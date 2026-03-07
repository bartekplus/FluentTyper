import { beforeEach, describe, expect, test } from "bun:test";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";

function ensureNodeFilterApi(): void {
  if (typeof (globalThis as { NodeFilter?: unknown }).NodeFilter !== "undefined") {
    return;
  }
  (globalThis as { NodeFilter: { SHOW_TEXT: number } }).NodeFilter = {
    SHOW_TEXT: 4,
  };
}

describe("ContentEditableAdapter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    ensureNodeFilterApi();
  });

  test("replaces text by offsets without dropping surrounding formatting", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<b>rich</b> wrld";
    document.body.appendChild(editable);
    let inputEventCount = 0;
    editable.addEventListener("input", () => {
      inputEventCount += 1;
    });

    // "rich wrld" => replace "wrld" (offsets 5..9) with "world"
    const result = adapter.replaceTextByOffsets(editable, 5, 9, "world", 10);

    expect(editable.textContent).toBe("rich world");
    expect(editable.querySelector("b")?.textContent).toBe("rich");
    expect(inputEventCount).toBe(1);
    expect(result).toEqual({
      appliedBy: "fallback-dom",
      didMutateDom: true,
      didDispatchInput: true,
    });
  });

  test("returns null block context when selection is outside the editable", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "inside";
    const outside = document.createElement("div");
    outside.textContent = "outside";
    document.body.appendChild(editable);
    document.body.appendChild(outside);

    const outsideText = outside.firstChild as Text;
    const range = document.createRange();
    range.setStart(outsideText, 0);
    range.setEnd(outsideText, outsideText.textContent?.length ?? 0);
    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }
    selection.removeAllRanges();
    selection.addRange(range);

    const context = adapter.getBlockContext(editable);
    expect(context).toBeNull();
  });

  test("dispatches only one semantic replacement event to avoid duplicate inserts", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "fun";
    document.body.appendChild(editable);

    const applyFromSelection = (event: Event) => {
      const inputEvent = event as Event & { inputType?: string; data?: string };
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(inputEvent.data ?? "");
      range.insertNode(textNode);
      const caret = document.createRange();
      caret.setStart(textNode, textNode.textContent?.length ?? 0);
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
    };

    editable.addEventListener("beforeinput", applyFromSelection);
    editable.addEventListener("input", applyFromSelection);

    const result = adapter.replaceTextByOffsets(editable, 0, 3, "function", 8);

    expect(editable.textContent).toBe("function");
    expect(result.appliedBy).toBe("host-beforeinput");
    expect(result.didDispatchInput).toBe(false);
  });

  test("respects canceled beforeinput and skips fallback DOM mutation", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "fun";
    document.body.appendChild(editable);

    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as Event & { inputType?: string };
      if (inputEvent.inputType === "insertReplacementText") {
        event.preventDefault();
      }
    });

    let inputEventCount = 0;
    editable.addEventListener("input", () => {
      inputEventCount += 1;
    });

    const result = adapter.replaceTextByOffsets(editable, 0, 3, "function", 8);

    expect(editable.textContent).toBe("fun");
    expect(inputEventCount).toBe(0);
    expect(result).toEqual({
      appliedBy: "host-beforeinput",
      didMutateDom: false,
      didDispatchInput: false,
    });
  });

  test("uses host-handled synchronous beforeinput mutation without fallback", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "fun";
    document.body.appendChild(editable);

    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as Event & { inputType?: string; data?: string };
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const replacementNode = document.createTextNode(inputEvent.data ?? "");
      range.insertNode(replacementNode);
      const caretRange = document.createRange();
      caretRange.setStart(replacementNode, replacementNode.textContent?.length ?? 0);
      caretRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caretRange);
    });

    let inputEventCount = 0;
    editable.addEventListener("input", () => {
      inputEventCount += 1;
    });

    const result = adapter.replaceTextByOffsets(editable, 0, 3, "function", 8);

    expect(editable.textContent).toBe("function");
    expect(inputEventCount).toBe(0);
    expect(result).toEqual({
      appliedBy: "host-beforeinput",
      didMutateDom: true,
      didDispatchInput: false,
    });
  });

  test("uses native insertText fallback before raw DOM mutation", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "fun";
    document.body.appendChild(editable);

    const originalExecCommand = document.execCommand;
    document.execCommand = ((commandId: string, _showUi?: boolean, value?: string) => {
      if (commandId !== "insertText") {
        return false;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return false;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const replacementNode = document.createTextNode(value ?? "");
      range.insertNode(replacementNode);
      const caretRange = document.createRange();
      caretRange.setStart(replacementNode, replacementNode.textContent?.length ?? 0);
      caretRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caretRange);
      return true;
    }) as typeof document.execCommand;

    try {
      let inputEventCount = 0;
      editable.addEventListener("input", () => {
        inputEventCount += 1;
      });

      const result = adapter.replaceTextByOffsets(editable, 0, 3, "function", 8);

      expect(editable.textContent).toBe("function");
      expect(inputEventCount).toBe(0);
      expect(result).toEqual({
        appliedBy: "fallback-dom",
        didMutateDom: true,
        didDispatchInput: false,
      });
    } finally {
      document.execCommand = originalExecCommand;
    }
  });

  test("maps offset zero to structural boundary before leading empty block text", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p><br></p><p>next</p>";
    document.body.appendChild(editable);

    const result = adapter.replaceTextByOffsets(editable, 0, 0, "hello", 5);

    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0]?.textContent ?? "").toContain("hello");
    expect(paragraphs[1]?.textContent ?? "").toBe("next");
    expect(result.didMutateDom).toBe(true);
  });

  test("uses zero-offset boundary fast path without full boundary scan", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p><br></p><p><br></p>";
    document.body.appendChild(editable);

    const adapterInternals = adapter as unknown as {
      measureBoundaryTextOffset: (
        root: HTMLElement,
        container: Node,
        offset: number,
        probeRange: Range,
      ) => number | null;
    };
    const originalMeasureBoundaryTextOffset =
      adapterInternals.measureBoundaryTextOffset.bind(adapter);
    let boundaryMeasureCallCount = 0;
    adapterInternals.measureBoundaryTextOffset = (
      root: HTMLElement,
      container: Node,
      offset: number,
      probeRange: Range,
    ) => {
      boundaryMeasureCallCount += 1;
      return originalMeasureBoundaryTextOffset(root, container, offset, probeRange);
    };

    try {
      const result = adapter.replaceTextByOffsets(editable, 0, 0, "hello", 5);
      const paragraphs = editable.querySelectorAll("p");

      expect(boundaryMeasureCallCount).toBe(0);
      expect(paragraphs[0]?.textContent ?? "").toContain("hello");
      expect(result.didMutateDom).toBe(true);
    } finally {
      adapterInternals.measureBoundaryTextOffset = originalMeasureBoundaryTextOffset;
    }
  });

  test("keeps insertion anchored at active caret when offset equals paragraph boundary", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>hello</p><p>next</p>";
    document.body.appendChild(editable);

    const secondParagraph = editable.querySelectorAll("p")[1];
    if (!secondParagraph) {
      throw new Error("Expected second paragraph");
    }

    const range = document.createRange();
    range.setStart(secondParagraph, 0);
    range.collapse(true);
    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }
    selection.removeAllRanges();
    selection.addRange(range);

    const result = adapter.replaceTextByOffsets(editable, 5, 5, "X", 6);

    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("hello");
    expect(paragraphs[1]?.textContent ?? "").toContain("X");
    expect(result.didMutateDom).toBe(true);
  });

  test("preserves a root boundary insertion before a non-empty block", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      'asap<div><span class="gmail_signature_prefix">-- </span><br><div class="gmail_signature">Pozdrawiam Bartek</div></div>';
    document.body.appendChild(editable);

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }
    const range = document.createRange();
    range.setStart(editable, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const result = adapter.replaceTextByOffsets(editable, 0, 4, "As soon as possible\u00A0", 20);

    expect(result.didMutateDom).toBe(true);
    expect(editable.innerHTML).toContain("As soon as possible&nbsp;<div");
    expect(editable.querySelector(".gmail_signature_prefix")?.textContent).toBe("-- ");
  });

  test("resolves block context to active line when caret is at root boundary", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<h1>Quill Rich Text Editor</h1><p>word</p>";
    document.body.appendChild(editable);

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }
    const range = document.createRange();
    range.setStart(editable, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const context = adapter.getBlockContext(editable);
    expect(context).not.toBeNull();
    expect(context?.beforeCursor).toBe("");
    expect(context?.afterCursor).toBe("word");
  });

  test("uses innermost block when wrapper div contains multiple paragraphs (Lexical/Reddit)", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<div><p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p><p class="second" dir="auto"><span data-lexical-text="true">S</span></p></div>';
    document.body.appendChild(editable);

    const wrapper = editable.querySelector("div")!;
    const secondP = editable.querySelector("p.second")!;
    const secondSpan = secondP.querySelector("span")!;
    const secondText = secondSpan.firstChild as Text;

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    // Cursor at (wrapper, 1) – between the two <p>s – should resolve to second paragraph, not full "Wa" + "S".
    const rangeAtBoundary = document.createRange();
    rangeAtBoundary.setStart(wrapper, 1);
    rangeAtBoundary.collapse(true);
    selection.removeAllRanges();
    selection.addRange(rangeAtBoundary);

    const contextAtBoundary = adapter.getBlockContext(editable);
    expect(contextAtBoundary).not.toBeNull();
    expect(contextAtBoundary?.beforeCursor).toBe("");
    expect(contextAtBoundary?.afterCursor).toBe("S");

    // Cursor after "S" in second paragraph – should still be block-local.
    const rangeInSecond = document.createRange();
    rangeInSecond.setStart(secondText, secondText.textContent?.length ?? 0);
    rangeInSecond.collapse(true);
    selection.removeAllRanges();
    selection.addRange(rangeInSecond);

    const contextInSecond = adapter.getBlockContext(editable);
    expect(contextInSecond).not.toBeNull();
    expect(contextInSecond?.beforeCursor).toBe("S");
    expect(contextInSecond?.afterCursor).toBe("");
  });

  test("uses innermost block through deeper nested wrappers", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<div class="outer"><div class="inner"><p class="target" dir="auto"><span data-lexical-text="true">Deep</span></p></div></div>';
    document.body.appendChild(editable);

    const textNode = editable.querySelector("p.target span")?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error("Expected text node in nested paragraph");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const context = adapter.getBlockContext(editable);
    expect(context).not.toBeNull();
    expect(context?.beforeCursor).toBe("De");
    expect(context?.afterCursor).toBe("ep");
  });

  test("uses leaf block when root boundary points at single wrapper child", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<div class="wrapper"><div class="first"><span>Wan</span></div><div class="second"><span>t</span></div></div>';
    document.body.appendChild(editable);

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    range.setStart(editable, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const context = adapter.getBlockContext(editable);
    expect(context).not.toBeNull();
    expect(context?.beforeCursor).toBe("t");
    expect(context?.afterCursor).toBe("");
  });

  test("scopes block context to the current br-separated line inside one paragraph", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<p class="target" dir="auto"><span data-lexical-text="true">Wan</span><br><span data-lexical-text="true">t</span></p>';
    document.body.appendChild(editable);

    const textNode = editable.querySelectorAll("span")[1]?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error("Expected second line text node");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    range.setStart(textNode, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const context = adapter.getBlockContext(editable);
    expect(context).not.toBeNull();
    expect(context?.beforeCursor).toBe("t");
    expect(context?.afterCursor).toBe("");
  });

  test("returns previous paragraph text when cursor is in second paragraph", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>First</p><p>Second</p>";
    document.body.appendChild(editable);

    const secondText = editable.querySelectorAll("p")[1]?.firstChild;
    if (!secondText || secondText.nodeType !== Node.TEXT_NODE) {
      throw new Error("Expected second paragraph text node");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    range.setStart(secondText, secondText.textContent?.length ?? 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(adapter.getPreviousBlockTextBySelection(editable)).toBe("First");
  });

  test("skips empty previous blocks when resolving previous block text", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>First</p><p></p><p>Third</p>";
    document.body.appendChild(editable);

    const thirdText = editable.querySelectorAll("p")[2]?.firstChild;
    if (!thirdText || thirdText.nodeType !== Node.TEXT_NODE) {
      throw new Error("Expected third paragraph text node");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    range.setStart(thirdText, thirdText.textContent?.length ?? 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(adapter.getPreviousBlockTextBySelection(editable)).toBe("First");
  });

  test("returns null when there is no previous block", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>Only</p>";
    document.body.appendChild(editable);

    const onlyText = editable.querySelector("p")?.firstChild;
    if (!onlyText || onlyText.nodeType !== Node.TEXT_NODE) {
      throw new Error("Expected single paragraph text node");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    range.setStart(onlyText, onlyText.textContent?.length ?? 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(adapter.getPreviousBlockTextBySelection(editable)).toBeNull();
  });

  test("returns null when selection resolves to the root block itself", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "Only root text";
    document.body.appendChild(editable);

    const rootText = editable.firstChild;
    if (!rootText || rootText.nodeType !== Node.TEXT_NODE) {
      throw new Error("Expected root text node");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    range.setStart(rootText, rootText.textContent?.length ?? 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(adapter.getPreviousBlockTextBySelection(editable)).toBeNull();
  });

  test("returns only the trailing line from the previous block", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>First line\nTrailing line</p><p>Second</p>";
    document.body.appendChild(editable);

    const secondText = editable.querySelectorAll("p")[1]?.firstChild;
    if (!secondText || secondText.nodeType !== Node.TEXT_NODE) {
      throw new Error("Expected second paragraph text node");
    }

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    range.setStart(secondText, secondText.textContent?.length ?? 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(adapter.getPreviousBlockTextBySelection(editable)).toBe("Trailing line");
  });

  test("collects leaf block elements in document order for nested blocks", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<div class="wrapper"><div class="inner"><p>A</p><p>B</p></div><p>C</p></div>';
    document.body.appendChild(editable);

    const leafBlocks = (
      adapter as unknown as {
        collectLeafBlockElements: (root: HTMLElement) => HTMLElement[];
      }
    ).collectLeafBlockElements(editable);

    expect(leafBlocks.map((block) => block.textContent)).toEqual(["A", "B", "C"]);
  });

  test("walking fallback maps ancestor boundary endpoints into resolved block", () => {
    const adapter = new ContentEditableAdapter();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      '<div><p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p><p class="second" dir="auto"><span data-lexical-text="true">S</span></p></div>';
    document.body.appendChild(editable);

    const wrapper = editable.querySelector("div")!;
    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    range.setStart(wrapper, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const originalResolvePointWithinBlock = (
      adapter as unknown as {
        resolvePointWithinBlock: (
          container: Node,
          offset: number,
          block: HTMLElement,
          root: HTMLElement,
        ) => unknown;
      }
    ).resolvePointWithinBlock;

    (
      adapter as unknown as {
        resolvePointWithinBlock: (
          container: Node,
          offset: number,
          block: HTMLElement,
          root: HTMLElement,
        ) => null;
      }
    ).resolvePointWithinBlock = () => null;

    try {
      const context = adapter.getBlockContext(editable);
      expect(context).not.toBeNull();
      expect(context?.beforeCursor).toBe("");
      expect(context?.afterCursor).toBe("S");
    } finally {
      (
        adapter as unknown as {
          resolvePointWithinBlock: typeof originalResolvePointWithinBlock;
        }
      ).resolvePointWithinBlock = originalResolvePointWithinBlock;
    }
  });
});
