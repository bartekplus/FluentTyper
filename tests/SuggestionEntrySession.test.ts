import { expect, jest, test } from "bun:test";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { SuggestionEntrySession } from "../src/adapters/chrome/content-script/suggestions/SuggestionEntrySession";
import type {
  PendingKeyFallback,
  PredictionResponse,
  SuggestionEntry,
} from "../src/adapters/chrome/content-script/suggestions/types";
import { createSuggestionEntry } from "./suggestionTestUtils";

function makeSession({
  entry = createSuggestionEntry({ requestId: 2 }),
  editableContextResolver = {
    resolve: () => ({
      kind: "text-value" as const,
      beforeCursor: "",
      afterCursor: "",
      fullText: "",
      cursorOffset: 0,
      selectionStable: true,
    }),
  },
  clearPendingFallback = () => undefined,
  isFocused = true,
  displayLangHeader = true,
  inlineSuggestionEnabled = false,
  hideMenu = jest.fn(),
  clearInlinePresenter = jest.fn(),
  renderMenu = jest.fn(),
  renderInline = jest.fn(),
  recordSuggestionShown = jest.fn(),
  logRenderedSuggestionPopup = jest.fn(),
  logNoVisibleSuggestions = jest.fn(),
  predictionCoordinator = {
    shouldProcessResponse: (_entry: SuggestionEntry, context: PredictionResponse) =>
      context.requestId === entry.requestId,
    schedule: jest.fn(),
    reconcile: jest.fn(),
    cancelPending: jest.fn(),
    findMentionToken: () => ({ token: "hel", start: 0 }),
  },
  grammarCoordinator = {
    hasEnabledRules: () => false,
    run: () => null,
  },
  textEditService = {
    acceptSuggestion: jest.fn(() => null),
    applyGrammarEdit: jest.fn(() => ({ applied: false, didDispatchInput: false })),
    syncManualAutoFixSuppression: jest.fn(),
  },
  contentEditableAdapter = new ContentEditableAdapter(),
  getPendingFallback = () => undefined,
  recordSuggestionAccepted = jest.fn(),
  getLang = () => "en_US",
  insertSpaceAfterAutocomplete = true,
}: {
  entry?: SuggestionEntry;
  editableContextResolver?: {
    resolve: (elem: SuggestionEntry["elem"]) => {
      kind: "text-value" | "contenteditable";
      beforeCursor: string;
      afterCursor: string;
      fullText: string;
      cursorOffset: number;
      selectionStable: boolean;
      blockContext?: { beforeCursor: string; afterCursor: string } | null;
    } | null;
  };
  clearPendingFallback?: () => void;
  isFocused?: boolean;
  displayLangHeader?: boolean;
  inlineSuggestionEnabled?: boolean;
  hideMenu?: () => void;
  clearInlinePresenter?: () => void;
  renderMenu?: (context: {
    suggestions: string[];
    selectedIndex: number;
    menuHeader: string | null;
    mentionText: string;
  }) => void;
  renderInline?: () => void;
  recordSuggestionShown?: (context: { suggestionCount: number; language?: string }) => void;
  logRenderedSuggestionPopup?: (context: PredictionResponse & { predictionCount: number }) => void;
  logNoVisibleSuggestions?: (context: PredictionResponse) => void;
  predictionCoordinator?: {
    shouldProcessResponse: (_entry: SuggestionEntry, context: PredictionResponse) => boolean;
    schedule: ReturnType<typeof jest.fn>;
    reconcile: ReturnType<typeof jest.fn>;
    cancelPending: ReturnType<typeof jest.fn>;
    findMentionToken: (beforeCursor: string) => { token: string; start: number };
  };
  grammarCoordinator?: { hasEnabledRules: () => boolean; run: (...args: unknown[]) => unknown };
  textEditService?: {
    acceptSuggestion: ReturnType<typeof jest.fn>;
    applyGrammarEdit: ReturnType<typeof jest.fn>;
    syncManualAutoFixSuppression: ReturnType<typeof jest.fn>;
  };
  contentEditableAdapter?: ContentEditableAdapter;
  getPendingFallback?: () => PendingKeyFallback | undefined;
  recordSuggestionAccepted?: ReturnType<typeof jest.fn>;
  getLang?: () => string;
  insertSpaceAfterAutocomplete?: boolean;
} = {}): SuggestionEntrySession {
  return new SuggestionEntrySession({
    entry,
    editableContextResolver,
    clearPendingFallback,
    hideMenu,
    clearInlinePresenter,
    isFocused: () => isFocused,
    displayLangHeader,
    inlineSuggestionEnabled,
    predictionCoordinator,
    grammarCoordinator,
    textEditService,
    contentEditableAdapter,
    getPendingFallback,
    renderMenu,
    renderInline,
    recordSuggestionShown,
    recordSuggestionAccepted,
    getLang,
    insertSpaceAfterAutocomplete,
    logRenderedSuggestionPopup,
    logNoVisibleSuggestions,
  });
}

