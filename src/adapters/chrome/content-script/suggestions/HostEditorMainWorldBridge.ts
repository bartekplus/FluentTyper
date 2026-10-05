import { readQuill, applyQuill, quillHistoryBoundary } from "./QuillEditor";
import {
  readSlate,
  applySlate,
  slateBlockContext,
  replaceSlateBlock,
  SLATE_ROOT_SELECTOR,
} from "./SlateEditor";
import {
  readGutenberg,
  applyGutenberg,
  gutenbergBlockContext,
  replaceGutenbergBlock,
  setGutenbergComposing,
} from "./GutenbergEditor";
import { gutenbergSelectedField, isGutenbergField } from "./GutenbergEnvironment";
import {
  observeProseMirror,
  setProseMirrorObservationEnabled,
  readProseMirror,
  applyProseMirror,
  proseMirrorBlockContext,
  replaceProseMirrorBlock,
} from "./ProseMirrorEditor";
import {
  CURSOR_MOVE_COUNT_ATTR,
  HOST_EDITOR_ENABLED_EVENT,
  HOST_EDITOR_ENABLED_ATTR,
  CURSOR_MOVE_EVENT,
  HOST_EDITOR_MAIN_WORLD_FLAG,
  HOST_EDITOR_REQUEST_ATTR,
  HOST_EDITOR_REQUEST_EVENT,
  HOST_EDITOR_RESPONSE_ATTR,
  MODEL_TYPING_SELECTOR,
  NOT_APPLIED,
  type HostEditorBlockReplacement,
  type HostEditorBridgeRequest,
  type DomEditorReplacement,
} from "./HostEditorBridgeProtocol";
import {
  applyLineEditorReplacement,
  findLineEditorController,
  isComposingIn,
  isValidBlockReplacement,
  readLineEditorBlockContext,
  recordComposition,
  type LineEditorBlockContext,
  type LineEditorController,
} from "./HostEditorControllerUtils";
import { TextTargetAdapter } from "./TextTargetAdapter";
import {
  applyReviewModel,
  flushCKEditor5PendingMutations,
  modelBlockContext,
  readReviewModel,
  replaceModelBlock,
} from "./ReviewModelEditors";
import { reviewTransaction } from "./ReviewDomEditors";

type BridgeWindow = Window & { [HOST_EDITOR_MAIN_WORLD_FLAG]?: boolean };

const APPLIED = { applied: true, didDispatchInput: false };

// ── CKEditor-5 integration ──────────────────────────────────────────
// CKEditor-5 stores its editor instance on the root editable element as
// `ckeditorInstance`.  We use the model API to apply replacements so the
// editor's internal model stays consistent with the DOM.  This avoids
// the problems caused by dispatching synthetic beforeinput events which
// CKEditor-5 handles using its own (stale) model selection.

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-member-access, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-argument */
interface CKEditorInstance {
  model: {
    document: { selection: { getFirstPosition(): any } };
    schema?: { isObject(node: any): boolean; isInline(node: any): boolean };
    change(callback: (writer: any) => void): void;
  };
  editing?: {
    mapper?: { toModelPosition(viewPosition: any): any; toViewElement?(element: any): any };
    view?: {
      document?: { isComposing?: boolean };
      domConverter?: {
        domPositionToView(domParent: Node, domOffset?: number): any;
        mapViewToDom?(viewNode: any): Node | undefined;
      };
      _observers?: Map<unknown, { flush?: () => void; _mutationObserver?: unknown }>;
    };
  };
  ui?: { view?: { editable?: { element?: HTMLElement | null } } };
}

