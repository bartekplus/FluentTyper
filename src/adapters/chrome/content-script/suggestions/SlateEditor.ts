import type { ReviewApplyResult, ReviewTargetText } from "@core/application/review/ReviewSession";
import type { ReviewEdit } from "@core/domain/grammar/review/types";
import { applyEdits } from "@core/domain/grammar/review/textRanges";
import {
  buildContentEditableTextMap,
  offsetRangeToDomRange,
} from "../review/ContentEditableTextMap";
import { formattingPreservingEdits } from "../review/RichTextFormatting";
import { isHiddenField, isLockedField, isSensitiveField } from "./FieldEligibility";
import type { LineEditorBlockContext } from "./HostEditorControllerUtils";
import type { HostEditorApplyResult } from "./HostEditorAdapterResolver";

/* Slate keeps its editor in React state only. The nearest `<Slate editor>` (or its
 * EditorContext provider) above the editable root is found through React's fiber
 * expando. Every read checks that the rendered text nodes match the model one to
 * one, so an unknown version or a foreign editor stays read-only.
 */
type SlateNode = { text?: unknown; children?: unknown };
interface SlatePoint {
  path: number[];
  offset: number;
}
interface SlateRange {
  anchor: SlatePoint;
  focus: SlatePoint;
}
type TextOperation = {
  type: "insert_text" | "remove_text";
  path: number[];
  offset: number;
  text: string;
};
type SlateOperation =
  | TextOperation
  | {
      type: "set_selection";
      properties: SlateRange | null;
      newProperties: SlateRange;
    };
interface SlateEditor {
  children: SlateNode[];
  selection: SlateRange | null;
  operations: unknown[];
  apply(operation: SlateOperation): void;
  onChange(): void;
  isInline(element: SlateNode): boolean;
  withoutNormalizing?(fn: () => void): void;
  history?: { undos: { operations: unknown[]; selectionBefore: unknown }[] };
}
interface Leaf {
  path: number[];
  text: string;
}
/** A model position: index into the document's text leaves and an offset in that leaf. */
interface LeafPoint {
  leaf: number;
  offset: number;
}
interface LeafEdit {
  start: LeafPoint;
  end: LeafPoint;
  replacement: string;
}

export const SLATE_ROOT_SELECTOR = '[data-slate-editor="true"]';
const ROOT = SLATE_ROOT_SELECTOR;

function isSlateEditor(value: unknown): value is SlateEditor {
  const editor = value as Partial<SlateEditor> | null;
  return (
    !!editor &&
    typeof editor === "object" &&
    Array.isArray(editor.children) &&
    Array.isArray(editor.operations) &&
    "selection" in editor &&
    typeof editor.apply === "function" &&
    typeof editor.onChange === "function" &&
    typeof editor.isInline === "function"
  );
}

function owningSlate(root: HTMLElement): SlateEditor | null {
  if (
    !root.matches(ROOT) ||
    !root.isConnected ||
    !root.isContentEditable ||
    isLockedField(root) ||
    isSensitiveField(root) ||
    isHiddenField(root)
  )
    return null;
  type Fiber = { return?: Fiber | null; memoizedProps?: { editor?: unknown; value?: unknown } };
  const key = Object.keys(root).find(
    (name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"),
  );
  let fiber = key ? (root as unknown as Record<string, Fiber | undefined>)[key] : undefined;
  for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return ?? undefined) {
    const props = fiber.memoizedProps;
    if (isSlateEditor(props?.editor)) return props.editor;
    if (isSlateEditor(props?.value)) return props.value;
  }
  return null;
}

function modelLeaves(nodes: SlateNode[], path: number[] = [], out: Leaf[] = []): Leaf[] | null {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const at = [...path, index];
    if (typeof node?.text === "string") out.push({ path: at, text: node.text });
    else if (!Array.isArray(node?.children) || !modelLeaves(node.children as SlateNode[], at, out))
      return null;
  }
  return out;
}

function nodeAt(editor: SlateEditor, path: number[]): SlateNode | null {
  let node: SlateNode | undefined = { children: editor.children };
  for (const index of path) node = (node?.children as SlateNode[] | undefined)?.[index];
  return node ?? null;
}

function textSpans(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-slate-node="text"]')].filter(
    (span) => span.closest(ROOT) === root,
  );
}

