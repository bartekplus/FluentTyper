import { formattingPreservingEdits } from "../review/RichTextFormatting";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as ModelNode } from "prosemirror-model";
import type { ReviewApplyResult, ReviewTargetText } from "@core/application/review/ReviewSession";
import type { ReviewEdit } from "@core/domain/grammar/review/types";
import {
  applyEdits,
  editTouches,
  isGraphemeBoundary,
} from "@core/domain/grammar/review/textRanges";
import {
  buildContentEditableTextMap,
  offsetRangeToDomRange,
} from "../review/ContentEditableTextMap";
import { isLockedField, isSensitiveField } from "./FieldEligibility";
import type { LineEditorBlockContext } from "./HostEditorControllerUtils";
import type { HostEditorApplyResult } from "./HostEditorAdapterResolver";

type HostView = EditorView & { docView: Descriptor; domObserver: { flush(): void } };

interface Descriptor {
  dom: HTMLElement;
  node: ModelNode;
  setSelection(anchor: number, head: number, view: HostView, force?: boolean): void;
  updateChildren(view: HostView, position: number): void;
}
const views = new WeakMap<HTMLElement, HostView>();
const armed = new WeakSet<Descriptor>();

function descriptor(root: HTMLElement): Descriptor | null {
  const value = (root as HTMLElement & { pmViewDesc?: Descriptor }).pmViewDesc;
  return value?.dom === root &&
    value.node?.type?.name === "doc" &&
    typeof value.setSelection === "function" &&
    typeof value.updateChildren === "function"
    ? value
    : null;
}

/** ProseMirror passes its owning view to these methods during normal updates.
 * No global/test handle, editor creation interception, or document mutation is needed.
 * This private descriptor is capability-checked on every access; unsupported versions
 * remain read-only until their owning view can be verified.
 */
export function observeProseMirror(root: HTMLElement): void {
  const desc = descriptor(root);
  if (!desc || armed.has(desc)) return;
  armed.add(desc);
  const remember = (view: HostView) => {
    if (view.dom === root && !view.isDestroyed && view.docView === desc) views.set(root, view);
  };
  const select = desc.setSelection.bind(desc);
  desc.setSelection = function (anchor, head, view, force) {
    remember(view);
    return select.call(this, anchor, head, view, force);
  };
  const update = desc.updateChildren.bind(desc);
  desc.updateChildren = function (view, position) {
    remember(view);
    return update.call(this, view, position);
  };
}

function owningView(root: HTMLElement): HostView | null {
  observeProseMirror(root);
  const view = views.get(root);
  return view && view.dom === root && !view.isDestroyed && view.docView === descriptor(root)
    ? view
    : null;
}

export function readProseMirror(root: HTMLElement): ReviewTargetText | null {
  const view = owningView(root);
  if (
    !view ||
    !view.editable ||
    view.composing ||
    !root.isConnected ||
    isLockedField(root) ||
    isSensitiveField(root)
  )
    return null;
  view.domObserver.flush();
  const map = buildContentEditableTextMap(root);
  return {
    text: map.text,
    protectedRanges: map.protectedRanges,
    signature: JSON.stringify([map.signature, view.state.doc.toJSON()]),
  };
}

/** Different ProseMirror bundles allocate different PluginKey suffixes. Let the
 * host history plugin supply its own closeHistory key rather than guessing it.
 */
function closeHostHistory(tr: Transaction): Transaction {
  const readMeta = tr.getMeta.bind(tr);
  tr.getMeta = (key): unknown => {
    const name = typeof key === "string" ? key : (key as unknown as { key: string }).key;
    if (name?.startsWith("closeHistory$")) return true;
    return readMeta(key);
  };
  return tr;
}