function findCKEditor5Instance(elem: HTMLElement): CKEditorInstance | null {
  let current: any = elem;
  while (current) {
    try {
      if (
        current.ckeditorInstance &&
        typeof current.ckeditorInstance.model?.change === "function"
      ) {
        return current.ckeditorInstance as CKEditorInstance;
      }
    } catch {
      // Property access may throw on exotic host objects.
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Mapping between plain-text offsets (used by FluentTyper / DOM textContent)
 * and CKEditor-5 model offsets.  softBreak elements and inline objects without
 * DOM text (an inline image) count as 1 model offset but contribute 0 text
 * characters, so every such element before a position adds +1 to the model
 * offset relative to the text offset.
 */
interface BlockTextMapping {
  text: string;
  /** Model offsets of the softBreaks and the inline objects (sorted ascending). */
  softBreakModelOffsets: number[];
  /** Model offsets of the inline objects. An edit must not contain one. */
  objectModelOffsets: number[];
}

/** An inline object, for example an inline image, that shows no DOM text. */
function isTextlessInlineObject(editor: CKEditorInstance, child: any): boolean {
  try {
    const schema = editor.model.schema;
    if (!schema?.isObject(child) || !schema.isInline(child)) return false;
    const view = editor.editing?.mapper?.toViewElement?.(child);
    const dom = view ? editor.editing?.view?.domConverter?.mapViewToDom?.(view) : null;
    return !!dom && dom.textContent === "";
  } catch {
    return false;
  }
}

function extractModelBlockMapping(editor: CKEditorInstance, block: any): BlockTextMapping | null {
  if (!block || typeof block.getChildren !== "function") {
    return null;
  }
  let text = "";
  const softBreakModelOffsets: number[] = [];
  const objectModelOffsets: number[] = [];
  let modelOffset = 0;
  for (const child of block.getChildren()) {
    if (typeof child.data === "string") {
      text += child.data;
      modelOffset += child.data.length;
    } else if (child.is && (child.is("softBreak") || child.is("element", "softBreak"))) {
      softBreakModelOffsets.push(modelOffset);
      modelOffset += 1;
    } else if (isTextlessInlineObject(editor, child)) {
      softBreakModelOffsets.push(modelOffset);
      objectModelOffsets.push(modelOffset);
      modelOffset += 1;
    } else if (child.is && !child.is("$text") && !child.is("$textProxy")) {
      // Other elements (a widget that shows text) – offsets diverge unpredictably.
      return null;
    } else if (!child.is) {
      // Unknown node type without an `is` method (exotic 3rd-party plugin).
      return null;
    }
  }
  return { text, softBreakModelOffsets, objectModelOffsets };
}

/**
 * Convert a plain-text offset to a CKEditor-5 model offset.
 *
 * @param endpoint — `"start"` (default) maps to the position AFTER a
 *   softBreak when the text offset sits exactly at the boundary.  Use for
 *   range starts and cursor positions.  `"end"` maps to BEFORE the
 *   softBreak, which is correct for range ends so the softBreak element
 *   itself is not included in a removal range.
 */
function textOffsetToModelOffset(
  textOffset: number,
  softBreakModelOffsets: number[],
  endpoint: "start" | "end" = "start",
): number {
  let adjustment = 0;
  for (const sbModelOffset of softBreakModelOffsets) {
    const crosses =
      endpoint === "end"
        ? sbModelOffset < textOffset + adjustment
        : sbModelOffset <= textOffset + adjustment;
    if (crosses) {
      adjustment += 1;
    } else {
      break;
    }
  }
  return textOffset + adjustment;
}

/** Convert a CKEditor-5 model offset to a plain-text offset. */
function modelOffsetToTextOffset(modelOffset: number, softBreakModelOffsets: number[]): number {
  let adjustment = 0;
  for (const sbModelOffset of softBreakModelOffsets) {
    if (sbModelOffset < modelOffset) {
      adjustment += 1;
    } else {
      break;
    }
  }
  return modelOffset - adjustment;
}

function getCKEditorEditableElement(editor: CKEditorInstance): HTMLElement | null {
  const editable = editor.ui?.view?.editable?.element;
  return editable instanceof HTMLElement ? editable : null;
}

function getCKEditor5SelectionPosition(editor: CKEditorInstance): any {
  const editable = getCKEditorEditableElement(editor);
  const domSelection = document.getSelection();
  if (
    editable &&
    domSelection &&
    domSelection.rangeCount > 0 &&
    typeof editor.editing?.view?.domConverter?.domPositionToView === "function" &&
    typeof editor.editing?.mapper?.toModelPosition === "function"
  ) {
    try {
      const range = domSelection.getRangeAt(0);
      if (editable === range.startContainer || editable.contains(range.startContainer)) {
        const viewPosition = editor.editing.view.domConverter.domPositionToView(
          range.startContainer,
          range.startOffset,
        );
        if (viewPosition) {
          const modelPosition = editor.editing.mapper.toModelPosition(viewPosition);
          if (modelPosition) {
            return modelPosition;
          }
        }
      }
    } catch {
      // Fall through to CKEditor's current model selection.
    }
  }

  return editor.model.document.selection.getFirstPosition();
}

/**
 * The selection position, its block and the block's text mapping. Pending DOM
 * mutation records are drained first, so the model agrees with what the user
 * sees in the DOM (Firefox CKEditor-5 may briefly lag by one typed character).
 */
function readCKEditor5Block(
  editor: CKEditorInstance,
): { position: any; block: any; mapping: BlockTextMapping } | null {
  if (editor.editing?.view?.document?.isComposing) return null;
  flushCKEditor5PendingMutations(editor);
  const position = getCKEditor5SelectionPosition(editor);
  const block = position?.parent;
  const mapping = block ? extractModelBlockMapping(editor, block) : null;
  return mapping ? { position, block, mapping } : null;
}

function getCKEditor5BlockContext(editor: CKEditorInstance): LineEditorBlockContext | null {
  const read = readCKEditor5Block(editor);
  if (!read || (typeof read.block.is === "function" && read.block.is("rootElement"))) {
    return null;
  }
  const { position, mapping } = read;
  const textOffset = modelOffsetToTextOffset(position.offset, mapping.softBreakModelOffsets);
  if (textOffset < 0 || textOffset > mapping.text.length) {
    return null;
  }
  return {
    beforeCursor: mapping.text.slice(0, textOffset),
    afterCursor: mapping.text.slice(textOffset),
    blockText: mapping.text,
  };
}

function applyCKEditor5BlockReplacement(
  editor: CKEditorInstance,
  request: HostEditorBlockReplacement,
): { applied: boolean; didDispatchInput: boolean } {
  const read = readCKEditor5Block(editor);
  if (!read) {
    return NOT_APPLIED;
  }
  const { position, block, mapping } = read;
  // FT-INV-5: flushing can reconcile pending typing; an unresolved mismatch
  // must never rebuild the model from the extension's DOM snapshot.
  if (mapping.text !== request.expectedBlockText || !isValidBlockReplacement(mapping.text, request))
    return NOT_APPLIED;

  // Translate text offsets to model offsets (accounting for softBreaks).
  const startAfterBreaks = textOffsetToModelOffset(
    request.replaceStart,
    mapping.softBreakModelOffsets,
  );
  const endBeforeBreaks = textOffsetToModelOffset(
    request.replaceEnd,
    mapping.softBreakModelOffsets,
    "end",
  );
  // A collapsed edit at a softBreak or an object has two model positions:
  // before and after it. Use the one on the caret's side (one position, never
  // an inverted range).
  const collapsed = request.replaceStart === request.replaceEnd;
  const collapsedAt = position.offset <= endBeforeBreaks ? endBeforeBreaks : startAfterBreaks;
  const modelReplaceStart = collapsed ? collapsedAt : startAfterBreaks;
  const modelReplaceEnd = collapsed ? collapsedAt : endBeforeBreaks;
  // An inline object must not be removed, and must not be between the edit and
  // the caret (the DOM text reads the words on its two sides as one word).
  const spanStart = Math.min(modelReplaceStart, position.offset);
  const spanEnd = Math.max(modelReplaceEnd, position.offset);
  if (mapping.objectModelOffsets.some((offset) => offset >= spanStart && offset < spanEnd))
    return NOT_APPLIED;
  // After the replacement, softBreaks inside the deleted range no longer
  // exist.  Filter them out, then shift the survivors that come after the
  // edit by the length delta. A softBreak at a collapsed edit is after the
  // inserted text, so it moves too.
  const replacedLength = request.replaceEnd - request.replaceStart;
  const lengthDelta = request.replacementText.length - replacedLength;
  const updatedSoftBreakOffsets = mapping.softBreakModelOffsets
    .filter((sbOffset) => sbOffset < modelReplaceStart || sbOffset >= modelReplaceEnd)
    .map((sbOffset) => (sbOffset >= modelReplaceEnd ? sbOffset + lengthDelta : sbOffset));
  // Use "end" when the cursor sits at the replacement boundary so it stays
  // on the same line as the replaced text (before a softBreak).  Use "start"
  // when the cursor is past the replacement (e.g. on the next line).
  const cursorIsAtReplacementBoundary =
    request.cursorAfter <= request.replaceStart + request.replacementText.length;
  const modelCursorAfter = textOffsetToModelOffset(
    request.cursorAfter,
    updatedSoftBreakOffsets,
    cursorIsAtReplacementBoundary ? "end" : "start",
  );

  // Capture text attributes (bold, italic, etc.) at the caret so the inserted
  // text preserves the surrounding formatting. Only a text node gives them:
  // the attributes of an inline image (src) or a softBreak are not text formatting.
  let textAttrs: Record<string, unknown> | null = null;
  try {
    const node = [position.textNode, position.nodeBefore, position.nodeAfter].find(
      (candidate) => candidate?.is?.("$text") || candidate?.is?.("$textProxy"),
    );
    if (node && typeof node.getAttributes === "function") {
      const attrs: Record<string, unknown> = Object.fromEntries(node.getAttributes());
      if (Object.keys(attrs).length > 0) {
        textAttrs = attrs;
      }
    }
  } catch {
    // Best-effort: proceed without attributes.
  }

  try {
    editor.model.change((writer: any) => {
      writer.remove(
        writer.createRange(
          writer.createPositionAt(block, modelReplaceStart),
          writer.createPositionAt(block, modelReplaceEnd),
        ),
      );
      if (request.replacementText.length > 0) {
        const insertPos = writer.createPositionAt(block, modelReplaceStart);
        if (textAttrs) {
          writer.insertText(request.replacementText, textAttrs, insertPos);
        } else {
          writer.insertText(request.replacementText, insertPos);
        }
      }
      writer.setSelection(writer.createPositionAt(block, modelCursorAfter));
    });
  } catch {
    return NOT_APPLIED;
  }

  return APPLIED;
}
/* oxlint-enable typescript/no-explicit-any, typescript/no-unsafe-member-access, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-argument */

function applyBlockReplacement(
  controller: LineEditorController,
  elem: HTMLElement,
  request: HostEditorBlockReplacement,
) {
  if (isComposingIn(elem)) return NOT_APPLIED;
  return applyLineEditorReplacement(
    controller,
    TextTargetAdapter.findBackingTextValueTarget(elem),
    request.expectedBlockText,
    request,
  )
    ? APPLIED
    : NOT_APPLIED;
}

/** The text node and offset at a character offset in the text of `root`. */
function textPosition(root: HTMLElement, offset: number): [Text, number] | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (offset <= node.length) return [node, offset];
    offset -= node.length;
  }
  return null;
}

// TinyMCE, CKEditor 4, Froala, Summernote and RoosterJS own history even though
// their content model is the DOM. Enclose the native minimal edit in one host
// undo step instead of merging into prior typing.
function applyDomEditor(elem: HTMLElement, request: DomEditorReplacement) {
  const win = elem.ownerDocument.defaultView;
  if (!win || !reviewTransaction(elem, "probe")) return NOT_APPLIED;
  const matches = () => {
    const selection = win.getSelection();
    if (
      !elem.isConnected ||
      isComposingIn(elem) ||
      elem.ownerDocument.activeElement !== elem ||
      elem.textContent !== request.before ||
      !selection?.rangeCount
    )
      return false;
    const range = selection.getRangeAt(0);
    if (!elem.contains(range.startContainer) || !elem.contains(range.endContainer)) return false;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(elem);
    prefix.setEnd(range.startContainer, range.startOffset);
    return prefix.toString() === request.prefix && range.toString() === request.selected;
  };
  if (!matches()) return NOT_APPLIED;
  // The host's undo step before the edit keeps the selection of this moment,
  // and its Undo restores it. Record the user's caret there, not the replaced
  // range: else Undo leaves the typed text selected, and the next key replaces it.
  const selection = win.getSelection()!;
  const replaced = selection.getRangeAt(0).cloneRange();
  const caret = textPosition(elem, request.caret);
  if (caret) selection.collapse(caret[0], caret[1]);
  const begun = reviewTransaction(elem, "begin");
  selection.removeAllRanges();
  selection.addRange(replaced);
  if (!begun) return NOT_APPLIED;
  let recorded: boolean;
  try {
    if (matches()) elem.ownerDocument.execCommand("insertText", false, request.replacement);
  } finally {
    recorded = reviewTransaction(elem, "end");
  }
  const after = elem.textContent ?? "";
  if (after === request.before) return NOT_APPLIED;
  const expected =
    request.prefix +
    request.replacement +
    request.before.slice(request.prefix.length + request.selected.length);
  return { ...APPLIED, ...(after === expected && recorded ? {} : { unverified: true }) };
}

export function installHostEditorMainWorldBridge(doc: Document = document): void {
  const win = doc.defaultView;
  if (!win) {
    return;
  }
  if ((win as BridgeWindow)[HOST_EDITOR_MAIN_WORLD_FLAG]) {
    return;
  }

  (win as BridgeWindow)[HOST_EDITOR_MAIN_WORLD_FLAG] = true;

  let enabled = false;
  const observe = (event: Event) => {
    const source = gutenbergSelectedField(event.composedPath()[0] as Element | null);
    if (source instanceof HTMLElement && isGutenbergField(source)) {
      if (event.type === "compositionstart" || event.type === "compositionend")
        setGutenbergComposing(source, event.type === "compositionstart");
    }
    const root = source instanceof Element ? source.closest<HTMLElement>(".ProseMirror") : null;
    if (root) observeProseMirror(root);
  };
  const observeSelection = () => {
    const root = doc.activeElement?.closest<HTMLElement>(".ProseMirror");
    if (root) observeProseMirror(root);
  };
  const names = [
    "focus",
    "keydown",
    "pointerdown",
    "beforeinput",
    "input",
    "compositionstart",
    "compositionend",
  ];
  // document.open() erases every listener of the document. An editor that writes
  // its frame that way (CKEditor 4, after Firefox injected this script) would
  // leave the bridge deaf: the bridge's own listeners are added again after it.
  const listeners: [string, EventListener, boolean][] = [];
  const listen = (type: string, listener: EventListener, capture = false) => {
    listeners.push([type, listener, capture]);
    doc.addEventListener(type, listener, capture);
  };
  const open = doc.open.bind(doc) as (...values: unknown[]) => unknown;
  doc.open = function (...args: unknown[]) {
    const result = open(...args);
    // The observation listeners are gone too: the bridge waits to be enabled again.
    enabled = false;
    setProseMirrorObservationEnabled(false);
    for (const [type, listener, capture] of listeners)
      doc.addEventListener(type, listener, capture);
    return result;
  } as typeof doc.open;
  // Always on: a composition that starts while the bridge is off must still block writes.
  listen("compositionstart", recordComposition, true);
  listen("compositionend", recordComposition, true);
  listen(HOST_EDITOR_ENABLED_EVENT, () => {
    const next = doc.documentElement.getAttribute(HOST_EDITOR_ENABLED_ATTR) === "true";
    if (next === enabled) return;
    enabled = next;
    setProseMirrorObservationEnabled(enabled);
    for (const name of names) {
      if (enabled) doc.addEventListener(name, observe, true);
      else doc.removeEventListener(name, observe, true);
    }
    if (enabled) {
      doc.addEventListener("selectionchange", observeSelection, true);
      doc.querySelectorAll<HTMLElement>(".ProseMirror").forEach(observeProseMirror);
    } else doc.removeEventListener("selectionchange", observeSelection, true);
  });

  // Cursor movement bridge: content script (isolated world) dispatches this
  // event when it needs to reposition the cursor in the main world. Running
  // Selection.modify() in the main world triggers native selectionchange events
  // that React-based editors (Lexical, Slate) listen for to sync their internal
  // selection state.
  listen(
    CURSOR_MOVE_EVENT,
    (event) => {
      if (!enabled) return;
      const source = event.composedPath()[0];
      if (!(source instanceof HTMLElement)) {
        return;
      }
      const rawCount = source.getAttribute(CURSOR_MOVE_COUNT_ATTR);
      const count = rawCount ? parseInt(rawCount, 10) : 0;
      if (!Number.isFinite(count) || count <= 0) {
        return;
      }
      const sel = win.getSelection();
      if (!sel) {
        return;
      }
      for (let i = 0; i < count; i++) {
        sel.modify("move", "backward", "character");
      }
    },
    true,
  );

  listen(
    HOST_EDITOR_REQUEST_EVENT,
    (event) => {
      if (!enabled) return;
      const source = event.composedPath()[0];
      if (!(source instanceof HTMLElement)) {
        return;
      }
      const rawRequest = source.getAttribute(HOST_EDITOR_REQUEST_ATTR);
      if (!rawRequest) {
        return;
      }

      let response: unknown = { ok: false };
      try {
        const request = JSON.parse(rawRequest) as HostEditorBridgeRequest;
        observeProseMirror(source);
        const controller = findLineEditorController(source);
        const ckEditor = controller ? null : findCKEditor5Instance(source);
        const slate = source.matches(SLATE_ROOT_SELECTOR);
        const modelTyping = source.matches(MODEL_TYPING_SELECTOR);
        if (request.action === "readGutenberg" || request.action === "readGutenbergSelection") {
          const snapshot = readGutenberg(source, request.action === "readGutenbergSelection");
          if (snapshot) response = { ok: true, snapshot };
        } else if (request.action === "applyGutenberg") {
          response = { ok: true, reviewResult: applyGutenberg(source, request) };
        } else if (request.action === "getBlockContext" && isGutenbergField(source)) {
          const blockContext = gutenbergBlockContext(source);
          if (blockContext) response = { ok: true, blockContext };
        } else if (request.action === "applyBlockReplacement" && isGutenbergField(source)) {
          response = { ok: true, result: replaceGutenbergBlock(source, request) };
        } else if (request.action === "applyDomEditor") {
          response = { ok: true, result: applyDomEditor(source, request) };
        } else if (request.action === "readQuill") {
          const snapshot = readQuill(source);
          if (snapshot) response = { ok: true, snapshot };
        } else if (request.action === "applyQuill") {
          response = { ok: true, reviewResult: applyQuill(source, request) };
        } else if (request.action === "quillHistoryBoundary") {
          const applied = quillHistoryBoundary(source);
          response = { ok: true, result: { applied, didDispatchInput: false } };
        } else if (request.action === "readSlate") {
          const snapshot = readSlate(source);
          if (snapshot) response = { ok: true, snapshot };
        } else if (request.action === "applySlate") {
          response = { ok: true, reviewResult: applySlate(source, request) };
        } else if (request.action === "readReviewModel") {
          const snapshot = readReviewModel(source);
          if (snapshot) response = { ok: true, snapshot };
        } else if (request.action === "applyReviewModel") {
          response = { ok: true, reviewResult: applyReviewModel(source, request) };
        } else if (request.action === "reviewTransaction") {
          const applied = reviewTransaction(source, request.phase);
          response = { ok: true, result: { applied, didDispatchInput: false } };
        } else if (request.action === "readProseMirror") {
          const snapshot = readProseMirror(source);
          if (snapshot) response = { ok: true, snapshot };
        } else if (request.action === "applyProseMirror") {
          response = { ok: true, reviewResult: applyProseMirror(source, request) };
        } else if (request.action === "getBlockContext") {
          const blockContext = controller
            ? readLineEditorBlockContext(controller)
            : ckEditor
              ? getCKEditor5BlockContext(ckEditor)
              : slate
                ? slateBlockContext(source)
                : modelTyping
                  ? modelBlockContext(source)
                  : proseMirrorBlockContext(source);
          if (blockContext) {
            response = { ok: true, blockContext };
          }
        } else if (request.action === "applyBlockReplacement" && controller) {
          response = { ok: true, result: applyBlockReplacement(controller, source, request) };
        } else if (request.action === "applyBlockReplacement" && ckEditor) {
          response = { ok: true, result: applyCKEditor5BlockReplacement(ckEditor, request) };
        } else if (request.action === "applyBlockReplacement" && slate) {
          response = { ok: true, result: replaceSlateBlock(source, request) };
        } else if (request.action === "applyBlockReplacement" && modelTyping) {
          response = { ok: true, result: replaceModelBlock(source, request) };
        } else if (request.action === "applyBlockReplacement") {
          response = { ok: true, result: replaceProseMirrorBlock(source, request) };
        }
      } catch {
        response = { ok: false };
      }

      try {
        source.setAttribute(HOST_EDITOR_RESPONSE_ATTR, JSON.stringify(response));
      } catch {
        // Ignore DOM attribute failures; the content script will fall back.
      }
    },
    true,
  );
}

installHostEditorMainWorldBridge();
