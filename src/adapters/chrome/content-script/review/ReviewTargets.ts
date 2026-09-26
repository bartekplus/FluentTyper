import type {
  ReviewApplyResult,
  ReviewCapabilities,
  ReviewTargetPort,
  ReviewTargetRead,
} from "@core/application/review/ReviewSession";
import type { ReviewEdit, TextRange } from "@core/domain/grammar/review/types";
import {
  commonAffixes,
  editTouches,
  isGraphemeBoundary,
  mergeEdits,
  positionThroughEdits,
} from "@core/domain/grammar/review/textRanges";
import { getDeepActiveElement, isInDocument } from "@core/application/dom-utils";
import { ancestorContext } from "../suggestions/CodeContextResolver";
import { isLockedField, isSensitiveField } from "../suggestions/FieldEligibility";
import { rangeInsideTarget } from "../suggestions/TextTargetAdapter";
import {
  buildContentEditableTextMap,
  caretRange,
  domPositionToOffset,
  offsetRangeToDomRange,
  readBlockAt,
  type BlockText,
  type ContentEditableTextMap,
} from "./ContentEditableTextMap";

export type ReviewEditorKind = "text-control" | "contenteditable" | "quill" | "model-editor";

/** Editors that own a document model; writing their DOM behind their back is not safe. */
const MODEL_EDITOR_SELECTOR = [
  "[data-lexical-editor]",
  ".ProseMirror",
  "[data-slate-editor]",
  ".DraftEditor-root",
  "[data-contents]",
  ".ck-editor__editable",
  // Frameworks that keep their own document or undo model over the DOM.
  "trix-editor",
  ".cke_editable",
  ".mce-content-body",
  ".fr-element",
  ".note-editable",
].join(", ");

export interface ReviewTargetHandle extends ReviewTargetPort {
  readonly element: HTMLElement;
  readonly kind: ReviewEditorKind;
  composing: boolean;
  /** Viewport rectangles of a snapshot range, for highlights and hit-testing. */
  rangeRects(range: TextRange): DOMRect[];
  /** DOM Range for CSS highlights; null for form controls. */
  domRange(range: TextRange): Range | null;
  /** Brings a range into view inside the editor without moving the caret. */
  reveal(range: TextRange): void;
  /** Gives the keyboard back to the editor (the review closed from its panel). */
  focusEditor(): void;
  /** Where measurement helpers may live (FluentTyper's own shadow root). */
  setMeasurementRoot(root: ShadowRoot): void;
  dispose(): void;
}

type Resolution =
  | { ok: true; target: ReviewTargetHandle; scope: TextRange | null }
  | { ok: false; reason: "no-editor" | "sensitive" | "cross-selection" };

function isTextControl(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA";
}

/** The protected ranges wholly before `limit`, as a comparable key. */
function protectionKey(ranges: readonly ProtectedRangeLike[], limit: number): string {
  return ranges
    .filter((range) => range.end <= limit)
    .map((range) => `${range.start}-${range.end}:${range.reason}`)
    .join(",");
}

type ProtectedRangeLike = TextRange & { reason: string };

/** The outermost contenteditable ancestor (the editing host) of `element`. */
export function editingHost(element: HTMLElement): HTMLElement | null {
  if (!element.isContentEditable) return null;
  let host = element;
  for (
    let parent = host.parentElement;
    parent && parent.isContentEditable;
    parent = parent.parentElement
  ) {
    host = parent;
  }
  return host;
}

/** Everything that makes a field ineligible for reading or writing, checked on every entry. */
export function isReviewEligible(element: HTMLElement): boolean {
  if (!isInDocument(element) || isLockedField(element) || isSensitiveField(element)) return false;
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  // Not rendered (display: none, visibility: hidden): nothing the user can review.
  const visible = (
    element as HTMLElement & {
      checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean;
    }
  ).checkVisibility;
  if (typeof visible === "function" && !visible.call(element, { visibilityProperty: true })) {
    return false;
  }
  // Code editors, and fields that are themselves code or read-only islands, are
  // not prose. Only the host's own markup counts here; code INSIDE a rich editor
  // is protected range by range, never by where the caret happens to be.
  return ancestorContext(element) === null;
}

/**
 * Captures the editor and the selection BEFORE any review UI opens or takes
 * focus. A selection must lie wholly inside one editor; otherwise the whole
 * editor is the scope, never the page.
 */
