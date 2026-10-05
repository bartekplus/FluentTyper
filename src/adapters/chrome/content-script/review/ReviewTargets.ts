import { editorCapabilities, MODEL_EDITOR_SELECTOR } from "../suggestions/EditorCapabilities";
import { prepareNativeReviewTransaction } from "./NativeReviewTransaction";
import { expectedFormatting, formattingPreservingEdits } from "./RichTextFormatting";
import { InjectedHostEditorPageBridge } from "../suggestions/HostEditorPageBridge";
import { DOM_EDITOR_SELECTOR } from "../suggestions/ReviewDomEditors";
import type {
  ReviewApplyResult,
  ReviewCapabilities,
  ReviewTargetPort,
  ReviewTargetRead,
} from "@core/application/review/ReviewSession";
import type { ReviewEdit, TextRange } from "@core/domain/grammar/review/types";
import {
  applyEdits,
  commonAffixes,
  isGraphemeBoundary,
  mergeEdits,
  positionThroughEdits,
  postEditRanges,
} from "@core/domain/grammar/review/textRanges";
import { getDeepActiveElement, isInDocument } from "@core/application/dom-utils";
import { isWordInputProxy } from "../suggestions/CodeContextResolver";
import { hasOtherFocusedEditor, rangeInsideTarget } from "../suggestions/TextTargetAdapter";
import { wordEditor } from "./WordReviewProtocol";
import { WordReviewTarget } from "./WordReviewTarget";
import { GutenbergReviewTarget } from "./GutenbergReviewTarget";
import {
  isGutenbergField,
  isGutenbergContainer,
  gutenbergSelectedField,
  GUTENBERG_FIELD_SELECTOR,
} from "../suggestions/GutenbergEnvironment";
import {
  buildContentEditableTextMap,
  caretRange,
  domPositionToOffset,
  offsetRangeToDomRange,
  type ContentEditableTextMap,
} from "./ContentEditableTextMap";

type ContentEditableKind =
  | "contenteditable"
  | "quill"
  | "prosemirror"
  | "slate"
  // Lexical, Draft.js, CKEditor 5 or Trix: one verified host-model transaction.
  | "host-model"
  // TinyMCE, CKEditor 4, Froala or Summernote: a native edit in one host undo step.
  | "host-dom"
  | "model-editor";

export interface ReviewTargetHandle extends ReviewTargetPort {
  readonly element: HTMLElement;
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
  setMeasurementRoot?(root: ShadowRoot): void;
  dispose(): void;
}

type Resolution =
  | { ok: true; target: ReviewTargetHandle; scope: TextRange | null }
  | { ok: false; reason: "no-editor" | "sensitive" | "cross-selection" };

export function isTextControl(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA";
}

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
  // designMode: the whole document is editable; its text is the body's.
  return host === host.ownerDocument.documentElement ? host.ownerDocument.body : host;
}

/**
 * Captures the editor and the selection BEFORE any review UI opens or takes
 * focus. A selection must lie wholly inside one editor; otherwise the whole
 * editor is the scope, never the page.
 */