function stringsOf(span: HTMLElement): HTMLElement[] {
  return [...span.querySelectorAll<HTMLElement>("[data-slate-string]")].filter(
    (string) => string.closest('[data-slate-node="text"]') === span,
  );
}

/** The editor, its leaves and their rendered spans, only while they agree exactly. */
function synced(root: HTMLElement) {
  const editor = owningSlate(root);
  // Operations not yet flushed to React mean the DOM is behind the model.
  if (!editor || editor.operations.length) return null;
  const leaves = modelLeaves(editor.children);
  const spans = textSpans(root);
  if (
    !leaves ||
    leaves.length !== spans.length ||
    leaves.some(
      (leaf, index) =>
        leaf.text !==
        stringsOf(spans[index])
          .map((string) => string.textContent ?? "")
          .join(""),
    )
  )
    return null;
  return { editor, leaves, spans };
}

export function readSlate(root: HTMLElement): ReviewTargetText | null {
  const state = synced(root);
  if (!state) return null;
  const map = buildContentEditableTextMap(root);
  return {
    text: map.text,
    protectedRanges: map.protectedRanges,
    signature: JSON.stringify([map.signature, state.editor.children]),
  };
}

function domToLeaf(
  spans: HTMLElement[],
  leaves: Leaf[],
  container: Node,
  offset: number,
): LeafPoint | null {
  const element = container.nodeType === 3 ? container.parentElement : (container as Element);
  const span = element?.closest<HTMLElement>('[data-slate-node="text"]');
  const leaf = span ? spans.indexOf(span) : -1;
  if (!span || leaf < 0) return null;
  let at = 0;
  for (const string of stringsOf(span)) {
    if (string.contains(container)) {
      const prefix = string.ownerDocument.createRange();
      prefix.setStart(string, 0);
      prefix.setEnd(container, offset);
      return { leaf, offset: at + prefix.toString().length };
    }
    at += string.textContent?.length ?? 0;
  }
  return leaves[leaf].text === "" ? { leaf, offset: 0 } : null;
}

const parentKey = (leaf: Leaf) => leaf.path.slice(0, -1).join();
const pathKey = (path: number[]) => path.join();

/**
 * Replace text through `editor.apply` only. Edits run last to first; inside an edit the
 * replacement is inserted before the start leaf is trimmed, so no leaf empties early.
 */