export function resolveReviewTarget(doc: Document = document): Resolution {
  const active = getDeepActiveElement(doc);
  if (!(active instanceof HTMLElement)) return { ok: false, reason: "no-editor" };

  if (isTextControl(active)) {
    // Non-text input types are refused as sensitive by the eligibility check.
    if (!isReviewEligible(active)) return { ok: false, reason: "sensitive" };
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? start;
    return {
      ok: true,
      target: new TextControlReviewTarget(active),
      scope: end > start ? { start, end } : null,
    };
  }

  let host = editingHost(active);
  if (!host) return { ok: false, reason: "no-editor" };
  // designMode: the whole document is editable; its text is the body's.
  if (host === doc.documentElement) host = doc.body;
  if (!host) return { ok: false, reason: "no-editor" };
  if (!isReviewEligible(host)) return { ok: false, reason: "sensitive" };
  const target = new ContentEditableReviewTarget(host);

  const selection = readSelectionRange(host);
  if (!selection || selection.collapsed) return { ok: true, target, scope: null };
  if (!rangeInsideTarget(selection, host)) {
    const touches =
      host.contains(selection.startContainer) || host.contains(selection.endContainer);
    return touches ? { ok: false, reason: "cross-selection" } : { ok: true, target, scope: null };
  }
  const map = buildContentEditableTextMap(host);
  const start = domPositionToOffset(map, selection.startContainer, selection.startOffset);
  const end = domPositionToOffset(map, selection.endContainer, selection.endOffset);
  if (start === null || end === null) return { ok: false, reason: "cross-selection" };
  return { ok: true, target, scope: end > start ? { start, end } : null };
}

function readSelectionRange(host: HTMLElement): Range | null {
  const root = host.getRootNode();
  const scoped = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection;
  const selection =
    root.nodeType === 11 && typeof scoped === "function"
      ? scoped.call(root)
      : host.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0);
}

/** `block` when it is still in the document and holds `range`. */
function blockHolding(block: BlockText | null, range: TextRange): BlockText | null {
  return block !== null &&
    block.element.isConnected &&
    range.start >= block.offset &&
    range.end <= block.offset + block.map.text.length
    ? block
    : null;
}

/**
 * `observed` equals `expected`, except that native editing may turn a space
 * right next to the inserted text into a no-break space (or back): Chrome and
 * Firefox do that so the space stays visible beside formatting boundaries. Any
 * other difference, or one farther away, is not accepted.
 */
function sameExceptEdgeSpaces(
  observed: string,
  expected: string,
  editStart: number,
  editEnd: number,
): boolean {
  if (observed === expected) return true;
  if (observed.length !== expected.length) return false;
  for (let i = 0; i < observed.length; i += 1) {
    if (observed[i] === expected[i]) continue;
    const spaces = /^[ \u00A0]$/.test(observed[i]) && /^[ \u00A0]$/.test(expected[i]);
    if (!spaces || i < editStart - 1 || i > editEnd) return false;
  }
  return true;
}

/** Tag names of the elements around `node` inside `scope` (its formatting and links). */
function inlineTags(node: Node, scope: Node): string[] {
  const tags: string[] = [];
  for (
    let element = node.parentElement;
    element && element !== scope;
    element = element.parentElement
  ) {
    if (!scope.contains(element)) return tags;
    tags.push(element.tagName);
  }
  return tags;
}

/** Every tag of `required` is in `tags`, as often (extra wrappers are allowed). */
function includesAll(tags: readonly string[], required: readonly string[]): boolean {
  const left = [...tags];
  return required.every((tag) => {
    const index = left.indexOf(tag);
    if (index < 0) return false;
    left.splice(index, 1);
    return true;
  });
}

/** Gecko's editor, for its native editing quirks (feature detection cannot see them). */
function isGecko(doc: Document): boolean {
  return /\bGecko\/\d/.test(doc.defaultView?.navigator.userAgent ?? "");
}

/** True when `range` holds all of one text node's text (whitespace aside). */
function coversWholeTextNode(range: Range): boolean {
  const node = range.startContainer;
  if (node.nodeType !== 3 || range.endContainer !== node || range.collapsed) return false;
  const data = (node as Text).data;
  const blank = /^[ \t\n\r\f]*$/;
  return blank.test(data.slice(0, range.startOffset)) && blank.test(data.slice(range.endOffset));
}

