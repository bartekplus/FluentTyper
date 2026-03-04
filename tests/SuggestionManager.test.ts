import { beforeEach, afterEach, describe, expect, jest, test } from "bun:test";
import type {
  ContentScriptPredictRequestContext,
  PredictResponseContext,
} from "../src/core/domain/messageTypes";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchKeydown(target: HTMLElement, key: string): void {
  const event = new Event("keydown", { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(event, "key", { value: key });
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
  lang: string;
  selectByDigit: boolean;
  revertOnBackspace: boolean;
  displayLangHeader: boolean;
  inline_suggestion: boolean;
  enabledGrammarRules: string[];
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
    lang: "en_US",
    selectByDigit: true,
    revertOnBackspace: true,
    displayLangHeader: true,
    inline_suggestion: false,
    enabledGrammarRules: ["commaPeriodSpacing"],
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
    textEdit: null,
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
  await wait(220);
  const request = getPrediction.mock.calls.at(-1)?.[0];
  if (!request) {
    throw new Error("Expected prediction request");
  }
  return request;
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
    await wait(220);
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

  test("rejects stale predictions but allows guarded stale textEdit", async () => {
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
      buildResponse(req1, {
        textEdit: {
          replacementText: "He",
          replaceBackwardCount: 2,
          evaluatedTextLength: 2,
          expectedReplacedText: "he",
          expectedPrefixToken: "",
        },
      }),
    );
    expect(input.value).toBe("He");

    input.value = "world";
    input.selectionStart = 5;
    input.selectionEnd = 5;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(50);

    manager.fulfillPrediction(
      buildResponse(req2, {
        textEdit: {
          replacementText: "XX",
          replaceBackwardCount: 2,
          evaluatedTextLength: 2,
          expectedReplacedText: "he",
          expectedPrefixToken: "",
        },
      }),
    );
    expect(input.value).toBe("world");
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

  test("supports digit selection and backspace revert", async () => {
    const { manager, getPrediction } = await createManager({
      selectByDigit: true,
      revertOnBackspace: true,
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

    dispatchKeydown(input, "Backspace");
    expect(input.value).toBe("h");
  });

  test("marks delete inputAction when backspace removes post-punctuation space", async () => {
    const { manager, getPrediction } = await createManager();
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
    await wait(220);

    const request = getPrediction.mock.calls.at(-1)?.[0];
    if (!request) {
      throw new Error("Expected prediction request");
    }
    expect(request.text).toBe("Hello.");
    expect(request.inputAction).toBe("delete");
  });

  test("infers delete inputAction from text shrink when key/inputType metadata is unavailable", async () => {
    const { manager, getPrediction } = await createManager();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    manager.queryAndAttachHelper();

    input.value = "Hello.\xA0";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(220);

    getPrediction.mockClear();

    input.value = "Hello.";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(220);

    const request = getPrediction.mock.calls.at(-1)?.[0];
    if (!request) {
      throw new Error("Expected prediction request");
    }
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
    await wait(220);

    const request = getPrediction.mock.calls.at(-1)?.[0];
    if (!request) {
      throw new Error("Expected prediction request");
    }

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["functionality "],
      }),
    );

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("functionality next");
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
    await wait(220);

    const request = getPrediction.mock.calls.at(-1)?.[0];
    if (!request) {
      throw new Error("Expected prediction request");
    }

    manager.fulfillPrediction(
      buildResponse(request, {
        predictions: ["functionality "],
      }),
    );

    dispatchKeydown(editable, "Tab");
    expect(editable.textContent).toBe("functionality next");
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
    await wait(220);

    const request = getPrediction.mock.calls.at(-1)?.[0];
    if (!request) {
      throw new Error("Expected prediction request");
    }

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
    await wait(220);

    const request = getPrediction.mock.calls.at(-1)?.[0];
    if (!request) {
      throw new Error("Expected prediction request");
    }

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
    await wait(220);

    const request = getPrediction.mock.calls.at(-1)?.[0];
    if (!request) {
      throw new Error("Expected prediction request");
    }

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
    await wait(220);

    const firstRequest = getPrediction.mock.calls.at(-1)?.[0];
    if (!firstRequest) {
      throw new Error("Expected first prediction request");
    }

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
    await wait(220);

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
    await wait(220);

    const firstRequest = getPrediction.mock.calls.at(-1)?.[0];
    if (!firstRequest) {
      throw new Error("Expected first prediction request");
    }

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
    await wait(120);

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
    await wait(220);

    const request = getPrediction.mock.calls.at(-1)?.[0];
    if (!request) {
      throw new Error("Expected prediction request");
    }
    expect(request.text).toBe("h");
    expect(request.inputAction).toBe("insert");
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
    await wait(220);

    const firstRequest = getPrediction.mock.calls.at(-1)?.[0];
    if (!firstRequest) {
      throw new Error("Expected first prediction request");
    }

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
    await wait(20);

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
    await wait(220);

    const firstRequest = getPrediction.mock.calls.at(-1)?.[0];
    if (!firstRequest) {
      throw new Error("Expected first prediction request");
    }

    manager.fulfillPrediction(
      buildResponse(firstRequest, {
        predictions: ["Whatever "],
      }),
    );

    const menu = (editable as HTMLElement & { suggestionMenu?: HTMLElement }).suggestionMenu;
    expect(menu?.style.display).toBe("block");

    dispatchKeydown(editable, "Backspace");
    await wait(25);
    editable.textContent = "Wha";
    setContentEditableCursor(editable, 3);
    const deleteInputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(deleteInputEvent, "inputType", {
      value: "deleteContentBackward",
    });
    editable.dispatchEvent(deleteInputEvent);
    await wait(90);

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
    await wait(220);

    const request = getPrediction.mock.calls.at(-1)?.[0];
    if (!request) {
      throw new Error("Expected prediction request");
    }

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
