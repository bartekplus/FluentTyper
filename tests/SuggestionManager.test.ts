import { beforeEach, afterEach, describe, expect, jest, test } from "bun:test";
import type {
  ContentScriptPredictRequestContext,
  PredictResponseContext,
} from "../src/core/domain/messageTypes";

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
    await new Promise<void>((r) => setTimeout(r, 5));
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
    await new Promise<void>((r) => setTimeout(r, 5));
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
  const event = new Event("keydown", { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(event, "key", { value: key });
  if (typeof options.altKey === "boolean") {
    Object.defineProperty(event, "altKey", { value: options.altKey });
  }
  if (typeof options.ctrlKey === "boolean") {
    Object.defineProperty(event, "ctrlKey", { value: options.ctrlKey });
  }
  if (typeof options.metaKey === "boolean") {
    Object.defineProperty(event, "metaKey", { value: options.metaKey });
  }
  if (typeof options.isComposing === "boolean") {
    Object.defineProperty(event, "isComposing", { value: options.isComposing });
  }
  target.dispatchEvent(event);
  return event;
}

function dispatchInput(
  target: HTMLElement,
  options: { isComposing?: boolean; inputType?: string } = {},
): void {
  const event = new Event("input", { bubbles: true, cancelable: true }) as InputEvent;
  if (typeof options.isComposing === "boolean") {
    Object.defineProperty(event, "isComposing", { value: options.isComposing });
  }
  if (typeof options.inputType === "string") {
    Object.defineProperty(event, "inputType", { value: options.inputType });
  }
  target.dispatchEvent(event);
}

function setContentEditableCursor(target: HTMLElement, offset: number): void {
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode() as Text | null;

  if (!current) {
    current = target.appendChild(document.createTextNode(""));
  }

  let remaining = Math.max(0, offset);
  let node: Text = current;
  let nodeOffset = 0;

  while (current) {
    const length = current.textContent?.length ?? 0;
    if (remaining <= length) {
      node = current;
      nodeOffset = remaining;
      break;
    }
    remaining -= length;
    node = current;
    nodeOffset = length;
    current = walker.nextNode() as Text | null;
  }

  const range = document.createRange();
  range.setStart(node, nodeOffset);
  range.collapse(true);

  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function ensureRangeRectApi(): void {
  if (typeof Range === "undefined") {
    return;
  }
  const proto = Range.prototype as unknown as {
    getBoundingClientRect?: () => DOMRect;
  };
  if (typeof proto.getBoundingClientRect === "function") {
    return;
  }

  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 16,
        width: 0,
        height: 16,
        toJSON: () => ({}),
      }) as DOMRect,
  });
}

function ensureNodeFilterApi(): void {
  if (typeof (globalThis as { NodeFilter?: unknown }).NodeFilter !== "undefined") {
    return;
  }
  (globalThis as { NodeFilter: { SHOW_TEXT: number } }).NodeFilter = {
    SHOW_TEXT: 4,
  };
}

let importNonce = 0;

async function loadSuggestionManagerClass() {
  importNonce += 1;
  const module = await import(
    `../src/adapters/chrome/content-script/SuggestionManager?bun_test_nonce_manager=${importNonce}`
  );
  return module.SuggestionManager;
}

type ConstructorArgs = {
  selectors: string;
  minWordLengthToPredict: number;
  autocomplete: boolean;
  autocompleteOnEnter: boolean;
  autocompleteOnTab: boolean;
  insertSpaceAfterAutocomplete: boolean;
  lang: string;
  selectByDigit: boolean;
  displayLangHeader: boolean;
  inline_suggestion: boolean;
  enabledGrammarRules: string[];
  userDictionaryList: string[];
  getPrediction: (context: ContentScriptPredictRequestContext) => void;
};

