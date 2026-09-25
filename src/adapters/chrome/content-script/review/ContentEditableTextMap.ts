import type { ProtectedRange, TextRange } from "@core/domain/grammar/review/types";
import { ancestorContext } from "../suggestions/CodeContextResolver";

/**
 * Snapshot of a contenteditable editor's text with an exact map back to DOM
 * text nodes. Reading never mutates the editor.
 *
 * - Block boundaries and <br> become "\n", non-editable islands (images,
 *   contenteditable=false chips, embeds) become U+FFFC. Both are virtual:
 *   marked "structure" so nothing is ever written across them.
 * - Text under code/pre/kbd/samp, Quill code blocks and code editors is marked
 *   "code" (the same signals as CodeContextResolver, range by range).
 * - Where CSS collapses whitespace, a single U+0020 maps 1:1; any other run
 *   ("\n  ", tabs, several spaces) reads as one protected space: it is not
 *   what the user sees, so it is never edited.
 */
export interface TextSegment {
  node: Text;
  /** Offset in node.data of snapshot offset `start`. */
  nodeStart: number;
  start: number;
  end: number;
}

export interface ContentEditableTextMap {
  text: string;
  protectedRanges: ProtectedRange[];
  segments: TextSegment[];
  signature: string;
  /** Snapshot offsets of node boundaries, for mapping element-offset selections. */
  nodeStarts: WeakMap<Node, number>;
  nodeEnds: WeakMap<Node, number>;
}

const BLOCK_TAGS = new Set(
  (
    "P DIV LI UL OL BLOCKQUOTE PRE TD TH TR TABLE THEAD TBODY TFOOT H1 H2 H3 H4 H5 H6 SECTION " +
    "ARTICLE HEADER FOOTER ASIDE NAV FIGURE FIGCAPTION DL DT DD ADDRESS DETAILS SUMMARY MAIN HR"
  ).split(" "),
);
const OBJECT_TAGS = new Set(
  "IMG IFRAME INPUT TEXTAREA SELECT BUTTON VIDEO AUDIO CANVAS SVG OBJECT EMBED MATH".split(" "),
);
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
// Zero-width characters rich editors insert as cursor guards.
const FILLER = /\u200B|\u200C|\u200D|\u2060|\uFEFF/;
// Characters that end an ordinary run of text, per white-space mode.
const SPECIAL_CHARS: Record<Whitespace, RegExp> = {
  collapse: /\u200B|\u200C|\u200D|\u2060|\uFEFF|[ \t\r\f\n]/g,
  "preserve-breaks": /\u200B|\u200C|\u200D|\u2060|\uFEFF|[ \t\r\f]/g,
  preserve: /\u200B|\u200C|\u200D|\u2060|\uFEFF/g,
};
/** Stop reading very large documents; the session reviews a bounded prefix and says so. */
export const MAX_MAPPED_CHARS = 200_000;

type Whitespace = "collapse" | "preserve" | "preserve-breaks";

function whitespaceOf(element: Element): Whitespace {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return "preserve";
  const whiteSpace = style.whiteSpace;
  if (whiteSpace === "normal" || whiteSpace === "nowrap") return "collapse";
  if (whiteSpace === "pre-line") return "preserve-breaks";
  if (whiteSpace === "pre" || whiteSpace === "pre-wrap" || whiteSpace === "break-spaces") {
    return "preserve";
  }
  // Any other combination is expressed by the white-space-collapse longhand.
  const collapse = (style as CSSStyleDeclaration & { whiteSpaceCollapse?: string })
    .whiteSpaceCollapse;
  if (collapse === "collapse") return "collapse";
  return collapse === "preserve-breaks" ? "preserve-breaks" : "preserve";
}

