import { jest } from "bun:test";
import type {
  ExtensionEditSnapshot,
  PredictionResponse,
  SuggestionEntry,
  SuggestionElement,
  SuggestionManagerOptions,
} from "../src/adapters/chrome/content-script/suggestions/types";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../src/core/domain/grammar/ruleCatalog";
import { SuggestionGrammarCoordinator } from "../src/adapters/chrome/content-script/suggestions/SuggestionGrammarCoordinator";
import { SuggestionTextEditService } from "../src/adapters/chrome/content-script/suggestions/SuggestionTextEditService";
import { EARLY_TAB_ACCEPT_ENTRY_ID_ATTR } from "../src/adapters/chrome/content-script/suggestions/EarlyTabAcceptBridgeProtocol";
import { resolveSuggestionMenuHostId } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuHost";
import { SuggestionKeyboardHandler } from "../src/adapters/chrome/content-script/suggestions/SuggestionKeyboardHandler";
import type { HostEditorPageBridge } from "../src/adapters/chrome/content-script/suggestions/HostEditorPageBridge";
import {
  HOST_EDITOR_ENABLED_ATTR,
  HOST_EDITOR_ENABLED_EVENT,
  type HostEditorBlockReplacement,
} from "../src/adapters/chrome/content-script/suggestions/HostEditorBridgeProtocol";
import { installHostEditorMainWorldBridge } from "../src/adapters/chrome/content-script/suggestions/HostEditorMainWorldBridge";
import { setCaretAtTextOffset } from "./codeContextTestUtils";

export function createSuggestionEntry(
  overrides: Partial<SuggestionEntry> & { elem?: SuggestionElement } = {},
): SuggestionEntry {
  const entry: SuggestionEntry = {
    id: 1,
    elem: document.createElement("input"),
    inputEventTarget: null,
    menu: document.createElement("div"),
    list: document.createElement("ul"),
    requestId: 0,
    suggestions: [],
    selectedIndex: 0,
    menuHeader: null,
    latestMentionText: "",
    latestMentionStart: 0,
    visibleSuggestionBeforeCursorText: null,
    visibleSuggestionFullText: null,
    inlineSuggestion: null,
    inlineSuggestionToken: null,
    pendingInlineAccept: false,
    inlineRenderRejected: false,
    missingTrailingSpace: false,
    expectedCursorPos: 0,
    expectedCursorPosIsBlockLocal: false,
    expectedCursorPosBlockElement: null,
    expectedCursorPosBlockText: null,
    pendingExtensionEdit: null,
    suppressNextSuggestionInputPrediction: false,
    manualAutoFixSuppression: null,
    isComposing: false,
    lastKeydownKey: null,
    lastInputAction: null,
    lastBeforeCursorText: null,
    hasMultipleBlockDescendants: false,
    pendingRequestTimer: null,
    pendingIdleTimer: null,
    pendingGrammarPaste: false,
    handlers: {
      beforeinput: () => undefined,
      input: () => undefined,
      keydown: () => undefined,
      paste: () => undefined,
      focus: () => undefined,
      blur: () => undefined,
      click: () => undefined,
      compositionStart: () => undefined,
      compositionEnd: () => undefined,
      menuMouseDown: () => undefined,
      menuClick: () => undefined,
    },
    ...overrides,
  };
  if (!entry.menu.contains(entry.list)) {
    entry.menu.appendChild(entry.list);
  }
  return entry;
}

export function createPendingEdit(
  overrides: Partial<ExtensionEditSnapshot> = {},
): ExtensionEditSnapshot {
  return {
    replaceStart: 0,
    originalText: "",
    replacementText: "",
    cursorBefore: 0,
    cursorAfter: 0,
    postEditFingerprint: { fullText: "", cursorOffset: 0, selectionCollapsed: true },
    source: "suggestion",
    ...overrides,
  };
}

/**
 * Builds a prediction response from the fields that a test gives. The other fields stay
 * absent, as in a partial runtime message, so the code under test sees the same data.
 */
export function partialResponse(
  fields: Pick<PredictionResponse, "requestId" | "suggestionId" | "predictions"> &
    Partial<PredictionResponse>,
): PredictionResponse {
  return fields as PredictionResponse;
}

/** Takes the last whitespace-separated word before the caret. */
export function findLastWord(beforeCursor: string): { token: string; start: number } {
  const token = beforeCursor.split(/\s+/).at(-1) ?? "";
  return { token, start: Math.max(0, beforeCursor.length - token.length) };
}

export function createTextEditService(
  overrides: Partial<ConstructorParameters<typeof SuggestionTextEditService>[0]> = {},
): SuggestionTextEditService {
  return new SuggestionTextEditService({
    findMentionToken: findLastWord,
    isSeparator: (value) => /\s/.test(value),
    ...overrides,
  });
}

export function grammarCoordinator(
  enabledGrammarRules: string[] = [...DEFAULT_CURRENT_GRAMMAR_RULES],
): SuggestionGrammarCoordinator {
  return new SuggestionGrammarCoordinator({
    enabledGrammarRules,
    insertSpaceAfterAutocomplete: true,
    lang: "en_US",
    userDictionaryList: [],
  });
}

export function createRuntimeOptions(
  overrides: Partial<SuggestionManagerOptions> = {},
): SuggestionManagerOptions {
  return {
    selectors: "textarea, input, [contenteditable]",
    minWordLengthToPredict: 1,
    autocomplete: true,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    insertSpaceAfterAutocomplete: true,
    lang: "en_US",
    selectByDigit: true,
    horizontalSuggestions: false,
    showSuggestionFooter: true,
    inline_suggestion: false,
    preferNativeAutocomplete: true,
    enabledGrammarRules: [],
    userDictionaryList: [],
    getPrediction: jest.fn(),
    ...overrides,
  };
}