/** A host transaction is prepared completely before it is dispatched. */
export function applyProseMirror(
  root: HTMLElement,
  request: {
    edits: ReviewEdit[];
    before: string;
    after: string;
    signature: string;
  },
): ReviewApplyResult {
  const snapshot = readProseMirror(root);
  const view = owningView(root);
  if (!view || !snapshot) return { status: "rejected", reason: "unsupported" };
  if (snapshot.text !== request.before || snapshot.signature !== request.signature)
    return { status: "stale" };
  if (!Array.isArray(request.edits) || applyEdits(snapshot.text, request.edits) !== request.after)
    return { status: "rejected", reason: "host-refused" };
  const map = buildContentEditableTextMap(root);
  const state = view.state;
  const tr = state.tr;
  const planned = formattingPreservingEdits(map, request.edits);
  if (!planned) return { status: "rejected", reason: "host-refused" };
  const edits = planned.sort((a, b) => b.start - a.start);
  for (const edit of edits) {
    if (
      !isGraphemeBoundary(snapshot.text, edit.start) ||
      !isGraphemeBoundary(snapshot.text, edit.end) ||
      map.protectedRanges.some((range) => editTouches(edit, range))
    )
      return { status: "rejected", reason: "host-refused" };
    const range = offsetRangeToDomRange(map, edit, root.ownerDocument);
    if (!range || range.toString() !== edit.original) return { status: "stale" };
    const from = view.posAtDOM(range.startContainer, range.startOffset, 1);
    const to = view.posAtDOM(range.endContainer, range.endOffset, -1);
    const $from = state.doc.resolve(from),
      $to = state.doc.resolve(to);
    if (
      !$from.sameParent($to) ||
      !$from.parent.isTextblock ||
      $from.parent.type.spec.code ||
      state.doc.textBetween(from, to, "\n", "\uFFFC") !== edit.original
    )
      return { status: "rejected", reason: "host-refused" };
    let marks = $from.marks();
    let markKey: string | null = null;
    let valid = true;
    state.doc.nodesBetween(from, to, (node) => {
      if (node.isText) {
        const key = JSON.stringify(node.marks);
        if (markKey !== null && key !== markKey && edit.replacement) valid = false;
        markKey = key;
        marks = node.marks;
      } else if (node.isInline && node.isAtom) valid = false;
    });
    if (!valid) return { status: "rejected", reason: "host-refused" };
    tr.replaceWith(from, to, edit.replacement ? state.schema.text(edit.replacement, marks) : []);
  }
  // One transaction, one independent history event, with the host selection mapped.
  closeHostHistory(tr);
  view.dispatch(tr);
  const expected = tr.doc;
  const observed = readProseMirror(root);
  if (view.state.doc.eq(state.doc) && !expected.eq(state.doc))
    return { status: "rejected", reason: "host-refused" };
  if (!observed || observed.text !== request.after || !view.state.doc.eq(expected))
    return { status: "unverified" };
  // Keep subsequent typing out of the correction's history event as well.
  view.dispatch(closeHostHistory(view.state.tr));
  return view.state.doc.eq(expected) ? { status: "applied" } : { status: "unverified" };
}

export function proseMirrorBlockContext(root: HTMLElement): LineEditorBlockContext | null {
  const view = owningView(root);
  if (!readProseMirror(root) || !view || !view.state.selection.empty) return null;
  const $head = view.state.selection.$head;
  if (!$head.parent.isTextblock || $head.parent.type.spec.code) return null;
  const blockText = $head.parent.textBetween(0, $head.parent.content.size, "\n", "\uFFFC");
  const beforeCursor = $head.parent.textBetween(0, $head.parentOffset, "\n", "\uFFFC");
  return { beforeCursor, afterCursor: blockText.slice(beforeCursor.length), blockText };
}

export function replaceProseMirrorBlock(
  root: HTMLElement,
  request: {
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
    cursorAfter: number;
    expectedBlockText: string;
  },
): HostEditorApplyResult {
  const context = proseMirrorBlockContext(root);
  const view = owningView(root);
  const snapshot = readProseMirror(root);
  if (
    !context ||
    !view ||
    !snapshot ||
    context.blockText !== request.expectedBlockText ||
    !Number.isSafeInteger(request.replaceStart) ||
    !Number.isSafeInteger(request.replaceEnd) ||
    request.replaceStart < 0 ||
    request.replaceEnd < request.replaceStart ||
    request.replaceEnd > context.blockText.length ||
    !Number.isSafeInteger(request.cursorAfter) ||
    request.cursorAfter < 0 ||
    request.cursorAfter >
      context.blockText.length -
        (request.replaceEnd - request.replaceStart) +
        request.replacementText.length
  )
    return { applied: false, didDispatchInput: false };
  const $head = view.state.selection.$head;
  const map = buildContentEditableTextMap(root);
  const dom = view.domAtPos($head.start());
  const blockOffset = map.nodeStarts.get(dom.node);
  if (blockOffset === undefined) return { applied: false, didDispatchInput: false };
  const start = blockOffset + request.replaceStart,
    end = blockOffset + request.replaceEnd;
  const original = snapshot.text.slice(start, end);
  if (original !== context.blockText.slice(request.replaceStart, request.replaceEnd))
    return { applied: false, didDispatchInput: false };
  const edit = { start, end, original, replacement: request.replacementText };
  const after = applyEdits(snapshot.text, [edit]);
  if (after === null) return { applied: false, didDispatchInput: false };
  const result = applyProseMirror(root, {
    edits: [edit],
    before: snapshot.text,
    after,
    signature: snapshot.signature,
  });
  if (result.status === "unverified")
    return { applied: false, didDispatchInput: false, unverified: true };
  if (result.status !== "applied") return { applied: false, didDispatchInput: false };
  const position = $head.start() + request.cursorAfter;
  const Selection = view.state.selection
    .constructor as typeof import("prosemirror-state").TextSelection;
  view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, position)));
  view.focus();
  return { applied: true, didDispatchInput: false };
}