export function buildContentEditableTextMap(root: HTMLElement): ContentEditableTextMap {
  const parts: string[] = [];
  let length = 0;
  let last = "";
  const protectedRanges: ProtectedRange[] = [];
  const segments: TextSegment[] = [];
  const nodeStarts = new WeakMap<Node, number>();
  const nodeEnds = new WeakMap<Node, number>();

  const protect = (start: number, end: number, reason: ProtectedRange["reason"]) => {
    const previous = protectedRanges.at(-1);
    if (previous && previous.reason === reason && previous.end === start) previous.end = end;
    else protectedRanges.push({ start, end, reason });
  };
  const emit = (text: string) => {
    parts.push(text);
    length += text.length;
    last = text[text.length - 1] ?? last;
  };
  const emitVirtual = (char: string) => {
    protect(length, length + 1, "structure");
    emit(char);
  };
  const ensureBreak = () => {
    if (length > 0 && last !== "\n") emitVirtual("\n");
  };
  const addSegment = (node: Text, nodeStart: number, text: string, code: boolean) => {
    const start = length;
    const previous = segments.at(-1);
    if (
      previous &&
      previous.node === node &&
      previous.end === start &&
      previous.nodeStart + (previous.end - previous.start) === nodeStart
    ) {
      previous.end += text.length;
    } else {
      segments.push({ node, nodeStart, start, end: start + text.length });
    }
    if (code) protect(start, start + text.length, "code");
    emit(text);
  };

  const visitText = (node: Text, whitespace: Whitespace, code: boolean) => {
    const data = node.data;
    const special = SPECIAL_CHARS[whitespace];
    const collapsible = (ch: string | undefined) =>
      whitespace !== "preserve" &&
      (ch === " " ||
        ch === "\t" ||
        ch === "\r" ||
        ch === "\f" ||
        (ch === "\n" && whitespace === "collapse"));
    let i = 0;
    while (i < data.length) {
      // Ordinary text up to the next filler or collapsible whitespace, in one piece.
      special.lastIndex = i;
      const next = special.exec(data)?.index ?? data.length;
      if (next > i) {
        addSegment(node, i, data.slice(i, next), code);
        i = next;
        continue;
      }
      const ch = data[i];
      if (FILLER.test(ch)) {
        protect(length, length + 1, "structure");
        emit(ch);
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < data.length && collapsible(data[j])) j += 1;
      // Leading whitespace in a line is not rendered; neither is a second space.
      if (length === 0 || last === "\n" || last === " ") {
        i = j;
        continue;
      }
      if (j - i === 1 && ch === " ") {
        addSegment(node, i, " ", code);
      } else {
        protect(length, length + 1, "structure");
        emit(" ");
      }
      i = j;
    }
  };

  const visit = (node: Node, whitespace: Whitespace, code: boolean) => {
    if (length > MAX_MAPPED_CHARS) return;
    nodeStarts.set(node, length);
    if (node.nodeType === 3) {
      visitText(node as Text, whitespace, code);
    } else if (node.nodeType === 1) {
      const element = node as HTMLElement;
      const tag = element.tagName.toUpperCase();
      if (SKIPPED_TAGS.has(tag) || element.hidden) {
        // Not rendered; nothing to read.
      } else if (tag === "BR") {
        emitVirtual("\n");
      } else if (OBJECT_TAGS.has(tag)) {
        emitVirtual("\uFFFC");
      } else if (
        element !== root &&
        ancestorContext(element, element.parentNode ?? undefined) === "protected"
      ) {
        // contenteditable=false, read-only islands: one object, never read as prose.
        emitVirtual("\uFFFC");
      } else {
        const block = BLOCK_TAGS.has(tag);
        const childCode =
          code || ancestorContext(element, element.parentNode ?? undefined) === "code";
        const childWhitespace =
          element === root || block || element.hasAttribute("style")
            ? whitespaceOf(element)
            : whitespace;
        if (block) ensureBreak();
        for (let child = element.firstChild; child; child = child.nextSibling) {
          visit(child, childWhitespace, childCode);
        }
        if (block) ensureBreak();
      }
    }
    nodeEnds.set(node, length);
  };

  visit(root, whitespaceOf(root), ancestorContext(root) === "code");
  // A trailing virtual break is not text.
  let text = parts.join("");
  if (text.endsWith("\n") && protectedRanges.at(-1)?.end === text.length) {
    const lastRange = protectedRanges.at(-1)!;
    if (lastRange.reason === "structure") {
      text = text.slice(0, -1);
      lastRange.end -= 1;
      if (lastRange.end <= lastRange.start) protectedRanges.pop();
    }
  }

  return {
    text,
    protectedRanges,
    segments,
    signature: protectedRanges
      .map((range) => `${range.reason[0]}${range.start}-${range.end}`)
      .join(","),
    nodeStarts,
    nodeEnds,
  };
}

