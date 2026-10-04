import { beforeEach, afterEach, describe, expect, jest, test } from "bun:test";
import type {
  ContentScriptPredictRequestContext,
  PredictResponseContext,
} from "../src/core/domain/messageTypes";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { SuggestionManagerRuntime } from "../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime";
import { createEditor, setCaret, setCaretAtTextOffset } from "./codeContextTestUtils";
import {
  createRuntimeOptions,
  menuFor,
  querySuggestionMenuItemByIndex,
  querySuggestionMenuItems,
} from "./suggestionTestUtils";

const activeManagers: SuggestionManagerRuntime[] = [];

async function waitForNextCall(
  mock: jest.Mock<(context: ContentScriptPredictRequestContext) => void>,
  { timeout = 2000 }: { timeout?: number } = {},
): Promise<ContentScriptPredictRequestContext> {
  const baseline = mock.mock.calls.length;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (mock.mock.calls.length > baseline) {
      const last = mock.mock.calls.at(-1)?.[0];
      if (last) {
        return last;
      }
    }
    await Bun.sleep(5);
  }
  throw new Error(`Expected getPrediction to be called within ${timeout}ms`);
}

async function waitFor(
  condition: () => boolean,
  { timeout = 2000 }: { timeout?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await Bun.sleep(5);
  }
  throw new Error(`Condition was not met within ${timeout}ms`);
}

function withFakeTimers(fn: () => void, ms: number): void {
  jest.useFakeTimers();
  try {
    fn();
    jest.advanceTimersByTime(ms);
  } finally {
    jest.useRealTimers();
  }
}

function dispatchKeydown(
  target: HTMLElement,
  key: string,
  options: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean } = {},
): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchInput(
  target: HTMLElement,
  options: { isComposing?: boolean; inputType?: string } = {},
): void {
  target.dispatchEvent(
    new window.InputEvent("input", { bubbles: true, cancelable: true, ...options }),
  );
}

