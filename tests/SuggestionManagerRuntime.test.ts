import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionManagerRuntime } from "../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime";
import type {
  SuggestionEntry,
  SuggestionManagerOptions,
} from "../src/adapters/chrome/content-script/suggestions/types";
import { createEditor } from "./codeContextTestUtils";
import { createRect, createRuntimeOptions } from "./suggestionTestUtils";

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

type SessionInternals = {
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
  allowsAutomaticEdit?: (edit: { deleteBackwards: number; replacement: string }) => boolean;
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

function getAttachedSession(runtime: SuggestionManagerRuntime, id: number): SessionInternals {
  return (
    runtime as unknown as { sessionRegistry: Map<number, SessionInternals> }
  ).sessionRegistry.get(id)!;
}

function entryFor(runtime: SuggestionManagerRuntime, elem: Element): SuggestionEntry {
  return (
    runtime as unknown as {
      entryRegistry: { getByElement: (elem: Element) => SuggestionEntry | undefined };
    }
  ).entryRegistry.getByElement(elem)!;
}

function makeRuntime(
  selectors = "textarea, input, [contentEditable]",
  overrides: Partial<SuggestionManagerOptions> = {},
): SuggestionManagerRuntime {
  return new SuggestionManagerRuntime(createRuntimeOptions({ selectors, ...overrides }));
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

function removeSuggestionOverlayNodes(): void {
  document.querySelectorAll('[id^="ft-menu-"]').forEach((node) => node.remove());
  document.querySelectorAll(".ft-suggestion-inline").forEach((node) => node.remove());
}

function mockRect(element: Element, ...rect: Parameters<typeof createRect>): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => createRect(...rect),
  });
}

