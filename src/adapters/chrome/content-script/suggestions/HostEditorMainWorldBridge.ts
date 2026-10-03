import { readQuill, applyQuill } from "./QuillEditor";
import {
  readSlate,
  applySlate,
  slateBlockContext,
  replaceSlateBlock,
  SLATE_ROOT_SELECTOR,
} from "./SlateEditor";
import {
  observeProseMirror,
  setProseMirrorObservationEnabled,
  readProseMirror,
  applyProseMirror,
  proseMirrorBlockContext,
  replaceProseMirrorBlock,
} from "./ProseMirrorEditor";
import type { ReviewEdit } from "@core/domain/grammar/review/types";
import {
  CURSOR_MOVE_COUNT_ATTR,
  HOST_EDITOR_ENABLED_EVENT,
  HOST_EDITOR_ENABLED_ATTR,
  CURSOR_MOVE_EVENT,
  HOST_EDITOR_MAIN_WORLD_FLAG,
  HOST_EDITOR_REQUEST_ATTR,
  HOST_EDITOR_REQUEST_EVENT,
  HOST_EDITOR_RESPONSE_ATTR,
} from "./HostEditorBridgeProtocol";
import {
  findLineEditorController,
  readLineEditorBlockContext,
  readLineEditorCursor,
  syncBackingSelection,
  type LineEditorController,
} from "./HostEditorControllerUtils";

import type { TinyMCEReplacement } from "./HostEditorPageBridge";

type BridgeRequest =
  | ({ action: "applyTinyMCE" } & TinyMCEReplacement)
  | { action: "readProseMirror" | "readQuill" | "readSlate" }
  | {
      action: "applyProseMirror" | "applyQuill" | "applySlate";
      edits: ReviewEdit[];
      before: string;
      after: string;
      signature: string;
    }
  | {
      action: "getBlockContext";
    }
  | {
      action: "applyBlockReplacement";
      replaceStart: number;
      replaceEnd: number;
      replacementText: string;
      cursorAfter: number;
      expectedBlockText: string;
    };
type ApplyRequest = Extract<BridgeRequest, { action: "applyBlockReplacement" }>;
type BridgeWindow = Window & { [HOST_EDITOR_MAIN_WORLD_FLAG]?: boolean };

const NOT_APPLIED = { applied: false, didDispatchInput: false };
const APPLIED = { applied: true, didDispatchInput: false };

// ── CKEditor-5 integration ──────────────────────────────────────────
// CKEditor-5 stores its editor instance on the root editable element as
// `ckeditorInstance`.  We use the model API to apply replacements so the
// editor's internal model stays consistent with the DOM.  This avoids
// the problems caused by dispatching synthetic beforeinput events which
// CKEditor-5 handles using its own (stale) model selection.

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-member-access, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-argument */
interface CKEditorModel {
  document: { selection: { getFirstPosition(): any } };
  change(callback: (writer: any) => void): void;
}

interface CKEditorEditingViewDomConverter {
  domPositionToView(domParent: Node, domOffset?: number): any;
}

interface CKEditorViewObserver {
  flush?: () => void;
  _mutationObserver?: unknown;
}

interface CKEditorEditingView {
  domConverter?: CKEditorEditingViewDomConverter;
  _observers?: Map<unknown, CKEditorViewObserver>;
}

interface CKEditorEditingMapper {
  toModelPosition(viewPosition: any): any;
}

interface CKEditorEditing {
  mapper?: CKEditorEditingMapper;
  view?: CKEditorEditingView;
}

interface CKEditorUiEditable {
  element?: HTMLElement | null;
}

interface CKEditorUiView {
  editable?: CKEditorUiEditable;
}

interface CKEditorUi {
  view?: CKEditorUiView;
}

interface CKEditorInstance {
  model: CKEditorModel;
  editing?: CKEditorEditing;
  ui?: CKEditorUi;
}

const ckEditorInstanceCache = new WeakMap<HTMLElement, CKEditorInstance | null>();

function findCKEditor5Instance(elem: HTMLElement): CKEditorInstance | null {
  const cached = ckEditorInstanceCache.get(elem);
  if (cached) {
    return cached;
  }
  let current: any = elem;
  while (current) {
    try {
      if (
        current.ckeditorInstance &&
        typeof current.ckeditorInstance.model?.change === "function"
      ) {
        const instance = current.ckeditorInstance as CKEditorInstance;
        ckEditorInstanceCache.set(elem, instance);
        return instance;
      }
    } catch {
      // Property access may throw on exotic host objects.
    }
    current = current.parentElement;
  }
  ckEditorInstanceCache.set(elem, null);
  return null;
}

/**
 * Mapping between plain-text offsets (used by FluentTyper / DOM textContent)
 * and CKEditor-5 model offsets.  softBreak elements count as 1 model offset
 * but contribute 0 text characters, so every softBreak before a position adds
 * +1 to the model offset relative to the text offset.
 */
interface BlockTextMapping {
  text: string;
  /** Model offsets at which softBreak elements occur (sorted ascending). */
  softBreakModelOffsets: number[];
}