test("session resolves one edit context and suppresses processing for unstable selection", () => {
  const editableContextResolver = {
    resolve: jest.fn(() => ({
      kind: "text-value" as const,
      beforeCursor: "",
      afterCursor: "",
      fullText: "",
      cursorOffset: 0,
      selectionStable: false,
    })),
  };
  const predictionCoordinator = {
    shouldProcessResponse: (_entry: SuggestionEntry, context: PredictionResponse) =>
      context.requestId === 2,
    schedule: jest.fn(),
    reconcile: jest.fn(),
    cancelPending: jest.fn(),
    findMentionToken: () => ({ token: "hel", start: 0 }),
  };
  const session = makeSession({ editableContextResolver, predictionCoordinator });

  session.handleInput(new Event("input"));

  expect(editableContextResolver.resolve).toHaveBeenCalledTimes(1);
  expect(predictionCoordinator.schedule).not.toHaveBeenCalled();
});

test("session suppresses processing when the entry is already composing", () => {
  const entry = createSuggestionEntry({
    isComposing: true,
    suggestions: ["stale"],
    inlineSuggestion: "stale",
  });
  entry.pendingIdleTimer = setTimeout(() => undefined, 1000);
  const predictionCoordinator = {
    shouldProcessResponse: (_entry: SuggestionEntry, context: PredictionResponse) =>
      context.requestId === entry.requestId,
    schedule: jest.fn(),
    reconcile: jest.fn(),
    cancelPending: jest.fn(),
    findMentionToken: () => ({ token: "hel", start: 0 }),
  };
  const session = makeSession({ entry, predictionCoordinator });

  session.handleInput(new Event("input"));

  expect(entry.pendingIdleTimer).toBeNull();
  expect(predictionCoordinator.schedule).not.toHaveBeenCalled();
  expect(entry.suggestions).toEqual([]);
  expect(entry.inlineSuggestion).toBeNull();
});

test("session marks event-level composition as unstable input", () => {
  const entry = createSuggestionEntry({
    elem: document.createElement("input") as SuggestionEntry["elem"],
  });
  const session = makeSession({ entry });
  const inputEvent = new Event("input", { bubbles: true }) as InputEvent;
  Object.defineProperty(inputEvent, "isComposing", { value: true });

  const reason = (
    session as unknown as {
      resolveUnstableInputSkipReason: (entry: SuggestionEntry, event?: Event) => string | null;
    }
  ).resolveUnstableInputSkipReason(entry, inputEvent);

  expect(reason).toBe("event_composing");
});

test("session marks non-collapsed selection as unstable input", () => {
  const input = document.createElement("input");
  input.value = "alpha";
  input.selectionStart = 1;
  input.selectionEnd = 4;
  const entry = createSuggestionEntry({ elem: input as SuggestionEntry["elem"] });
  const session = makeSession({ entry });

  const reason = (
    session as unknown as {
      resolveUnstableInputSkipReason: (entry: SuggestionEntry, event?: Event) => string | null;
    }
  ).resolveUnstableInputSkipReason(entry);

  expect(reason).toBe("selection_not_collapsed");
});

