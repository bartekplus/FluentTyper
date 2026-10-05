import { isLockedField, isSensitiveField, isHiddenField } from "./FieldEligibility";
import { hasOtherFocusedEditor } from "./TextTargetAdapter";
import { isComposingIn } from "./HostEditorControllerUtils";
import type { ReviewApplyResult, ReviewTargetText } from "@core/application/review/ReviewSession";
import type { HostEditorReviewApplyRequest } from "./HostEditorBridgeProtocol";
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
  update?(source: "user"): unknown;
}
interface QuillClass {
  find(node: Node, bubble?: boolean): unknown;
}

const instanceIds = new WeakMap<QuillInstance, number>();
let nextInstanceId = 0;

function isEligible(root: HTMLElement): boolean {
  return (
    root.isConnected && !isLockedField(root) && !isSensitiveField(root) && !isHiddenField(root)
  );
}

function owningQuill(root: HTMLElement): { quill: QuillInstance; library: QuillClass } | null {
  const container = root.closest<HTMLElement & { __quill?: { constructor?: QuillClass } }>(
    ".ql-container",
  );
  // A bundled Quill 1 (Slack, react-quill) has no window.Quill. Its class is
  // the constructor of the instance that it stores on the container.
  const library =
    container?.__quill?.constructor ??
    (root.ownerDocument.defaultView as (Window & { Quill?: QuillClass }) | null)?.Quill;
  if (!isEligible(root) || !container || typeof library?.find !== "function") return null;
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

/**
 * Quill's history merges the changes of the last second into one undo step.
 * A typing write calls this before and after its native edit, so that the edit
 * is one undo step apart from the typed text before it and after it.
 * `update` first records the pending DOM changes (typed text, or Quill 1's
 * execCommand result); `cutoff` then starts a new undo step. A bundled Quill 2
 * keeps its instance in a module-private map: there is no instance and no boundary.
 */
export function quillHistoryBoundary(root: HTMLElement): boolean {
  const owner = owningQuill(root);
  if (!owner || owner.quill.selection?.composing || isComposingIn(root)) return false;
  const { quill } = owner;
  if (typeof quill.update !== "function") return false;
  try {
    quill.update("user");
    quill.history.cutoff();
    return true;
  } catch {
    return false;
  }
}

/** The public Quill model and DOM must belong to the same editor. */
export function readQuill(root: HTMLElement): ReviewTargetText | null {
  const owner = owningQuill(root);
  if (!owner || owner.quill.selection?.composing) return null;
  const map = buildContentEditableTextMap(root);
  const contents = owner.quill.getContents();
  if (
    !isEligible(root) ||
    !Array.isArray(contents.ops) ||
    typeof contents.compose !== "function" ||
    typeof contents.diff !== "function" ||
    typeof contents.length !== "function"
  )
    return null;
  const after = buildContentEditableTextMap(root);
  if (after.text !== map.text || after.signature !== map.signature) return null;
  // A full Delta contains inserts only. Embeds occupy one protected DOM offset.
  const parts: string[] = [];
  for (const op of contents.ops) {
    if (op.retain !== undefined || op.delete !== undefined) return null;
    if (typeof op.insert === "string") parts.push(op.insert);
    else if (op.insert && typeof op.insert === "object" && !Array.isArray(op.insert))
      parts.push("\uFFFC");
    else return null;
  }
  const modelText = parts.join("");
  // Quill's terminal line marker is not part of the mapped review text.
  if ((modelText.endsWith("\n") ? modelText.slice(0, -1) : modelText) !== map.text) return null;
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
  request: HostEditorReviewApplyRequest,
): ReviewApplyResult {
  if (!isEligible(root)) return { status: "rejected", reason: "ineligible" };
  if (hasOtherFocusedEditor(root)) return { status: "stale" };
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
  if (!isEligible(root)) return { status: "rejected", reason: "ineligible" };
  const history = quill.history;
  history.cutoff();
  // Page-owned lookups and history callbacks can change eligibility or the model.
  // Recheck after them, immediately before the only text mutation.
  if (!isEligible(root)) return { status: "rejected", reason: "ineligible" };
  if (quill.selection?.composing) return { status: "rejected", reason: "composing" };
  if (
    quill.history !== history ||
    readQuill(root)?.signature !== request.signature ||
    hasOtherFocusedEditor(root)
  )
    return { status: "stale" };
  let historyVerified: boolean;
  try {
    quill.updateContents({ ops }, "user");
  } catch {
    // A host can throw after committing. Verification, not the exception, decides.
  } finally {
    try {
      historyVerified = quill.history === history;
      history.cutoff();
      historyVerified = historyVerified && quill.history === history;
    } catch {
      historyVerified = false;
    }
  }
  try {
    const observed = quill.getContents();
    if (!historyVerified) return { status: "unverified" };
    if (original.diff(observed).ops.length === 0)
      return readQuill(root)?.signature === request.signature
        ? { status: "rejected", reason: "host-refused" }
        : { status: "unverified" };
    const verified = readQuill(root);
    return expected.diff(observed).ops.length === 0 && verified?.text === request.after
      ? { status: "applied", signature: verified.signature }
      : { status: "unverified" };
  } catch {
    // The host can remove or reconfigure its model after a committed write.
    return { status: "unverified" };
  }
}
