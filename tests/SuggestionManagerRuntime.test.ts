import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionManagerRuntime } from "../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime";
import type { SuggestionEntry } from "../src/adapters/chrome/content-script/suggestions/types";
import { acquireDomGlobalLock } from "./support/domGlobalLock";

const baseGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  navigator: globalThis.navigator,
  Node: globalThis.Node,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
  HTMLButtonElement: globalThis.HTMLButtonElement,
  Event: globalThis.Event,
  CustomEvent: globalThis.CustomEvent,
  MutationObserver: globalThis.MutationObserver,
  getComputedStyle: globalThis.getComputedStyle,
  chrome: (globalThis as unknown as { chrome: unknown }).chrome,
};

function runtimeDebugState(runtime: SuggestionManagerRuntime): {
  attachedSessions: number;
  buildsEntrySessions: boolean;
  handlesPredictionInternally: boolean;
} {
  const runtimeInternal = runtime as unknown as {
    sessionRegistry?: Map<number, unknown>;
    buildEntrySession?: unknown;
  };
  const firstSession = runtimeInternal.sessionRegistry?.values().next().value as
    | {
        handleInput?: unknown;
        handlePredictionResponse?: unknown;
        handleCompositionStart?: unknown;
        handleCompositionEnd?: unknown;
      }
    | undefined;
  const sessionOwnsEntryBehavior =
    typeof firstSession?.handleInput === "function" &&
    typeof firstSession?.handlePredictionResponse === "function" &&
    typeof firstSession?.handleCompositionStart === "function" &&
    typeof firstSession?.handleCompositionEnd === "function";

  return {
    attachedSessions: runtimeInternal.sessionRegistry?.size ?? 0,
    buildsEntrySessions: typeof runtimeInternal.buildEntrySession === "function",
    handlesPredictionInternally: !sessionOwnsEntryBehavior,
  };
}

function getAttachedSession(
  runtime: SuggestionManagerRuntime,
  id: number,
): {
  requestPrediction?: () => void;
  requestInlineSuggestion?: () => void;
  handleInput?: (event: Event) => void;
  handleKeyFallbackReconcile?: (...args: unknown[]) => void;
  handleKeyDown?: (event: KeyboardEvent) => void;
  reconcileSelection?: () => void;
  handleClick?: () => void;
  handleBlur?: () => void;
  acceptSuggestionAtIndex?: (index: number) => void;
  acceptSuggestion?: (suggestion: string) => void;
  handleFocus?: () => void;
  handlePaste?: () => void;
  handlePredictionResponse?: (context: {
    requestId: number;
    suggestionId: number;
    predictions: string[];
  }) => void;
  handleCompositionStart?: () => void;
  handleCompositionEnd?: () => void;
} {
  const runtimeInternal = runtime as unknown as {
    sessionRegistry: Map<number, unknown>;
  };

  const session = runtimeInternal.sessionRegistry.get(id);
  if (!session) {
    throw new Error(`Expected attached session for entry ${id}`);
  }

  return session as {
    requestPrediction?: () => void;
    requestInlineSuggestion?: () => void;
    handleInput?: (event: Event) => void;
    handleKeyFallbackReconcile?: (...args: unknown[]) => void;
    handleKeyDown?: (event: KeyboardEvent) => void;
    reconcileSelection?: () => void;
    handleClick?: () => void;
    handleBlur?: () => void;
    acceptSuggestionAtIndex?: (index: number) => void;
    acceptSuggestion?: (suggestion: string) => void;
    handleFocus?: () => void;
    handlePaste?: () => void;
    handlePredictionResponse?: (context: {
      requestId: number;
      suggestionId: number;
      predictions: string[];
    }) => void;
    handleCompositionStart?: () => void;
    handleCompositionEnd?: () => void;
  };
}

function getManualAttachButton(root: ParentNode = document): HTMLButtonElement | null {
  return root.querySelector(".ft-manual-attach-button");
}

function getManualAttachContainer(root: ParentNode = document): HTMLDivElement | null {
  return root.querySelector(".ft-manual-attach");
}

function clickManualAttachButton(button: HTMLButtonElement): void {
  button.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function mockRect(
  element: Element,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: rect.left,
        y: rect.top,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => ({}),
      }) satisfies DOMRect,
  });
}