test("session short-circuits deferred fallback input without clearing the pending fallback", () => {
  const clearPendingFallback = jest.fn();
  const entry = createSuggestionEntry({
    elem: document.createElement("div") as SuggestionEntry["elem"],
  });
  entry.elem.setAttribute("contenteditable", "true");
  Object.defineProperty(entry.elem, "isContentEditable", { value: true, configurable: true });
  const predictionCoordinator = {
    shouldProcessResponse: (_entry: SuggestionEntry, context: PredictionResponse) =>
      context.requestId === 2,
    schedule: jest.fn(),
    reconcile: jest.fn(),
    cancelPending: jest.fn(),
    findMentionToken: () => ({ token: "hel", start: 0 }),
  };
  const session = makeSession({
    entry,
    clearPendingFallback,
    predictionCoordinator,
    editableContextResolver: {
      resolve: () => ({
        kind: "contenteditable",
        beforeCursor: "raw-block-before-cursor",
        afterCursor: "",
        fullText: "old-full-text",
        cursorOffset: 22,
        selectionStable: true,
      }),
    },
    getPendingFallback: () => ({
      timer: setTimeout(() => undefined, 1000),
      observer: null,
      reconcileScheduled: false,
      inputAction: "insert",
      expectedBeforeCursor: "predicted-before-cursor",
      expectedFullText: "old-full-text",
      typedKey: "a",
      waitForTextChangeUntilMs: Date.now() + 1000,
    }),
  });

  session.handleInput(new Event("input"));

  expect(clearPendingFallback).not.toHaveBeenCalled();
  expect(predictionCoordinator.schedule).not.toHaveBeenCalled();
});

test("session clears the pending fallback before processing input", () => {
  const clearPendingFallback = jest.fn();
  const predictionCoordinator = {
    shouldProcessResponse: (_entry: SuggestionEntry, context: PredictionResponse) =>
      context.requestId === 2,
    schedule: jest.fn(),
    reconcile: jest.fn(),
    cancelPending: jest.fn(),
    findMentionToken: () => ({ token: "hel", start: 0 }),
  };
  const session = makeSession({
    clearPendingFallback,
    predictionCoordinator,
  });

  const inputEvent = new Event("input") as InputEvent;
  Object.defineProperty(inputEvent, "inputType", { value: "insertText" });
  session.handleInput(inputEvent);

  expect(clearPendingFallback).toHaveBeenCalledTimes(1);
  expect(predictionCoordinator.schedule).toHaveBeenCalledTimes(1);
});

test("session click and blur cleanup clear accepted transient state", () => {
  const entry = createSuggestionEntry({ requestId: 2 });
  const block = document.createElement("p");
  entry.pendingExtensionEdit = {
    replaceStart: 2,
    originalText: "a",
    replacementText: "ab",
    cursorBefore: 2,
    cursorAfter: 3,
    postEditFingerprint: { fullText: "ab", cursorOffset: 3, selectionCollapsed: true },
    source: "suggestion",
    blockScoped: true,
    blockElement: block,
    postEditBlockText: "ab",
  };
  entry.missingTrailingSpace = true;
  entry.expectedCursorPos = 3;
  entry.expectedCursorPosIsBlockLocal = true;
  entry.expectedCursorPosBlockElement = block;
  entry.expectedCursorPosBlockText = "ab";
  const session = makeSession({ entry });

  session.handleClick({ dismissEntry: jest.fn() });

  expect(entry.pendingExtensionEdit).toBeNull();
  expect(entry.missingTrailingSpace).toBe(false);
  expect(entry.expectedCursorPos).toBe(0);

  entry.pendingExtensionEdit = {
    replaceStart: 2,
    originalText: "a",
    replacementText: "ab",
    cursorBefore: 2,
    cursorAfter: 3,
    postEditFingerprint: { fullText: "ab", cursorOffset: 3, selectionCollapsed: true },
    source: "suggestion",
  };
  entry.missingTrailingSpace = true;
  entry.expectedCursorPos = 3;
  entry.isComposing = true;
  entry.pendingGrammarPaste = true;
  entry.pendingIdleTimer = setTimeout(() => undefined, 1000);

  session.handleBlur({ dismissEntry: jest.fn() });

  expect(entry.pendingExtensionEdit).toBeNull();
  expect(entry.missingTrailingSpace).toBe(false);
  expect(entry.isComposing).toBe(false);
  expect(entry.pendingGrammarPaste).toBe(false);
  expect(entry.pendingIdleTimer).toBeNull();
});