function applyLeafEdits(
  editor: SlateEditor,
  leaves: Leaf[],
  edits: LeafEdit[],
  selectAfter?: (leaves: Leaf[]) => LeafPoint | null,
): "applied" | "refused" | "unverified" {
  const sorted = [...edits].sort(
    (a, b) => b.start.leaf - a.start.leaf || b.start.offset - a.start.offset,
  );
  const operations: TextOperation[] = [];
  let limit: LeafPoint = { leaf: Infinity, offset: Infinity };
  for (const { start, end, replacement } of sorted) {
    const first = leaves[start.leaf],
      last = leaves[end.leaf];
    if (
      !first ||
      !last ||
      end.leaf < start.leaf ||
      (end.leaf === start.leaf && end.offset < start.offset) ||
      end.leaf > limit.leaf ||
      (end.leaf === limit.leaf && end.offset > limit.offset) ||
      start.offset < 0 ||
      start.offset > first.text.length ||
      end.offset > last.text.length ||
      leaves.slice(start.leaf, end.leaf + 1).some((leaf) => parentKey(leaf) !== parentKey(first))
    )
      return "refused";
    limit = start;
    for (let index = end.leaf; index > start.leaf; index--) {
      const leaf = leaves[index];
      const to = index === end.leaf ? end.offset : leaf.text.length;
      if (to > 0)
        operations.push({
          type: "remove_text",
          path: leaf.path,
          offset: 0,
          text: leaf.text.slice(0, to),
        });
    }
    const to = end.leaf === start.leaf ? end.offset : first.text.length;
    if (replacement)
      operations.push({
        type: "insert_text",
        path: first.path,
        offset: start.offset,
        text: replacement,
      });
    if (to > start.offset)
      operations.push({
        type: "remove_text",
        path: first.path,
        offset: start.offset + replacement.length,
        text: first.text.slice(start.offset, to),
      });
  }
  if (!operations.length) return "refused";
  const concat = (list: Leaf[]) => list.map((leaf) => leaf.text).join("");
  const starts: number[] = [];
  leaves.reduce((at, leaf) => (starts.push(at), at + leaf.text.length), 0);
  let expected = concat(leaves);
  for (const edit of sorted)
    expected =
      expected.slice(0, starts[edit.start.leaf] + edit.start.offset) +
      edit.replacement +
      expected.slice(starts[edit.end.leaf] + edit.end.offset);

  // slate-history merges an operation into the previous batch when it continues the
  // user's typing. An empty batch on top makes this edit its own Undo step; it is
  // removed again right after, and kept only if the host put operations into it.
  const undos = Array.isArray(editor.history?.undos) ? editor.history.undos : null;
  const marker = { operations: [] as unknown[], selectionBefore: editor.selection };
  undos?.push(marker);
  let applied = 0;
  let failed = false;
  const run = () => {
    for (const operation of operations) {
      const node = nodeAt(editor, operation.path);
      const text = typeof node?.text === "string" ? node.text : null;
      if (
        text === null ||
        (operation.type === "remove_text" &&
          text.slice(operation.offset, operation.offset + operation.text.length) !==
            operation.text) ||
        (operation.type === "insert_text" && operation.offset > text.length)
      ) {
        failed = true;
        return;
      }
      editor.apply(operation);
      applied++;
    }
  };
  try {
    if (typeof editor.withoutNormalizing === "function") editor.withoutNormalizing(run);
    else run();
  } catch {
    failed = true;
  } finally {
    const index = undos?.indexOf(marker) ?? -1;
    if (undos && index >= 0 && !marker.operations.length) undos.splice(index, 1);
  }
  if (!applied) return "refused";
  const after = modelLeaves(editor.children);
  if (failed || !after || concat(after) !== expected) return "unverified";
  const caret = selectAfter?.(after);
  if (selectAfter) {
    if (!caret) return "unverified";
    const point = { path: after[caret.leaf].path, offset: caret.offset };
    try {
      editor.apply({
        type: "set_selection",
        properties: editor.selection,
        // Separate objects: the host may serialize or freeze each point on its own.
        newProperties: { anchor: point, focus: { path: [...point.path], offset: point.offset } },
      });
    } catch {
      return "unverified";
    }
  }
  return "applied";
}

export function applySlate(
  root: HTMLElement,
  request: { edits: ReviewEdit[]; before: string; after: string; signature: string },
): ReviewApplyResult {
  const snapshot = readSlate(root);
  const state = synced(root);
  if (!snapshot || !state) return { status: "rejected", reason: "unsupported" };
  if (snapshot.text !== request.before || snapshot.signature !== request.signature)
    return { status: "stale" };
  if (
    !Array.isArray(request.edits) ||
    !request.edits.length ||
    applyEdits(snapshot.text, request.edits) !== request.after
  )
    return { status: "rejected", reason: "host-refused" };
  const map = buildContentEditableTextMap(root);
  const planned = formattingPreservingEdits(map, request.edits);
  if (!planned) return { status: "rejected", reason: "host-refused" };
  const edits: LeafEdit[] = [];
  for (const edit of planned) {
    const range = offsetRangeToDomRange(map, edit, root.ownerDocument);
    if (!range || range.toString() !== edit.original) return { status: "stale" };
    const start = domToLeaf(state.spans, state.leaves, range.startContainer, range.startOffset);
    const end = domToLeaf(state.spans, state.leaves, range.endContainer, range.endOffset);
    if (!start || !end) return { status: "rejected", reason: "host-refused" };
    edits.push({ start, end, replacement: edit.replacement });
  }
  const result = applyLeafEdits(state.editor, state.leaves, edits);
  return result === "applied"
    ? { status: "applied" }
    : result === "unverified"
      ? { status: "unverified" }
      : { status: "rejected", reason: "host-refused" };
}

/** The block's leaves around the model's collapsed selection. Text inside inline
 * elements belongs to the block; a block never mixes inline and block children.
 */
