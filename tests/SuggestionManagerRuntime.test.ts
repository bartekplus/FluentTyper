import { beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionManagerRuntime } from "../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime";

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
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: jest.fn(),
        getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
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

    test("does not show manual attach icon for contenteditable conflict candidates", () => {
      const runtime = makeRuntime();
      const editable = document.createElement("div");
      editable.contentEditable = "true";
      editable.setAttribute("role", "combobox");
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", "editable-list");
      const list = document.createElement("div");
      list.id = "editable-list";
      list.setAttribute("role", "listbox");
      document.body.append(editable, list);

      runtime.queryAndAttachHelper();

      expect(editable.hasAttribute("data-suggestion")).toBe(false);
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