test("session focus renders inline suggestions for the active entry", () => {
  const renderInline = jest.fn();
  const entry = createSuggestionEntry({ inlineSuggestion: "beta" });
  const session = makeSession({
    entry,
    inlineSuggestionEnabled: true,
    renderInline,
  });

  session.handleFocus();

  expect(renderInline).toHaveBeenCalledTimes(1);
});

test("session paste marks grammar-paste state", () => {
  const entry = createSuggestionEntry({ pendingGrammarPaste: false });
  const session = makeSession({ entry });

  session.handlePaste();

  expect(entry.pendingGrammarPaste).toBe(true);
});

test("session acceptance lifecycle applies accepted suggestion state", () => {
  const entry = createSuggestionEntry({ requestId: 2, suggestions: ["beta"] });
  const textEditService = {
    acceptSuggestion: jest.fn(() => ({
      triggerText: "bet",
      insertedText: "beta",
      cursorAfter: 4,
      cursorAfterIsBlockLocal: false,
    })),
    applyGrammarEdit: jest.fn(() => ({ applied: false, didDispatchInput: false })),
    syncManualAutoFixSuppression: jest.fn(),
  };
  const recordSuggestionAccepted = jest.fn();
  const session = makeSession({
    entry,
    textEditService,
    recordSuggestionAccepted,
    insertSpaceAfterAutocomplete: true,
    getLang: () => "en_US",
  });

  session.acceptSuggestionAtIndex(0);

  expect(textEditService.acceptSuggestion).toHaveBeenCalledWith(entry, "beta");
  expect(entry.suggestions).toEqual([]);
  expect(entry.missingTrailingSpace).toBe(true);
  expect(entry.expectedCursorPos).toBe(4);
  expect(recordSuggestionAccepted).toHaveBeenCalledWith({
    triggerText: "bet",
    insertedText: "beta",
    language: "en_US",
  });
});

test("session clears idle and resets prediction bookkeeping when input is suppressed", () => {
  const entry = createSuggestionEntry({
    requestId: 2,
    suggestions: ["stale"],
    inlineSuggestion: "stale",
    pendingInlineAccept: true,
    lastInputAction: "insert",
    lastKeydownKey: "a",
    lastBeforeCursorText: "alpha",
    visibleSuggestionBeforeCursorText: "alpha",
    visibleSuggestionFullText: "alpha beta",
    pendingGrammarPaste: true,
  });
  const session = makeSession({
    entry,
    editableContextResolver: {
      resolve: () => ({
        kind: "text-value",
        beforeCursor: "",
        afterCursor: "",
        fullText: "",
        cursorOffset: 0,
        selectionStable: false,
      }),
    },
  });

  session.handleInput(new Event("input"));

  expect(entry.pendingIdleTimer).toBeNull();
  expect(entry.requestId).toBe(3);
  expect(entry.lastInputAction).toBeNull();
  expect(entry.lastKeydownKey).toBeNull();
  expect(entry.pendingGrammarPaste).toBe(false);
  expect(entry.lastBeforeCursorText).toBeNull();
  expect(entry.visibleSuggestionBeforeCursorText).toBeNull();
  expect(entry.visibleSuggestionFullText).toBeNull();
  expect(entry.suggestions).toEqual([]);
  expect(entry.inlineSuggestion).toBeNull();
  expect(entry.pendingInlineAccept).toBe(false);
});