function extractModelBlockMapping(block: any): BlockTextMapping | null {
  if (!block || typeof block.getChildren !== "function") {
    return null;
  }
  let text = "";
  const softBreakModelOffsets: number[] = [];
  let modelOffset = 0;
  for (const child of block.getChildren()) {
    if (typeof child.data === "string") {
      text += child.data;
      modelOffset += child.data.length;
    } else if (child.is && (child.is("softBreak") || child.is("element", "softBreak"))) {
      softBreakModelOffsets.push(modelOffset);
      modelOffset += 1;
    } else if (child.is && !child.is("$text") && !child.is("$textProxy")) {
      // Inline object (image, widget, etc.) – offsets diverge unpredictably.
      return null;
    } else if (!child.is) {
      // Unknown node type without an `is` method (exotic 3rd-party plugin).
      return null;
    }
  }
  return { text, softBreakModelOffsets };
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

function getCKEditor5BlockContext(
  editor: CKEditorInstance,
): { beforeCursor: string; afterCursor: string; blockText: string } | null {
  // Drain any pending DOM mutation records so the returned block text
  // reflects what the user sees in the DOM, not a stale model snapshot
  // (Firefox CKEditor-5 may briefly lag by one character after typing).
  flushCKEditor5PendingMutations(editor);
  const position = getCKEditor5SelectionPosition(editor);
  if (!position) {
    return null;
  }
  const block = position.parent;
  if (!block) {
    return null;
  }
  if (typeof block.is === "function" && block.is("rootElement")) {
    return null;
  }
  const mapping = extractModelBlockMapping(block);
  if (mapping === null) {
    return null;
  }
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

/**
 * Synchronously drain any pending DOM mutation records that CKEditor-5's
 * MutationObserver has queued but not yet reconciled into the model.  On
 * Firefox, a character typed into the DOM can sit in this queue briefly
 * while the observer's microtask is still pending.  Flushing here before we
 * read or write the model ensures we operate on a state that agrees with
 * what the user sees in the DOM.
 */
function flushCKEditor5PendingMutations(editor: CKEditorInstance): void {
  const observers = editor.editing?.view?._observers;
  if (!observers || typeof observers.values !== "function") {
    return;
  }
  for (const observer of observers.values()) {
    // The MutationObserver wrapper is the only observer that owns a
    // native `_mutationObserver` instance.  Its `flush()` synchronously
    // processes any pending records and reconciles them into the model.
    if (observer && observer._mutationObserver && typeof observer.flush === "function") {
      try {
        observer.flush();
      } catch {
        // Best-effort: if flushing throws, proceed without it.
      }
      return;
    }
  }
}

function applyCKEditor5BlockReplacement(
  editor: CKEditorInstance,
  request: ApplyRequest,
): { applied: boolean; didDispatchInput: boolean } {
  // Drain any pending DOM mutation records before reading the model so that
  // a freshly-typed character already in the DOM (Firefox CKEditor-5 lag)
  // is reflected in the model we plan to edit.
  flushCKEditor5PendingMutations(editor);
  const position = getCKEditor5SelectionPosition(editor);
  if (!position) {
    return NOT_APPLIED;
  }
  const block = position.parent;
  if (!block) {
    return NOT_APPLIED;
  }
  const mapping = extractModelBlockMapping(block);
  if (mapping === null) {
    return NOT_APPLIED;
  }
  // FT-INV-5: flushing can reconcile pending typing; an unresolved mismatch
  // must never rebuild the model from the extension's DOM snapshot.
  if (
    mapping.text !== request.expectedBlockText ||
    request.replaceStart < 0 ||
    request.replaceEnd < request.replaceStart ||
    request.replaceEnd > mapping.text.length
  )
    return NOT_APPLIED;
  const expectedLength =
    request.expectedBlockText.length -
    (request.replaceEnd - request.replaceStart) +
    request.replacementText.length;
  if (request.cursorAfter < 0 || request.cursorAfter > expectedLength) {
    return NOT_APPLIED;
  }

  // Translate text offsets to model offsets (accounting for softBreaks).
  const modelReplaceStart = textOffsetToModelOffset(
    request.replaceStart,
    mapping.softBreakModelOffsets,
  );
  const modelReplaceEnd = textOffsetToModelOffset(
    request.replaceEnd,
    mapping.softBreakModelOffsets,
    "end",
  );
  // After the replacement, softBreaks inside the deleted range no longer
  // exist.  Filter them out, then shift the survivors that come after the
  // edit by the length delta.
  const replacedLength = request.replaceEnd - request.replaceStart;
  const lengthDelta = request.replacementText.length - replacedLength;
  const updatedSoftBreakOffsets = mapping.softBreakModelOffsets
    .filter((sbOffset) => sbOffset <= modelReplaceStart || sbOffset >= modelReplaceEnd)
    .map((sbOffset) => (sbOffset > modelReplaceStart ? sbOffset + lengthDelta : sbOffset));
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

  // Capture text attributes (bold, italic, etc.) at the replacement start so
  // the inserted text preserves the surrounding formatting.
  let textAttrs: Record<string, unknown> | null = null;
  try {
    const node = position.textNode ?? position.nodeBefore ?? position.nodeAfter;
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

// Intentionally duplicated from TextTargetAdapter: the main-world bridge runs in
// a separate injected bundle and stays self-contained instead of importing
// extension-world helpers across the world boundary.
function findBackingTextValueTarget(
  elem: HTMLElement,
): HTMLInputElement | HTMLTextAreaElement | null {
  const codeMirrorRoot = elem.closest(".CodeMirror");
  if (!(codeMirrorRoot instanceof HTMLElement)) {
    return null;
  }
  const candidate = codeMirrorRoot.previousElementSibling;
  return candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement
    ? candidate
    : null;
}

function applyBlockReplacement(
  controller: LineEditorController,
  elem: HTMLElement,
  request: ApplyRequest,
) {
  const cursor = readLineEditorCursor(controller);
  if (!cursor) {
    return NOT_APPLIED;
  }
  const blockText = controller.getLine(cursor.line);
  if (
    typeof blockText !== "string" ||
    blockText !== request.expectedBlockText ||
    request.replaceStart < 0 ||
    request.replaceEnd < request.replaceStart ||
    request.replaceEnd > blockText.length
  ) {
    return NOT_APPLIED;
  }

  const expectedLength =
    blockText.length - (request.replaceEnd - request.replaceStart) + request.replacementText.length;
  if (request.cursorAfter < 0 || request.cursorAfter > expectedLength) {
    return NOT_APPLIED;
  }

  const from = { line: cursor.line, ch: request.replaceStart };
  const to = { line: cursor.line, ch: request.replaceEnd };
  const selection = { line: cursor.line, ch: request.cursorAfter };
  const run = () => {
    controller.replaceRange(request.replacementText, from, to, "+input");
    controller.setCursor(selection);
  };

  if (typeof controller.operation === "function") {
    controller.operation(run);
  } else {
    run();
  }

  syncBackingSelection(controller, findBackingTextValueTarget(elem), selection);
  controller.focus?.();

  return APPLIED;
}

// TinyMCE owns history even though its content model is the DOM. Enclose the
// native minimal edit in its transaction instead of merging into prior typing.
function applyTinyMCE(elem: HTMLElement, request: TinyMCEReplacement) {
  type Editor = {
    getBody(): HTMLElement;
    undoManager: { transact(callback: () => void): void };
    nodeChanged(): void;
  };
  type TinyWindow = Window & { tinymce?: { get?(): Editor[] } };
  const win = elem.ownerDocument.defaultView;
  if (!win) return NOT_APPLIED;
  const editors = [win as TinyWindow];
  try {
    if (win.parent !== win) editors.push(win.parent);
  } catch {
    /* Cross-origin parents cannot own this editor. */
  }
  let editor: Editor | undefined;
  try {
    editor = editors
      .flatMap((view) => view.tinymce?.get?.() ?? [])
      .find((candidate) => candidate.getBody() === elem);
  } catch {
    return NOT_APPLIED;
  }
  if (!editor) return NOT_APPLIED;
  const matches = () => {
    const selection = win.getSelection();
    if (
      !elem.isConnected ||
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
  editor.undoManager.transact(() => {
    if (matches()) elem.ownerDocument.execCommand("insertText", false, request.replacement);
  });
  const after = elem.textContent ?? "";
  if (after === request.before) return NOT_APPLIED;
  editor.nodeChanged();
  const expected =
    request.prefix +
    request.replacement +
    request.before.slice(request.prefix.length + request.selected.length);
  return { ...APPLIED, ...(after === expected ? {} : { unverified: true }) };
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
    const source = event.composedPath()[0];
    const root = source instanceof Element ? source.closest<HTMLElement>(".ProseMirror") : null;
    if (root) observeProseMirror(root);
  };
  const observeSelection = () => {
    const root = doc.activeElement?.closest<HTMLElement>(".ProseMirror");
    if (root) observeProseMirror(root);
  };
  const names = ["focus", "keydown", "pointerdown", "beforeinput", "input"];
  doc.addEventListener(HOST_EDITOR_ENABLED_EVENT, () => {
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
  doc.addEventListener(
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

  doc.addEventListener(
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
        const request = JSON.parse(rawRequest) as BridgeRequest;
        observeProseMirror(source);
        const controller = findLineEditorController(source);
        const ckEditor = controller ? null : findCKEditor5Instance(source);
        const slate = source.matches(SLATE_ROOT_SELECTOR);
        if (request.action === "applyTinyMCE") {
          response = { ok: true, result: applyTinyMCE(source, request) };
        } else if (request.action === "readQuill") {
          const snapshot = readQuill(source);
          if (snapshot) response = { ok: true, snapshot };
        } else if (request.action === "applyQuill") {
          response = { ok: true, reviewResult: applyQuill(source, request) };
        } else if (request.action === "readSlate") {
          const snapshot = readSlate(source);
          if (snapshot) response = { ok: true, snapshot };
        } else if (request.action === "applySlate") {
          response = { ok: true, reviewResult: applySlate(source, request) };
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