function selectionBlock(root: HTMLElement) {
  const editor = owningSlate(root);
  const selection = editor?.selection;
  const leaves = editor && modelLeaves(editor.children);
  if (
    !editor ||
    !leaves ||
    !selection ||
    pathKey(selection.anchor.path) !== pathKey(selection.focus.path) ||
    selection.anchor.offset !== selection.focus.offset
  )
    return null;
  const caretLeaf = leaves.findIndex(
    (leaf) => pathKey(leaf.path) === pathKey(selection.anchor.path),
  );
  if (caretLeaf < 0 || selection.anchor.offset > leaves[caretLeaf].text.length) return null;
  let blockPath = leaves[caretLeaf].path.slice(0, -1);
  while (blockPath.length && editor.isInline(nodeAt(editor, blockPath)!))
    blockPath = blockPath.slice(0, -1);
  if (!blockPath.length) return null;
  const inBlock = (leaf: Leaf) =>
    pathKey(leaf.path.slice(0, blockPath.length)) === pathKey(blockPath);
  const first = leaves.findIndex(inBlock);
  const count = leaves.filter(inBlock).length;
  const block = leaves.slice(first, first + count);
  const blockText = block.map((leaf) => leaf.text).join("");
  const beforeCursor =
    block
      .slice(0, caretLeaf - first)
      .map((leaf) => leaf.text)
      .join("") + leaves[caretLeaf].text.slice(0, selection.anchor.offset);
  return { editor, leaves, blockPath, first, count, blockText, beforeCursor };
}

/** Block-local offset to a leaf point; `before` attaches to the character before it. */
function blockPoint(
  leaves: Leaf[],
  first: number,
  count: number,
  offset: number,
  bias: "before" | "after",
): LeafPoint | null {
  let at = 0;
  for (let leaf = first; leaf < first + count; leaf++) {
    const end = at + leaves[leaf].text.length;
    if (bias === "before" ? offset > at && offset <= end : offset >= at && offset < end)
      return { leaf, offset: offset - at };
    at = end;
  }
  if (offset === 0) return { leaf: first, offset: 0 };
  return offset === at && count
    ? { leaf: first + count - 1, offset: leaves[first + count - 1].text.length }
    : null;
}

export function slateBlockContext(root: HTMLElement): LineEditorBlockContext | null {
  const block = selectionBlock(root);
  return block
    ? {
        beforeCursor: block.beforeCursor,
        afterCursor: block.blockText.slice(block.beforeCursor.length),
        blockText: block.blockText,
      }
    : null;
}

export function replaceSlateBlock(
  root: HTMLElement,
  request: {
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
    cursorAfter: number;
    expectedBlockText: string;
  },
): HostEditorApplyResult {
  const refused = { applied: false, didDispatchInput: false };
  const block = selectionBlock(root);
  if (
    !block ||
    block.blockText !== request.expectedBlockText ||
    !Number.isSafeInteger(request.replaceStart) ||
    !Number.isSafeInteger(request.replaceEnd) ||
    !Number.isSafeInteger(request.cursorAfter) ||
    request.replaceStart < 0 ||
    request.replaceEnd < request.replaceStart ||
    request.replaceEnd > block.blockText.length ||
    request.cursorAfter < 0 ||
    request.cursorAfter >
      block.blockText.length -
        (request.replaceEnd - request.replaceStart) +
        request.replacementText.length
  )
    return refused;
  const { editor, leaves, blockPath, first, count } = block;
  const collapsed = request.replaceStart === request.replaceEnd;
  const start = blockPoint(
    leaves,
    first,
    count,
    request.replaceStart,
    collapsed ? "before" : "after",
  );
  const end = collapsed ? start : blockPoint(leaves, first, count, request.replaceEnd, "before");
  if (!start || !end) return refused;
  const result = applyLeafEdits(
    editor,
    leaves,
    [{ start, end, replacement: request.replacementText }],
    (after) => {
      const inBlock = (leaf: Leaf) =>
        pathKey(leaf.path.slice(0, blockPath.length)) === pathKey(blockPath);
      const from = after.findIndex(inBlock);
      return from < 0
        ? null
        : blockPoint(after, from, after.filter(inBlock).length, request.cursorAfter, "before");
    },
  );
  return result === "applied"
    ? { applied: true, didDispatchInput: false }
    : result === "unverified"
      ? { ...refused, unverified: true }
      : refused;
}