test("dispose clears timers and UI state for one entry", () => {
  const entry = createSuggestionEntry({
    suggestions: ["hello"],
    selectedIndex: 2,
    visibleSuggestionBeforeCursorText: "hel",
    visibleSuggestionFullText: "hello world",
    inlineSuggestion: "hello",
    pendingInlineAccept: true,
  });
  entry.pendingRequestTimer = setTimeout(() => undefined, 1000);
  entry.pendingIdleTimer = setTimeout(() => undefined, 1000);
  const hideMenu = jest.fn();
  const clearInlinePresenter = jest.fn();

  const session = new SuggestionEntrySession({
    entry,
    editableContextResolver: {
      resolve: () => ({
        kind: "text-value",
        beforeCursor: "",
        afterCursor: "",
        fullText: "",
        cursorOffset: 0,
        selectionStable: true,
      }),
    },
    hideMenu,
    clearInlinePresenter,
    isFocused: () => true,
    displayLangHeader: true,
    inlineSuggestionEnabled: false,
    predictionCoordinator: {
      shouldProcessResponse: () => true,
      schedule: jest.fn(),
      reconcile: jest.fn(),
      cancelPending: jest.fn(),
      findMentionToken: () => ({ token: "", start: 0 }),
    },
    grammarCoordinator: { hasEnabledRules: () => false, run: () => null },
    textEditService: {
      acceptSuggestion: jest.fn(() => null),
      applyGrammarEdit: jest.fn(() => ({ applied: false, didDispatchInput: false })),
      syncManualAutoFixSuppression: jest.fn(),
    },
    contentEditableAdapter: new ContentEditableAdapter(),
    renderMenu: () => undefined,
    renderInline: () => undefined,
    recordSuggestionShown: () => undefined,
    recordSuggestionAccepted: () => undefined,
    getLang: () => "en_US",
    insertSpaceAfterAutocomplete: true,
    logRenderedSuggestionPopup: () => undefined,
    logNoVisibleSuggestions: () => undefined,
  });

  session.dispose();

  expect(entry.pendingRequestTimer).toBeNull();
  expect(entry.pendingIdleTimer).toBeNull();
  expect(entry.suggestions).toEqual([]);
  expect(entry.selectedIndex).toBe(0);
  expect(entry.visibleSuggestionBeforeCursorText).toBeNull();
  expect(entry.visibleSuggestionFullText).toBeNull();
  expect(entry.inlineSuggestion).toBeNull();
  expect(entry.pendingInlineAccept).toBe(false);
  expect(hideMenu.mock.calls.length).toBeGreaterThan(0);
  expect(clearInlinePresenter).toHaveBeenCalledTimes(1);
});

test("composition lifecycle is handled by the session", () => {
  const entry = createSuggestionEntry({
    suggestions: ["hello"],
    inlineSuggestion: "hello",
    isComposing: false,
  });
  entry.pendingIdleTimer = setTimeout(() => undefined, 1000);
  const predictionCoordinator = {
    shouldProcessResponse: (_entry: SuggestionEntry, context: PredictionResponse) =>
      context.requestId === entry.requestId,
    schedule: jest.fn(),
    reconcile: jest.fn(),
    cancelPending: jest.fn(),
    findMentionToken: () => ({ token: "hel", start: 0 }),
  };
  const session = makeSession({
    entry,
    predictionCoordinator,
    grammarCoordinator: { hasEnabledRules: () => true, run: () => null },
  });

  session.handleCompositionStart();

  expect(entry.isComposing).toBe(true);
  expect(entry.pendingIdleTimer).toBeNull();
  expect(predictionCoordinator.cancelPending).toHaveBeenCalledTimes(1);
  expect(entry.suggestions).toEqual([]);
  expect(entry.inlineSuggestion).toBeNull();

  session.handleCompositionEnd();

  expect(entry.isComposing).toBe(false);
  expect(entry.pendingIdleTimer).not.toBeNull();
  if (entry.pendingIdleTimer) {
    clearTimeout(entry.pendingIdleTimer);
    entry.pendingIdleTimer = null;
  }
});

