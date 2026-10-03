import type { ReviewApplyResult, ReviewTargetText } from "@core/application/review/ReviewSession";
import type { ReviewEdit } from "@core/domain/grammar/review/types";
import { applyEdits } from "@core/domain/grammar/review/textRanges";
import {
  buildContentEditableTextMap,
  offsetRangeToDomRange,
} from "../review/ContentEditableTextMap";
import { formattingPreservingEdits } from "../review/RichTextFormatting";

interface DeltaOperation {
  retain?: number;
  delete?: number;
  insert?: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}
interface Delta {
  ops: DeltaOperation[];
  diff(other: Delta): Delta;
  length(): number;
  compose(other: { ops: DeltaOperation[] }): Delta;
}
interface QuillInstance {
  root: HTMLElement;
  container: HTMLElement;
  selection?: { composing?: boolean };
  history: { cutoff(): void };
  isEnabled(): boolean;
  getContents(index?: number, length?: number): Delta;
  getText(index?: number, length?: number): string;
  getIndex(blot: unknown): number;
  updateContents(delta: { ops: DeltaOperation[] }, source: "user"): unknown;
}
interface QuillClass {
  find(node: Node, bubble?: boolean): unknown;
}

const instanceIds = new WeakMap<QuillInstance, number>();
let nextInstanceId = 0;

function owningQuill(root: HTMLElement): { quill: QuillInstance; library: QuillClass } | null {
  const library = (root.ownerDocument.defaultView as (Window & { Quill?: QuillClass }) | null)
    ?.Quill;
  const container = root.closest<HTMLElement>(".ql-container");
  if (!root.isConnected || !container || typeof library?.find !== "function") return null;
  const quill = library.find(container) as QuillInstance | null;
  if (
    !quill ||
    quill.root !== root ||
    quill.container !== container ||
    !quill.isEnabled?.() ||
    typeof quill.getContents !== "function" ||
    typeof quill.getText !== "function" ||
    typeof quill.getIndex !== "function" ||
    typeof quill.updateContents !== "function" ||
    typeof quill.history?.cutoff !== "function"
  )
    return null;
  return { quill, library };
}

/** The public Quill model and DOM must belong to the same editor. */
export function readQuill(root: HTMLElement): ReviewTargetText | null {
  const owner = owningQuill(root);
  if (!owner || owner.quill.selection?.composing) return null;
  const map = buildContentEditableTextMap(root);
  const contents = owner.quill.getContents();
  if (
    !Array.isArray(contents.ops) ||
    typeof contents.compose !== "function" ||
    typeof contents.diff !== "function" ||
    typeof contents.length !== "function"
  )
    return null;
  let identity = instanceIds.get(owner.quill);
  if (identity === undefined) {
    identity = ++nextInstanceId;
    instanceIds.set(owner.quill, identity);
  }
  return {
    text: map.text,
    protectedRanges: map.protectedRanges,
    signature: JSON.stringify([identity, map.signature, contents.ops]),
  };
}

/** Build the entire Delta before one model update, with explicit history boundaries. */
export function applyQuill(
  root: HTMLElement,
  request: {
    edits: ReviewEdit[];
    before: string;
    after: string;
    signature: string;
  },
): ReviewApplyResult {
  const owner = owningQuill(root);
  if (owner?.quill.selection?.composing) return { status: "rejected", reason: "composing" };
  const snapshot = readQuill(root);
  if (!owner || !snapshot) return { status: "rejected", reason: "unsupported" };
  if (snapshot.text !== request.before || snapshot.signature !== request.signature)
    return { status: "stale" };
  if (
    !Array.isArray(request.edits) ||
    !request.edits.length ||
    applyEdits(request.before, request.edits) !== request.after
  )
    return { status: "rejected", reason: "host-refused" };
  const { quill, library } = owner;
  const map = buildContentEditableTextMap(root);
  const planned = formattingPreservingEdits(map, request.edits);
  if (!planned) return { status: "rejected", reason: "host-refused" };
  const original = quill.getContents();
  const ops: DeltaOperation[] = [];
  let cursor = 0;
  for (const edit of [...planned].sort((a, b) => a.start - b.start)) {
    const range = offsetRangeToDomRange(map, edit, root.ownerDocument);
    if (!range || range.startContainer.nodeType !== 3 || range.endContainer.nodeType !== 3)
      return { status: "rejected", reason: "unsupported" };
    const startBlot = library.find(range.startContainer);
    const endBlot = library.find(range.endContainer);
    if (!startBlot || !endBlot) return { status: "stale" };
    const from = quill.getIndex(startBlot) + range.startOffset;
    const to = quill.getIndex(endBlot) + range.endOffset;
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < cursor ||
      to < from ||
      to > original.length() ||
      quill.getText(from, to - from) !== edit.original
    )
      return { status: "stale" };
    if (from > cursor) ops.push({ retain: from - cursor });
    if (to > from) ops.push({ delete: to - from });
    if (edit.replacement) {
      const attributesAt = from === to && range.startOffset > 0 ? from - 1 : from;
      const attributes = quill.getContents(attributesAt, 1).ops[0]?.attributes;
      ops.push({ insert: edit.replacement, ...(attributes ? { attributes } : {}) });
    }
    cursor = to;
  }
  if (!ops.length) return { status: "rejected", reason: "host-refused" };
  const expected = original.compose({ ops });
  // Re-read after all page-owned lookups, before the only mutation.
  if (readQuill(root)?.signature !== request.signature) return { status: "stale" };
  quill.history.cutoff();
  try {
    quill.updateContents({ ops }, "user");
  } catch {
    // A host can throw after committing. Verification, not the exception, decides.
  } finally {
    quill.history.cutoff();
  }
  const observed = quill.getContents();
  if (original.diff(observed).ops.length === 0)
    return readQuill(root)?.signature === request.signature
      ? { status: "rejected", reason: "host-refused" }
      : { status: "unverified" };
  return expected.diff(observed).ops.length === 0 && readQuill(root)?.text === request.after
    ? { status: "applied" }
    : { status: "unverified" };
}