export function createHandler(
  overrides: Partial<ConstructorParameters<typeof SuggestionKeyboardHandler>[0]> = {},
): SuggestionKeyboardHandler {
  return new SuggestionKeyboardHandler({
    autocompleteOnSpace: true,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    selectByDigit: true,
    inlineSuggestionEnabled: true,
    handleMissingSpaceAfterAccept: jest.fn(),
    tryUndoLastExtensionEdit: jest.fn(() => false),
    consumeKeyboardEvent: jest.fn(),
    clearSuggestions: jest.fn(),
    isMenuVisible: jest.fn(() => false),
    isInlineVisible: jest.fn(() => false),
    updateSelectionHighlight: jest.fn(),
    acceptSuggestion: jest.fn(),
    acceptSuggestionAtIndex: jest.fn(),
    acceptGrammarProposal: jest.fn(() => false),
    requestInlineSuggestion: jest.fn(),
    ...overrides,
  });
}

export function createRect(left = 10, top = 20, width = 30, height = 12): DOMRect {
  return new DOMRect(left, top, width, height);
}

/** The menu host of an attached field, or null when the field has no helper. */
export function menuFor(elem: Element): HTMLElement | null {
  const entryId = elem.getAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR);
  return entryId ? document.getElementById(resolveSuggestionMenuHostId(entryId)) : null;
}

export function getSuggestionMenuRoots(doc: Document = document): ParentNode[] {
  const collectManagedElements = (root: ParentNode): HTMLElement[] => [
    ...Array.from(root.querySelectorAll<HTMLElement>('[data-suggestion="true"]')),
    ...Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((element) =>
      element.shadowRoot ? collectManagedElements(element.shadowRoot) : [],
    ),
  ];

  const roots = collectManagedElements(doc)
    .map((element) => element.getAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR))
    .filter((entryId): entryId is string => typeof entryId === "string" && entryId.length > 0)
    .map((entryId) => doc.getElementById(resolveSuggestionMenuHostId(entryId)))
    .filter((menu): menu is HTMLElement => menu instanceof HTMLElement)
    .map((container): ParentNode => container.shadowRoot ?? container);
  return [...new Set(roots)];
}

export function querySuggestionMenuItems(doc: Document = document): HTMLLIElement[] {
  return getSuggestionMenuRoots(doc).flatMap(
    (root) => Array.from(root.querySelectorAll("li[data-index]")) as HTMLLIElement[],
  );
}

export function querySuggestionMenuItemByIndex(
  index: number,
  doc: Document = document,
): HTMLLIElement | null {
  return (
    getSuggestionMenuRoots(doc)
      .map((root) => root.querySelector(`li[data-index="${index}"]`) as HTMLLIElement | null)
      .find((item) => item !== null) ?? null
  );
}

type LinePosition = { line: number; ch: number };

/**
 * Turns on the MAIN-world host editor bridge in this window. A page controller
 * expando is visible only there, as in a browser.
 */
export function enableHostEditorBridge(): void {
  installHostEditorMainWorldBridge();
  document.documentElement.setAttribute(HOST_EDITOR_ENABLED_ATTR, "true");
  document.dispatchEvent(new Event(HOST_EDITOR_ENABLED_EVENT));
  document.documentElement.removeAttribute(HOST_EDITOR_ENABLED_ATTR);
}

/** Fake one-line editor controller (CodeMirror 5 shape) that writes its line into editable. */
export function createLineEditorController(
  editable: HTMLElement,
  text: string,
  cursor: number,
  {
    withOperation = false,
    onReplace,
  }: { withOperation?: boolean; onReplace?: (line: string) => void } = {},
) {
  let line = text;
  let ch = cursor;
  const controller = {
    replaceRangeCalls: 0,
    setLine(value: string) {
      line = value;
    },
    replaceRange(replacementText: string, from: LinePosition, to?: LinePosition) {
      controller.replaceRangeCalls += 1;
      line = `${line.slice(0, from.ch)}${replacementText}${line.slice(to?.ch ?? from.ch)}`;
      editable.textContent = line;
      onReplace?.(line);
    },
    setCursor(position: LinePosition) {
      ch = position.ch;
      setCaretAtTextOffset(editable, ch);
    },
    getCursor: () => ({ line: 0, ch }),
    getLine: (index: number) => (index === 0 ? line : ""),
    posFromIndex: (index: number) => ({ line: 0, ch: index }),
    indexFromPos: (position: LinePosition) => position.ch,
  };
  if (withOperation) Object.assign(controller, { operation: (run: () => void) => run() });
  return controller;
}

/** Fake page bridge that keeps one block of text and writes it into editable. */
export function fakePageBridge(
  editable: HTMLElement,
  text: string,
  cursor: number,
  { movesCaret = true } = {},
) {
  let caret = cursor;
  const bridge: HostEditorPageBridge & { blockText: string; calls: HostEditorBlockReplacement[] } =
    {
      blockText: text,
      calls: [],
      getBlockContextAtSelection: () => ({
        beforeCursor: bridge.blockText.slice(0, caret),
        afterCursor: bridge.blockText.slice(caret),
        blockText: bridge.blockText,
      }),
      applyBlockReplacement(_elem: HTMLElement, args: HostEditorBlockReplacement) {
        bridge.calls.push({ ...args });
        const { blockText } = bridge;
        bridge.blockText = `${blockText.slice(0, args.replaceStart)}${args.replacementText}${blockText.slice(args.replaceEnd)}`;
        caret = args.cursorAfter;
        editable.textContent = bridge.blockText;
        if (movesCaret) setCaretAtTextOffset(editable, caret);
        return { applied: true, didDispatchInput: false };
      },
    };
  return bridge;
}