test("dispose cancels pending prediction work", () => {
  const predictionCoordinator = {
    shouldProcessResponse: (_entry: SuggestionEntry, context: PredictionResponse) =>
      context.requestId === 2,
    schedule: jest.fn(),
    reconcile: jest.fn(),
    cancelPending: jest.fn(),
    findMentionToken: () => ({ token: "hel", start: 0 }),
  };
  const session = makeSession({ predictionCoordinator });

  session.dispose();

  expect(predictionCoordinator.cancelPending).toHaveBeenCalledTimes(1);
});

test("session ignores stale responses and renders fresh menu responses", () => {
  const renderMenu = jest.fn();
  const clearInlinePresenter = jest.fn();
  const recordSuggestionShown = jest.fn();
  const logRenderedSuggestionPopup = jest.fn();
  const entry = createSuggestionEntry({ requestId: 2, latestMentionText: "bet" });
  const input = entry.elem as HTMLInputElement;
  input.value = "hello world";
  input.selectionStart = 3;
  input.selectionEnd = 3;
  const session = makeSession({
    entry,
    renderMenu,
    clearInlinePresenter,
    recordSuggestionShown,
    logRenderedSuggestionPopup,
  });

  session.handlePredictionResponse({ requestId: 1, suggestionId: 1, predictions: ["alpha"] });
  session.handlePredictionResponse({
    requestId: 2,
    suggestionId: 1,
    predictions: ["beta"],
    lang: "en_US",
  });

  expect(renderMenu).toHaveBeenCalledTimes(1);
  expect(renderMenu).toHaveBeenCalledWith(
    expect.objectContaining({
      suggestions: ["beta"],
      selectedIndex: 0,
      menuHeader: "Lang: English (US)",
      mentionText: "bet",
    }),
  );
  expect(clearInlinePresenter).toHaveBeenCalledTimes(1);
  expect(entry.visibleSuggestionBeforeCursorText).toBe("hel");
  expect(entry.visibleSuggestionFullText).toBe("hello world");
  expect(entry.suggestions).toEqual(["beta"]);
  expect(recordSuggestionShown).toHaveBeenCalledWith({ suggestionCount: 1, language: "en_US" });
  expect(logRenderedSuggestionPopup).toHaveBeenCalledTimes(1);
});

test("session falls back to empty suggestions for invalid prediction payloads", () => {
  const renderMenu = jest.fn();
  const logNoVisibleSuggestions = jest.fn();
  const entry = createSuggestionEntry({ requestId: 2, suggestions: ["stale"] });
  const session = makeSession({ entry, renderMenu, logNoVisibleSuggestions });

  session.handlePredictionResponse({
    requestId: 2,
    suggestionId: 1,
    predictions: undefined as unknown as string[],
  });

  expect(renderMenu).toHaveBeenCalledTimes(1);
  expect(entry.suggestions).toEqual([]);
  expect(logNoVisibleSuggestions).toHaveBeenCalledTimes(1);
});

test("session renders inline suggestions and fulfills pending inline accept", () => {
  const hideMenu = jest.fn();
  const renderInline = jest.fn();
  const textEditService = {
    acceptSuggestion: jest.fn(() => ({
      triggerText: "bet",
      insertedText: "beta",
      cursorAfter: 4,
      cursorAfterIsBlockLocal: false,
    })),
    applyGrammarEdit: jest.fn(() => ({ applied: false, didDispatchInput: false })),
    syncManualAutoFixSuppression: jest.fn(),
  };
  const entry = createSuggestionEntry({ requestId: 2, pendingInlineAccept: true });
  const session = makeSession({
    entry,
    hideMenu,
    renderInline,
    textEditService,
    inlineSuggestionEnabled: true,
  });

  session.handlePredictionResponse({ requestId: 2, suggestionId: 1, predictions: ["beta"] });

  expect(entry.inlineSuggestion).toBeNull();
  expect(hideMenu.mock.calls.length).toBeGreaterThan(0);
  expect(renderInline).toHaveBeenCalledTimes(1);
  expect(entry.pendingInlineAccept).toBe(false);
  expect(textEditService.acceptSuggestion).toHaveBeenCalledWith(entry, "beta");
});