export function resolveReviewTarget(
  doc: Document = document,
  current?: ReviewTargetHandle,
): Resolution {
  const active = getDeepActiveElement(doc);
  if (!(active instanceof HTMLElement)) return { ok: false, reason: "no-editor" };

  const word = wordEditor(doc);
  if (word && isWordInputProxy(active)) {
    // Reopening the same review must not replace its single-use model token
    // or create another mutation observer.
    if (
      current instanceof WordReviewTarget &&
      current.element === word &&
      current.inputProxy === active &&
      current.matchesSelection()
    )
      return { ok: true, target: current, scope: current.scope };
    if (current instanceof WordReviewTarget) current.dispose();
    const target = new WordReviewTarget(word, active);
    target.captureSelection();
    return { ok: true, target, scope: target.scope };
  }

  if (isTextControl(active)) {
    // Non-text input types are refused as sensitive by the eligibility check.
    if (!editorCapabilities(active).renderReview) return { ok: false, reason: "sensitive" };
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? start;
    return {
      ok: true,
      target: new TextControlReviewTarget(active),
      scope: end > start ? { start, end } : null,
    };
  }

  const selectedField = gutenbergSelectedField(active);
  const host =
    active.closest<HTMLElement>(GUTENBERG_FIELD_SELECTOR) ??
    (selectedField !== active ? selectedField : editingHost(active));
  if (!host) return { ok: false, reason: "no-editor" };
  // A Gutenberg canvas without a selected RichText field has no editor to review.
  if (isGutenbergContainer(host)) return { ok: false, reason: "no-editor" };
  if (!editorCapabilities(host).renderReview) return { ok: false, reason: "sensitive" };
  if (isGutenbergField(host)) {
    if (current instanceof GutenbergReviewTarget && current.element.contains(host))
      return { ok: true, target: current, scope: current.scope };
    const target = new GutenbergReviewTarget(host);
    if (!target.captureSelection()) {
      target.dispose();
      return { ok: false, reason: "no-editor" };
    }
    return { ok: true, target, scope: target.scope };
  }
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

/**
 * `observed` equals `expected`, except that native editing may turn a space
 * right next to the inserted text into a no-break space (or back): Chrome and
 * Firefox do that so the space stays visible beside formatting boundaries. Any
 * other difference, or one farther away, is not accepted.
 */
function sameExceptEdgeSpaces(
  observed: string,
  expected: string,
  edits: readonly ReviewEdit[],
): boolean {
  if (observed === expected) return true;
  if (observed.length !== expected.length) return false;
  const boundaries = postEditRanges(edits);
  for (let i = 0; i < observed.length; i += 1) {
    if (observed[i] === expected[i]) continue;
    const spaces = /^[ \u00A0]$/.test(observed[i]) && /^[ \u00A0]$/.test(expected[i]);
    if (!spaces || !boundaries.some(({ start, end }) => i >= start - 1 && i <= end)) return false;
  }
  return true;
}

/** Gecko's editor, for its native editing quirks (feature detection cannot see them). */
function isGecko(doc: Document): boolean {
  return /\bGecko\/\d/.test(doc.defaultView?.navigator.userAgent ?? "");
}

/** True when `range`, inside one text node, holds all of its text (whitespace aside). */
function coversWholeTextNode(range: Range): boolean {
  if (range.collapsed) return false;
  const data = (range.startContainer as Text).data;
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
  // Both callers give a range inside one Text node that holds edit.original.
  const node = range.startContainer;
  if (edit.replacement.length > 0) {
    // An insertion anchored on a neighboring character ("a" -> "a ") is written
    // as a pure insertion. At a link's leading edge browsers can move the new
    // text outside the link. Gecko can retain a leading caret in other inline
    // nodes; Blink still needs the anchored replacement at that boundary.
    const { prefix, suffix } = commonAffixes(edit.original, edit.replacement);
    const at = range.startOffset + prefix;
    if (
      prefix + suffix === edit.original.length &&
      (at > 0 || (isGecko(doc) && !node.parentElement?.closest("a"))) &&
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
    // Gecko can remove adjacent whitespace when it replaces a whole text node.
    if (coversWholeTextNode(range) && isGecko(doc)) return false;
  }
  selectRange(selection, range);
  if (edit.replacement.length > 0) doc.execCommand("insertText", false, edit.replacement);
  else doc.execCommand("delete", false);
  return true;
}

/**
 * A Quill without a reachable instance (a bundled Quill 2) applies an
 * insertReplacementText beforeinput to its own model, as typing does, and
 * cancels the event. An event that nobody cancels changes nothing.
 */
function writeQuillInput(root: HTMLElement, range: Range, edit: ReviewEdit): boolean {
  const target = range.cloneRange();
  let text = edit.replacement;
  if (range.collapsed) {
    // Quill handles only a non-empty target: anchor the insertion on the
    // character before it, whose formats it then takes, as typing does.
    const node = range.startContainer as Text;
    const at = range.startOffset;
    let from = at - 1;
    while (from > 0 && !isGraphemeBoundary(node.data, from)) from -= 1;
    if (from < 0) return false;
    target.setStart(node, from);
    text = node.data.slice(from, at) + text;
  }
  const event = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: "insertReplacementText",
    data: text,
    targetRanges: [new StaticRange(target)],
  });
  root.dispatchEvent(event);
  return event.defaultPrevented;
}

