import { beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionManagerRuntime } from "../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime";

describe("SuggestionManagerRuntime", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: jest.fn(),
        lastError: undefined,
      },
    };
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
});