test("session seeds merged typed key at a contenteditable block boundary", () => {
  const entry = createSuggestionEntry({
    elem: document.createElement("div") as SuggestionEntry["elem"],
  });
  entry.elem.setAttribute("contenteditable", "true");
  Object.defineProperty(entry.elem, "isContentEditable", { value: true, configurable: true });
  const session = makeSession({
    entry,
    contentEditableAdapter: {
      getBlockContext: () => ({ beforeCursor: "AlphaP", afterCursor: "" }),
      getBlockContextBySelection: () => null,
      isCollapsedSelectionBeforeBlockBoundary: () => true,
      getPreviousBlockTextBySelection: () => null,
      getActiveBlockElement: () => null,
      hasMultipleBlockDescendants: () => true,
    } as unknown as ContentEditableAdapter,
  });

  const context = (
    session as unknown as {
      resolveEditableCursorContext: (
        entry: SuggestionEntry,
        snapshot: { beforeCursor: string; afterCursor: string; cursorOffset: number },
        options: { inputAction: "insert"; hasMultipleBlockDescendants: true; typedKey: string },
      ) => { beforeCursor: string; afterCursor: string; safeForGrammar: boolean };
    }
  ).resolveEditableCursorContext(
    entry,
    { beforeCursor: "AlphaP", afterCursor: "", cursorOffset: 6 },
    { inputAction: "insert", hasMultipleBlockDescendants: true, typedKey: "p" },
  );

  expect(context.beforeCursor).toBe("P");
  expect(context.afterCursor).toBe("");
  expect(context.safeForGrammar).toBe(false);
});

test("session seeds pending grammar edits from merged snapshots", () => {
  const entry = createSuggestionEntry({
    elem: document.createElement("div") as SuggestionEntry["elem"],
    pendingExtensionEdit: {
      replaceStart: 5,
      originalText: "",
      replacementText: "P",
      cursorBefore: 5,
      cursorAfter: 6,
      postEditFingerprint: { fullText: "AlphaP", cursorOffset: 6, selectionCollapsed: true },
      source: "grammar",
    },
  });
  entry.elem.setAttribute("contenteditable", "true");
  Object.defineProperty(entry.elem, "isContentEditable", { value: true, configurable: true });
  const session = makeSession({
    entry,
    contentEditableAdapter: {
      getBlockContext: () => ({ beforeCursor: "AlphaP", afterCursor: "" }),
      getBlockContextBySelection: () => null,
      isCollapsedSelectionBeforeBlockBoundary: () => true,
      getPreviousBlockTextBySelection: () => null,
      getActiveBlockElement: () => null,
      hasMultipleBlockDescendants: () => true,
    } as unknown as ContentEditableAdapter,
  });

  const context = (
    session as unknown as {
      resolveEditableCursorContext: (
        entry: SuggestionEntry,
        snapshot: { beforeCursor: string; afterCursor: string; cursorOffset: number },
        options: { inputAction: "insert"; hasMultipleBlockDescendants: true },
      ) => { beforeCursor: string; afterCursor: string; safeForGrammar: boolean };
    }
  ).resolveEditableCursorContext(
    entry,
    { beforeCursor: "AlphaP", afterCursor: "", cursorOffset: 6 },
    { inputAction: "insert", hasMultipleBlockDescendants: true },
  );

  expect(context.beforeCursor).toBe("P");
  expect(context.afterCursor).toBe("");
  expect(context.safeForGrammar).toBe(true);
});

