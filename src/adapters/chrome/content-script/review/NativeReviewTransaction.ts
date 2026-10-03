import type { ReviewEdit } from "@core/domain/grammar/review/types";
import { applyEdits } from "@core/domain/grammar/review/textRanges";
import { offsetRangeToDomRange, type ContentEditableTextMap } from "./ContentEditableTextMap";

/** One native replacement of the smallest range containing the edits. */
export interface NativeReviewTransaction {
  range: Range;
  command: "insertText" | "insertHTML";
  value: string;
}

const SAFE_TAGS = new Set(
  "P DIV BR SPAN A B STRONG I EM U S STRIKE MARK SMALL SUB SUP CODE PRE KBD SAMP BLOCKQUOTE UL OL LI H1 H2 H3 H4 H5 H6".split(
    " ",
  ),
);

/** Prepare only the changed range off-document. The live editor is never rebuilt. */
export function prepareNativeReviewTransaction(
  root: HTMLElement,
  map: ContentEditableTextMap,
  edits: readonly ReviewEdit[],
  gecko = false,
): NativeReviewTransaction | null {
  if (!edits.length || applyEdits(map.text, edits) === null) return null;
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const ranges = sorted.map((edit) => offsetRangeToDomRange(map, edit, root.ownerDocument));
  if (
    ranges.some(
      (range, index) =>
        !range ||
        range.startContainer.nodeType !== 3 ||
        range.startContainer !== range.endContainer ||
        range.toString() !== sorted[index].original,
    )
  )
    return null;
  const valid = ranges as Range[];
  const range = valid[0].cloneRange();
  const last = valid[valid.length - 1];
  range.setEnd(last.endContainer, last.endOffset);
  if (range.startContainer === range.endContainer) {
    const start = range.startOffset;
    const value = applyEdits(
      range.toString(),
      sorted.map((edit, index) => ({
        ...edit,
        start: valid[index].startOffset - start,
        end: valid[index].endOffset - start,
      })),
    );
    return value === null ? null : { range, command: "insertText", value };
  }
  // Partial block insertion lets browsers add style spans and boundary NBSPs.
  // Keep the affected block contents complete, without serializing the host.
  // Gecko needs the list wrapper. Chromium must keep that wrapper in place.
  const blockFor = (node: Node) =>
    (gecko ? node.parentElement?.closest("ul,ol") : null) ??
    node.parentElement?.closest("p,div,li,h1,h2,h3,h4,h5,h6,blockquote") ??
    root;
  const firstBlock = blockFor(range.startContainer);
  const lastBlock = blockFor(range.endContainer);
  if (
    !root.contains(firstBlock) ||
    !root.contains(lastBlock) ||
    firstBlock.parentNode !== lastBlock.parentNode ||
    firstBlock.tagName !== lastBlock.tagName ||
    (firstBlock.matches("ul,ol") && firstBlock !== lastBlock)
  )
    return null;
  range.setStart(firstBlock, 0);
  range.setEnd(lastBlock, lastBlock.childNodes.length);
  if (firstBlock.matches("ul,ol")) {
    if (firstBlock === root) return null;
    range.setStartBefore(firstBlock);
  }
  if (lastBlock.matches("ul,ol")) {
    if (lastBlock === root) return null;
    range.setEndAfter(lastBlock);
  }
  // Native insertion replaces nodes inside this range. Refuse stateful islands
  // and executable markup before cloning, which could activate resource loads.
  for (const element of root.querySelectorAll("*")) {
    if (!range.intersectsNode(element)) continue;
    if (
      !SAFE_TAGS.has(element.tagName) ||
      element.hasAttribute("contenteditable") ||
      element.hasAttribute("id") ||
      [...element.attributes].some(
        (attr) => /^on/i.test(attr.name) || /^(?:javascript|vbscript):/i.test(attr.value.trim()),
      )
    )
      return null;
  }
  const fragment = range.cloneContents();
  const walker = root.ownerDocument.createTreeWalker(fragment, 4);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node as Text);
  const changes = valid.map((part, index) => {
    const prefix = range.cloneRange();
    prefix.setEnd(part.startContainer, part.startOffset);
    let offset = prefix.toString().length;
    for (const node of textNodes) {
      if (offset < node.length || (offset === node.length && part.startOffset > 0)) {
        const edit = sorted[index];
        if (node.data.slice(offset, offset + edit.original.length) !== edit.original) return null;
        return { node, offset, edit };
      }
      offset -= node.length;
    }
    return null;
  });
  if (changes.some((change) => !change)) return null;
  for (const change of changes.reverse()) {
    if (change)
      change.node.replaceData(change.offset, change.edit.original.length, change.edit.replacement);
  }
  const container = root.ownerDocument.createElement("div");
  container.append(fragment);
  return { range, command: "insertHTML", value: container.innerHTML };
}