describe("SuggestionManagerRuntime", () => {
  let releaseDomGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseDomGlobalLock = await acquireDomGlobalLock();
  });

  beforeEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    (globalThis as unknown as { window: Window }).window = baseGlobals.window;
    (globalThis as unknown as { document: Document }).document = baseGlobals.document;
    (globalThis as unknown as { navigator: Navigator }).navigator = baseGlobals.navigator;
    (globalThis as unknown as { Node: typeof Node }).Node = baseGlobals.Node;
    (globalThis as unknown as { Element: typeof Element }).Element = baseGlobals.Element;
    (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
      baseGlobals.HTMLElement;
    (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement =
      baseGlobals.HTMLButtonElement;
    (globalThis as unknown as { Event: typeof Event }).Event = baseGlobals.Event;
    (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent =
      baseGlobals.CustomEvent;
    (globalThis as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver =
      baseGlobals.MutationObserver;
    (globalThis as unknown as { getComputedStyle: typeof getComputedStyle }).getComputedStyle =
      baseGlobals.getComputedStyle;
    document.body.innerHTML = "";
    document.documentElement.dir = "";
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: jest.fn(),
        getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
        lastError: undefined,
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    (globalThis as unknown as { window: Window }).window = baseGlobals.window;
    (globalThis as unknown as { document: Document }).document = baseGlobals.document;
    (globalThis as unknown as { navigator: Navigator }).navigator = baseGlobals.navigator;
    (globalThis as unknown as { Node: typeof Node }).Node = baseGlobals.Node;
    (globalThis as unknown as { Element: typeof Element }).Element = baseGlobals.Element;
    (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
      baseGlobals.HTMLElement;
    (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement =
      baseGlobals.HTMLButtonElement;
    (globalThis as unknown as { Event: typeof Event }).Event = baseGlobals.Event;
    (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent =
      baseGlobals.CustomEvent;
    (globalThis as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver =
      baseGlobals.MutationObserver;
    (globalThis as unknown as { getComputedStyle: typeof getComputedStyle }).getComputedStyle =
      baseGlobals.getComputedStyle;
    (globalThis as unknown as { chrome: unknown }).chrome = baseGlobals.chrome;
    releaseDomGlobalLock?.();
    releaseDomGlobalLock = null;
  });

  test("attaches and detaches helper markers through public API", () => {
    const runtime = new SuggestionManagerRuntime({
      selectors: "input",
      minWordLengthToPredict: 1,
      autocomplete: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      insertSpaceAfterAutocomplete: true,
      lang: "en_US",
      selectByDigit: true,
      displayLangHeader: true,
      inline_suggestion: false,
      preferNativeAutocomplete: true,
      enabledGrammarRules: [],
      userDictionaryList: [],
      getPrediction: jest.fn(),
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();
    expect(input.getAttribute("data-suggestion")).toBe("true");

    runtime.detachAllHelpers();
    expect(input.hasAttribute("data-suggestion")).toBe(false);
  });

  test("runtime only orchestrates attach, active-session lookup, and response routing", () => {
    const runtime = makeRuntime();
    const input = document.createElement("input");
    document.body.appendChild(input);

    expect(runtime.queryAndAttachHelper()).toBe(true);
    expect(runtime.queryAndAttachHelper()).toBe(false);

    expect(runtimeDebugState(runtime)).toMatchObject({
      attachedSessions: 1,
      buildsEntrySessions: true,
      handlesPredictionInternally: false,
    });
  });

  test("triggerActiveSuggestion delegates prediction workflow to the active session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();
    input.dispatchEvent(new Event("focus", { bubbles: true }));

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const requestPrediction = jest.fn();
    session.requestPrediction = requestPrediction;

    input.focus();
    runtime.triggerActiveSuggestion();

    expect(requestPrediction).toHaveBeenCalledTimes(1);
  });

  test("detaches helper when attached input becomes structurally ineligible", () => {
    const runtime = new SuggestionManagerRuntime({
      selectors: "input",
      minWordLengthToPredict: 1,
      autocomplete: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      insertSpaceAfterAutocomplete: true,
      lang: "en_US",
      selectByDigit: true,
      displayLangHeader: true,
      inline_suggestion: false,
      preferNativeAutocomplete: true,
      enabledGrammarRules: [],
      userDictionaryList: [],
      getPrediction: jest.fn(),
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    runtime.queryAndAttachHelper();

    input.type = "password";
    runtime.removeHelpersNotInDocument();

    expect(input.hasAttribute("data-suggestion")).toBe(false);
  });

  test("blur dismiss clears entry request state through session cleanup", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
      predictionCoordinator: { cancelPending: (entry: SuggestionEntry) => void };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    entry.suggestions = ["hello"];
    entry.inlineSuggestion = "hello";
    entry.pendingInlineAccept = true;
    entry.pendingRequestTimer = setTimeout(() => undefined, 1000);
    entry.pendingIdleTimer = setTimeout(() => undefined, 1000);
    runtimeInternal.predictionCoordinator.cancelPending = jest.fn();

    input.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(entry.pendingRequestTimer).toBeNull();
    expect(entry.pendingIdleTimer).toBeNull();
    expect(entry.suggestions).toEqual([]);
    expect(entry.inlineSuggestion).toBeNull();
    expect(entry.pendingInlineAccept).toBe(false);
  });

  test("fulfillPrediction routes prediction responses through the entry session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const handlePredictionResponse = jest.fn();
    session.handlePredictionResponse = handlePredictionResponse;

    runtime.fulfillPrediction({
      requestId: 2,
      suggestionId: entry.id,
      predictions: ["beta"],
    });

    expect(handlePredictionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ suggestionId: entry.id, predictions: ["beta"] }),
    );
  });

  test("input events route through the entry session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const handleInput = jest.fn();
    session.handleInput = handleInput;

    const inputEvent = new Event("input", { bubbles: true });
    input.dispatchEvent(inputEvent);

    expect(handleInput).toHaveBeenCalledWith(inputEvent);
  });

  test("composition events route through the entry session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const handleCompositionStart = jest.fn();
    const handleCompositionEnd = jest.fn();
    session.handleCompositionStart = handleCompositionStart;
    session.handleCompositionEnd = handleCompositionEnd;

    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    input.dispatchEvent(new Event("compositionend", { bubbles: true }));

    expect(handleCompositionStart).toHaveBeenCalledTimes(1);
    expect(handleCompositionEnd).toHaveBeenCalledTimes(1);
  });

  test("inline keyboard request delegates to the attached session", () => {
    const runtime = new SuggestionManagerRuntime({
      selectors: "input",
      minWordLengthToPredict: 1,
      autocomplete: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      insertSpaceAfterAutocomplete: true,
      lang: "en_US",
      selectByDigit: true,
      displayLangHeader: true,
      inline_suggestion: true,
      preferNativeAutocomplete: true,
      enabledGrammarRules: [],
      userDictionaryList: [],
      getPrediction: jest.fn(),
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    entry.latestMentionText = "hel";
    const session = getAttachedSession(runtime, entry.id);
    const requestInlineSuggestion = jest.fn();
    session.requestInlineSuggestion = requestInlineSuggestion;

    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );

    expect(requestInlineSuggestion).toHaveBeenCalledTimes(1);
  });

  test("fallback reconcile delegates to the attached session", () => {
    const runtime = makeRuntime();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "Alpha";
    document.body.appendChild(editable);

    runtime.queryAndAttachHelper(editable);

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
      pendingKeyFallbacks: Map<number, unknown>;
      runKeyFallbackReconcile: (id: number) => void;
    };
    const entry = runtimeInternal.entryRegistry.getByElement(editable);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const handleKeyFallbackReconcile = jest.fn();
    session.handleKeyFallbackReconcile = handleKeyFallbackReconcile;
    runtimeInternal.pendingKeyFallbacks.set(entry.id, {
      timer: setTimeout(() => undefined, 1000),
      observer: null,
      reconcileScheduled: false,
      inputAction: "insert",
      expectedBeforeCursor: "Alpha",
      expectedFullText: "Alpha",
      typedKey: "a",
      waitForTextChangeUntilMs: null,
    });

    runtimeInternal.runKeyFallbackReconcile(entry.id);

    expect(handleKeyFallbackReconcile).toHaveBeenCalledTimes(1);
  });

  test("keydown handling delegates active fallback setup to the attached session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const handleKeyDown = jest.fn();
    session.handleKeyDown = handleKeyDown;

    const keydown = new window.KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydown);

    expect(handleKeyDown).toHaveBeenCalledTimes(1);
    expect(handleKeyDown.mock.calls[0]?.[0]).toBe(keydown);
  });

  test("document-level Tab capture accepts suggestions when an ancestor swallows keydown before the entry listener", () => {
    const runtime = makeRuntime();
    const wrapper = document.createElement("div");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    wrapper.appendChild(editable);
    document.body.appendChild(wrapper);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(editable);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    entry.suggestions = ["hello"];
    entry.selectedIndex = 0;
    entry.menu.style.display = "block";

    const session = getAttachedSession(runtime, entry.id);
    const acceptSuggestionAtIndex = jest.fn(() => true);
    session.acceptSuggestionAtIndex = acceptSuggestionAtIndex;

    wrapper.addEventListener(
      "keydown",
      (event) => {
        event.stopPropagation();
      },
      true,
    );

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    editable.dispatchEvent(keydown);

    expect(acceptSuggestionAtIndex).toHaveBeenCalledTimes(1);
    expect(acceptSuggestionAtIndex).toHaveBeenCalledWith(0);
    expect(keydown.defaultPrevented).toBe(true);
  });

  test("early bridge accept delegates popup acceptance to the attached session", () => {
    const runtime = makeRuntime();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(editable);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    entry.suggestions = ["hello"];
    entry.selectedIndex = 0;
    entry.menu.style.display = "block";

    const session = getAttachedSession(runtime, entry.id);
    const acceptSuggestionAtIndex = jest.fn(() => true);
    session.acceptSuggestionAtIndex = acceptSuggestionAtIndex;

    expect(
      (
        runtime as unknown as {
          handleEarlyTabAcceptRequest: (entryId: string) => { accepted: boolean };
        }
      ).handleEarlyTabAcceptRequest(String(entry.id)),
    ).toEqual(expect.objectContaining({ accepted: true }));
    expect(acceptSuggestionAtIndex).toHaveBeenCalledTimes(1);
    expect(acceptSuggestionAtIndex).toHaveBeenCalledWith(0);
  });

  test("early bridge accept reports failure when session acceptance returns false", () => {
    const runtime = makeRuntime();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(editable);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    entry.suggestions = ["hello"];
    entry.selectedIndex = 0;
    entry.menu.style.display = "block";

    const session = getAttachedSession(runtime, entry.id);
    session.acceptSuggestionAtIndex = jest.fn(() => false);

    expect(
      (
        runtime as unknown as {
          handleEarlyTabAcceptRequest: (entryId: string) => { accepted: boolean; reason: string };
        }
      ).handleEarlyTabAcceptRequest(String(entry.id)),
    ).toEqual(
      expect.objectContaining({
        accepted: false,
        reason: "accept_failed",
      }),
    );
  });

  test("selection reconciliation delegates to the attached session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();
    input.dispatchEvent(new Event("focus", { bubbles: true }));

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const reconcileSelection = jest.fn();
    session.reconcileSelection = reconcileSelection;

    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));

    expect(reconcileSelection).toHaveBeenCalledTimes(1);
  });

  test("click and blur cleanup delegate to the attached session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const handleClick = jest.fn();
    const handleBlur = jest.fn();
    session.handleClick = handleClick;
    session.handleBlur = handleBlur;

    input.dispatchEvent(new Event("click", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleBlur).toHaveBeenCalledTimes(1);
  });

  test("focus and paste delegate to the attached session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const handleFocus = jest.fn();
    const handlePaste = jest.fn();
    session.handleFocus = handleFocus;
    session.handlePaste = handlePaste;

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("paste", { bubbles: true }));

    expect(handleFocus).toHaveBeenCalledTimes(1);
    expect(handlePaste).toHaveBeenCalledTimes(1);
  });

  test("backing textarea keydown, focus, and blur delegate to the attached contenteditable session", () => {
    const runtime = makeRuntime();
    const wrapper = document.createElement("div");
    const textarea = document.createElement("textarea");
    const codeMirror = document.createElement("div");
    codeMirror.className = "CodeMirror";
    const codeMirrorCode = document.createElement("div");
    codeMirrorCode.className = "CodeMirror-code";
    codeMirrorCode.setAttribute("contenteditable", "true");
    Object.defineProperty(codeMirrorCode, "isContentEditable", { value: true, configurable: true });
    codeMirror.appendChild(codeMirrorCode);
    wrapper.append(textarea, codeMirror);
    document.body.appendChild(wrapper);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(codeMirrorCode);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    const session = getAttachedSession(runtime, entry.id);
    const handleKeyDown = jest.fn();
    const handleFocus = jest.fn();
    const handleBlur = jest.fn();
    session.handleKeyDown = handleKeyDown;
    session.handleFocus = handleFocus;
    session.handleBlur = handleBlur;

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(keydown);
    textarea.dispatchEvent(new Event("focus", { bubbles: true }));
    textarea.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(handleKeyDown).toHaveBeenCalledTimes(1);
    expect(handleKeyDown.mock.calls[0]?.[0]).toBe(keydown);
    expect(handleFocus).toHaveBeenCalledTimes(1);
    expect(handleBlur).toHaveBeenCalledTimes(1);
  });

  test("menu click delegates acceptance to the attached session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    entry.suggestions = ["alpha"];
    const item = document.createElement("li");
    item.setAttribute("data-index", "0");
    entry.list.appendChild(item);

    const session = getAttachedSession(runtime, entry.id);
    const acceptSuggestionAtIndex = jest.fn();
    session.acceptSuggestionAtIndex = acceptSuggestionAtIndex;

    item.dispatchEvent(new Event("click", { bubbles: true }));

    expect(acceptSuggestionAtIndex).toHaveBeenCalledTimes(1);
    expect(acceptSuggestionAtIndex).toHaveBeenCalledWith(0);
  });

  test("keyboard accept delegates active accept flow to the attached session", () => {
    const runtime = new SuggestionManagerRuntime({
      selectors: "input",
      minWordLengthToPredict: 1,
      autocomplete: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      insertSpaceAfterAutocomplete: true,
      lang: "en_US",
      selectByDigit: true,
      displayLangHeader: true,
      inline_suggestion: true,
      preferNativeAutocomplete: true,
      enabledGrammarRules: [],
      userDictionaryList: [],
      getPrediction: jest.fn(),
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    entry.inlineSuggestion = "beta";
    const session = getAttachedSession(runtime, entry.id);
    const acceptSuggestion = jest.fn();
    session.acceptSuggestion = acceptSuggestion;

    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );

    expect(acceptSuggestion).toHaveBeenCalledTimes(1);
    expect(acceptSuggestion).toHaveBeenCalledWith("beta");
  });

  test("existing attached sessions use updated lang config", () => {
    const telemetry = {
      recordSuggestionShown: jest.fn(),
      recordSuggestionAccepted: jest.fn(),
    };
    const runtime = new SuggestionManagerRuntime({
      selectors: "input",
      minWordLengthToPredict: 1,
      autocomplete: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      insertSpaceAfterAutocomplete: true,
      lang: "en_US",
      selectByDigit: true,
      displayLangHeader: true,
      inline_suggestion: true,
      preferNativeAutocomplete: true,
      enabledGrammarRules: [],
      userDictionaryList: [],
      getPrediction: jest.fn(),
      telemetry: telemetry as never,
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "bet";
    input.selectionStart = 3;
    input.selectionEnd = 3;
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();
    runtime.updateLangConfig("pl_PL");

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    entry.inlineSuggestion = "beta";

    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );

    expect(telemetry.recordSuggestionAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ language: "pl_PL" }),
    );
  });

  test("real routed input skips prediction scheduling when the input event is composing", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    input.value = "alpha";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
      predictionCoordinator: { schedule: (entry: SuggestionEntry, context: unknown) => void };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    runtimeInternal.predictionCoordinator.schedule = jest.fn();
    const initialRequestId = entry.requestId;
    const inputEvent = new Event("input", { bubbles: true }) as InputEvent;
    Object.defineProperty(inputEvent, "isComposing", { value: true });

    input.dispatchEvent(inputEvent);

    expect(runtimeInternal.predictionCoordinator.schedule).not.toHaveBeenCalled();
    expect(entry.requestId).toBe(initialRequestId + 1);
  });

  test("real routed input skips prediction scheduling for non-collapsed selection", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    input.value = "alpha";
    input.selectionStart = 1;
    input.selectionEnd = 4;
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const runtimeInternal = runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
      predictionCoordinator: { schedule: (entry: SuggestionEntry, context: unknown) => void };
    };
    const entry = runtimeInternal.entryRegistry.getByElement(input);
    if (!entry) {
      throw new Error("Expected attached suggestion entry");
    }

    runtimeInternal.predictionCoordinator.schedule = jest.fn();
    const initialRequestId = entry.requestId;

    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(runtimeInternal.predictionCoordinator.schedule).not.toHaveBeenCalled();
    expect(entry.requestId).toBe(initialRequestId + 1);
  });

  const makeRuntime = (selectors = "textarea, input, [contentEditable]") =>
    new SuggestionManagerRuntime({
      selectors,
      minWordLengthToPredict: 1,
      autocomplete: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      insertSpaceAfterAutocomplete: true,
      lang: "en_US",
      selectByDigit: true,
      displayLangHeader: true,
      inline_suggestion: false,
      preferNativeAutocomplete: true,
      enabledGrammarRules: [],
      userDictionaryList: [],
      getPrediction: jest.fn(),
    });

  describe("input type eligibility", () => {
    test.each(["email", "url", "text", "search"])(
      'attaches to input[type="%s"]',
      (type: string) => {
        const runtime = makeRuntime();
        const input = document.createElement("input");
        input.type = type;
        document.body.appendChild(input);
        runtime.queryAndAttachHelper();
        expect(input.getAttribute("data-suggestion")).toBe("true");
      },
    );

    test.each(["number", "password", "hidden", "checkbox", "radio", "file", "color", "tel"])(
      'does not attach to input[type="%s"]',
      (type: string) => {
        const runtime = makeRuntime();
        const input = document.createElement("input");
        input.type = type;
        document.body.appendChild(input);
        runtime.queryAndAttachHelper();
        expect(input.hasAttribute("data-suggestion")).toBe(false);
      },
    );
  });

  describe("disabled and readonly inputs", () => {
    test("does not attach to disabled input", () => {
      const runtime = makeRuntime();
      const input = document.createElement("input");
      input.type = "text";
      input.disabled = true;
      document.body.appendChild(input);
      runtime.queryAndAttachHelper();
      expect(input.hasAttribute("data-suggestion")).toBe(false);
    });

    test("does not attach to readonly input", () => {
      const runtime = makeRuntime();
      const input = document.createElement("input");
      input.type = "text";
      input.readOnly = true;
      document.body.appendChild(input);
      runtime.queryAndAttachHelper();
      expect(input.hasAttribute("data-suggestion")).toBe(false);
    });

    test("does not attach to disabled textarea", () => {
      const runtime = makeRuntime();
      const ta = document.createElement("textarea");
      ta.disabled = true;
      document.body.appendChild(ta);
      runtime.queryAndAttachHelper();
      expect(ta.hasAttribute("data-suggestion")).toBe(false);
    });

    test("does not attach to readonly textarea", () => {
      const runtime = makeRuntime();
      const ta = document.createElement("textarea");
      ta.readOnly = true;
      document.body.appendChild(ta);
      runtime.queryAndAttachHelper();
      expect(ta.hasAttribute("data-suggestion")).toBe(false);
    });

    test("detaches when input becomes disabled, reattaches when re-enabled", () => {
      const runtime = makeRuntime();
      const input = document.createElement("input");
      input.type = "text";
      document.body.appendChild(input);

      runtime.queryAndAttachHelper();
      expect(input.getAttribute("data-suggestion")).toBe("true");

      input.disabled = true;
      runtime.removeHelpersNotInDocument();
      expect(input.hasAttribute("data-suggestion")).toBe(false);

      input.disabled = false;
      runtime.queryAndAttachHelper();
      expect(input.getAttribute("data-suggestion")).toBe("true");
    });

    test("detaches when input becomes readonly, reattaches when re-editable", () => {
      const runtime = makeRuntime();
      const input = document.createElement("input");
      input.type = "text";
      document.body.appendChild(input);

      runtime.queryAndAttachHelper();
      expect(input.getAttribute("data-suggestion")).toBe("true");

      input.readOnly = true;
      runtime.removeHelpersNotInDocument();
      expect(input.hasAttribute("data-suggestion")).toBe(false);

      input.readOnly = false;
      runtime.queryAndAttachHelper();
      expect(input.getAttribute("data-suggestion")).toBe("true");
    });
  });

  describe("native autocomplete conflict handling", () => {
    test("shows a manual attach icon for datalist conflicts when preferNativeAutocomplete is enabled", () => {
      const runtime = makeRuntime();
      const list = document.createElement("datalist");
      list.id = "cities";
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("list", "cities");
      document.body.append(list, input);

      runtime.queryAndAttachHelper();

      expect(input.hasAttribute("data-suggestion")).toBe(false);
      const button = getManualAttachButton(input.parentElement ?? document);
      expect(button).not.toBeNull();
      expect(button?.title).toBe("Click to enable FluentTyper for this field.");
      expect(input.style.paddingRight).not.toBe("");
    });

    test("shows a manual attach icon for semantic autocomplete conflicts", () => {
      const runtime = makeRuntime();
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("autocomplete", "email");
      document.body.appendChild(input);

      runtime.queryAndAttachHelper();

      expect(input.hasAttribute("data-suggestion")).toBe(false);
      expect(getManualAttachButton(input.parentElement ?? document)).not.toBeNull();
    });

    test("shows a manual attach icon for aria combobox conflicts", () => {
      const runtime = makeRuntime();
      const list = document.createElement("div");
      list.id = "cities";
      list.setAttribute("role", "listbox");
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-controls", "cities");
      document.body.append(list, input);

      runtime.queryAndAttachHelper();

      expect(input.hasAttribute("data-suggestion")).toBe(false);
      expect(getManualAttachButton(input.parentElement ?? document)).not.toBeNull();
    });

    test("shows a manual attach icon for contenteditable combobox conflicts inside composite editors", () => {
      const runtime = makeRuntime();
      const shell = document.createElement("div");
      const leftActions = document.createElement("div");
      const editorShell = document.createElement("div");
      const editable = document.createElement("div");
      const placeholder = document.createElement("div");
      const rightActions = document.createElement("div");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", {
        configurable: true,
        value: true,
      });
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      placeholder.setAttribute("aria-hidden", "true");
      editorShell.append(editable, placeholder);
      shell.append(leftActions, editorShell, rightActions);
      document.body.append(shell, list);
      mockRect(shell, { left: 10, top: 20, width: 360, height: 52 });
      mockRect(leftActions, { left: 18, top: 30, width: 56, height: 28 });
      mockRect(editorShell, { left: 86, top: 24, width: 190, height: 40 });
      mockRect(editable, { left: 94, top: 30, width: 150, height: 28 });
      mockRect(rightActions, { left: 236, top: 28, width: 32, height: 32 });

      runtime.queryAndAttachHelper();

      expect(editable.hasAttribute("data-suggestion")).toBe(false);
      expect(getManualAttachButton(leftActions)).toBeNull();
      expect(getManualAttachButton(rightActions)).toBeNull();
      const container = getManualAttachContainer(editorShell);
      expect(container).not.toBeNull();
      expect(container?.style.left).toBe("124px");
      expect(container?.style.top).toBe("14px");
      expect(editable.style.paddingRight).toBe("");
      expect(editable.style.paddingLeft).toBe("");
    });

    test("repositions contenteditable manual attach icon when inline-end sibling controls appear", () => {
      const runtime = makeRuntime();
      const shell = document.createElement("div");
      const editorShell = document.createElement("div");
      const editable = document.createElement("div");
      const rightActions = document.createElement("div");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", {
        configurable: true,
        value: true,
      });
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      shell.append(editorShell, rightActions);
      editorShell.appendChild(editable);
      document.body.append(shell, list);
      mockRect(shell, { left: 10, top: 20, width: 320, height: 52 });
      mockRect(editorShell, { left: 86, top: 24, width: 190, height: 40 });
      mockRect(editable, { left: 94, top: 30, width: 150, height: 28 });
      mockRect(rightActions, { left: 280, top: 28, width: 0, height: 0 });

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(editorShell);
      expect(container?.style.left).toBe("132px");

      mockRect(rightActions, { left: 236, top: 28, width: 32, height: 32 });
      runtime.removeHelpersNotInDocument();

      expect(container?.style.left).toBe("124px");
    });

    test("avoids same-wrapper inline-end controls for contenteditable manual attach placement", () => {
      const runtime = makeRuntime();
      const shell = document.createElement("div");
      const editorShell = document.createElement("div");
      const editable = document.createElement("div");
      const placeholder = document.createElement("div");
      const inlineAction = document.createElement("button");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", {
        configurable: true,
        value: true,
      });
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      placeholder.setAttribute("aria-hidden", "true");
      inlineAction.type = "button";
      editorShell.append(editable, placeholder, inlineAction);
      shell.appendChild(editorShell);
      document.body.append(shell, list);
      mockRect(shell, { left: 10, top: 20, width: 260, height: 52 });
      mockRect(editorShell, { left: 86, top: 24, width: 150, height: 40 });
      mockRect(editable, { left: 94, top: 30, width: 140, height: 28 });
      mockRect(placeholder, { left: 94, top: 30, width: 140, height: 20 });
      mockRect(inlineAction, { left: 220, top: 28, width: 16, height: 24 });

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(editorShell);
      expect(container).not.toBeNull();
      expect(container?.style.left).toBe("108px");
      expect(getManualAttachButton(editorShell)).not.toBeNull();
    });

    test("ignores nested decorative descendants when positioning contenteditable manual attach icon", () => {
      const runtime = makeRuntime();
      const shell = document.createElement("div");
      const editorShell = document.createElement("div");
      const editable = document.createElement("div");
      const decorationLayer = document.createElement("div");
      const decorationIcon = document.createElement("span");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", {
        configurable: true,
        value: true,
      });
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      decorationLayer.appendChild(decorationIcon);
      editorShell.append(editable, decorationLayer);
      shell.appendChild(editorShell);
      document.body.append(shell, list);
      mockRect(shell, { left: 10, top: 20, width: 260, height: 52 });
      mockRect(editorShell, { left: 86, top: 24, width: 150, height: 40 });
      mockRect(editable, { left: 94, top: 30, width: 150, height: 28 });
      mockRect(decorationLayer, { left: 214, top: 26, width: 18, height: 28 });
      mockRect(decorationIcon, { left: 214, top: 30, width: 14, height: 14 });

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(editorShell);
      expect(container).not.toBeNull();
      expect(container?.style.left).toBe("132px");
    });

    test("uses a high-contrast dark surface treatment for manual attach icon", () => {
      const runtime = makeRuntime();
      const shell = document.createElement("div");
      const editorShell = document.createElement("div");
      const editable = document.createElement("div");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      shell.style.backgroundColor = "rgb(29, 28, 29)";
      editorShell.style.backgroundColor = "rgb(29, 28, 29)";
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", {
        configurable: true,
        value: true,
      });
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      editorShell.appendChild(editable);
      shell.appendChild(editorShell);
      document.body.append(shell, list);
      mockRect(shell, { left: 10, top: 20, width: 260, height: 52 });
      mockRect(editorShell, { left: 86, top: 24, width: 150, height: 40 });
      mockRect(editable, { left: 94, top: 30, width: 150, height: 28 });

      runtime.queryAndAttachHelper();

      const button = getManualAttachButton(editorShell);
      const icon = button?.querySelector("img");
      expect(button).not.toBeNull();
      expect(button?.style.backgroundColor).toBe("rgba(15, 23, 42, 0.92)");
      expect(button?.style.borderColor).toBe("rgba(148, 163, 184, 0.34)");
      expect(icon?.style.filter).not.toContain("grayscale");
    });

    test("ignores non-overlapping rows when resolving contenteditable manual attach obstacles", () => {
      const runtime = makeRuntime();
      const shell = document.createElement("div");
      const editorShell = document.createElement("div");
      const editable = document.createElement("div");
      const lowerRowAction = document.createElement("button");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", {
        configurable: true,
        value: true,
      });
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      lowerRowAction.type = "button";
      shell.append(editorShell, lowerRowAction);
      editorShell.appendChild(editable);
      document.body.append(shell, list);
      mockRect(shell, { left: 10, top: 20, width: 320, height: 96 });
      mockRect(editorShell, { left: 86, top: 24, width: 190, height: 40 });
      mockRect(editable, { left: 94, top: 30, width: 150, height: 28 });
      mockRect(lowerRowAction, { left: 236, top: 76, width: 32, height: 24 });

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(editorShell);
      expect(container).not.toBeNull();
      expect(container?.style.left).toBe("132px");
    });

    test("positions the manual attach icon on inline-end for rtl inputs", () => {
      const runtime = makeRuntime();
      const parent = document.createElement("div");
      const list = document.createElement("datalist");
      list.id = "cities";
      const input = document.createElement("input");
      input.type = "text";
      input.dir = "rtl";
      input.setAttribute("list", "cities");
      parent.append(input);
      document.body.append(list, parent);
      mockRect(parent, { left: 10, top: 20, width: 220, height: 80 });
      mockRect(input, { left: 30, top: 40, width: 100, height: 50 });

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(parent);
      expect(container).not.toBeNull();
      expect(container?.style.left).toBe("28px");
      expect(container?.style.top).toBe("36px");
      expect(input.style.paddingLeft).not.toBe("");
      expect(input.style.paddingRight).toBe("");
    });

    test("positions the manual attach icon on inline-end for rtl textareas", () => {
      const runtime = makeRuntime("textarea");
      const parent = document.createElement("div");
      const list = document.createElement("div");
      list.id = "cities";
      list.setAttribute("role", "listbox");
      const textarea = document.createElement("textarea");
      textarea.dir = "rtl";
      textarea.setAttribute("role", "combobox");
      textarea.setAttribute("aria-expanded", "true");
      textarea.setAttribute("aria-controls", "cities");
      parent.append(textarea);
      document.body.append(list, parent);
      mockRect(parent, { left: 12, top: 18, width: 260, height: 160 });
      mockRect(textarea, { left: 32, top: 44, width: 120, height: 80 });

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(parent);
      expect(container).not.toBeNull();
      expect(container?.style.left).toBe("28px");
      expect(container?.style.top).toBe("34px");
      expect(textarea.style.paddingLeft).not.toBe("");
      expect(textarea.style.paddingRight).toBe("");
    });

    test("clicking the manual attach icon force-attaches and restores focus", () => {
      jest.useFakeTimers();
      try {
        const runtime = makeRuntime();
        const list = document.createElement("datalist");
        list.id = "cities";
        const input = document.createElement("input");
        input.type = "text";
        input.setAttribute("list", "cities");
        document.body.append(list, input);

        runtime.queryAndAttachHelper();
        const button = getManualAttachButton(input.parentElement ?? document);
        expect(button).not.toBeNull();

        button?.focus();
        clickManualAttachButton(button as HTMLButtonElement);

        expect(input.getAttribute("data-suggestion")).toBe("true");
        expect(document.activeElement).toBe(input);

        jest.advanceTimersByTime(700);
        expect(getManualAttachButton(input.parentElement ?? document)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test("clicking the manual attach icon force-attaches a semantic autocomplete conflict", () => {
      jest.useFakeTimers();
      try {
        const runtime = makeRuntime();
        const input = document.createElement("input");
        input.type = "text";
        input.setAttribute("autocomplete", "email");
        document.body.appendChild(input);

        runtime.queryAndAttachHelper();
        const button = getManualAttachButton(input.parentElement ?? document);
        expect(button).not.toBeNull();

        clickManualAttachButton(button as HTMLButtonElement);

        expect(input.getAttribute("data-suggestion")).toBe("true");
        expect(document.activeElement).toBe(input);

        jest.advanceTimersByTime(700);
        expect(getManualAttachButton(input.parentElement ?? document)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test("clicking the manual attach icon force-attaches an aria combobox conflict", () => {
      jest.useFakeTimers();
      try {
        const runtime = makeRuntime();
        const list = document.createElement("div");
        list.id = "cities";
        list.setAttribute("role", "listbox");
        const input = document.createElement("input");
        input.type = "text";
        input.setAttribute("role", "combobox");
        input.setAttribute("aria-expanded", "true");
        input.setAttribute("aria-controls", "cities");
        document.body.append(list, input);

        runtime.queryAndAttachHelper();
        const button = getManualAttachButton(input.parentElement ?? document);
        expect(button).not.toBeNull();

        clickManualAttachButton(button as HTMLButtonElement);

        expect(input.getAttribute("data-suggestion")).toBe("true");
        expect(document.activeElement).toBe(input);

        jest.advanceTimersByTime(700);
        expect(getManualAttachButton(input.parentElement ?? document)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test("clicking the manual attach icon force-attaches a contenteditable combobox conflict", () => {
      jest.useFakeTimers();
      try {
        const runtime = makeRuntime();
        const editable = document.createElement("div");
        const list = document.createElement("div");
        editable.setAttribute("contenteditable", "true");
        Object.defineProperty(editable, "isContentEditable", {
          configurable: true,
          value: true,
        });
        editable.tabIndex = 0;
        editable.setAttribute("role", "combobox");
        editable.setAttribute("aria-expanded", "true");
        editable.setAttribute("aria-controls", "editable-list");
        list.id = "editable-list";
        list.setAttribute("role", "listbox");
        document.body.append(editable, list);

        runtime.queryAndAttachHelper();
        const button = getManualAttachButton(editable.parentElement ?? document);
        expect(button).not.toBeNull();

        clickManualAttachButton(button as HTMLButtonElement);

        expect(editable.getAttribute("data-suggestion")).toBe("true");
        expect(document.activeElement).toBe(editable);

        jest.advanceTimersByTime(700);
        expect(getManualAttachButton(editable.parentElement ?? document)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test("detaches helper and replaces it with the manual attach icon when input gains native conflict attributes", () => {
      const runtime = makeRuntime();
      const list = document.createElement("datalist");
      list.id = "cities";
      const input = document.createElement("input");
      input.type = "text";
      document.body.append(list, input);

      runtime.queryAndAttachHelper();
      expect(input.getAttribute("data-suggestion")).toBe("true");

      input.setAttribute("list", "cities");
      runtime.removeHelpersNotInDocument();

      expect(input.hasAttribute("data-suggestion")).toBe(false);
      expect(getManualAttachButton(input.parentElement ?? document)).not.toBeNull();
    });

    test("reattaches helper after native autocomplete conflict is removed and clears the icon", () => {
      const runtime = makeRuntime();
      const list = document.createElement("datalist");
      list.id = "cities";
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("list", "cities");
      document.body.append(list, input);

      runtime.queryAndAttachHelper();
      expect(input.hasAttribute("data-suggestion")).toBe(false);
      expect(getManualAttachButton(input.parentElement ?? document)).not.toBeNull();

      input.removeAttribute("list");
      runtime.queryAndAttachHelper();

      expect(input.getAttribute("data-suggestion")).toBe("true");
      expect(getManualAttachButton(input.parentElement ?? document)).toBeNull();
    });

    test("attaches to conflicting fields when preferNativeAutocomplete is disabled", () => {
      const runtime = new SuggestionManagerRuntime({
        selectors: "input",
        minWordLengthToPredict: 1,
        autocomplete: true,
        autocompleteOnEnter: true,
        autocompleteOnTab: true,
        insertSpaceAfterAutocomplete: true,
        lang: "en_US",
        selectByDigit: true,
        displayLangHeader: true,
        inline_suggestion: false,
        preferNativeAutocomplete: false,
        enabledGrammarRules: [],
        userDictionaryList: [],
        getPrediction: jest.fn(),
      });
      const list = document.createElement("datalist");
      list.id = "cities";
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("list", "cities");
      document.body.append(list, input);

      runtime.queryAndAttachHelper();

      expect(input.getAttribute("data-suggestion")).toBe("true");
      expect(getManualAttachButton(input.parentElement ?? document)).toBeNull();
    });

    test("attaches to contenteditable editors even when they expose aria autocomplete widgets", () => {
      const runtime = makeRuntime();
      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", {
        configurable: true,
        value: true,
      });
      editable.setAttribute("role", "textbox");
      editable.setAttribute("aria-autocomplete", "list");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      editable.setAttribute("data-lexical-editor", "true");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      document.body.append(editable, list);

      runtime.queryAndAttachHelper();

      expect(editable.getAttribute("data-suggestion")).toBe("true");
      expect(getManualAttachButton(document)).toBeNull();
    });

    test("removes the manual attach icon when a conflicting field becomes readonly", () => {
      const runtime = makeRuntime();
      const list = document.createElement("datalist");
      list.id = "cities";
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("list", "cities");
      document.body.append(list, input);

      runtime.queryAndAttachHelper();
      expect(getManualAttachButton(input.parentElement ?? document)).not.toBeNull();

      input.readOnly = true;
      runtime.removeHelpersNotInDocument();

      expect(getManualAttachButton(input.parentElement ?? document)).toBeNull();
      expect(input.style.paddingRight).toBe("");
    });
  });

  // Regression: querySelectorAll does not pierce shadow roots, so inputs inside
  // open shadow roots were silently skipped before deepQuerySelectorAll was added.
  describe("open shadow DOM discovery", () => {
    test("queryAndAttachHelper attaches to an input inside an open shadow root", () => {
      const runtime = makeRuntime();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const shadowInput = document.createElement("input");
      shadowInput.type = "text";
      shadow.appendChild(shadowInput);

      // The naive querySelectorAll("input") would miss this:
      expect(document.querySelectorAll("input").length).toBe(0);

      runtime.queryAndAttachHelper();
      expect(shadowInput.getAttribute("data-suggestion")).toBe("true");

      host.remove();
    });

    test("onShadowRootDiscovered callback is invoked for each open shadow root", () => {
      const discovered: ShadowRoot[] = [];
      const runtimeWithHook = new SuggestionManagerRuntime({
        selectors: "textarea, input, [contentEditable]",
        minWordLengthToPredict: 1,
        autocomplete: true,
        autocompleteOnEnter: true,
        autocompleteOnTab: true,
        insertSpaceAfterAutocomplete: true,
        lang: "en_US",
        selectByDigit: true,
        displayLangHeader: true,
        inline_suggestion: false,
        preferNativeAutocomplete: true,
        enabledGrammarRules: [],
        userDictionaryList: [],
        getPrediction: jest.fn(),
        onShadowRootDiscovered: (root) => discovered.push(root),
      });

      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const shadowInput = document.createElement("input");
      shadowInput.type = "text";
      shadow.appendChild(shadowInput);

      runtimeWithHook.queryAndAttachHelper();
      expect(discovered).toContain(shadow);

      host.remove();
    });

    test("removeHelpersNotInDocument detaches shadow-hosted helper when host is removed", () => {
      const runtime = makeRuntime();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const shadowInput = document.createElement("input");
      shadowInput.type = "text";
      shadow.appendChild(shadowInput);

      runtime.queryAndAttachHelper();
      expect(shadowInput.getAttribute("data-suggestion")).toBe("true");

      // Removing the host takes the shadow-hosted input out of the document.
      host.remove();
      runtime.removeHelpersNotInDocument();
      expect(shadowInput.hasAttribute("data-suggestion")).toBe(false);
    });

    test("renders the manual attach icon inside the shadow root for a direct conflicting child", () => {
      const runtime = makeRuntime();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const list = document.createElement("datalist");
      list.id = "cities";
      const shadowInput = document.createElement("input");
      shadowInput.type = "text";
      shadowInput.setAttribute("list", "cities");
      shadow.append(list, shadowInput);

      runtime.queryAndAttachHelper();

      expect(getManualAttachButton(shadow)).not.toBeNull();
      expect(getManualAttachButton(host)).toBeNull();
    });

    test("uses dark surface styling for a shadow-hosted conflicting field on a dark host", () => {
      const runtime = makeRuntime();
      const host = document.createElement("div");
      host.style.backgroundColor = "rgb(29, 28, 29)";
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const list = document.createElement("datalist");
      list.id = "cities";
      const shadowInput = document.createElement("input");
      shadowInput.type = "text";
      shadowInput.setAttribute("list", "cities");
      shadow.append(list, shadowInput);

      runtime.queryAndAttachHelper();

      const button = getManualAttachButton(shadow);
      expect(button).not.toBeNull();
      expect(button?.style.backgroundColor).toBe("rgba(15, 23, 42, 0.92)");
    });

    test("removes the manual attach icon when a shadow-hosted conflicting field is removed", () => {
      const runtime = makeRuntime();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const list = document.createElement("datalist");
      list.id = "cities";
      const shadowInput = document.createElement("input");
      shadowInput.type = "text";
      shadowInput.setAttribute("list", "cities");
      shadow.append(list, shadowInput);

      runtime.queryAndAttachHelper();
      expect(getManualAttachButton(shadow)).not.toBeNull();
      expect(getManualAttachButton(host)).toBeNull();

      host.remove();
      runtime.removeHelpersNotInDocument();

      expect(getManualAttachButton(shadow)).toBeNull();
      expect(getManualAttachButton(host)).toBeNull();
    });
  });
});