test("session preserves resolved afterCursor when merged grammar snapshot does not start with replacement", () => {
  const entry = createSuggestionEntry({
    elem: document.createElement("div") as SuggestionEntry["elem"],
    pendingExtensionEdit: {
      replaceStart: 5,
      originalText: "",
      replacementText: "P",
      cursorBefore: 5,
      cursorAfter: 6,
      postEditFingerprint: { fullText: "AlphaPz", cursorOffset: 6, selectionCollapsed: true },
      source: "grammar",
    },
  });
  entry.elem.setAttribute("contenteditable", "true");
  Object.defineProperty(entry.elem, "isContentEditable", { value: true, configurable: true });
  const session = makeSession({
    entry,
    contentEditableAdapter: {
      getBlockContext: () => ({ beforeCursor: "AlphaP", afterCursor: "z" }),
      getBlockContextBySelection: () => null,
      isCollapsedSelectionBeforeBlockBoundary: () => true,
      getPreviousBlockTextBySelection: () => null,
      getActiveBlockElement: () => null,
      hasMultipleBlockDescendants: () => true,
    } as unknown as ContentEditableAdapter,
  });

  const context = (
    session as unknown as {
      resolveEditableCursorContext: (
        entry: SuggestionEntry,
        snapshot: { beforeCursor: string; afterCursor: string; cursorOffset: number },
        options: { inputAction: "insert"; hasMultipleBlockDescendants: true },
      ) => { beforeCursor: string; afterCursor: string; safeForGrammar: boolean };
    }
  ).resolveEditableCursorContext(
    entry,
    { beforeCursor: "AlphaP", afterCursor: "z", cursorOffset: 6 },
    { inputAction: "insert", hasMultipleBlockDescendants: true },
  );

  expect(context.beforeCursor).toBe("P");
  expect(context.afterCursor).toBe("z");
  expect(context.safeForGrammar).toBe(true);
});

test("session fallback reconcile dispatches adjusted prediction after grammar apply dispatches input", () => {
  const entry = createSuggestionEntry({
    elem: document.createElement("div") as SuggestionEntry["elem"],
  });
  entry.elem.setAttribute("contenteditable", "true");
  Object.defineProperty(entry.elem, "isContentEditable", { value: true, configurable: true });
  const predictionCoordinator = {
    shouldProcessResponse: (_entry: SuggestionEntry, context: PredictionResponse) =>
      context.requestId === entry.requestId,
    schedule: jest.fn(),
    reconcile: jest.fn(),
    cancelPending: jest.fn(),
    findMentionToken: () => ({ token: "P", start: 0 }),
  };
  const session = makeSession({
    entry,
    predictionCoordinator,
    grammarCoordinator: {
      hasEnabledRules: () => true,
      run: () => ({ replacement: "P", deleteBackwards: 1 }),
    },
    textEditService: {
      acceptSuggestion: jest.fn(() => null),
      applyGrammarEdit: jest.fn(() => ({ applied: true, didDispatchInput: true })),
      syncManualAutoFixSuppression: jest.fn(),
    },
    contentEditableAdapter: {
      getBlockContext: () => ({ beforeCursor: "p", afterCursor: "" }),
      getBlockContextBySelection: () => null,
      isCollapsedSelectionBeforeBlockBoundary: () => false,
      getPreviousBlockTextBySelection: () => null,
      getActiveBlockElement: () => null,
      hasMultipleBlockDescendants: () => false,
    } as unknown as ContentEditableAdapter,
  });

  const handled = (
    session as unknown as {
      tryDispatchResolvedContentEditableFallbackReconcile: (
        pending: {
          inputAction: "insert";
          typedKey: string;
          expectedBeforeCursor: string | null;
          expectedFullText: string | null;
          waitForTextChangeUntilMs: number | null;
          timer: ReturnType<typeof setTimeout>;
          observer: null;
          reconcileScheduled: boolean;
        },
        snapshot: { beforeCursor: string; afterCursor: string; cursorOffset: number },
        hasMultipleBlockDescendants: boolean,
      ) => boolean;
    }
  ).tryDispatchResolvedContentEditableFallbackReconcile(
    {
      timer: setTimeout(() => undefined, 1000),
      observer: null,
      reconcileScheduled: false,
      inputAction: "insert",
      expectedBeforeCursor: null,
      expectedFullText: null,
      typedKey: "p",
      waitForTextChangeUntilMs: null,
    },
    { beforeCursor: "p", afterCursor: "", cursorOffset: 1 },
    false,
  );

  expect(handled).toBe(true);
  expect(predictionCoordinator.reconcile).toHaveBeenCalledTimes(1);
});