function selectRange(selection: Selection, range: Range): void {
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Writes one verified-in-place edit with the browser's own editing commands, so
 * native undo reverts it. `range` holds exactly `edit.original` in `text`.
 * Returns false, having written nothing, when the browser cannot write it in place.
 */
function writeNative(
  doc: Document,
  selection: Selection,
  range: Range,
  edit: ReviewEdit,
  text: string,
): boolean {
  const node = range.startContainer;
  const inOneNode =
    node.nodeType === 3 &&
    range.endContainer === node &&
    range.endOffset - range.startOffset === edit.original.length;
  if (inOneNode && edit.replacement.length > 0) {
    // An insertion anchored on a neighboring character ("a" -> "a ") is written
    // as a pure insertion strictly inside that character's node: browsers move
    // text typed at the very edge of a link out of the link.
    const { prefix, suffix } = commonAffixes(edit.original, edit.replacement);
    const at = range.startOffset + prefix;
    if (
      prefix + suffix === edit.original.length &&
      at > 0 &&
      at < (node as Text).data.length &&
      isGraphemeBoundary(text, edit.start + prefix)
    ) {
      const caret = doc.createRange();
      caret.setStart(node, at);
      caret.collapse(true);
      selectRange(selection, caret);
      doc.execCommand(
        "insertText",
        false,
        edit.replacement.slice(prefix, edit.replacement.length - suffix),
      );
      return true;
    }
    // Gecko, replacing a text node's whole text, empties the node first and then
    // drops the space next to it ("Well, <em>i</em> agree" -> "Well, <em>I</em>agree").
    // Keep the last original character until the replacement is in, so the node
    // never empties, then delete it. (Two native undo steps there.)
    if (coversWholeTextNode(range) && isGecko(doc)) {
      let tail = 1;
      while (tail < edit.original.length && !isGraphemeBoundary(text, edit.end - tail)) tail += 1;
      // Nothing is kept before the tail: text typed at a link's very start lands
      // outside the link, and the link would read "Ii".
      if (tail === edit.original.length && node.parentElement?.closest("a")) return false;
      const tailText = edit.original.slice(edit.original.length - tail);
      const head = range.cloneRange();
      head.setEnd(node, range.endOffset - tail);
      selectRange(selection, head);
      doc.execCommand("insertText", false, edit.replacement);
      const tailStart = range.startOffset + edit.replacement.length;
      const data = (node as Text).data;
      // Written somewhere else: the read-back reports it; nothing more is written.
      if (!node.isConnected || data.slice(tailStart, tailStart + tail) !== tailText) return true;
      const rest = doc.createRange();
      rest.setStart(node, tailStart);
      rest.setEnd(node, tailStart + tail);
      selectRange(selection, rest);
      doc.execCommand("delete", false);
      return true;
    }
  }
  selectRange(selection, range);
  if (edit.replacement.length > 0) doc.execCommand("insertText", false, edit.replacement);
  else doc.execCommand("delete", false);
  return true;
}

const TEXT_CAPABILITIES: ReviewCapabilities = {
  inline: true,
  apply: true,
  bulk: true,
  undo: "single-step",
};

/** How long a batch of native edits runs before it lets the page breathe. */
const WRITE_SLICE_MS = 50;

function nextFrame(win: Window): Promise<void> {
  return new Promise((resolve) => {
    // One frame lets a host editor reconcile its model; a timer covers hidden tabs.
    const timer = win.setTimeout(resolve, 50);
    win.requestAnimationFrame(() => {
      win.clearTimeout(timer);
      resolve();
    });
  });
}

/** Input and textarea: plain text, written as ONE native edit (one undo step). */
export class TextControlReviewTarget implements ReviewTargetHandle {
  readonly kind = "text-control" as const;
  readonly capabilities = TEXT_CAPABILITIES;
  composing = false;
  private mirror: TextControlMirror | null = null;
  private measurementRoot: ShadowRoot | null = null;

  constructor(readonly element: HTMLInputElement | HTMLTextAreaElement) {}

  setMeasurementRoot(root: ShadowRoot): void {
    this.measurementRoot = root;
  }

  private ensureMirror(): TextControlMirror | null {
    if (!this.measurementRoot) return null;
    this.mirror ??= new TextControlMirror(this.element, this.measurementRoot);
    return this.mirror;
  }

  read(): ReviewTargetRead {
    if (!isReviewEligible(this.element)) {
      return { ok: false, reason: isInDocument(this.element) ? "ineligible" : "detached" };
    }
    if (this.composing) return { ok: false, reason: "composing" };
    return { ok: true, text: this.element.value, protectedRanges: [], signature: "" };
  }

  apply(request: {
    edits: ReviewEdit[];
    before: string;
    after: string;
  }): Promise<ReviewApplyResult> {
    return Promise.resolve(this.applyNow(request));
  }

  private applyNow(request: {
    edits: ReviewEdit[];
    before: string;
    after: string;
  }): ReviewApplyResult {
    const field = this.element;
    const check = (): ReviewApplyResult | null => {
      if (!isReviewEligible(field)) return { status: "rejected", reason: "ineligible" };
      if (this.composing) return { status: "rejected", reason: "composing" };
      if (field.value !== request.before) return { status: "stale" };
      // The browser would cut the text to the field's maxlength: refused, never truncated.
      if (field.maxLength >= 0 && request.after.length > field.maxLength) {
        return { status: "rejected", reason: "host-refused" };
      }
      return null;
    };
    const refused = check();
    if (refused) return refused;

    const { start, end, replacement } = mergeEdits(request.before, request.after, request.edits);
    const selection = {
      start: field.selectionStart ?? 0,
      end: field.selectionEnd ?? 0,
      direction: field.selectionDirection ?? "none",
    };
    const scroll = { top: field.scrollTop, left: field.scrollLeft };
    const doc = field.ownerDocument;

    field.focus({ preventScroll: true });
    // The native edit goes to the focused element; if focus did not move here
    // (hidden, or the page kept it), writing would change another editor.
    if (getDeepActiveElement(doc) !== field) return { status: "rejected", reason: "host-refused" };
    // Focus handlers run page code: the offsets hold only for the text they came from.
    const changed = check();
    if (changed) return changed;
    field.setSelectionRange(start, end);
    // One native insertion, so the browser's own undo reverts it as one step.
    // A control without execCommand support is refused rather than written
    // another way that undo would not restore.
    if (replacement.length > 0) doc.execCommand("insertText", false, replacement);
    else doc.execCommand("delete", false);

    if (field.value === request.after) {
      const remap = (position: number) => positionThroughEdits(position, request.edits);
      field.setSelectionRange(remap(selection.start), remap(selection.end), selection.direction);
      field.scrollTop = scroll.top;
      field.scrollLeft = scroll.left;
      return { status: "applied" };
    }
    if (field.value === request.before) {
      field.setSelectionRange(selection.start, selection.end, selection.direction);
      return { status: "rejected", reason: "host-refused" };
    }
    return { status: "unverified" };
  }

  rangeRects(range: TextRange): DOMRect[] {
    return this.ensureMirror()?.rects(range) ?? [];
  }

  domRange(): Range | null {
    return null;
  }

  focusEditor(): void {
    this.element.focus({ preventScroll: true });
  }

  reveal(range: TextRange): void {
    this.ensureMirror()?.reveal(range);
  }

  dispose(): void {
    this.mirror?.dispose();
    this.mirror = null;
  }
}

/** Plain contenteditable and Quill: minimal native edits inside text nodes, verified after each. */
export class ContentEditableReviewTarget implements ReviewTargetHandle {
  readonly kind: ReviewEditorKind;
  readonly capabilities: ReviewCapabilities;
  composing = false;
  private map: ContentEditableTextMap | null = null;

  constructor(readonly element: HTMLElement) {
    const quill = element.classList.contains("ql-editor") && !!element.closest(".ql-container");
    this.kind = quill
      ? "quill"
      : element.matches(MODEL_EDITOR_SELECTOR) || element.closest(MODEL_EDITOR_SELECTOR)
        ? "model-editor"
        : "contenteditable";
    const writable = this.kind !== "model-editor";
    this.capabilities = {
      inline: true,
      apply: writable,
      bulk: writable,
      // Quill's history module merges quick successive changes; plain
      // contenteditable keeps one native undo step per edit.
      undo: this.kind === "quill" ? "host-history" : writable ? "per-edit" : "none",
    };
  }

  read(): ReviewTargetRead {
    if (!isReviewEligible(this.element)) {
      return { ok: false, reason: isInDocument(this.element) ? "ineligible" : "detached" };
    }
    if (this.composing) return { ok: false, reason: "composing" };
    this.map = buildContentEditableTextMap(this.element);
    return {
      ok: true,
      text: this.map.text,
      protectedRanges: this.map.protectedRanges,
      signature: this.map.signature,
    };
  }

  async apply(request: {
    edits: ReviewEdit[];
    before: string;
    after: string;
    signature: string;
  }): Promise<ReviewApplyResult> {
    const root = this.element;
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    if (!win || !this.capabilities.apply) return { status: "rejected", reason: "unsupported" };
    if (!isReviewEligible(root)) return { status: "rejected", reason: "ineligible" };
    if (this.composing) return { status: "rejected", reason: "composing" };
    let map = buildContentEditableTextMap(root);
    if (map.text !== request.before || map.signature !== request.signature) {
      return { status: "stale" };
    }
    const selection = doc.getSelection();
    // Inside a shadow root the document selection is retargeted; read the scoped one.
    const saved = this.captureSelection(map, readSelectionRange(root));

    root.focus({ preventScroll: true });
    // The write lands wherever focus is: it must be this editor.
    const focusInside = () => {
      const focused = getDeepActiveElement(doc);
      return !!focused && (focused === root || root.contains(focused));
    };
    if (!focusInside()) return { status: "rejected", reason: "host-refused" };
    // Focus handlers run page code, which may have changed the text or only its
    // markup (text moved into <code>): re-read everything before the first write.
    if (!isReviewEligible(root)) return { status: "rejected", reason: "ineligible" };
    if (this.composing) return { status: "rejected", reason: "composing" };
    map = buildContentEditableTextMap(root);
    if (map.text !== request.before || map.signature !== request.signature) {
      return { status: "stale" };
    }
    const protectedAtStart = map.protectedRanges;
    let current = request.before;
    // Each write is verified in its own block when that block reads the same
    // on its own; a final full read-back below verifies the whole result.
    let written: BlockText | null = null;
    const edits = [...request.edits].sort((a, b) => b.start - a.start);
    let sliceStart = win.performance.now();
    for (let index = 0; index < edits.length; index += 1) {
      // Stopping before the first edit changed nothing; later, say how far it got.
      const failAt = (first: ReviewApplyResult): ReviewApplyResult =>
        index === 0 ? first : { status: "partial", applied: index };
      if (index > 0 && this.composing) return failAt({ status: "stale" });
      // A long batch yields so the page stays responsive; each native edit is its
      // own undo step here anyway. Afterwards it continues only if nothing moved.
      if (win.performance.now() - sliceStart > WRITE_SLICE_MS) {
        await new Promise((resolve) => win.setTimeout(resolve, 0));
        map = buildContentEditableTextMap(root);
        written = null;
        if (map.text !== current || this.composing || !root.isConnected || !focusInside()) {
          return failAt({ status: "stale" });
        }
        // The edits still to come lie before the ones written: that part of the
        // text must still have exactly the protection it had, and none may touch it.
        const limit = index === 0 ? Number.POSITIVE_INFINITY : edits[index - 1].start;
        if (
          !isReviewEligible(root) ||
          protectionKey(map.protectedRanges, limit) !== protectionKey(protectedAtStart, limit) ||
          edits
            .slice(index)
            .some((pending) => map.protectedRanges.some((range) => editTouches(pending, range)))
        ) {
          return failAt({ status: "stale" });
        }
        sliceStart = win.performance.now();
      }
      const edit = edits[index];
      // Descending order: earlier blocks are untouched, so the first map still
      // locates them; the block just written has new nodes, so use its re-read.
      const previous = blockHolding(written, edit);
      const range: Range | null = previous
        ? offsetRangeToDomRange(
            previous.map,
            { start: edit.start - previous.offset, end: edit.end - previous.offset },
            doc,
          )
        : offsetRangeToDomRange(map, edit, doc);
      if (!range || !selection || range.toString() !== edit.original) {
        return failAt({ status: "rejected", reason: "host-refused" });
      }
      const block: BlockText | null = previous ?? readBlockAt(root, map, range, current);
      const scopeElement = block?.element ?? root;
      // The formatting (link, bold…) around the text being changed, when it is one node.
      const formatting =
        range.startContainer.nodeType === 3 && range.endContainer === range.startContainer
          ? inlineTags(range.startContainer, scopeElement)
          : null;
      if (!writeNative(doc, selection, range, edit, current)) {
        return failAt({ status: "rejected", reason: "host-refused" });
      }
      const expected = current.slice(0, edit.start) + edit.replacement + current.slice(edit.end);
      // The DOM is read back; a successful dispatch proves nothing.
      let observed: string;
      let placedIn: { map: ContentEditableTextMap; offset: number };
      if (block && block.element.isConnected) {
        const after = buildContentEditableTextMap(block.element);
        observed =
          current.slice(0, block.offset) +
          after.text +
          current.slice(block.offset + block.map.text.length);
        written = { element: block.element, offset: block.offset, map: after };
        placedIn = { map: after, offset: block.offset };
      } else {
        map = buildContentEditableTextMap(root);
        observed = map.text;
        written = null;
        placedIn = { map, offset: 0 };
      }
      const editEnd = edit.start + edit.replacement.length;
      if (!sameExceptEdgeSpaces(observed, expected, edit.start, editEnd)) {
        if (observed === current) return failAt({ status: "rejected", reason: "host-refused" });
        return { status: "unverified" };
      }
      // The right text in the wrong place: a browser can move text typed at a
      // link's edge out of the link. Reported, never passed off as applied.
      if (formatting && formatting.length > 0 && edit.replacement.length > 0) {
        const placed = offsetRangeToDomRange(
          placedIn.map,
          { start: edit.start - placedIn.offset, end: editEnd - placedIn.offset },
          doc,
        );
        const kept = (node: Node) => includesAll(inlineTags(node, scopeElement), formatting);
        if (!placed || !kept(placed.startContainer) || !kept(placed.endContainer)) {
          return { status: "unverified" };
        }
      }
      current = observed;
    }

    // Let a model-backed host (Quill) reconcile, then confirm it kept the text.
    await nextFrame(win);
    const final = buildContentEditableTextMap(root);
    if (final.text !== current) return { status: "unverified" };
    this.map = final;
    this.restoreSelection(final, saved, request.edits);
    return { status: "applied" };
  }

  private captureSelection(
    map: ContentEditableTextMap,
    range: Range | null,
  ): { start: number; end: number } | null {
    if (!range || !rangeInsideTarget(range, this.element)) return null;
    const start = domPositionToOffset(map, range.startContainer, range.startOffset);
    const end = domPositionToOffset(map, range.endContainer, range.endOffset);
    return start === null || end === null ? null : { start, end };
  }

  private restoreSelection(
    map: ContentEditableTextMap,
    saved: { start: number; end: number } | null,
    edits: ReviewEdit[],
  ): void {
    if (!saved) return;
    const shift = (position: number) =>
      edits.reduce((result, edit) => {
        if (position >= edit.end) return result + edit.replacement.length - (edit.end - edit.start);
        if (position > edit.start)
          return result + (edit.start + edit.replacement.length - position);
        return result;
      }, position);
    const doc = this.element.ownerDocument;
    const start = caretRange(map, shift(saved.start), doc);
    const end = caretRange(map, shift(saved.end), doc);
    const selection = doc.getSelection();
    if (!start || !end || !selection) return;
    const range = doc.createRange();
    range.setStart(start.startContainer, start.startOffset);
    range.setEnd(end.startContainer, end.startOffset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  rangeRects(range: TextRange): DOMRect[] {
    const domRange = this.domRange(range);
    // Range geometry is missing in some non-layout environments; no rects, no marks.
    return domRange && typeof domRange.getClientRects === "function"
      ? Array.from(domRange.getClientRects())
      : [];
  }

  domRange(range: TextRange): Range | null {
    this.map ??= buildContentEditableTextMap(this.element);
    return offsetRangeToDomRange(this.map, range, this.element.ownerDocument);
  }

  setMeasurementRoot(): void {
    // Measured through DOM Ranges on the editor itself.
  }

  focusEditor(): void {
    this.element.focus({ preventScroll: true });
  }

  reveal(range: TextRange): void {
    const domRange = this.domRange(range);
    const node = domRange?.startContainer;
    const element = node?.nodeType === 3 ? node.parentElement : (node as Element | undefined);
    element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  dispose(): void {
    this.map = null;
  }
}

const MIRRORED_STYLES = [
  "box-sizing",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-kerning",
  "font-feature-settings",
  "letter-spacing",
  "word-spacing",
  "line-height",
  "text-transform",
  "text-indent",
  "text-align",
  "tab-size",
  "direction",
  "unicode-bidi",
  "writing-mode",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
] as const;

/**
 * Measures text ranges inside an input/textarea with an invisible mirror laid
 * over the field's content box: same font, padding, wrapping, direction and
 * scroll. Nothing is added to or changed in the field itself.
 */
class TextControlMirror {
  private readonly mirror: HTMLDivElement;
  private readonly textNode: Text;

  constructor(
    private readonly field: HTMLInputElement | HTMLTextAreaElement,
    root: ShadowRoot,
  ) {
    const doc = field.ownerDocument;
    this.mirror = doc.createElement("div");
    this.mirror.setAttribute("aria-hidden", "true");
    this.mirror.setAttribute("data-fluenttyper-review-mirror", "");
    this.textNode = doc.createTextNode("");
    this.mirror.appendChild(this.textNode);
    // In FluentTyper's own shadow root: never inside or next to the host's field.
    root.appendChild(this.mirror);
  }

  // One sync serves every measurement in the same task: a paint measures each
  // finding, and re-syncing forces a style and layout pass per finding.
  private synced = false;

  private syncOnce(): void {
    if (this.synced) return;
    this.sync();
    this.synced = true;
    queueMicrotask(() => {
      this.synced = false;
    });
  }

  private sync(): void {
    const field = this.field;
    const view = field.ownerDocument.defaultView;
    if (!view) return;
    const computed = view.getComputedStyle(field);
    const style = this.mirror.style;
    for (const property of MIRRORED_STYLES) {
      style.setProperty(property, computed.getPropertyValue(property), "important");
    }
    const rect = field.getBoundingClientRect();
    const textarea = field.tagName === "TEXTAREA";
    const important = (name: string, value: string) => style.setProperty(name, value, "important");
    important("position", "fixed");
    important("visibility", "hidden");
    important("pointer-events", "none");
    important("overflow", "hidden");
    important("margin", "0");
    important("border", "0");
    important("box-sizing", "border-box");
    important("left", `${rect.left + field.clientLeft}px`);
    important("top", `${rect.top + field.clientTop}px`);
    important("width", `${field.clientWidth}px`);
    important("height", `${field.clientHeight}px`);
    important("white-space", textarea ? "pre-wrap" : "pre");
    important("overflow-wrap", textarea ? computed.overflowWrap || "break-word" : "normal");
    important("word-break", computed.wordBreak);
    important("z-index", "-1");
    // A trailing newline needs a character after it to occupy a line.
    const value = field.value;
    const text = value.endsWith("\n") ? `${value}\u200B` : value;
    // Always a Text node: the value is set as plain text, never parsed.
    if (this.textNode.data !== text) this.textNode.textContent = text;
    this.mirror.scrollTop = field.scrollTop;
    this.mirror.scrollLeft = field.scrollLeft;
  }

  /** The mirror's DOM range for a snapshot range (clamped to its text). */
  private rangeFor(range: TextRange): Range {
    const domRange = this.field.ownerDocument.createRange();
    const length = this.textNode.data.length;
    domRange.setStart(this.textNode, Math.min(range.start, length));
    domRange.setEnd(this.textNode, Math.min(range.end, length));
    return domRange;
  }

  rects(range: TextRange): DOMRect[] {
    this.syncOnce();
    const domRange = this.rangeFor(range);
    const box = this.mirror.getBoundingClientRect();
    if (typeof domRange.getClientRects !== "function") return [];
    // Only the part inside the field's visible content box is really on screen.
    return Array.from(domRange.getClientRects()).filter(
      (rect) =>
        rect.width > 0 &&
        rect.bottom > box.top &&
        rect.top < box.bottom &&
        rect.right > box.left &&
        rect.left < box.right,
    );
  }

  reveal(range: TextRange): void {
    this.sync();
    const domRange = this.rangeFor(range);
    if (typeof domRange.getBoundingClientRect !== "function") return;
    const target = domRange.getBoundingClientRect();
    const box = this.mirror.getBoundingClientRect();
    if (target.top < box.top) this.field.scrollTop -= box.top - target.top + 4;
    else if (target.bottom > box.bottom) this.field.scrollTop += target.bottom - box.bottom + 4;
    if (target.left < box.left) this.field.scrollLeft -= box.left - target.left + 4;
    else if (target.right > box.right) this.field.scrollLeft += target.right - box.right + 4;
    // The field may have scrolled: measure again next time.
    this.synced = false;
  }

  dispose(): void {
    this.mirror.remove();
  }
}