/** One block of the editor, read on its own, and where its text sits in the whole. */
export interface BlockText {
  element: HTMLElement;
  offset: number;
  map: ContentEditableTextMap;
}

/**
 * The nearest block element inside `root` that holds `range`, read on its own,
 * for verifying a write without re-reading the whole editor. Null when there is
 * no such block or its text does not line up exactly with `text` (the whole
 * editor's text, mapped by `map`): the caller then reads everything.
 */
export function readBlockAt(
  root: HTMLElement,
  map: ContentEditableTextMap,
  range: Range,
  text: string,
): BlockText | null {
  let node: Node | null = range.commonAncestorContainer;
  while (
    node &&
    node !== root &&
    !(node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName.toUpperCase()))
  ) {
    node = node.parentNode;
  }
  if (!node || node === root) return null;
  const element = node as HTMLElement;
  let offset = map.nodeStarts.get(element);
  if (offset === undefined) return null;
  const local = buildContentEditableTextMap(element);
  // The whole map may open the block with a virtual break the block's own read lacks.
  if (text[offset] === "\n" && !local.text.startsWith("\n")) offset += 1;
  if (text.slice(offset, offset + local.text.length) !== local.text) return null;
  return { element, offset, map: local };
}

/** Snapshot offset of a DOM position (text or element offset), or null when outside the map. */
export function domPositionToOffset(
  map: ContentEditableTextMap,
  container: Node,
  offset: number,
): number | null {
  if (container.nodeType === 3) {
    let best: number | null = null;
    for (const segment of map.segments) {
      if (segment.node !== container) continue;
      const length = segment.end - segment.start;
      if (offset < segment.nodeStart) {
        best ??= segment.start;
        break;
      }
      if (offset <= segment.nodeStart + length) return segment.start + (offset - segment.nodeStart);
      best = segment.end;
    }
    return best ?? map.nodeStarts.get(container) ?? null;
  }
  const child = container.childNodes[offset];
  if (child) return map.nodeStarts.get(child) ?? null;
  return map.nodeEnds.get(container) ?? null;
}

function segmentContaining(map: ContentEditableTextMap, index: number): TextSegment | null {
  let low = 0;
  let high = map.segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = map.segments[middle];
    if (index < segment.start) high = middle - 1;
    else if (index >= segment.end) low = middle + 1;
    else return segment;
  }
  return null;
}

/**
 * The DOM Range for a non-empty snapshot range. Each end is resolved inside the
 * text node that holds the character next to it, so a range never spills into
 * a neighbouring (differently formatted) node. Null when either end is virtual.
 */
export function offsetRangeToDomRange(
  map: ContentEditableTextMap,
  range: TextRange,
  doc: Document,
): Range | null {
  if (range.end <= range.start) return caretRange(map, range.start, doc);
  const first = segmentContaining(map, range.start);
  const lastSegment = segmentContaining(map, range.end - 1);
  if (!first || !lastSegment) return null;
  const domRange = doc.createRange();
  domRange.setStart(first.node, first.nodeStart + (range.start - first.start));
  domRange.setEnd(lastSegment.node, lastSegment.nodeStart + (range.end - lastSegment.start));
  return domRange;
}

/** A collapsed Range at `offset`, attached to the character before it where possible. */
export function caretRange(
  map: ContentEditableTextMap,
  offset: number,
  doc: Document,
): Range | null {
  const before = offset > 0 ? segmentContaining(map, offset - 1) : null;
  const segment = before ?? segmentContaining(map, offset);
  if (!segment) return null;
  const domRange = doc.createRange();
  const position = before
    ? segment.nodeStart + (offset - segment.start)
    : segment.nodeStart + (offset - segment.start);
  domRange.setStart(segment.node, position);
  domRange.collapse(true);
  return domRange;
}