function dispatchBeforeInput(target: HTMLElement, inputType: string): InputEvent {
  const event = new window.InputEvent("beforeinput", {
    inputType,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function queryMenuItems(menu: Element | null | undefined): HTMLLIElement[] {
  if (!(menu instanceof HTMLElement)) {
    return [];
  }
  const root = menu.shadowRoot ?? menu;
  return Array.from(root.querySelectorAll("li[data-index]")) as HTMLLIElement[];
}

function createManager(
  overrides: Partial<ConstructorParameters<typeof SuggestionManagerRuntime>[0]> = {},
) {
  const getPrediction = jest.fn<(context: ContentScriptPredictRequestContext) => void>();
  const manager = new SuggestionManagerRuntime(
    createRuntimeOptions({
      enabledGrammarRules: ["commaPeriodSpacing"],
      getPrediction,
      ...overrides,
    }),
  );
  activeManagers.push(manager);

  return { manager, getPrediction };
}

function attachTextInput(
  manager: SuggestionManagerRuntime,
  value = "",
  start = value.length,
  end = start,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.setSelectionRange(start, end);
  document.body.appendChild(input);
  manager.queryAndAttachHelper();
  return input;
}

function buildResponse(
  request: ContentScriptPredictRequestContext,
  overrides: Partial<PredictResponseContext> = {},
): PredictResponseContext {
  return {
    text: request.text,
    nextChar: request.nextChar,
    lang: request.lang,
    tabId: 1,
    frameId: 0,
    suggestionId: request.suggestionId,
    requestId: request.requestId,
    predictions: [],
    ...overrides,
  };
}

async function typeAndCollectRequest(
  input: HTMLInputElement,
  text: string,
  getPrediction: jest.Mock<(context: ContentScriptPredictRequestContext) => void>,
): Promise<ContentScriptPredictRequestContext> {
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return waitForNextCall(getPrediction);
}

describe("SuggestionManager", () => {
  beforeEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: jest.fn(),
        lastError: undefined,
      },
    };
  });

  afterEach(() => {
    while (activeManagers.length > 0) {
      activeManagers.pop()?.detachAllHelpers();
    }
  });

  test("attaches and detaches helpers with data-suggestion marker", () => {
    const { manager } = createManager();
    const input = document.createElement("input");
    input.type = "text";
    const password = document.createElement("input");
    password.type = "password";
    document.body.appendChild(input);
    document.body.appendChild(password);

    manager.queryAndAttachHelper();

    expect(input.hasAttribute("data-suggestion")).toBe(true);
    expect(password.hasAttribute("data-suggestion")).toBe(false);
    expect(menuFor(input)).not.toBeNull();

    manager.detachAllHelpers();

    expect(input.hasAttribute("data-suggestion")).toBe(false);
    expect(menuFor(input)).toBeNull();
  });

  test("keeps helpers attached while hidden and detaches only after element removal", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager);
    expect(input.hasAttribute("data-suggestion")).toBe(true);

    input.style.display = "none";
    manager.removeHelpersNotInDocument();
    expect(input.hasAttribute("data-suggestion")).toBe(true);
    expect(menuFor(input)).not.toBeNull();

    input.style.display = "";
    input.value = "h";
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForNextCall(getPrediction);
    expect(getPrediction).toHaveBeenCalled();

    input.remove();
    manager.removeHelpersNotInDocument();
    expect(input.hasAttribute("data-suggestion")).toBe(false);
    expect(menuFor(input)).toBeNull();
  });

  test("attaches helper after hidden input becomes visible and is rescanned", () => {
    const { manager } = createManager();
    const input = document.createElement("input");
    input.type = "text";
    input.style.display = "none";
    document.body.appendChild(input);

    manager.queryAndAttachHelper();
    expect(input.hasAttribute("data-suggestion")).toBe(false);

    input.style.display = "";
    manager.queryAndAttachHelper(input);

    expect(input.hasAttribute("data-suggestion")).toBe(true);
    expect(menuFor(input)).not.toBeNull();
  });

  test("detaches helper when attached input becomes password field", () => {
    const { manager } = createManager();
    const input = attachTextInput(manager);
    expect(input.hasAttribute("data-suggestion")).toBe(true);
    expect(menuFor(input)).not.toBeNull();

    input.type = "password";
    manager.removeHelpersNotInDocument();

    expect(input.hasAttribute("data-suggestion")).toBe(false);
    expect(menuFor(input)).toBeNull();
  });

  test("Quill code prediction stays lowercase through Tab acceptance", async () => {
    const { PresageHandler } = await import("../src/adapters/chrome/background/PresageHandler");
    const { PredictionOrchestrator } =
      await import("../src/adapters/chrome/background/PredictionOrchestrator");
    const { mod } = await import("./fakeLibPresage.js");
    const original = mod.PresageCallback.predictions;
    try {
      mod.PresageCallback.predictions = ["was"];
      const handler = new PresageHandler(mod);
      handler.setConfig({
        numSuggestions: 1,
        minWordLengthToPredict: 1,
        insertSpaceAfterAutocomplete: true,
        autoCapitalize: true,
        textExpansions: [],
        prefixOnlyMode: false,
      });
      const backend = new PredictionOrchestrator(handler);
      const { manager, getPrediction } = createManager({
        enabledGrammarRules: ["capitalizeSentenceStart"],
        selectByDigit: false,
      });
      const root = createEditor('<div class="ql-code-block">what . wa</div>');
      manager.queryAndAttachHelper();
      root.focus();
      setCaretAtTextOffset(root, "what . wa".length);
      dispatchInput(root, { inputType: "insertText" });
      const request = await waitForNextCall(getPrediction);
      const result = await backend.runPrediction(
        request.text,
        request.nextChar,
        request.lang,
        { suppressAutoCapitalize: request.suppressAutoCapitalize },
        request.afterCursorTokenSuffix,
      );
      manager.fulfillPrediction(buildResponse(request, result));
      expect(
        querySuggestionMenuItems()[0]?.querySelector(".ft-suggestion-label")?.textContent?.trim(),
      ).toBe("was");
      dispatchKeydown(root, "Tab");
      expect(root.querySelector(".ql-code-block")?.textContent?.trimEnd()).toBe("what . was");
    } finally {
      mod.PresageCallback.predictions = original;
    }
  });

  test("capitalizes an accepted suggestion the way typing the word would", async () => {
    // Typing "was " capitalized while picking "was" from the menu did not:
    // acceptance finishes a word without ever reaching the keystroke path.
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const input = attachTextInput(manager);

    input.value = "w";
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    manager.fulfillPrediction(buildResponse(request, { predictions: ["was\xA0"] }));
    expect(querySuggestionMenuItems().length).toBe(1);

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("Was\xA0");
  });

  test("renders popup suggestions and accepts via Tab and click", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager);

    const request = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0", "hi\xA0"],
      }),
    );

    const menuItems = querySuggestionMenuItems();
    expect(menuItems.length).toBe(2);
    expect(menuItems[0]?.querySelector(".ft-suggestion-label")?.textContent).toBe("hello\xA0");

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("hello\xA0");

    const request2 = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request2, {
        predictions: ["hello\xA0", "hi\xA0"],
      }),
    );

    const second = querySuggestionMenuItemByIndex(1) as HTMLElement;
    const init = { bubbles: true, cancelable: true, composed: true };
    second.dispatchEvent(new window.MouseEvent("mousedown", init));
    second.dispatchEvent(new window.MouseEvent("click", init));

    expect(input.value).toBe("hi\xA0");
  });

  test("accepts inline suggestion on Tab", async () => {
    const { manager, getPrediction } = createManager({ inline_suggestion: true });
    const input = attachTextInput(manager);

    const request = await typeAndCollectRequest(input, "w", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["word\xA0"],
      }),
    );

    expect(querySuggestionMenuItems().length).toBe(0);
    const ghost = document.querySelector(".ft-suggestion-inline") as HTMLElement | null;
    expect(ghost).toBeDefined();
    expect(ghost?.textContent).toBe("ord\xA0");

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("word\xA0");
    expect(document.querySelector(".ft-suggestion-inline")).toBeNull();
  });

  test("dispatches input predictions within the reduced runtime debounce budget", () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "he");

    jest.useFakeTimers();
    try {
      dispatchInput(input, { inputType: "insertText" });

      jest.advanceTimersByTime(19);
      expect(getPrediction).toHaveBeenCalledTimes(0);

      jest.advanceTimersByTime(1);
      expect(getPrediction).toHaveBeenCalledTimes(1);
      expect(getPrediction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: "he",
          requestId: 1,
          traceId: expect.any(String),
          traceStartedAtMs: expect.any(Number),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test("clears inline suggestion on blur", async () => {
    const { manager, getPrediction } = createManager({ inline_suggestion: true });
    const input = attachTextInput(manager);

    const request = await typeAndCollectRequest(input, "w", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["word\xA0"],
      }),
    );

    expect(document.querySelector(".ft-suggestion-inline")).not.toBeNull();

    input.dispatchEvent(new Event("blur", { bubbles: true }));
    // Blur dismiss is deferred via microtask when inline suggestion is active
    await Promise.resolve();
    expect(document.querySelector(".ft-suggestion-inline")).toBeNull();
  });

  test("inline cleanup removes only extension-owned nodes", async () => {
    const { manager, getPrediction } = createManager({ inline_suggestion: true });
    const input = document.createElement("input");
    input.type = "text";
    const hostInline = document.createElement("div");
    hostInline.className = "ft-suggestion-inline";
    hostInline.textContent = "host-owned";
    document.body.appendChild(input);
    document.body.appendChild(hostInline);
    manager.queryAndAttachHelper();

    const request = await typeAndCollectRequest(input, "w", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["word\xA0"],
      }),
    );

    expect(
      document.querySelector(".ft-suggestion-inline[data-ft-suggestion-owned='true']"),
    ).not.toBeNull();

    input.dispatchEvent(new Event("blur", { bubbles: true }));
    // Blur dismiss is deferred via microtask when inline suggestion is active
    await Promise.resolve();

    expect(
      document.querySelector(".ft-suggestion-inline[data-ft-suggestion-owned='true']"),
    ).toBeNull();
    expect(document.body.contains(hostInline)).toBe(true);
    expect(hostInline.textContent).toBe("host-owned");
  });

  test("rejects stale predictions", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager);

    const req1 = await typeAndCollectRequest(input, "h", getPrediction);
    const req2 = await typeAndCollectRequest(input, "he", getPrediction);

    manager.fulfillPrediction(
      buildResponse(req1, {
        predictions: ["hello\xA0"],
      }),
    );
    expect(querySuggestionMenuItems().length).toBe(0);

    manager.fulfillPrediction(
      buildResponse(req2, {
        predictions: ["help\xA0"],
      }),
    );
    expect(querySuggestionMenuItems().length).toBe(1);
  });

  test("applies local grammar before prediction request for text inputs", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["mathOperatorSpacing"],
    });
    const input = attachTextInput(manager);

    input.value = "x=y";
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(input.value).toBe("x = y");
    await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.at(-1)?.[0]?.text).toBe("x = y");
  });

  test("applies local duplicate punctuation cleanup before prediction request gating", () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["duplicatePunctuationCollapse"],
    });
    const input = attachTextInput(manager);

    input.value = "This is awseome,, ";
    input.setSelectionRange(input.value.length, input.value.length);
    withFakeTimers(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 220);

    expect(input.value).toBe("This is awseome, ");
    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("applies local grammar to contenteditable targets before prediction", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["mathOperatorSpacing"],
    });
    const editable = createEditor("x=y");
    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }
      event.preventDefault();
      editable.textContent = inputEvent.data ?? "";
      setCaretAtTextOffset(editable, editable.textContent.length);
    });
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 3);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    expect(editable.textContent).toBe("x = y");
    await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.at(-1)?.[0]?.text).toBe("x = y");
  });

  test("skips contenteditable grammar when root-boundary selection would require full-root fallback", () => {
    const { manager } = createManager({
      enabledGrammarRules: ["englishTypoWhitelistCorrection"],
    });
    const editable = createEditor("<p>teh</p><p><br></p>");
    manager.queryAndAttachHelper();

    setCaret(editable, 1);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("teh");
    expect(paragraphs[1]?.textContent ?? "").toBe("");
  });

  test("clears stale suggestions after local grammar mutation", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["mathOperatorSpacing"],
    });
    const input = attachTextInput(manager);

    const request = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );
    expect(querySuggestionMenuItems().length).toBe(1);

    input.value = "x=y";
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(input.value).toBe("x = y");
    expect(querySuggestionMenuItems().length).toBe(0);
  });

  test("inserts a regular space before first typed char after acceptance and cancels on cursor move", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager);

    const req1 = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(req1, {
        predictions: ["hello"],
      }),
    );

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("hello");

    dispatchKeydown(input, "x");
    expect(input.value).toBe("hello x");

    const req2 = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(req2, {
        predictions: ["hello"],
      }),
    );
    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("hello");

    input.setSelectionRange(4, 4);
    dispatchKeydown(input, "ArrowLeft");
    dispatchKeydown(input, "x");
    expect(input.value).toBe("hello");
  });

  test("supports digit selection and unified undo chord", async () => {
    const { manager, getPrediction } = createManager({
      selectByDigit: true,
    });
    const input = attachTextInput(manager);

    const req = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(req, {
        predictions: ["hello\xA0", "hi\xA0"],
      }),
    );

    const menuItems = querySuggestionMenuItems();
    expect(menuItems[0]?.querySelector(".ft-suggestion-shortcut")?.textContent).toBe("1");
    expect(menuItems[1]?.querySelector(".ft-suggestion-shortcut")?.textContent).toBe("2");

    dispatchKeydown(input, "2");
    expect(input.value).toBe("hi\xA0");

    dispatchKeydown(input, "z", { ctrlKey: true });
    // Simulate browser Undo. The unit DOM does not implement native history.
    input.value = "h";
    input.setSelectionRange(input.value.length, input.value.length);
    dispatchInput(input, { inputType: "historyUndo" });
    expect(input.value).toBe("h");
  });

  test("reverts grammar auto-fix on beforeinput historyUndo without reapplying it", () => {
    const { manager } = createManager({
      enabledGrammarRules: ["mathOperatorSpacing"],
    });
    const input = attachTextInput(manager);

    input.value = "x=y";
    input.setSelectionRange(3, 3);
    dispatchInput(input, { inputType: "insertText" });

    expect(input.value).toBe("x = y");

    const undoEvent = dispatchBeforeInput(input, "historyUndo");

    expect(undoEvent.defaultPrevented).toBe(false);
    input.value = "x=y";
    input.setSelectionRange(3, 3);
    dispatchInput(input, { inputType: "historyUndo" });
    expect(input.value).toBe("x=y");
  });

  test("reverts grammar auto-fix on Ctrl+Z without reapplying it", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["mathOperatorSpacing"],
    });
    const input = attachTextInput(manager);

    input.value = "x=y";
    input.setSelectionRange(3, 3);
    dispatchInput(input, { inputType: "insertText" });

    expect(input.value).toBe("x = y");
    const initialPrediction = await waitForNextCall(getPrediction);
    expect(initialPrediction.text).toBe("x = y");

    dispatchKeydown(input, "z", { ctrlKey: true });
    // Simulate browser Undo. The unit DOM does not implement native history.
    input.value = "x=y";
    input.setSelectionRange(input.value.length, input.value.length);
    dispatchInput(input, { inputType: "historyUndo" });
    expect(input.value).toBe("x=y");
    const postUndoPrediction = await waitForNextCall(getPrediction);
    expect(postUndoPrediction.text).toBe("x=y");
  });

  test.each([
    [
      "an ordinal suffix fix",
      ["englishOrdinalSuffix", "measurementUnitFormatting"],
      "Took 1th ",
      "Took 1st ",
    ],
    [
      "a deferred month capitalization",
      ["englishProperNounCapitalization"],
      "Due may 15 ",
      "Due May 15 ",
    ],
  ])("reverts %s on Ctrl+Z without reapplying it", (_name, enabledGrammarRules, typed, fixed) => {
    const { manager } = createManager({ enabledGrammarRules });
    const input = attachTextInput(manager);

    input.value = typed;
    input.setSelectionRange(typed.length, typed.length);
    dispatchInput(input, { inputType: "insertText" });

    expect(input.value).toBe(fixed);

    dispatchKeydown(input, "z", { ctrlKey: true });
    // Simulate browser Undo. The unit DOM does not implement native history.
    input.value = typed;
    input.setSelectionRange(typed.length, typed.length);
    dispatchInput(input, { inputType: "historyUndo" });
    expect(input.value).toBe(typed);

    dispatchInput(input, { inputType: "insertText" });
    expect(input.value).toBe(typed);
  });

  test("hides popup when caret navigation leaves the current token", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager);

    const request = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = menuFor(input);
    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);

    dispatchKeydown(input, "ArrowLeft");

    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );
    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);
  });

  test("hides popup when caret position changes without an input event", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "hello");

    const request = await typeAndCollectRequest(input, input.value, getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = menuFor(input);
    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);

    input.setSelectionRange(2, 2);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));

    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);
  });

  test("hides popup when text selection appears without an input event", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "hello");

    const request = await typeAndCollectRequest(input, input.value, getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = menuFor(input);
    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);

    input.setSelectionRange(1, 4);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));

    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);
  });

  test("marks delete inputAction when backspace removes post-punctuation space", async () => {
    const { manager, getPrediction } = createManager({
      minWordLengthToPredict: 0,
    });
    const input = attachTextInput(manager, "Hello.\xA0");

    dispatchKeydown(input, "Backspace");
    input.value = "Hello.";
    input.setSelectionRange(input.value.length, input.value.length);
    dispatchInput(input, { inputType: "deleteContentBackward" });

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("Hello.");
    expect(request.inputAction).toBe("delete");
  });

  test("infers delete inputAction from text shrink when key/inputType metadata is unavailable", async () => {
    const { manager, getPrediction } = createManager({
      minWordLengthToPredict: 0,
    });
    const input = attachTextInput(manager);

    input.value = "Hello.\xA0";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForNextCall(getPrediction);

    getPrediction.mockClear();

    input.value = "Hello.";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("Hello.");
    expect(request.inputAction).toBe("delete");
  });

  test("avoids double space when accepted suggestion already ends with space", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "funconality next", 4);

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["functionality "],
      }),
    );

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("functionality next");
  });

  test("does not inject delayed space after accept when insertSpaceAfterAutocomplete is disabled", async () => {
    const { manager, getPrediction } = createManager({
      insertSpaceAfterAutocomplete: false,
    });
    const input = attachTextInput(manager, "Cra");

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["Crab"],
      }),
    );

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("Crab");

    const keydownEvent = dispatchKeydown(input, "s");
    expect(keydownEvent.defaultPrevented).toBe(false);

    input.value = `${input.value}s`;
    input.setSelectionRange(input.value.length, input.value.length);
    dispatchInput(input, { inputType: "insertText" });

    expect(input.value).toBe("Crabs");
  });

  test("keeps delayed space insertion after accept when insertSpaceAfterAutocomplete is enabled", async () => {
    const { manager, getPrediction } = createManager({
      insertSpaceAfterAutocomplete: true,
    });
    const input = attachTextInput(manager, "Cra");

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["Crab"],
      }),
    );

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("Crab");

    const keydownEvent = dispatchKeydown(input, "s");
    expect(keydownEvent.defaultPrevented).toBe(true);
    expect(input.value).toBe("Crab s");
  });

  test("preserves opening smart quote prefix when accepting suggestion", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "This is \u201Cawesom");

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["awesome"],
      }),
    );

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("This is \u201Cawesome");
  });

  test("preserves em dash prefix when accepting suggestion", async () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "alpha\u2014awesom");

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["awesome"],
      }),
    );

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("alpha\u2014awesome");
  });

  test("replaces full token for contenteditable when cursor is in the middle of a word", async () => {
    const { manager, getPrediction } = createManager({ inline_suggestion: true });
    const editable = createEditor("funconality next");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 4);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["functionality "],
      }),
    );

    dispatchKeydown(editable, "Tab");
    expect(editable.textContent).toBe("functionality next");
  });

  test("uses active block context for contenteditable prediction at paragraph boundary", async () => {
    const { manager, getPrediction } = createManager({
      minWordLengthToPredict: 0,
    });
    const editable = createEditor("<p>hello</p><p>next</p>");
    manager.queryAndAttachHelper();

    const paragraphs = editable.querySelectorAll("p");
    const secondParagraph = paragraphs[1]!;

    setCaret(secondParagraph, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("");
    expect(request.nextChar).toBe("n");
  });

  test("sends block-local text for contenteditable with wrapper div (Lexical/Reddit)", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      '<div><p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p><p class="second" dir="auto"><span data-lexical-text="true">S</span></p></div>',
    );
    manager.queryAndAttachHelper();

    const secondP = editable.querySelector("p.second");
    const secondSpan = secondP?.querySelector("span");
    const secondText = secondSpan?.firstChild as Text;

    setCaret(secondText);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("S");
    expect(request.nextChar).toBe("");
  });

  test("sends block-local text when wrapper div mutates asynchronously after input (Reddit multiline)", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      '<div><p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p><p class="second" dir="auto"><span data-lexical-text="true"></span></p></div>',
    );
    manager.queryAndAttachHelper();

    const secondP = editable.querySelector("p.second")!;
    const secondSpan = secondP.querySelector("span")!;
    const secondText = secondSpan.appendChild(document.createTextNode(""));

    setCaret(secondP, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "s");

    // Reddit/Lexical-style ordering: input fires before the DOM update, then the
    // second paragraph text appears while the caret still points to paragraph start.
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    secondText.textContent = "S";
    setCaret(secondP, 0);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("S");
    expect(request.nextChar).toBe("");
  });

  test("keeps second-line prediction block-local after Enter in wrapper div (Reddit multiline flow)", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      '<div><p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p></div>',
    );
    manager.queryAndAttachHelper();

    const wrapper = editable.querySelector("div")!;
    const firstText = editable.querySelector("p.first span")?.firstChild as Text;

    setCaret(firstText);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    // Enter creates a second paragraph.
    dispatchKeydown(editable, "Enter");
    wrapper.insertAdjacentHTML(
      "beforeend",
      '<p class="second" dir="auto"><span data-lexical-text="true"></span></p>',
    );
    const secondP = editable.querySelector("p.second")!;
    const secondSpan = secondP.querySelector("span")!;
    const secondText = secondSpan.appendChild(document.createTextNode(""));
    setCaret(wrapper, 1);
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const baselineCalls = getPrediction.mock.calls.length;

    // First character on the new line arrives with Reddit/Lexical-style stale selection.
    dispatchKeydown(editable, "s");
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    secondText.textContent = "S";
    setCaret(wrapper, 1);

    const request = await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.length).toBeGreaterThan(baselineCalls);
    expect(request.text).toBe("S");
    expect(request.nextChar).toBe("");
  });

  test("restores previous-block prediction immediately after Enter in wrapper div", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      '<div><p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p></div>',
    );
    manager.queryAndAttachHelper();

    const wrapper = editable.querySelector("div")!;
    const firstText = editable.querySelector("p.first span")?.firstChild as Text;

    setCaret(firstText);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    const baselineCalls = getPrediction.mock.calls.length;

    dispatchKeydown(editable, "Enter");
    wrapper.insertAdjacentHTML(
      "beforeend",
      '<p class="second" dir="auto"><span data-lexical-text="true"></span></p>',
    );
    setCaret(wrapper, 1);
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.length).toBeGreaterThan(baselineCalls);
    expect(request.text).toBe("Wa");
    expect(request.nextChar).toBe("");
  });

  test("keeps second-line prediction block-local after Enter with root paragraphs (Reddit actual DOM)", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      '<p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p>',
    );
    manager.queryAndAttachHelper();

    const firstText = editable.querySelector("p.first span")?.firstChild as Text;

    setCaret(firstText);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    dispatchKeydown(editable, "Enter");
    editable.insertAdjacentHTML(
      "beforeend",
      '<p class="second" dir="auto"><span data-lexical-text="true"></span></p>',
    );
    const secondP = editable.querySelector("p.second")!;
    const secondSpan = secondP.querySelector("span")!;
    const secondText = secondSpan.appendChild(document.createTextNode(""));
    setCaret(editable, 1);
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const baselineCalls = getPrediction.mock.calls.length;

    dispatchKeydown(editable, "s");
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    secondText.textContent = "S";
    setCaret(editable, 1);

    const request = await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.length).toBeGreaterThan(baselineCalls);
    expect(request.text).toBe("S");
    expect(request.nextChar).toBe("");
  });

  test("keeps second-line prediction block-local after Enter with single wrapper root boundary (Facebook-style)", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      '<div class="wrapper"><div class="first" dir="auto"><span data-text="true">Wan</span></div></div>',
    );
    manager.queryAndAttachHelper();

    const wrapper = editable.querySelector(".wrapper")!;
    const firstText = editable.querySelector("div.first span")?.firstChild as Text;

    setCaret(firstText);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    dispatchKeydown(editable, "Enter");
    wrapper.insertAdjacentHTML(
      "beforeend",
      '<div class="second" dir="auto"><span data-text="true"></span></div>',
    );
    const secondDiv = editable.querySelector("div.second")!;
    const secondSpan = secondDiv.querySelector("span")!;
    const secondText = secondSpan.appendChild(document.createTextNode(""));
    setCaret(editable, 1);
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const baselineCalls = getPrediction.mock.calls.length;

    dispatchKeydown(editable, "t");
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    secondText.textContent = "t";
    setCaret(editable, 1);

    const request = await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.length).toBeGreaterThan(baselineCalls);
    expect(request.text).toBe("t");
    expect(request.nextChar).toBe("");
  });

  test("keeps second-line prediction block-local with br-separated line break in one paragraph (Facebook actual DOM)", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      '<p class="target" dir="auto"><span data-lexical-text="true">Wan</span><br><span data-lexical-text="true"></span></p>',
    );
    manager.queryAndAttachHelper();

    const secondSpan = editable.querySelectorAll("span")[1] as HTMLElement;
    const secondText = secondSpan.appendChild(document.createTextNode(""));

    setCaret(secondText, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    const baselineCalls = getPrediction.mock.calls.length;
    dispatchKeydown(editable, "t");
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    secondText.textContent = "t";
    setCaret(secondText, 1);

    const request = await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.length).toBeGreaterThan(baselineCalls);
    expect(request.text).toBe("t");
    expect(request.nextChar).toBe("");
  });

  test("restores previous-block prediction immediately after Enter with root paragraphs", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      '<p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p>',
    );
    manager.queryAndAttachHelper();

    const firstText = editable.querySelector("p.first span")?.firstChild as Text;

    setCaret(firstText);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    const baselineCalls = getPrediction.mock.calls.length;

    dispatchKeydown(editable, "Enter");
    editable.insertAdjacentHTML(
      "beforeend",
      '<p class="second" dir="auto"><span data-lexical-text="true"></span></p>',
    );
    setCaret(editable, 1);
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.length).toBeGreaterThan(baselineCalls);
    expect(request.text).toBe("Wa");
    expect(request.nextChar).toBe("");
  });

  test("keeps second-line grammar block-local after Enter with root paragraphs", async () => {
    const { manager, getPrediction } = createManager({
      minWordLengthToPredict: 0,
      enabledGrammarRules: ["autoBracketClose"],
    });
    const editable = createEditor(
      '<p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p>',
    );
    manager.queryAndAttachHelper();

    const firstText = editable.querySelector("p.first span")?.firstChild as Text;

    setCaret(firstText);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    dispatchKeydown(editable, "Enter");
    editable.insertAdjacentHTML(
      "beforeend",
      '<p class="second" dir="auto"><span data-lexical-text="true"></span></p>',
    );
    const secondP = editable.querySelector("p.second")!;
    const secondSpan = secondP.querySelector("span")!;
    const secondText = secondSpan.appendChild(document.createTextNode(""));
    setCaret(editable, 1);
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const baselineCalls = getPrediction.mock.calls.length;

    dispatchKeydown(editable, "(");
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    secondText.textContent = "(";
    setCaret(editable, 1);

    const request = await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.length).toBeGreaterThan(baselineCalls);
    expect(request.text).toBe("()");
    expect(request.nextChar).toBe("");
  });

  test("uses block-local nextChar for contenteditable prediction before a following signature block", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      'asap<div><span class="gmail_signature_prefix">-- </span><br><div class="gmail_signature">Pozdrawiam Bartek</div></div>',
    );
    manager.queryAndAttachHelper();

    setCaret(editable.firstChild as Text);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("asap");
    expect(request.nextChar).toBe("");
  });

  test("predicts on first character for contenteditable when caret lags after insert", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor("<p><br></p><p></p>");
    manager.queryAndAttachHelper();

    const secondParagraph = editable.querySelectorAll("p")[1]!;

    // Simulate editor timing where text is updated but caret offset still points
    // to paragraph start during the immediate input event.
    setCaret(secondParagraph, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "h");

    secondParagraph.textContent = "h";
    setCaret(secondParagraph, 0);

    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("h");
  });

  test("preserves surrounding rich formatting during contenteditable replacement", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor("<b>rich</b> wrld <i>next</i>");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, "rich wrld".length);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["world"],
      }),
    );

    dispatchKeydown(editable, "Tab");
    expect(editable.textContent).toBe("rich world next");
    expect(editable.querySelector("b")?.textContent).toBe("rich");
    expect(editable.querySelector("i")?.textContent).toBe("next");
  });

  test("does not reopen prediction or mutate text on a second Tab after Facebook-style acceptance", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor(
      '<div class="wrapper"><div class="first" dir="auto"><span data-text="true">wha</span></div></div>',
    );
    manager.queryAndAttachHelper();

    const firstBlock = editable.querySelector("div.first")!;
    const textNode = editable.querySelector("span")?.firstChild as Text;

    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }

      event.preventDefault();
      textNode.textContent = inputEvent.data ?? "";

      setCaret(firstBlock, 0);

      dispatchInput(editable, { inputType: "insertText" });
    });

    setCaret(textNode);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("wha");

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["what"],
      }),
    );

    const baselineCallCount = getPrediction.mock.calls.length;
    const firstTab = dispatchKeydown(editable, "Tab");
    expect(firstTab.defaultPrevented).toBe(true);
    expect(editable.textContent).toBe("what");

    await Bun.sleep(40);
    expect(getPrediction.mock.calls.length).toBe(baselineCallCount);

    const secondTab = dispatchKeydown(editable, "Tab");
    expect(secondTab.defaultPrevented).toBe(false);
    expect(editable.textContent).toBe("what");

    await Bun.sleep(40);
    expect(getPrediction.mock.calls.length).toBe(baselineCallCount);
    expect(editable.textContent).toBe("what");
  });

  test("hides contenteditable popup on outside click even without blur", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor("h");
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 1);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = menuFor(editable);
    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);

    outside.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));

    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );
    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);
  });

  test("hides contenteditable popup when clicking inside target to move caret", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor("hello world");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 1);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = menuFor(editable);
    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);

    editable.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);
  });

  test("ignores stale contenteditable response after backspace clears below threshold", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("Y");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 1);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const firstRequest = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["You "],
      }),
    );

    const menu = menuFor(editable);
    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);

    editable.textContent = "";
    setCaretAtTextOffset(editable, 0);
    dispatchInput(editable, { inputType: "deleteContentBackward" });
    await waitFor(() => menu?.style.display === "none");

    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["You "],
      }),
    );

    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);
  });

  test("hides contenteditable popup when delete lowers token below threshold without input event", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("Y");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 1);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const firstRequest = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["You "],
      }),
    );

    const menu = menuFor(editable);
    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);

    dispatchKeydown(editable, "Backspace");
    editable.textContent = "";
    setCaretAtTextOffset(editable, 0);
    await waitFor(() => menu?.style.display === "none");

    expect(menu?.style.display).toBe("none");
    expect(queryMenuItems(menu).length).toBe(0);
  });

  test("requests prediction for contenteditable inserts when input event is missing", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 0);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    dispatchKeydown(editable, "h");
    editable.textContent = "h";
    setCaretAtTextOffset(editable, 1);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("h");
    expect(request.inputAction).toBe("insert");
  });

  test("requests prediction for first character when contenteditable input is missing and caret stays stale", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("<p><br></p><p></p>");
    manager.queryAndAttachHelper();

    const secondParagraph = editable.querySelectorAll("p")[1]!;

    setCaret(secondParagraph, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "w");

    secondParagraph.textContent = "w";
    setCaret(secondParagraph, 0);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("w");
    expect(request.inputAction).toBe("insert");
  });

  test("applies grammar locally for contenteditable when caret stays stale", async () => {
    const { manager, getPrediction } = createManager({
      minWordLengthToPredict: 0,
      enabledGrammarRules: ["autoBracketClose"],
    });
    const editable = createEditor("<p><br></p><p></p>");
    manager.queryAndAttachHelper();

    const secondParagraph = editable.querySelectorAll("p")[1]!;

    setCaret(secondParagraph, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "(");

    secondParagraph.textContent = "(";
    setCaret(secondParagraph, 0);

    const request = await waitForNextCall(getPrediction);
    expect(editable.textContent).toBe("()");
    expect(request.text).toBe("()");
    expect(request.inputAction).toBe("insert");
  });

  test("applies grammar immediately for large contenteditable while predicting from fallback reconcile", async () => {
    const { manager, getPrediction } = createManager({
      minWordLengthToPredict: 0,
      enabledGrammarRules: ["autoBracketClose"],
    });
    const editable = createEditor(`<p>${"a".repeat(25_000)}</p><p></p>`);
    manager.queryAndAttachHelper();

    const secondParagraph = editable.querySelectorAll("p")[1]!;

    setCaret(secondParagraph, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "(");

    secondParagraph.textContent = "(";
    setCaret(secondParagraph, 0);

    const request = await waitForNextCall(getPrediction);
    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("a".repeat(25_000));
    expect(paragraphs[1]?.textContent).toBe("()");
    expect(request.text).toBe("()");
    expect(request.inputAction).toBe("insert");
  });

  test("shows popup prediction after host-handled contenteditable grammar edit leaves caret stale", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["mathOperatorSpacing"],
    });
    const editable = createEditor(
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true">x=y</span></p>',
    );
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p")!;
    const lexicalTextNode = editable.querySelector("span")?.firstChild as Text;

    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }

      event.preventDefault();
      lexicalTextNode.textContent = inputEvent.data ?? "";

      // Simulate editors like Lexical that apply the text update but keep the
      // live selection anchored at the block boundary until a later reconcile.
      setCaret(paragraph, 0);
    });

    setCaret(lexicalTextNode, 3);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchInput(editable, { inputType: "insertText" });

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("x = y");

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["Word\xA0"],
      }),
    );

    const menuItems = querySuggestionMenuItems();
    expect(menuItems.length).toBe(1);
    expect(menuItems[0]?.querySelector(".ft-suggestion-label")?.textContent).toBe("Word\xA0");
  });

  test("shows popup when keydown + host capitalize + input arrive with stale caret (Reddit scenario)", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const editable = createEditor(
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true"></span></p>',
    );
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p")!;
    const lexicalSpan = editable.querySelector("span")!;
    const lexicalTextNode = lexicalSpan.appendChild(document.createTextNode(""));

    setCaret(paragraph, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    // 1. keydown fires first
    dispatchKeydown(editable, "p");

    // 2. Host (Lexical) capitalizes and updates DOM, caret stays stale
    lexicalTextNode.textContent = "P";
    setCaret(paragraph, 0);

    // 3. Host fires input event (this is what Reddit/Lexical does)
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("P");

    // 4. Verify popup actually shows when prediction is fulfilled
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["Pattern\xA0"],
      }),
    );

    const menuItems = querySuggestionMenuItems();
    expect(menuItems.length).toBe(1);
    expect(menuItems[0]?.querySelector(".ft-suggestion-label")?.textContent).toBe("Pattern\xA0");
  });

  test("shows popup when keydown + input fires before DOM mutation + stale caret (Reddit async scenario)", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor(
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true"></span></p>',
    );
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p")!;
    const lexicalSpan = editable.querySelector("span")!;
    const lexicalTextNode = lexicalSpan.appendChild(document.createTextNode(""));

    setCaret(paragraph, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    // 1. keydown fires first
    dispatchKeydown(editable, "p");

    // 2. input fires BEFORE DOM mutation (empty text still)
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    // 3. THEN host actually updates DOM with capitalized text
    lexicalTextNode.textContent = "P";
    setCaret(paragraph, 0);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("P");
    expect(request.inputAction).toBe("insert");
  });

  test("requests prediction when fallback sees capitalized text for a lowercase typed key", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor(
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true"></span></p>',
    );
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p")!;
    const lexicalSpan = editable.querySelector("span")!;
    const lexicalTextNode = lexicalSpan.appendChild(document.createTextNode(""));

    setCaret(paragraph, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "p");

    lexicalTextNode.textContent = "P";
    setCaret(paragraph, 0);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("P");
    expect(request.inputAction).toBe("insert");
  });

  test("keeps predicting from corrected text when a follow-up contenteditable input arrives with stale caret", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["mathOperatorSpacing"],
    });
    const editable = createEditor(
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true">x=y</span></p>',
    );
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p")!;
    const lexicalTextNode = editable.querySelector("span")?.firstChild as Text;

    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }

      event.preventDefault();
      lexicalTextNode.textContent = inputEvent.data ?? "";

      setCaret(paragraph, 0);
    });

    setCaret(lexicalTextNode, 3);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchInput(editable, { inputType: "insertText" });
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("x = y");
  });

  test("requests prediction when delayed contenteditable mutation arrives after insert fallback timeout", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 0);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    withFakeTimers(() => dispatchKeydown(editable, "h"), 180);
    expect(getPrediction.mock.calls.length).toBe(0);

    editable.textContent = "h";
    setCaretAtTextOffset(editable, 1);

    const request = await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.length).toBe(1);
    expect(request.text).toBe("h");
    expect(request.inputAction).toBe("insert");
  });

  test("does not request prediction when contenteditable insert is swallowed without text mutation", () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("hello");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, editable.textContent.length);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    const originalDateNow = Date.now;
    let fakeNow = originalDateNow();
    Date.now = () => fakeNow;

    try {
      withFakeTimers(() => {
        dispatchKeydown(editable, "x");
        fakeNow += 2000;
      }, 220);

      expect(getPrediction.mock.calls.length).toBe(0);
      expect(editable.textContent).toBe("hello");
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("requests prediction when contenteditable text is already mutated before keydown fallback snapshot", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("hello");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, editable.textContent.length);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    const originalDateNow = Date.now;
    let fakeNow = originalDateNow();
    Date.now = () => fakeNow;

    try {
      editable.textContent = "hellox";
      setCaretAtTextOffset(editable, editable.textContent.length);
      dispatchKeydown(editable, "x");
      fakeNow += 2000;
    } finally {
      Date.now = originalDateNow;
    }

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("hellox");
    expect(request.inputAction).toBe("insert");
  });

  test("requests prediction from direct fallback fast-path when resolved reconcile context fails", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor(
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true"></span></p>',
    );
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p")!;
    const lexicalSpan = editable.querySelector("span")!;
    const lexicalTextNode = lexicalSpan.appendChild(document.createTextNode(""));

    const runtime = manager as unknown as {
      resolveEditableCursorContext: (
        entry: unknown,
        snapshot: unknown,
        options?: { inputAction?: string; typedKey?: string | null },
      ) => { beforeCursor: string };
    };
    const originalResolveEditableCursorContext = runtime.resolveEditableCursorContext;

    let shouldThrowOnResolvedReconcile = false;
    jest
      .spyOn(runtime, "resolveEditableCursorContext")
      .mockImplementation((entry, snapshot, options) => {
        const result = originalResolveEditableCursorContext.call(runtime, entry, snapshot, options);
        const stack = new Error().stack ?? "";
        if (
          shouldThrowOnResolvedReconcile &&
          options?.inputAction === "insert" &&
          options.typedKey === "w" &&
          result.beforeCursor === "w" &&
          stack.includes("tryDispatchResolvedContentEditableFallbackReconcile") &&
          !stack.includes("resolveBeforeCursorForPrediction")
        ) {
          throw new Error("Synthetic reconcile resolution failure");
        }
        return result;
      });

    setCaret(paragraph, 0);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "w");

    lexicalTextNode.textContent = "w";
    setCaret(paragraph, 0);
    shouldThrowOnResolvedReconcile = true;

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("w");
    expect(request.inputAction).toBe("insert");
  });

  test("keeps full paragraph context for root contenteditable when boundary detection is stale", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = document.createElement("p");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "hello";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, editable.textContent.length);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    const originalIsCollapsedSelectionBeforeBlockBoundary =
      ContentEditableAdapter.prototype.isCollapsedSelectionBeforeBlockBoundary;
    ContentEditableAdapter.prototype.isCollapsedSelectionBeforeBlockBoundary = () => true;

    const originalDateNow = Date.now;
    let fakeNow = originalDateNow();
    Date.now = () => fakeNow;

    try {
      editable.textContent = "hellox";
      setCaretAtTextOffset(editable, editable.textContent.length);
      dispatchKeydown(editable, "x");
      fakeNow += 2000;
    } finally {
      ContentEditableAdapter.prototype.isCollapsedSelectionBeforeBlockBoundary =
        originalIsCollapsedSelectionBeforeBlockBoundary;
      Date.now = originalDateNow;
    }

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("hellox");
    expect(request.inputAction).toBe("insert");
  });

  test("does not request prediction on Enter in input when input event is missing", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const input = attachTextInput(manager, "hello");

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForNextCall(getPrediction);
    const baselineCalls = getPrediction.mock.calls.length;

    withFakeTimers(() => dispatchKeydown(input, "Enter"), 220);

    expect(getPrediction.mock.calls.length).toBe(baselineCalls);
  });

  test("does not request prediction on Alt+key in contenteditable without text change", () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("hello");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, editable.textContent.length);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    withFakeTimers(() => dispatchKeydown(editable, "f", { altKey: true }), 260);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction on Alt+key in input without text change", () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const input = attachTextInput(manager, "hello");

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    withFakeTimers(() => dispatchKeydown(input, "f", { altKey: true }), 260);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction during IME composition input", () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "h");

    withFakeTimers(() => dispatchInput(input, { isComposing: true }), 240);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction from fallback reconcile while IME composition is active", () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "hello");

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    withFakeTimers(() => dispatchKeydown(input, "x"), 260);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction when input selection is not collapsed", () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "hello", 1, 4);

    withFakeTimers(() => dispatchInput(input), 240);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction from fallback reconcile when selection is active", () => {
    const { manager, getPrediction } = createManager();
    const input = attachTextInput(manager, "hello", 1, 4);

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    withFakeTimers(() => dispatchKeydown(input, "x"), 260);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not apply local grammar while IME composition is active", () => {
    const { manager } = createManager({
      enabledGrammarRules: ["englishTypoWhitelistCorrection"],
    });
    const input = attachTextInput(manager);
    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));

    input.value = "teh ";
    input.setSelectionRange(input.value.length, input.value.length);
    dispatchInput(input, { isComposing: true, inputType: "insertText" });

    expect(input.value).toBe("teh ");
  });

  test("does not apply local grammar when selection is active", () => {
    const { manager } = createManager({
      enabledGrammarRules: ["englishTypoWhitelistCorrection"],
    });
    const input = attachTextInput(manager);

    input.value = "teh ";
    input.setSelectionRange(0, 2);
    dispatchInput(input, { inputType: "insertText" });

    expect(input.value).toBe("teh ");
  });

  test("keeps contenteditable popup visible on Backspace when follow-up input event updates text", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("What");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 4);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const firstRequest = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["Whatever "],
      }),
    );

    const menu = menuFor(editable);
    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);

    dispatchKeydown(editable, "Backspace");
    editable.textContent = "Wha";
    setCaretAtTextOffset(editable, 3);
    dispatchInput(editable, { inputType: "deleteContentBackward" });
    await waitFor(() => menu?.style.display === "block");

    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);
  });

  test("keeps contenteditable popup visible when delete input event arrives asynchronously", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: [],
    });
    const editable = createEditor("What");
    manager.queryAndAttachHelper();

    setCaretAtTextOffset(editable, 4);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const firstRequest = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["Whatever "],
      }),
    );

    const menu = menuFor(editable);
    expect(menu?.style.display).toBe("block");

    withFakeTimers(() => dispatchKeydown(editable, "Backspace"), 25);
    editable.textContent = "Wha";
    setCaretAtTextOffset(editable, 3);
    dispatchInput(editable, { inputType: "deleteContentBackward" });
    await waitForNextCall(getPrediction);

    expect(menu?.style.display).toBe("block");
    expect(queryMenuItems(menu).length).toBeGreaterThan(0);
  });

  test("preserves paragraph break when replacing token at end of first paragraph", async () => {
    const { manager, getPrediction } = createManager();
    const editable = createEditor("<p>h</p><p>next</p>");
    manager.queryAndAttachHelper();

    setCaret(editable.querySelector("p")!.firstChild as Text);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["he\xA0"],
      }),
    );

    dispatchKeydown(editable, "Tab");

    const paragraphs = Array.from(editable.querySelectorAll("p"));
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    const normalizedParagraphs = paragraphs
      .map((paragraph) => (paragraph.textContent ?? "").replace(/\u00a0/g, " ").trim())
      .filter(Boolean);
    expect(normalizedParagraphs).toContain("next");
    expect(normalizedParagraphs).toContain("he");
  });

  test("capitalizes the pending word on Enter before the host submits", () => {
    const { manager } = createManager({
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    manager.queryAndAttachHelper();

    textarea.value = "hello";
    textarea.setSelectionRange(5, 5);
    textarea.dispatchEvent(new Event("focus", { bubbles: true }));
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    const event = dispatchKeydown(textarea, "Enter");

    // The host still owns the key: we only slipped one grammar pass in first.
    expect(event.defaultPrevented).toBe(false);
    expect(textarea.value).toBe("Hello");
  });

  test("leaves the pending word alone on Enter while composing", () => {
    const { manager } = createManager({
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    manager.queryAndAttachHelper();

    textarea.value = "hello";
    textarea.setSelectionRange(5, 5);
    textarea.dispatchEvent(new Event("focus", { bubbles: true }));
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    dispatchKeydown(textarea, "Enter", { isComposing: true });

    expect(textarea.value).toBe("hello");
  });

  test("accepts the open suggestion on Enter and still applies the word boundary", async () => {
    const { manager, getPrediction } = createManager({
      autocompleteOnEnter: true,
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    manager.queryAndAttachHelper();

    textarea.value = "hel";
    textarea.setSelectionRange(3, 3);
    textarea.dispatchEvent(new Event("focus", { bubbles: true }));
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    manager.fulfillPrediction(buildResponse(request, { predictions: ["hello\xA0"] }));
    expect(querySuggestionMenuItems().length).toBe(1);

    const event = dispatchKeydown(textarea, "Enter");

    // Enter accepts rather than being consumed by the grammar pass, and the
    // accepted word is finished exactly as typing it would have been.
    expect(event.defaultPrevented).toBe(true);
    expect(textarea.value).toBe("Hello\xA0");
  });

  test("shows popup when a host-handled grammar edit re-dispatches input (Reddit grammar scenario)", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["mathOperatorSpacing"],
    });
    const editable = createEditor(
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true">x=y</span></p>',
    );
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p")!;
    const lexicalTextNode = editable.querySelector("span")?.firstChild as Text;

    let handledReplacements = 0;
    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }
      handledReplacements += 1;
      event.preventDefault();
      lexicalTextNode.textContent = inputEvent.data ?? "";

      // Lexical applies the text but keeps the live selection anchored at the
      // block boundary until a later reconcile.
      setCaret(paragraph, 0);

      // ...and then fires its own input event, re-entering our input handler
      // while the grammar edit is still being applied.
      editable.dispatchEvent(new Event("input", { bubbles: true }));
    });

    setCaret(lexicalTextNode, 3);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchInput(editable, { inputType: "insertText" });

    const request = await waitForNextCall(getPrediction);
    expect(handledReplacements).toBe(1);
    expect(lexicalTextNode.textContent).toBe("x = y");
    expect(request.text).toBe("x = y");

    // The host's re-entrant input must be coalesced into the edit's own
    // request, not shipped as a second one built from the stale caret.
    await Bun.sleep(60);
    expect(getPrediction).toHaveBeenCalledTimes(1);

    manager.fulfillPrediction(buildResponse(request, { predictions: ["Word\xA0"] }));

    const menuItems = querySuggestionMenuItems();
    expect(menuItems.length).toBe(1);
    expect(menuItems[0]?.querySelector(".ft-suggestion-label")?.textContent).toBe("Word\xA0");
  });

  test("shows popup when the host prevents a grammar edit without a sync DOM change (Reddit async grammar scenario)", async () => {
    const { manager, getPrediction } = createManager({
      enabledGrammarRules: ["mathOperatorSpacing"],
    });
    const editable = createEditor(
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true">x=y</span></p>',
    );
    manager.queryAndAttachHelper();

    const lexicalTextNode = editable.querySelector("span")?.firstChild as Text;

    let handledReplacements = 0;
    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }
      handledReplacements += 1;
      // Lexical claims the edit but reconciles asynchronously, so the DOM is
      // unchanged by the time our handler regains control.
      event.preventDefault();
    });

    setCaret(lexicalTextNode, 3);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchInput(editable, { inputType: "insertText" });

    const request = await waitForNextCall(getPrediction);
    expect(handledReplacements).toBe(1);
    expect(lexicalTextNode.textContent).toBe("x=y");
    // The prediction follows the edit the host accepted responsibility for,
    // not the DOM it has not reconciled yet.
    expect(request.text).toBe("x = y");

    manager.fulfillPrediction(buildResponse(request, { predictions: ["Word\xA0"] }));

    const menuItems = querySuggestionMenuItems();
    expect(menuItems.length).toBe(1);
  });
});
