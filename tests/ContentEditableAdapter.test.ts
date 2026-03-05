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
});