async function createManager(overrides: Partial<ConstructorArgs> = {}) {
  const SuggestionManager = await loadSuggestionManagerClass();
  const getPrediction = jest.fn<(context: ContentScriptPredictRequestContext) => void>();
  const manager = new SuggestionManager({
    selectors: "textarea, input, [contenteditable]",
    minWordLengthToPredict: 1,
    autocomplete: true,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    insertSpaceAfterAutocomplete: true,
    lang: "en_US",
    selectByDigit: true,
    displayLangHeader: true,
    inline_suggestion: false,
    enabledGrammarRules: ["commaPeriodSpacing"],
    userDictionaryList: [],
    getPrediction,
    ...overrides,
  });

  return { manager, getPrediction };
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
  input.selectionStart = text.length;
  input.selectionEnd = text.length;
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
    document.body.innerHTML = "";
    ensureRangeRectApi();
    ensureNodeFilterApi();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("attaches and detaches helpers with data-suggestion marker", async () => {
    const { manager } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    const password = document.createElement("input");
    password.type = "password";
    document.body.appendChild(input);
    document.body.appendChild(password);

    manager.queryAndAttachHelper();

    expect(input.hasAttribute("data-suggestion")).toBe(true);
    expect(password.hasAttribute("data-suggestion")).toBe(false);
    expect((input as HTMLInputElement & { suggestionMenu?: Element }).suggestionMenu).toBeDefined();

    manager.detachAllHelpers();

    expect(input.hasAttribute("data-suggestion")).toBe(false);
    expect(
      (input as HTMLInputElement & { suggestionMenu?: Element }).suggestionMenu,
    ).toBeUndefined();
  });

  test("keeps helpers attached while hidden and detaches only after element removal", async () => {
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    manager.queryAndAttachHelper();
    expect(input.hasAttribute("data-suggestion")).toBe(true);

    input.style.display = "none";
    manager.removeHelpersNotInDocument();
    expect(input.hasAttribute("data-suggestion")).toBe(true);
    expect((input as HTMLInputElement & { suggestionMenu?: Element }).suggestionMenu).toBeDefined();

    input.style.display = "";
    input.value = "h";
    input.selectionStart = 1;
    input.selectionEnd = 1;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForNextCall(getPrediction);
    expect(getPrediction).toHaveBeenCalled();

    input.remove();
    manager.removeHelpersNotInDocument();
    expect(input.hasAttribute("data-suggestion")).toBe(false);
    expect(
      (input as HTMLInputElement & { suggestionMenu?: Element }).suggestionMenu,
    ).toBeUndefined();
  });

  test("attaches helper after hidden input becomes visible and is rescanned", async () => {
    const { manager } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    input.style.display = "none";
    document.body.appendChild(input);

    manager.queryAndAttachHelper();
    expect(input.hasAttribute("data-suggestion")).toBe(false);

    input.style.display = "";
    manager.queryAndAttachHelper(input);

    expect(input.hasAttribute("data-suggestion")).toBe(true);
    expect((input as HTMLInputElement & { suggestionMenu?: Element }).suggestionMenu).toBeDefined();
  });

  test("detaches helper when attached input becomes password field", async () => {
    const { manager } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    manager.queryAndAttachHelper();
    expect(input.hasAttribute("data-suggestion")).toBe(true);
    expect((input as HTMLInputElement & { suggestionMenu?: Element }).suggestionMenu).toBeDefined();

    input.type = "password";
    manager.removeHelpersNotInDocument();

    expect(input.hasAttribute("data-suggestion")).toBe(false);
    expect(
      (input as HTMLInputElement & { suggestionMenu?: Element }).suggestionMenu,
    ).toBeUndefined();
  });

  test("renders popup suggestions and accepts via Tab and click", async () => {
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    const request = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0", "hi\xA0"],
      }),
    );

    const menuItems = Array.from(document.querySelectorAll(".ft-suggestion-container li"));
    expect(menuItems.length).toBe(2);
    expect(menuItems[0]?.textContent).toBe("hello\xA0");

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("hello\xA0");

    const request2 = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request2, {
        predictions: ["hello\xA0", "hi\xA0"],
      }),
    );

    const second = document.querySelector(
      ".ft-suggestion-container li[data-index='1']",
    ) as HTMLElement;
    second.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
    second.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(input.value).toBe("hi\xA0");
  });

  test("accepts inline suggestion on Tab", async () => {
    const { manager, getPrediction } = await createManager({ inline_suggestion: true });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    const request = await typeAndCollectRequest(input, "w", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["word\xA0"],
      }),
    );

    expect(document.querySelectorAll(".ft-suggestion-container li").length).toBe(0);
    const ghost = document.querySelector(".ft-suggestion-inline") as HTMLElement | null;
    expect(ghost).toBeDefined();
    expect(ghost?.textContent).toBe("ord\xA0");

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("word\xA0");
    expect(document.querySelector(".ft-suggestion-inline")).toBeNull();
  });

  test("clears inline suggestion on blur", async () => {
    const { manager, getPrediction } = await createManager({ inline_suggestion: true });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    const request = await typeAndCollectRequest(input, "w", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["word\xA0"],
      }),
    );

    expect(document.querySelector(".ft-suggestion-inline")).not.toBeNull();

    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(document.querySelector(".ft-suggestion-inline")).toBeNull();
  });

  test("inline cleanup removes only extension-owned nodes", async () => {
    const { manager, getPrediction } = await createManager({ inline_suggestion: true });
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

    expect(
      document.querySelector(".ft-suggestion-inline[data-ft-suggestion-owned='true']"),
    ).toBeNull();
    expect(document.body.contains(hostInline)).toBe(true);
    expect(hostInline.textContent).toBe("host-owned");
  });

  test("rejects stale predictions", async () => {
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    const req1 = await typeAndCollectRequest(input, "h", getPrediction);
    const req2 = await typeAndCollectRequest(input, "he", getPrediction);

    manager.fulfillPrediction(
      buildResponse(req1, {
        predictions: ["hello\xA0"],
      }),
    );
    expect(document.querySelectorAll(".ft-suggestion-container li").length).toBe(0);

    manager.fulfillPrediction(
      buildResponse(req2, {
        predictions: ["help\xA0"],
      }),
    );
    expect(document.querySelectorAll(".ft-suggestion-container li").length).toBe(1);
  });

  test("applies local capitalization before prediction request for text inputs", async () => {
    const { manager, getPrediction } = await createManager({
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    input.value = "a";
    input.selectionStart = 1;
    input.selectionEnd = 1;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(input.value).toBe("A");
    await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.at(-1)?.[0]?.text).toBe("A");
  });

  test("applies local duplicate punctuation cleanup before prediction request gating", async () => {
    const { manager, getPrediction } = await createManager({
      enabledGrammarRules: ["duplicatePunctuationCollapse"],
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    input.value = "This is awseome,, ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    withFakeTimers(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 220);

    expect(input.value).toBe("This is awseome, ");
    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("applies local grammar to contenteditable targets before prediction", async () => {
    const { manager, getPrediction } = await createManager({
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "w";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }
      event.preventDefault();
      editable.textContent = `${(editable.textContent ?? "").slice(0, -1)}${inputEvent.data ?? ""}`;
      setContentEditableCursor(editable, editable.textContent.length);
    });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 1);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    expect(editable.textContent).toBe("W");
    await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.at(-1)?.[0]?.text).toBe("W");
  });

  test("skips contenteditable grammar when root-boundary selection would require full-root fallback", async () => {
    const { manager } = await createManager({
      enabledGrammarRules: ["englishTypoWhitelistCorrection"],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>teh</p><p><br></p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    const range = document.createRange();
    range.setStart(editable, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("teh");
    expect(paragraphs[1]?.textContent ?? "").toBe("");
  });

  test("clears stale suggestions after local grammar mutation", async () => {
    const { manager, getPrediction } = await createManager({
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    const request = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );
    expect(document.querySelectorAll(".ft-suggestion-container li").length).toBe(1);

    input.value = "a";
    input.selectionStart = 1;
    input.selectionEnd = 1;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(input.value).toBe("A");
    expect(document.querySelectorAll(".ft-suggestion-container li").length).toBe(0);
  });

  test("inserts a regular space before first typed char after acceptance and cancels on cursor move", async () => {
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

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

    input.selectionStart = 4;
    input.selectionEnd = 4;
    dispatchKeydown(input, "ArrowLeft");
    dispatchKeydown(input, "x");
    expect(input.value).toBe("hello");
  });

  test("supports digit selection and unified undo chord", async () => {
    const { manager, getPrediction } = await createManager({
      selectByDigit: true,
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    const req = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(req, {
        predictions: ["hello\xA0", "hi\xA0"],
      }),
    );

    dispatchKeydown(input, "2");
    expect(input.value).toBe("hi\xA0");

    dispatchKeydown(input, "z", { ctrlKey: true });
    expect(input.value).toBe("h");
  });

  test("hides popup when caret navigation leaves the current token", async () => {
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    const request = await typeAndCollectRequest(input, "h", getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = (input as HTMLInputElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);

    dispatchKeydown(input, "ArrowLeft");

    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );
    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);
  });

  test("hides popup when caret position changes without an input event", async () => {
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    const request = await typeAndCollectRequest(input, input.value, getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = (input as HTMLInputElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);

    input.selectionStart = 2;
    input.selectionEnd = 2;
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));

    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);
  });

  test("hides popup when text selection appears without an input event", async () => {
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    const request = await typeAndCollectRequest(input, input.value, getPrediction);
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = (input as HTMLInputElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);

    input.selectionStart = 1;
    input.selectionEnd = 4;
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));

    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);
  });

  test("marks delete inputAction when backspace removes post-punctuation space", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 0,
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Hello.\xA0";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    dispatchKeydown(input, "Backspace");
    input.value = "Hello.";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const deleteInputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(deleteInputEvent, "inputType", {
      value: "deleteContentBackward",
      configurable: true,
    });
    input.dispatchEvent(deleteInputEvent);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("Hello.");
    expect(request.inputAction).toBe("delete");
  });

  test("infers delete inputAction from text shrink when key/inputType metadata is unavailable", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 0,
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    input.value = "Hello.\xA0";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForNextCall(getPrediction);

    getPrediction.mockClear();

    input.value = "Hello.";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("Hello.");
    expect(request.inputAction).toBe("delete");
  });

  test("avoids double space when accepted suggestion already ends with space", async () => {
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    input.value = "funconality next";
    input.selectionStart = 4;
    input.selectionEnd = 4;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

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
    const { manager, getPrediction } = await createManager({
      insertSpaceAfterAutocomplete: false,
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Cra";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

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
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    dispatchInput(input, { inputType: "insertText" });

    expect(input.value).toBe("Crabs");
  });

  test("keeps delayed space insertion after accept when insertSpaceAfterAutocomplete is enabled", async () => {
    const { manager, getPrediction } = await createManager({
      insertSpaceAfterAutocomplete: true,
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Cra";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

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
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    input.value = "This is \u201Cawesom";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

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
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    input.value = "alpha\u2014awesom";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

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
    const { manager, getPrediction } = await createManager({ inline_suggestion: true });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "funconality next";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 4);
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
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 0,
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>hello</p><p>next</p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const paragraphs = editable.querySelectorAll("p");
    const secondParagraph = paragraphs[1];
    if (!secondParagraph) {
      throw new Error("Expected second paragraph");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    const range = document.createRange();
    range.setStart(secondParagraph, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("");
    expect(request.nextChar).toBe("n");
  });

  test("uses block-local nextChar for contenteditable prediction before a following signature block", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      'asap<div><span class="gmail_signature_prefix">-- </span><br><div class="gmail_signature">Pozdrawiam Bartek</div></div>';
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    const range = document.createRange();
    const textNode = editable.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error("Expected leading text node");
    }
    range.setStart(textNode, textNode.textContent?.length ?? 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("asap");
    expect(request.nextChar).toBe("");
  });

  test("predicts on first character for contenteditable when caret lags after insert", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p><br></p><p></p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const secondParagraph = editable.querySelectorAll("p")[1];
    if (!secondParagraph) {
      throw new Error("Expected second paragraph");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }

    // Simulate editor timing where text is updated but caret offset still points
    // to paragraph start during the immediate input event.
    const preInsertRange = document.createRange();
    preInsertRange.setStart(secondParagraph, 0);
    preInsertRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(preInsertRange);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "h");

    secondParagraph.textContent = "h";
    const staleCaretRange = document.createRange();
    staleCaretRange.setStart(secondParagraph, 0);
    staleCaretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(staleCaretRange);

    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("h");
  });

  test("preserves surrounding rich formatting during contenteditable replacement", async () => {
    const { manager, getPrediction } = await createManager();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<b>rich</b> wrld <i>next</i>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, "rich wrld".length);
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

  test("hides contenteditable popup on outside click even without blur", async () => {
    const { manager, getPrediction } = await createManager();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "h";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    const outside = document.createElement("div");
    document.body.appendChild(editable);
    document.body.appendChild(outside);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 1);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = (editable as HTMLElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);

    outside.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));

    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );
    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);
  });

  test("hides contenteditable popup when clicking inside target to move caret", async () => {
    const { manager, getPrediction } = await createManager();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "hello world";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 1);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["hello\xA0"],
      }),
    );

    const menu = (editable as HTMLElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);

    editable.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);
  });

  test("ignores stale contenteditable response after backspace clears below threshold", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "Y";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 1);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const firstRequest = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["You "],
      }),
    );

    const menu = (editable as HTMLElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);

    editable.textContent = "";
    setContentEditableCursor(editable, 0);
    const deleteInputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(deleteInputEvent, "inputType", {
      value: "deleteContentBackward",
    });
    editable.dispatchEvent(deleteInputEvent);
    await waitFor(() => menu?.style.display === "none");

    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["You "],
      }),
    );

    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);
  });

  test("hides contenteditable popup when delete lowers token below threshold without input event", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "Y";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 1);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const firstRequest = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["You "],
      }),
    );

    const menu = (editable as HTMLElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);

    dispatchKeydown(editable, "Backspace");
    editable.textContent = "";
    setContentEditableCursor(editable, 0);
    await waitFor(() => menu?.style.display === "none");

    expect(menu?.style.display).toBe("none");
    expect(menu?.querySelectorAll("li").length).toBe(0);
  });

  test("requests prediction for contenteditable inserts when input event is missing", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 0);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    dispatchKeydown(editable, "h");
    editable.textContent = "h";
    setContentEditableCursor(editable, 1);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("h");
    expect(request.inputAction).toBe("insert");
  });

  test("requests prediction for first character when contenteditable input is missing and caret stays stale", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p><br></p><p></p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const secondParagraph = editable.querySelectorAll("p")[1];
    if (!secondParagraph) {
      throw new Error("Expected second paragraph");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }

    const initialRange = document.createRange();
    initialRange.setStart(secondParagraph, 0);
    initialRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(initialRange);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "w");

    secondParagraph.textContent = "w";
    const staleCaretRange = document.createRange();
    staleCaretRange.setStart(secondParagraph, 0);
    staleCaretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(staleCaretRange);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("w");
    expect(request.inputAction).toBe("insert");
  });

  test("capitalizes first character locally for contenteditable when caret stays stale", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p><br></p><p></p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const secondParagraph = editable.querySelectorAll("p")[1];
    if (!secondParagraph) {
      throw new Error("Expected second paragraph");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }

    const initialRange = document.createRange();
    initialRange.setStart(secondParagraph, 0);
    initialRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(initialRange);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "w");

    secondParagraph.textContent = "w";
    const staleCaretRange = document.createRange();
    staleCaretRange.setStart(secondParagraph, 0);
    staleCaretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(staleCaretRange);

    const request = await waitForNextCall(getPrediction);
    expect(editable.textContent).toBe("W");
    expect(request.text).toBe("W");
    expect(request.inputAction).toBe("insert");
  });

  test("shows popup prediction after host-handled contenteditable capitalization leaves caret stale", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true">w</span></p>';
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p");
    const lexicalTextNode = editable.querySelector("span")?.firstChild as Text | null;
    if (!paragraph || !lexicalTextNode) {
      throw new Error("Expected Lexical-like paragraph");
    }

    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }

      event.preventDefault();
      lexicalTextNode.textContent = inputEvent.data ?? "";

      // Simulate editors like Lexical that apply the text update but keep the
      // live selection anchored at the block boundary until a later reconcile.
      const selection = window.getSelection();
      if (!selection) {
        return;
      }
      const staleRange = document.createRange();
      staleRange.setStart(paragraph, 0);
      staleRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(staleRange);
    });

    const initialRange = document.createRange();
    initialRange.setStart(lexicalTextNode, 1);
    initialRange.collapse(true);
    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    selection.removeAllRanges();
    selection.addRange(initialRange);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchInput(editable, { inputType: "insertText" });

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("W");

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["Word\xA0"],
      }),
    );

    const menuItems = Array.from(document.querySelectorAll(".ft-suggestion-container li"));
    expect(menuItems.length).toBe(1);
    expect(menuItems[0]?.textContent).toBe("Word\xA0");
  });

  test("shows popup when keydown + host capitalize + input arrive with stale caret (Reddit scenario)", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true"></span></p>';
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p");
    const lexicalSpan = editable.querySelector("span");
    if (!paragraph || !lexicalSpan) {
      throw new Error("Expected Lexical-like paragraph");
    }
    const lexicalTextNode = lexicalSpan.appendChild(document.createTextNode(""));

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    const initialRange = document.createRange();
    initialRange.setStart(paragraph, 0);
    initialRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(initialRange);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    // 1. keydown fires first
    dispatchKeydown(editable, "p");

    // 2. Host (Lexical) capitalizes and updates DOM, caret stays stale
    lexicalTextNode.textContent = "P";
    const staleRange = document.createRange();
    staleRange.setStart(paragraph, 0);
    staleRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(staleRange);

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

    const menuItems = Array.from(document.querySelectorAll(".ft-suggestion-container li"));
    expect(menuItems.length).toBe(1);
    expect(menuItems[0]?.textContent).toBe("Pattern\xA0");
  });

  test("shows popup when keydown + input fires before DOM mutation + stale caret (Reddit async scenario)", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true"></span></p>';
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p");
    const lexicalSpan = editable.querySelector("span");
    if (!paragraph || !lexicalSpan) {
      throw new Error("Expected Lexical-like paragraph");
    }
    const lexicalTextNode = lexicalSpan.appendChild(document.createTextNode(""));

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    const initialRange = document.createRange();
    initialRange.setStart(paragraph, 0);
    initialRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(initialRange);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    // 1. keydown fires first
    dispatchKeydown(editable, "p");

    // 2. input fires BEFORE DOM mutation (empty text still)
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    // 3. THEN host actually updates DOM with capitalized text
    lexicalTextNode.textContent = "P";
    const staleRange = document.createRange();
    staleRange.setStart(paragraph, 0);
    staleRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(staleRange);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("P");
    expect(request.inputAction).toBe("insert");
  });

  test("shows popup when grammar capitalize fires on Lexical and host re-dispatches input (Reddit grammar scenario)", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true"></span></p>';
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p");
    const lexicalSpan = editable.querySelector("span");
    if (!paragraph || !lexicalSpan) {
      throw new Error("Expected Lexical-like paragraph");
    }
    const lexicalTextNode = lexicalSpan.appendChild(document.createTextNode(""));

    // Simulate Lexical intercepting insertReplacementText beforeinput:
    // When our grammar rule dispatches beforeinput, Lexical handles it by
    // changing text and potentially firing its own input event with stale caret.
    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }
      event.preventDefault();
      lexicalTextNode.textContent = inputEvent.data ?? "";

      // Lexical leaves caret stale at paragraph boundary
      const sel = window.getSelection();
      if (!sel) {
        return;
      }
      const staleRange = document.createRange();
      staleRange.setStart(paragraph, 0);
      staleRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(staleRange);

      // Lexical fires its own input event after handling beforeinput
      editable.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    const initialRange = document.createRange();
    initialRange.setStart(paragraph, 0);
    initialRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(initialRange);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    // 1. keydown fires
    dispatchKeydown(editable, "p");

    // 2. Host inserts "p" (lowercase), caret stale
    lexicalTextNode.textContent = "p";
    const staleRange = document.createRange();
    staleRange.setStart(paragraph, 0);
    staleRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(staleRange);

    // 3. Host fires input
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    // Now our grammar rule should fire (via fallback or input handler),
    // dispatch insertReplacementText, Lexical intercepts it (beforeinput
    // handler above), changes "p" to "P", fires input, re-enters our handler.

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("P");

    // Verify popup shows
    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["Pattern\xA0"],
      }),
    );
    const menuItems = Array.from(document.querySelectorAll(".ft-suggestion-container li"));
    expect(menuItems.length).toBe(1);
  });

  test("shows popup when Lexical prevents grammar beforeinput without sync DOM change (Reddit async grammar scenario)", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true"></span></p>';
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p");
    const lexicalSpan = editable.querySelector("span");
    if (!paragraph || !lexicalSpan) {
      throw new Error("Expected Lexical-like paragraph");
    }
    const lexicalTextNode = lexicalSpan.appendChild(document.createTextNode(""));

    // Lexical prevents default on our grammar's insertReplacementText
    // but does NOT apply the text change synchronously (async reconcile).
    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }
      event.preventDefault();
      // Does NOT change text here — async reconcile would happen later
    });

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    const initialRange = document.createRange();
    initialRange.setStart(paragraph, 0);
    initialRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(initialRange);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    // 1. keydown fires
    dispatchKeydown(editable, "p");

    // 2. Host inserts "p" (lowercase), caret stale
    lexicalTextNode.textContent = "p";
    const staleRange = document.createRange();
    staleRange.setStart(paragraph, 0);
    staleRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(staleRange);

    // 3. Host fires input
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    // Even though the grammar edit was prevented, we should still get a
    // prediction for the lowercase "p" (grammar couldn't apply, but
    // prediction should still fire).
    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("P");
  });

  test("requests prediction when fallback sees capitalized text for a lowercase typed key", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true"></span></p>';
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p");
    const lexicalSpan = editable.querySelector("span");
    if (!paragraph || !lexicalSpan) {
      throw new Error("Expected Lexical-like paragraph");
    }
    const lexicalTextNode = lexicalSpan.appendChild(document.createTextNode(""));

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    const initialRange = document.createRange();
    initialRange.setStart(paragraph, 0);
    initialRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(initialRange);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchKeydown(editable, "p");

    lexicalTextNode.textContent = "P";
    const staleRange = document.createRange();
    staleRange.setStart(paragraph, 0);
    staleRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(staleRange);

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("P");
    expect(request.inputAction).toBe("insert");
  });

  test("keeps predicting from corrected text when a follow-up contenteditable input arrives with stale caret", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["capitalizeSentenceStart"],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<p class="first:mt-0 last:mb-0" dir="auto"><span data-lexical-text="true">w</span></p>';
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const paragraph = editable.querySelector("p");
    const lexicalTextNode = editable.querySelector("span")?.firstChild as Text | null;
    if (!paragraph || !lexicalTextNode) {
      throw new Error("Expected Lexical-like paragraph");
    }

    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }

      event.preventDefault();
      lexicalTextNode.textContent = inputEvent.data ?? "";

      const selection = window.getSelection();
      if (!selection) {
        return;
      }
      const staleRange = document.createRange();
      staleRange.setStart(paragraph, 0);
      staleRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(staleRange);
    });

    const initialRange = document.createRange();
    initialRange.setStart(lexicalTextNode, 1);
    initialRange.collapse(true);
    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    selection.removeAllRanges();
    selection.addRange(initialRange);

    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    dispatchInput(editable, { inputType: "insertText" });
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("W");
  });

  test("requests prediction when delayed contenteditable mutation arrives after insert fallback timeout", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 0);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    withFakeTimers(() => dispatchKeydown(editable, "h"), 180);
    expect(getPrediction.mock.calls.length).toBe(0);

    editable.textContent = "h";
    setContentEditableCursor(editable, 1);

    const request = await waitForNextCall(getPrediction);
    expect(getPrediction.mock.calls.length).toBe(1);
    expect(request.text).toBe("h");
    expect(request.inputAction).toBe("insert");
  });

  test("does not request prediction when contenteditable insert is swallowed without text mutation", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "hello";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, editable.textContent.length);
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
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "hello";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, editable.textContent.length);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));

    const originalDateNow = Date.now;
    let fakeNow = originalDateNow();
    Date.now = () => fakeNow;

    try {
      editable.textContent = "hellox";
      setContentEditableCursor(editable, editable.textContent.length);
      dispatchKeydown(editable, "x");
      fakeNow += 2000;
    } finally {
      Date.now = originalDateNow;
    }

    const request = await waitForNextCall(getPrediction);
    expect(request.text).toBe("hellox");
    expect(request.inputAction).toBe("insert");
  });

  test("does not request prediction on Enter in input when input event is missing", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitForNextCall(getPrediction);
    const baselineCalls = getPrediction.mock.calls.length;

    withFakeTimers(() => dispatchKeydown(input, "Enter"), 220);

    expect(getPrediction.mock.calls.length).toBe(baselineCalls);
  });

  test("does not request prediction on Alt+key in contenteditable without text change", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "hello";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, editable.textContent.length);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    withFakeTimers(() => dispatchKeydown(editable, "f", { altKey: true }), 260);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction on Alt+key in input without text change", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    withFakeTimers(() => dispatchKeydown(input, "f", { altKey: true }), 260);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction during IME composition input", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["commaPeriodSpacing"],
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "h";
    input.selectionStart = 1;
    input.selectionEnd = 1;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    withFakeTimers(() => dispatchInput(input, { isComposing: true }), 240);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction from fallback reconcile while IME composition is active", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["commaPeriodSpacing"],
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    withFakeTimers(() => dispatchKeydown(input, "x"), 260);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction when input selection is not collapsed", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["commaPeriodSpacing"],
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    input.selectionStart = 1;
    input.selectionEnd = 4;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    withFakeTimers(() => dispatchInput(input), 240);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not request prediction from fallback reconcile when selection is active", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: ["commaPeriodSpacing"],
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    input.selectionStart = 1;
    input.selectionEnd = 4;
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    withFakeTimers(() => dispatchKeydown(input, "x"), 260);

    expect(getPrediction.mock.calls.length).toBe(0);
  });

  test("does not apply local grammar while IME composition is active", async () => {
    const { manager } = await createManager({
      enabledGrammarRules: ["englishTypoWhitelistCorrection"],
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();
    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));

    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    dispatchInput(input, { isComposing: true, inputType: "insertText" });

    expect(input.value).toBe("teh ");
  });

  test("does not apply local grammar when selection is active", async () => {
    const { manager } = await createManager({
      enabledGrammarRules: ["englishTypoWhitelistCorrection"],
    });
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    input.value = "teh ";
    input.selectionStart = 0;
    input.selectionEnd = 2;
    dispatchInput(input, { inputType: "insertText" });

    expect(input.value).toBe("teh ");
  });

  test("keeps contenteditable popup visible on Backspace when follow-up input event updates text", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "What";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 4);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const firstRequest = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["Whatever "],
      }),
    );

    const menu = (editable as HTMLElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);

    dispatchKeydown(editable, "Backspace");
    editable.textContent = "Wha";
    setContentEditableCursor(editable, 3);
    const deleteInputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(deleteInputEvent, "inputType", {
      value: "deleteContentBackward",
    });
    editable.dispatchEvent(deleteInputEvent);
    await waitFor(() => menu?.style.display === "block");

    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);
  });

  test("keeps contenteditable popup visible when delete input event arrives asynchronously", async () => {
    const { manager, getPrediction } = await createManager({
      minWordLengthToPredict: 1,
      enabledGrammarRules: [],
    });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "What";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    setContentEditableCursor(editable, 4);
    editable.dispatchEvent(new Event("focus", { bubbles: true }));
    editable.dispatchEvent(new Event("input", { bubbles: true }));

    const firstRequest = await waitForNextCall(getPrediction);

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["Whatever "],
      }),
    );

    const menu = (editable as HTMLElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");

    withFakeTimers(() => dispatchKeydown(editable, "Backspace"), 25);
    editable.textContent = "Wha";
    setContentEditableCursor(editable, 3);
    const deleteInputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(deleteInputEvent, "inputType", {
      value: "deleteContentBackward",
    });
    editable.dispatchEvent(deleteInputEvent);
    await waitForNextCall(getPrediction);

    expect(menu?.style.display).toBe("block");
    expect(menu?.querySelectorAll("li").length).toBeGreaterThan(0);
  });

  test("preserves paragraph break when replacing token at end of first paragraph", async () => {
    const { manager, getPrediction } = await createManager();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>h</p><p>next</p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    manager.queryAndAttachHelper();

    const firstParagraph = editable.querySelector("p");
    const firstTextNode =
      firstParagraph?.firstChild && firstParagraph.firstChild.nodeType === Node.TEXT_NODE
        ? (firstParagraph.firstChild as Text)
        : (firstParagraph?.appendChild(document.createTextNode("")) as Text);
    if (!firstTextNode) {
      throw new Error("Expected first paragraph text node");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Expected selection");
    }
    const range = document.createRange();
    range.setStart(firstTextNode, firstTextNode.textContent?.length ?? 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

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
    if (normalizedParagraphs.length === 0) {
      throw new Error(`Unexpected editable state: ${editable.innerHTML}`);
    }
    expect(normalizedParagraphs).toContain("next");
    expect(normalizedParagraphs).toContain("he");
  });
});
