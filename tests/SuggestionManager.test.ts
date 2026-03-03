import { beforeEach, afterEach, describe, expect, jest, test } from "bun:test";
import type { ContentScriptPredictRequestContext, PredictResponseContext } from "../src/core/domain/messageTypes";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchKeydown(target: HTMLElement, key: string): void {
  const event = new Event("keydown", { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(event, "key", { value: key });
  target.dispatchEvent(event);
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
    expect((input as HTMLInputElement & { suggestionMenu?: Element }).suggestionMenu).toBeUndefined();
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

    const menuItems = Array.from(document.querySelectorAll(".suggestion-container li"));
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

    const second = document.querySelector(".suggestion-container li[data-index='1']") as HTMLElement;
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

    expect(document.querySelectorAll(".suggestion-container li").length).toBe(0);

    dispatchKeydown(input, "Tab");
    expect(input.value).toBe("word\xA0");
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
    expect(document.querySelectorAll(".suggestion-container li").length).toBe(0);

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

  test("inserts NBSP before first typed char after acceptance and cancels on cursor move", async () => {
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
    expect(input.value).toBe("hello\xA0x");

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
});