describe("SuggestionManagerRuntime", () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.assign(globalThis, baseGlobals);
    removeSuggestionOverlayNodes();
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
    Object.assign(globalThis, baseGlobals);
    removeSuggestionOverlayNodes();
  });

  test("attaches and detaches helper markers through public API", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();
    expect(input.getAttribute("data-suggestion")).toBe("true");

    runtime.detachAllHelpers();
    expect(input.hasAttribute("data-suggestion")).toBe(false);
  });

  test("mounts the popup host outside a contenteditable body root", () => {
    const runtime = makeRuntime();
    document.body.setAttribute("contenteditable", "true");
    Object.defineProperty(document.body, "isContentEditable", {
      value: true,
      configurable: true,
    });
    runtime.queryAndAttachHelper();

    const entry = entryFor(runtime, document.body);

    expect(entry.menu.parentElement).toBe(document.documentElement);
    expect(document.body.querySelector(`#${entry.menu.id}`)).toBeNull();
    expect(document.body.hasAttribute("data-suggestion")).toBe(false);
    expect(document.body.hasAttribute("data-ft-suggestion-id")).toBe(false);
    expect(document.documentElement.getAttribute("data-suggestion")).toBe("true");
    expect(document.documentElement.getAttribute("data-ft-suggestion-id")).toBe(String(entry.id));

    runtime.detachAllHelpers();
    expect(document.documentElement.hasAttribute("data-suggestion")).toBe(false);
    expect(document.documentElement.hasAttribute("data-ft-suggestion-id")).toBe(false);
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

    const entry = entryFor(runtime, input);

    const session = getAttachedSession(runtime, entry.id);
    const requestPrediction = jest.fn();
    session.requestPrediction = requestPrediction;

    input.focus();
    runtime.triggerActiveSuggestion();

    expect(requestPrediction).toHaveBeenCalledTimes(1);
  });

  test("detaches helper when attached input becomes structurally ineligible", () => {
    const runtime = makeRuntime("input");
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
      predictionCoordinator: { cancelPending: (entry: SuggestionEntry) => void };
    };
    const entry = entryFor(runtime, input);

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

    const entry = entryFor(runtime, input);

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

    const entry = entryFor(runtime, input);

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

    const entry = entryFor(runtime, input);

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

  test("inline keyboard preserves Tab before a visible suggestion", () => {
    const runtime = makeRuntime("input", { inline_suggestion: true });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const entry = entryFor(runtime, input);

    entry.latestMentionText = "hel";
    entry.suggestions = ["hello"];
    const session = getAttachedSession(runtime, entry.id);
    const requestInlineSuggestion = jest.fn();
    session.requestInlineSuggestion = requestInlineSuggestion;

    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );

    expect(requestInlineSuggestion).not.toHaveBeenCalled();
  });

  test("fallback reconcile delegates to the attached session", () => {
    const runtime = makeRuntime();
    const editable = createEditor("Alpha");

    runtime.queryAndAttachHelper(editable);

    const runtimeInternal = runtime as unknown as {
      pendingKeyFallbacks: Map<number, unknown>;
      runKeyFallbackReconcile: (id: number) => void;
    };
    const entry = entryFor(runtime, editable);

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

    const entry = entryFor(runtime, input);

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
    const editable = createEditor("");
    const wrapper = document.createElement("div");
    wrapper.appendChild(editable);
    document.body.appendChild(wrapper);

    runtime.queryAndAttachHelper();

    const entry = entryFor(runtime, editable);

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
    const editable = createEditor("");

    runtime.queryAndAttachHelper();

    const entry = entryFor(runtime, editable);

    entry.suggestions = ["hello"];
    entry.selectedIndex = 0;
    entry.menu.style.display = "block";

    const session = getAttachedSession(runtime, entry.id);
    const acceptSuggestionAtIndex = jest.fn(() => true);
    session.acceptSuggestionAtIndex = acceptSuggestionAtIndex;

    expect(runtime.handleEarlyTabAcceptRequest(String(entry.id))).toBe(true);
    expect(acceptSuggestionAtIndex).toHaveBeenCalledTimes(1);
    expect(acceptSuggestionAtIndex).toHaveBeenCalledWith(0);
  });

  test("early bridge accept reports no visible suggestion state when the popup host is hidden", () => {
    const runtime = makeRuntime();
    const editable = createEditor("");

    runtime.queryAndAttachHelper();

    const entry = entryFor(runtime, editable);

    entry.suggestions = ["hello"];
    entry.selectedIndex = 0;
    entry.menu.style.display = "block";
    entry.menu.style.visibility = "hidden";

    const session = getAttachedSession(runtime, entry.id);
    const acceptSuggestionAtIndex = jest.fn(() => true);
    session.acceptSuggestionAtIndex = acceptSuggestionAtIndex;

    expect(runtime.handleEarlyTabAcceptRequest(String(entry.id))).toBe(false);
    expect(acceptSuggestionAtIndex).not.toHaveBeenCalled();
  });

  test("early bridge accept reports failure when session acceptance returns false", () => {
    const runtime = makeRuntime();
    const editable = createEditor("");

    runtime.queryAndAttachHelper();

    const entry = entryFor(runtime, editable);

    entry.suggestions = ["hello"];
    entry.selectedIndex = 0;
    entry.menu.style.display = "block";

    const session = getAttachedSession(runtime, entry.id);
    const acceptSuggestionAtIndex = jest.fn(() => false);
    session.acceptSuggestionAtIndex = acceptSuggestionAtIndex;

    expect(runtime.handleEarlyTabAcceptRequest(String(entry.id))).toBe(false);
    expect(acceptSuggestionAtIndex).toHaveBeenCalledWith(0);
  });

  test("document-level Tab capture ignores suggestions when the popup host was removed", () => {
    const runtime = makeRuntime();
    const editable = createEditor("");
    const wrapper = document.createElement("div");
    wrapper.appendChild(editable);
    document.body.appendChild(wrapper);

    runtime.queryAndAttachHelper();

    const entry = entryFor(runtime, editable);

    entry.suggestions = ["hello"];
    entry.selectedIndex = 0;
    entry.menu.style.display = "block";
    entry.menu.remove();

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

    expect(acceptSuggestionAtIndex).not.toHaveBeenCalled();
    expect(keydown.defaultPrevented).toBe(false);
  });

  test("selection reconciliation delegates to the attached session", () => {
    const runtime = makeRuntime("input");
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();
    input.dispatchEvent(new Event("focus", { bubbles: true }));

    const entry = entryFor(runtime, input);

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

    const entry = entryFor(runtime, input);

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

    const entry = entryFor(runtime, input);

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
    const codeMirrorCode = createEditor("");
    codeMirrorCode.className = "CodeMirror-code";
    codeMirror.appendChild(codeMirrorCode);
    wrapper.append(textarea, codeMirror);
    document.body.appendChild(wrapper);

    runtime.queryAndAttachHelper();

    const entry = entryFor(runtime, codeMirrorCode);

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

    const entry = entryFor(runtime, input);

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
    const runtime = makeRuntime("input", { inline_suggestion: true });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    runtime.queryAndAttachHelper();

    const entry = entryFor(runtime, input);

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
    const runtime = makeRuntime("input", {
      inline_suggestion: true,
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

    const entry = entryFor(runtime, input);

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
      predictionCoordinator: { schedule: (entry: SuggestionEntry, context: unknown) => void };
    };
    const entry = entryFor(runtime, input);

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
      predictionCoordinator: { schedule: (entry: SuggestionEntry, context: unknown) => void };
    };
    const entry = entryFor(runtime, input);

    runtimeInternal.predictionCoordinator.schedule = jest.fn();
    const initialRequestId = entry.requestId;

    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(runtimeInternal.predictionCoordinator.schedule).not.toHaveBeenCalled();
    expect(entry.requestId).toBe(initialRequestId + 1);
  });

  test("pauses an attached writing field for a late popup, rejects stale answers and resumes on typing", () => {
    const runtime = makeRuntime();
    document.body.innerHTML =
      '<input id="subject" aria-autocomplete="list" aria-controls="choices"><div id="choices" role="listbox" hidden><div role="option">Choice</div></div>';
    const input = document.querySelector("input")!;
    const popup = document.querySelector<HTMLElement>("#choices")!;
    for (const node of [popup, popup.firstElementChild!])
      node.getClientRects = () =>
        [
          { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 },
        ] as unknown as DOMRectList;
    runtime.queryAndAttachHelper();
    input.focus();
    input.value = "hel";
    input.setSelectionRange(3, 3);
    const internals = runtime as unknown as {
      predictionCoordinator: { schedule: (...args: unknown[]) => void };
    };
    const entry = entryFor(runtime, input);
    const session = getAttachedSession(runtime, entry.id);
    const requestId = entry.requestId;
    entry.suggestions = ["hello"];
    popup.hidden = false;
    // No observer delivery: the acceptance path must still refuse the edit.
    expect(session.acceptSuggestion?.("hello")).toBe(false);
    expect(input.value).toBe("hel");
    expect(entry.suggestions).toEqual([]);
    expect(input.getAttribute("data-suggestion")).toBe("true");
    runtime.fulfillPrediction({
      suggestionId: entry.id,
      requestId,
      predictions: ["hello"],
      text: "hel",
      nextChar: "",
      lang: "en_US",
      tabId: 1,
      frameId: 0,
    });
    expect(entry.suggestions).toEqual([]);
    const schedule = jest.spyOn(internals.predictionCoordinator, "schedule");
    input.value = "website choice";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(schedule).not.toHaveBeenCalled();
    popup.remove();
    runtime.removeHelpersNotInDocument();
    expect(session.allowsAutomaticEdit?.({ deleteBackwards: 6, replacement: "Choice" })).toBe(
      false,
    );
    expect(schedule).not.toHaveBeenCalled();
    input.value += " h";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(schedule).toHaveBeenCalled();
    runtime.detachAllHelpers();
  });

  test.each([
    '<input list="missing">',
    '<input list="choices"><datalist id="choices"></datalist>',
    '<input aria-autocomplete="list">',
  ])("keeps FluentTyper arrow navigation with unusable autocomplete metadata: %s", (html) => {
    const runtime = makeRuntime();
    document.body.innerHTML = html;
    const input = document.querySelector("input")!;
    runtime.queryAndAttachHelper();
    input.focus();
    const entry = entryFor(runtime, input);
    entry.suggestions = ["hello", "help"];
    entry.selectedIndex = 0;
    entry.menu.style.display = "block";
    const arrow = new window.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
    expect(entry.selectedIndex).toBe(1);
    expect(entry.suggestions).toEqual(["hello", "help"]);
    expect(entry.menu.style.display).toBe("block");
    runtime.detachAllHelpers();
  });

  test("search keeps Space and widget opening arrows native while explicit acceptance works", () => {
    const runtime = makeRuntime();
    document.body.innerHTML = '<input type="search" role="combobox" aria-autocomplete="list">';
    const input = document.querySelector("input")!;
    runtime.queryAndAttachHelper();
    input.focus();
    input.value = "hel";
    input.setSelectionRange(3, 3);
    const entry = entryFor(runtime, input);
    entry.suggestions = ["hello"];
    const space = new window.KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    expect(input.value).toBe("hel");
    const arrow = new window.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(getAttachedSession(runtime, entry.id).acceptSuggestion?.("hello")).toBe(true);
    expect(input.value).toContain("hello");
    runtime.detachAllHelpers();
  });

  test.each(["ArrowUp", "ArrowDown", "Escape"])(
    "manually activated datalist dismisses suggestions before yielding %s",
    (key) => {
      const runtime = makeRuntime();
      document.body.innerHTML =
        '<input list="choices"><datalist id="choices"><option value="hello"></option></datalist>';
      const input = document.querySelector("input")!;
      runtime.queryAndAttachHelper();
      clickManualAttachButton(getManualAttachButton()!);
      const entry = entryFor(runtime, input);
      entry.suggestions = ["hello"];
      entry.menu.style.display = "block";
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(entry.suggestions).toEqual([]);
      expect(entry.menu.style.display).toBe("none");
      expect(document.activeElement).toBe(input);
      runtime.detachAllHelpers();
    },
  );

  test("manual activation cannot bypass dynamic credential protection", () => {
    const runtime = makeRuntime();
    document.body.innerHTML = '<input autocomplete="email">';
    const input = document.querySelector("input")!;
    runtime.queryAndAttachHelper();
    clickManualAttachButton(getManualAttachButton()!);
    const entry = entryFor(runtime, input);
    input.setAttribute("autocomplete", "one-time-code");
    input.value = "123";
    expect(getAttachedSession(runtime, entry.id).acceptSuggestion?.("1234")).toBe(false);
    expect(entry.lastBeforeCursorText).toBeNull();
    runtime.removeHelpersNotInDocument();
    expect(input.hasAttribute("data-suggestion")).toBe(false);
    expect(getManualAttachButton()).toBeNull();
    runtime.detachAllHelpers();
  });

  test("remembered choices restore replacement fields but refuse duplicate anchors", async () => {
    const { fieldSignatureSource, hashFieldSignature } =
      await import("../src/adapters/chrome/content-script/suggestions/FieldSignature");
    document.body.innerHTML = '<input id="recipient" autocomplete="email">';
    let input = document.querySelector("input")!;
    const signature = await hashFieldSignature(fieldSignatureSource(input)!);
    const runtime = makeRuntime("input", { loadFieldPreferences: async () => [signature] });
    // Flush WebCrypto completion using its own promise rather than a timer.
    for (let i = 0; i < 10 && !input.hasAttribute("data-suggestion"); i++)
      await hashFieldSignature("flush");
    expect(input.getAttribute("data-suggestion")).toBe("true");
    input.outerHTML = '<input id="recipient" autocomplete="email">';
    input = document.querySelector("input")!;
    runtime.removeHelpersNotInDocument();
    runtime.queryAndAttachHelper();
    for (let i = 0; i < 10 && !input.hasAttribute("data-suggestion"); i++)
      await hashFieldSignature("flush");
    expect(input.getAttribute("data-suggestion")).toBe("true");
    document.body.append(input.cloneNode());
    runtime.removeHelpersNotInDocument();
    runtime.queryAndAttachHelper();
    expect(input.hasAttribute("data-suggestion")).toBe(false);
    runtime.detachAllHelpers();
  });
  describe("input type eligibility", () => {
    test.each(["text", "search"])('attaches to input[type="%s"]', (type: string) => {
      const runtime = makeRuntime();
      const input = document.createElement("input");
      input.type = type;
      document.body.appendChild(input);
      runtime.queryAndAttachHelper();
      expect(input.getAttribute("data-suggestion")).toBe("true");
    });

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
      list.innerHTML = '<option value="Paris"></option>';
      list.id = "cities";
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("list", "cities");
      document.body.append(list, input);

      runtime.queryAndAttachHelper();

      expect(input.hasAttribute("data-suggestion")).toBe(false);
      const button = getManualAttachButton(input.parentElement ?? document);
      expect(button).not.toBeNull();
      expect(button?.title).toContain("Enable writing assistance here");
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

    test.each([true, false])(
      "excludes formatting toolbar controls even with preferNativeAutocomplete=%s",
      (preferNativeAutocomplete) => {
        const runtime = makeRuntime(undefined, { preferNativeAutocomplete });
        document.body.innerHTML =
          '<div role="toolbar"><input role="combobox" aria-label="Font name" value="Aptos"><input role="combobox" aria-label="Font size" value="12"></div><div id="FontFormattingGroup"><input role="combobox" aria-label="Font Name"></div><textarea></textarea>';
        const toolbar = document.querySelector<HTMLElement>('[role="toolbar"]')!;
        runtime.queryAndAttachHelper();
        expect(getManualAttachButton(toolbar)).toBeNull();
        expect(getManualAttachButton(document.getElementById("FontFormattingGroup")!)).toBeNull();
        for (const input of document.querySelectorAll("input")) {
          expect(input.hasAttribute("data-suggestion")).toBe(false);
          expect(input.style.paddingInlineEnd).toBe("");
          expect(input.style.paddingRight).toBe("");
        }
        expect(document.querySelector("textarea")?.getAttribute("data-suggestion")).toBe("true");
      },
    );

    test("removes a manual activation icon when a field becomes a toolbar control", () => {
      const runtime = makeRuntime();
      document.body.innerHTML = '<div><input role="combobox" autocomplete="street-address"></div>';
      const wrapper = document.body.firstElementChild!;
      const input = wrapper.firstElementChild as HTMLInputElement;
      runtime.queryAndAttachHelper();
      expect(getManualAttachButton(wrapper)).not.toBeNull();
      wrapper.setAttribute("role", "toolbar");
      runtime.removeHelpersNotInDocument();
      expect(getManualAttachButton(wrapper)).toBeNull();
      expect(input.style.paddingRight).toBe("");
      expect(input.hasAttribute("data-suggestion")).toBe(false);
    });

    test("shows a manual attach icon for structured combobox fields", () => {
      const runtime = makeRuntime();
      const list = document.createElement("div");
      list.id = "cities";
      list.setAttribute("role", "listbox");
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("role", "combobox");
      input.setAttribute("autocomplete", "street-address");
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-controls", "cities");
      document.body.append(list, input);

      runtime.queryAndAttachHelper();

      expect(input.hasAttribute("data-suggestion")).toBe(false);
      expect(getManualAttachButton(input.parentElement ?? document)).not.toBeNull();
    });

    test("shows a manual attach icon for structured contenteditable fields inside composite editors", () => {
      const runtime = makeRuntime();
      const shell = document.createElement("div");
      const leftActions = document.createElement("div");
      const editorShell = document.createElement("div");
      const editable = createEditor("");
      const placeholder = document.createElement("div");
      const rightActions = document.createElement("div");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("autocomplete", "street-address");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      placeholder.setAttribute("aria-hidden", "true");
      editorShell.append(editable, placeholder);
      shell.append(leftActions, editorShell, rightActions);
      document.body.append(shell, list);
      mockRect(shell, 10, 20, 360, 52);
      mockRect(leftActions, 18, 30, 56, 28);
      mockRect(editorShell, 86, 24, 190, 40);
      mockRect(editable, 94, 30, 150, 28);
      mockRect(rightActions, 236, 28, 32, 32);

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
      const editable = createEditor("");
      const rightActions = document.createElement("div");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("autocomplete", "street-address");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      shell.append(editorShell, rightActions);
      editorShell.appendChild(editable);
      document.body.append(shell, list);
      mockRect(shell, 10, 20, 320, 52);
      mockRect(editorShell, 86, 24, 190, 40);
      mockRect(editable, 94, 30, 150, 28);
      mockRect(rightActions, 280, 28, 0, 0);

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(editorShell);
      expect(container?.style.left).toBe("132px");

      mockRect(rightActions, 236, 28, 32, 32);
      runtime.removeHelpersNotInDocument();

      expect(container?.style.left).toBe("124px");
    });

    test("avoids same-wrapper inline-end controls for contenteditable manual attach placement", () => {
      const runtime = makeRuntime();
      const shell = document.createElement("div");
      const editorShell = document.createElement("div");
      const editable = createEditor("");
      const placeholder = document.createElement("div");
      const inlineAction = document.createElement("button");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("autocomplete", "street-address");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      placeholder.setAttribute("aria-hidden", "true");
      inlineAction.type = "button";
      editorShell.append(editable, placeholder, inlineAction);
      shell.appendChild(editorShell);
      document.body.append(shell, list);
      mockRect(shell, 10, 20, 260, 52);
      mockRect(editorShell, 86, 24, 150, 40);
      mockRect(editable, 94, 30, 140, 28);
      mockRect(placeholder, 94, 30, 140, 20);
      mockRect(inlineAction, 220, 28, 16, 24);

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
      const editable = createEditor("");
      const decorationLayer = document.createElement("div");
      const decorationIcon = document.createElement("span");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("autocomplete", "street-address");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      decorationLayer.appendChild(decorationIcon);
      editorShell.append(editable, decorationLayer);
      shell.appendChild(editorShell);
      document.body.append(shell, list);
      mockRect(shell, 10, 20, 260, 52);
      mockRect(editorShell, 86, 24, 150, 40);
      mockRect(editable, 94, 30, 150, 28);
      mockRect(decorationLayer, 214, 26, 18, 28);
      mockRect(decorationIcon, 214, 30, 14, 14);

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(editorShell);
      expect(container).not.toBeNull();
      expect(container?.style.left).toBe("132px");
    });

    test("uses a high-contrast dark surface treatment for manual attach icon", () => {
      const runtime = makeRuntime();
      const shell = document.createElement("div");
      const editorShell = document.createElement("div");
      const editable = createEditor("");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      shell.style.backgroundColor = "rgb(29, 28, 29)";
      editorShell.style.backgroundColor = "rgb(29, 28, 29)";
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("autocomplete", "street-address");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      editorShell.appendChild(editable);
      shell.appendChild(editorShell);
      document.body.append(shell, list);
      mockRect(shell, 10, 20, 260, 52);
      mockRect(editorShell, 86, 24, 150, 40);
      mockRect(editable, 94, 30, 150, 28);

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
      const editable = createEditor("");
      const lowerRowAction = document.createElement("button");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      editable.tabIndex = 0;
      editable.setAttribute("role", "combobox");
      editable.setAttribute("autocomplete", "street-address");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      lowerRowAction.type = "button";
      shell.append(editorShell, lowerRowAction);
      editorShell.appendChild(editable);
      document.body.append(shell, list);
      mockRect(shell, 10, 20, 320, 96);
      mockRect(editorShell, 86, 24, 190, 40);
      mockRect(editable, 94, 30, 150, 28);
      mockRect(lowerRowAction, 236, 76, 32, 24);

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(editorShell);
      expect(container).not.toBeNull();
      expect(container?.style.left).toBe("132px");
    });

    test("positions the manual attach icon on inline-end for rtl inputs", () => {
      const runtime = makeRuntime();
      const parent = document.createElement("div");
      const list = document.createElement("datalist");
      list.innerHTML = '<option value="Paris"></option>';
      list.id = "cities";
      const input = document.createElement("input");
      input.type = "text";
      input.dir = "rtl";
      input.setAttribute("list", "cities");
      parent.append(input);
      document.body.append(list, parent);
      mockRect(parent, 10, 20, 220, 80);
      mockRect(input, 30, 40, 100, 50);

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
      textarea.setAttribute("autocomplete", "street-address");
      textarea.setAttribute("aria-expanded", "true");
      textarea.setAttribute("aria-controls", "cities");
      parent.append(textarea);
      document.body.append(list, parent);
      mockRect(parent, 12, 18, 260, 160);
      mockRect(textarea, 32, 44, 120, 80);

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
        list.innerHTML = '<option value="Paris"></option>';
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

    test("clicking the manual attach icon force-attaches a structured combobox field", () => {
      jest.useFakeTimers();
      try {
        const runtime = makeRuntime();
        const list = document.createElement("div");
        list.id = "cities";
        list.setAttribute("role", "listbox");
        const input = document.createElement("input");
        input.type = "text";
        input.setAttribute("role", "combobox");
        input.setAttribute("autocomplete", "street-address");
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

    test("clicking the manual attach icon force-attaches a structured contenteditable field", () => {
      jest.useFakeTimers();
      try {
        const runtime = makeRuntime();
        const editable = createEditor("");
        const list = document.createElement("div");
        editable.tabIndex = 0;
        editable.setAttribute("role", "combobox");
        editable.setAttribute("autocomplete", "street-address");
        editable.setAttribute("aria-expanded", "true");
        editable.setAttribute("aria-controls", "editable-list");
        list.id = "editable-list";
        list.setAttribute("role", "listbox");
        document.body.append(list);

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
      list.innerHTML = '<option value="Paris"></option>';
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
      list.innerHTML = '<option value="Paris"></option>';
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
      const runtime = makeRuntime("input", { preferNativeAutocomplete: false });
      const list = document.createElement("datalist");
      list.innerHTML = '<option value="Paris"></option>';
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
      const editable = createEditor("");
      editable.setAttribute("role", "textbox");
      editable.setAttribute("aria-autocomplete", "list");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      editable.setAttribute("data-lexical-editor", "true");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      document.body.append(list);

      runtime.queryAndAttachHelper();

      expect(editable.getAttribute("data-suggestion")).toBe("true");
      expect(getManualAttachButton(document)).toBeNull();
    });

    test("removes the manual attach icon when a conflicting field becomes readonly", () => {
      const runtime = makeRuntime();
      const list = document.createElement("datalist");
      list.innerHTML = '<option value="Paris"></option>';
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
    });

    test("onShadowRootDiscovered callback is invoked for each open shadow root", () => {
      const discovered: ShadowRoot[] = [];
      const runtimeWithHook = makeRuntime(undefined, {
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
      list.innerHTML = '<option value="Paris"></option>';
      list.id = "cities";
      const shadowInput = document.createElement("input");
      shadowInput.type = "text";
      shadowInput.setAttribute("list", "cities");
      shadow.append(list, shadowInput);

      runtime.queryAndAttachHelper();

      expect(getManualAttachButton(shadow)).not.toBeNull();
      expect(getManualAttachButton(host)).toBeNull();
    });

    test("positions the shadow-hosted manual attach icon in viewport coordinates", () => {
      const runtime = makeRuntime();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const list = document.createElement("datalist");
      list.innerHTML = '<option value="Paris"></option>';
      list.id = "cities";
      const shadowInput = document.createElement("input");
      shadowInput.type = "text";
      shadowInput.setAttribute("list", "cities");
      shadow.append(list, shadowInput);
      mockRect(host, 500, 500, 10, 10);
      mockRect(shadowInput, 100, 50, 200, 30);

      runtime.queryAndAttachHelper();

      const container = getManualAttachContainer(shadow);
      expect(container?.style.position).toBe("fixed");
      expect(container?.style.left).toBe("274px");
      expect(container?.style.top).toBe("56px");
    });

    test("uses dark surface styling for a shadow-hosted conflicting field on a dark host", () => {
      const runtime = makeRuntime();
      const host = document.createElement("div");
      host.style.backgroundColor = "rgb(29, 28, 29)";
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const list = document.createElement("datalist");
      list.innerHTML = '<option value="Paris"></option>';
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
      list.innerHTML = '<option value="Paris"></option>';
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