const TEXT_CAPABILITIES: ReviewCapabilities = { apply: true, bulk: true };

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
  get capabilities(): ReviewCapabilities {
    return typeof this.element.ownerDocument.execCommand === "function"
      ? TEXT_CAPABILITIES
      : { apply: false, bulk: false };
  }
  composing = false;
  private mirror: TextControlMirror | null = null;
  private measurementRoot: ShadowRoot | null = null;

  constructor(readonly element: HTMLInputElement | HTMLTextAreaElement) {}

  setMeasurementRoot(root: ShadowRoot): void {
    if (root === this.measurementRoot) return;
    // A rebuilt panel has a new root: a mirror in the old one goes with it.
    this.mirror?.dispose();
    this.mirror = null;
    this.measurementRoot = root;
  }

  private ensureMirror(): TextControlMirror | null {
    if (!this.measurementRoot) return null;
    this.mirror ??= new TextControlMirror(this.element, this.measurementRoot);
    return this.mirror;
  }

  read(): ReviewTargetRead {
    if (!editorCapabilities(this.element).renderReview) {
      return { ok: false, reason: isInDocument(this.element) ? "ineligible" : "detached" };
    }
    if (this.composing) return { ok: false, reason: "composing" };
    return { ok: true, text: this.element.value, protectedRanges: [], signature: "" };
  }

  async apply(request: {
    edits: ReviewEdit[];
    before: string;
    after: string;
  }): Promise<ReviewApplyResult> {
    const result = this.applyNow(request);
    if (result.status !== "applied") return result;
    const win = this.element.ownerDocument.defaultView;
    if (!win) return { status: "unverified" };
    await nextFrame(win);
    return this.element.isConnected && this.element.value === request.after
      ? result
      : { status: "unverified" };
  }

  private applyNow(request: {
    edits: ReviewEdit[];
    before: string;
    after: string;
  }): ReviewApplyResult {
    const field = this.element;
    if (
      request.edits.length === 0 ||
      applyEdits(request.before, request.edits) !== request.after ||
      request.edits.some(
        (edit) =>
          !isGraphemeBoundary(request.before, edit.start) ||
          !isGraphemeBoundary(request.before, edit.end),
      )
    )
      return { status: "rejected", reason: "host-refused" };
    const check = (): ReviewApplyResult | null => {
      if (!editorCapabilities(field).renderReview)
        return { status: "rejected", reason: "ineligible" };
      if (this.composing) return { status: "rejected", reason: "composing" };
      if (typeof field.ownerDocument.execCommand !== "function")
        return { status: "rejected", reason: "unsupported" };
      if (hasOtherFocusedEditor(field)) return { status: "stale" };
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
    try {
      if (replacement.length > 0) doc.execCommand("insertText", false, replacement);
      else doc.execCommand("delete", false);
    } catch {
      // Read back the field. An exception does not prove that no write occurred.
    }

    if (field.value === request.after) {
      const remap = (position: number) => positionThroughEdits(position, request.edits);
      if (
        getDeepActiveElement(doc) === field &&
        field.selectionStart === start + replacement.length &&
        field.selectionEnd === field.selectionStart
      ) {
        field.setSelectionRange(remap(selection.start), remap(selection.end), selection.direction);
        field.scrollTop = scroll.top;
        field.scrollLeft = scroll.left;
      }
      return { status: "applied" };
    }
    if (field.value === request.before) {
      if (
        getDeepActiveElement(doc) === field &&
        field.selectionStart === start &&
        field.selectionEnd === end
      )
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

/** Native rich-text transactions and verified host-model transactions. */
export class ContentEditableReviewTarget implements ReviewTargetHandle {
  kind: ContentEditableKind;
  private adapterCapabilities: ReviewCapabilities;
  composing = false;
  private map: ContentEditableTextMap | null = null;
  private readonly pageBridge = new InjectedHostEditorPageBridge();
  private readonly quillModel: boolean;
  /** Any Quill: without its model, Review writes through Quill's beforeinput handling. */
  private readonly quill: boolean;

  constructor(readonly element: HTMLElement) {
    const quill = element.classList.contains("ql-editor") && !!element.closest(".ql-container");
    const eligible = editorCapabilities(element).renderReview;
    this.quillModel = eligible && quill && !!this.pageBridge.readQuill(element);
    this.quill = eligible && quill;
    const proseMirror =
      eligible && element.matches(".ProseMirror") && !!this.pageBridge.readProseMirror(element);
    const slate =
      eligible && element.matches("[data-slate-editor]") && !!this.pageBridge.readSlate(element);
    // Other fingerprints get a writer only when the bridge finds their editor.
    // A RoosterJS editor has no own fingerprint: the bridge identifies it.
    const fingerprint =
      !proseMirror &&
      !slate &&
      !quill &&
      (!!element.closest(MODEL_EDITOR_SELECTOR) ||
        (element.matches(DOM_EDITOR_SELECTOR) &&
          this.pageBridge.reviewTransaction(element, "identify")));
    const hostModel = eligible && fingerprint && !!this.pageBridge.readReviewModel(element);
    const hostDom =
      eligible && fingerprint && !hostModel && this.pageBridge.reviewTransaction(element, "probe");
    const native = typeof element.ownerDocument.execCommand === "function";
    this.kind = proseMirror
      ? "prosemirror"
      : slate
        ? "slate"
        : quill
          ? "quill"
          : hostModel
            ? "host-model"
            : hostDom && native
              ? "host-dom"
              : fingerprint
                ? "model-editor"
                : "contenteditable";
    const model =
      this.kind === "prosemirror" || this.kind === "slate" || this.kind === "host-model";
    const writable =
      model ||
      this.quill ||
      ((this.kind === "contenteditable" || this.kind === "host-dom") && native);
    // Each batch uses one native command or one host-model transaction.
    this.adapterCapabilities = { apply: writable, bulk: writable };
  }

  get capabilities(): ReviewCapabilities {
    // A model can mount on the same DOM host while Review remains open.
    const newModel =
      this.kind === "contenteditable" &&
      (this.element.closest(MODEL_EDITOR_SELECTOR) ||
        (this.element.classList.contains("ql-editor") && this.element.closest(".ql-container")));
    return newModel ? { apply: false, bulk: false } : this.adapterCapabilities;
  }

  /**
   * A model editor without a writer when Review opened: its DOM can be ahead of
   * its model for a moment (a pending render). When the model reads now, with
   * all of its checks, the model writer takes over. Returns true when that occurs.
   */
  resolveModelWriter(): boolean {
    if (
      this.kind !== "model-editor" ||
      this.composing ||
      !editorCapabilities(this.element).renderReview ||
      !this.pageBridge.readReviewModel(this.element)
    )
      return false;
    this.kind = "host-model";
    this.adapterCapabilities = { apply: true, bulk: true };
    return true;
  }

  read(): ReviewTargetRead {
    if (!editorCapabilities(this.element).renderReview) {
      return { ok: false, reason: isInDocument(this.element) ? "ineligible" : "detached" };
    }
    if (this.composing) return { ok: false, reason: "composing" };
    this.resolveModelWriter();
    this.map = buildContentEditableTextMap(this.element);
    if (
      this.kind === "prosemirror" ||
      this.kind === "slate" ||
      this.kind === "host-model" ||
      this.quillModel
    ) {
      const snapshot = this.readModel(this.element);
      return snapshot ? { ok: true, ...snapshot } : { ok: false, reason: "unsupported" };
    }
    return {
      ok: true,
      text: this.map.text,
      protectedRanges: this.map.protectedRanges,
      signature: this.map.signature,
    };
  }

  async apply(request: Parameters<ReviewTargetHandle["apply"]>[0]): Promise<ReviewApplyResult> {
    const root = this.element;
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    if (!win || !this.capabilities.apply) return { status: "rejected", reason: "unsupported" };
    if (!editorCapabilities(root).renderReview) return { status: "rejected", reason: "ineligible" };
    if (this.composing) return { status: "rejected", reason: "composing" };
    if (hasOtherFocusedEditor(root)) return { status: "stale" };
    if (this.kind === "slate") {
      const result = this.pageBridge.applySlate(root, request);
      if (result.status !== "applied") return result;
      // Slate renders its model through React after a microtask; wait for the DOM.
      for (let frame = 0; frame < 10; frame++) {
        await nextFrame(win);
        const snapshot = this.pageBridge.readSlate(root);
        if (snapshot)
          return snapshot.text === request.after
            ? { status: "applied", signature: snapshot.signature }
            : { status: "unverified" };
      }
      return { status: "unverified" };
    }
    if (this.kind === "host-model") {
      const result = this.pageBridge.applyReviewModel(root, request);
      if (result.status !== "applied") return result;
      // Draft.js renders through React later. The read refuses a DOM that the model has left.
      for (let frame = 0; frame < 10; frame++) {
        await nextFrame(win);
        const snapshot = this.pageBridge.readReviewModel(root);
        if (!snapshot || snapshot.text === request.before) continue;
        this.map = null;
        return sameExceptEdgeSpaces(snapshot.text, request.after, request.edits)
          ? {
              status: "applied",
              signature: snapshot.signature,
              ...(snapshot.text !== request.after ? { text: snapshot.text } : {}),
            }
          : { status: "unverified" };
      }
      return { status: "unverified" };
    }
    if (this.kind === "prosemirror" || this.quillModel) {
      const result = this.quillModel
        ? this.pageBridge.applyQuill(root, request)
        : this.pageBridge.applyProseMirror(root, request);
      await nextFrame(win);
      const snapshot = this.readModel(root);
      return result.status === "applied" &&
        (!result.signature ||
          snapshot?.text !== request.after ||
          snapshot.signature !== result.signature)
        ? { status: "unverified" }
        : result;
    }
    if (!request.edits.length) return { status: "rejected", reason: "unsupported" };
    let map = buildContentEditableTextMap(root);
    if (map.text !== request.before || map.signature !== request.signature) {
      return { status: "stale" };
    }
    if (applyEdits(map.text, request.edits) !== request.after)
      return { status: "rejected", reason: "host-refused" };
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
    if (!editorCapabilities(root).renderReview) return { status: "rejected", reason: "ineligible" };
    if (!this.capabilities.apply) return { status: "rejected", reason: "unsupported" };
    if (this.composing) return { status: "rejected", reason: "composing" };
    map = buildContentEditableTextMap(root);
    if (map.text !== request.before || map.signature !== request.signature) {
      return { status: "stale" };
    }
    const planned = formattingPreservingEdits(map, request.edits);
    if (!planned) return { status: "rejected", reason: "host-refused" };

    const expectedStyles = expectedFormatting(map, planned);
    const edit = planned[0];
    if (!edit || !selection) return { status: "rejected", reason: "host-refused" };
    // The host records typing before the edit, so its own undo reverts only the edit.
    const transaction = this.kind === "host-dom";
    if (transaction && !this.pageBridge.reviewTransaction(root, "begin"))
      return { status: "rejected", reason: "unsupported" };
    let refused: ReviewApplyResult | null;
    let recorded = true;
    try {
      refused = this.writePlanned(doc, selection, map, planned, request.before);
    } finally {
      if (transaction) recorded = this.pageBridge.reviewTransaction(root, "end");
    }
    if (refused) return refused;
    // The host has no undo step for the edit.
    if (!recorded) return { status: "unverified" };
    const observed = buildContentEditableTextMap(root);
    const current = observed.text;
    if (!sameExceptEdgeSpaces(current, request.after, planned)) {
      return current === request.before
        ? { status: "rejected", reason: "host-refused" }
        : { status: "unverified" };
    }
    // Do not restore selection after the user or host moves it during verification.
    const afterSelection = doc.getSelection();
    const anchorNode = afterSelection?.anchorNode;
    const anchorOffset = afterSelection?.anchorOffset;
    const focusNode = afterSelection?.focusNode;
    const focusOffset = afterSelection?.focusOffset;
    // Let an unknown host revert or normalize the edit, then confirm it kept the text.
    await nextFrame(win);
    const final = buildContentEditableTextMap(root);
    if (
      !root.isConnected ||
      final.text !== current ||
      expectedFormatting(final, []) !== expectedStyles
    )
      return { status: "unverified" };
    this.map = final;
    const liveSelection = doc.getSelection();
    if (
      focusInside() &&
      liveSelection?.anchorNode === anchorNode &&
      liveSelection?.anchorOffset === anchorOffset &&
      liveSelection?.focusNode === focusNode &&
      liveSelection?.focusOffset === focusOffset
    )
      this.restoreSelection(final, saved, request.edits);
    return { status: "applied", ...(current !== request.after ? { text: current } : {}) };
  }

  /** Writes the planned edits natively. Returns the refusal, or null when they were written. */
  private writePlanned(
    doc: Document,
    selection: Selection,
    map: ContentEditableTextMap,
    planned: ReviewEdit[],
    before: string,
  ): ReviewApplyResult | null {
    const root = this.element;
    const edit = planned[0];
    const write = (range: Range, part: ReviewEdit, text: string) =>
      this.kind === "quill"
        ? writeQuillInput(root, range, part)
        : writeNative(doc, selection, range, part, text);
    if (planned.length > 1 && (this.kind === "host-dom" || this.kind === "quill")) {
      // The host undo step holds the batch, so each edit can be its own native
      // edit in its own text node. Quill merges changes of one moment into one
      // undo step. From the end: earlier offsets stay valid.
      let wrote = false;
      for (const part of [...planned].sort((a, b) => b.start - a.start)) {
        const current = buildContentEditableTextMap(root);
        const range = offsetRangeToDomRange(current, part, doc);
        if (
          !range ||
          range.toString() !== part.original ||
          range.startContainer !== range.endContainer ||
          !write(range, part, current.text)
        )
          break;
        wrote = true;
      }
      if (!wrote) return { status: "rejected", reason: "host-refused" };
    } else if (planned.length > 1) {
      const transaction = prepareNativeReviewTransaction(root, map, planned);
      if (!transaction) return { status: "rejected", reason: "unsupported" };
      if (
        !writeNative(
          doc,
          selection,
          transaction.range,
          {
            start: Math.min(...planned.map((part) => part.start)),
            end: Math.max(...planned.map((part) => part.end)),
            original: transaction.range.toString(),
            replacement: transaction.value,
          },
          before,
        )
      )
        return { status: "rejected", reason: "host-refused" };
    } else {
      const range = offsetRangeToDomRange(map, edit, doc);
      if (!range || range.toString() !== edit.original)
        return { status: "rejected", reason: "host-refused" };
      // Equivalent formatting does not prove that sibling nodes have no host state.
      if (range.startContainer !== range.endContainer)
        return { status: "rejected", reason: "unsupported" };
      if (!write(range, edit, before)) return { status: "rejected", reason: "host-refused" };
    }
    return null;
  }

  private readModel(root: HTMLElement) {
    return this.quillModel
      ? this.pageBridge.readQuill(root)
      : this.kind === "slate"
        ? this.pageBridge.readSlate(root)
        : this.kind === "host-model"
          ? this.pageBridge.readReviewModel(root)
          : this.pageBridge.readProseMirror(root);
  }

  private captureSelection(
    map: ContentEditableTextMap,
    range: Range | null,
  ): { start: number; end: number; backward: boolean } | null {
    if (!range || !rangeInsideTarget(range, this.element)) return null;
    const start = domPositionToOffset(map, range.startContainer, range.startOffset);
    const end = domPositionToOffset(map, range.endContainer, range.endOffset);
    const selection = this.element.ownerDocument.getSelection();
    const backward =
      selection?.anchorNode === range.endContainer &&
      selection?.anchorOffset === range.endOffset &&
      !range.collapsed;
    return start === null || end === null ? null : { start, end, backward };
  }

  private restoreSelection(
    map: ContentEditableTextMap,
    saved: { start: number; end: number; backward: boolean } | null,
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
    const [anchor, focus] = saved.backward ? [end, start] : [start, end];
    selection.setBaseAndExtent(
      anchor.startContainer,
      anchor.startOffset,
      focus.startContainer,
      focus.startOffset,
    );
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
