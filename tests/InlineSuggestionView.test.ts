import { afterEach, describe, expect, jest, test } from "bun:test";
import { InlineSuggestionView } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionView";

describe("InlineSuggestionView", () => {
  afterEach(() => {
    InlineSuggestionView.removeAll(document);
  });

  test("mounts inline ghost outside a contenteditable body root", () => {
    document.body.setAttribute("contenteditable", "true");
    Object.defineProperty(document.body, "isContentEditable", {
      value: true,
      configurable: true,
    });
    document.body.textContent = "hello";

    const ghost = InlineSuggestionView.render({
      target: document.body,
      text: " world",
      caretRect: { left: 10, top: 20, width: 0, height: 16 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    expect(ghost?.parentElement).toBe(document.documentElement);
    expect(document.body.querySelector(`.${InlineSuggestionView.CLASS_NAME}`)).toBeNull();
  });

  test("copies font from caret element inside contenteditable, not the container", () => {
    const container = document.createElement("div");
    container.contentEditable = "true";
    Object.defineProperty(container, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(container);

    const heading = document.createElement("h1");
    heading.style.fontFamily = "Georgia, serif";
    heading.style.fontSize = "32px";
    heading.style.fontWeight = "700";
    heading.textContent = "Hello";
    container.appendChild(heading);

    const textNode = heading.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const ghost = InlineSuggestionView.render({
      target: container,
      text: " world",
      caretRect: { left: 100, top: 50, width: 0, height: 37 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    const style = ghost!.style;
    expect(style.fontFamily).toBe("Georgia, serif");
    expect(style.fontSize).toBe("32px");
    expect(style.fontWeight).toBe("700");

    container.remove();
  });

  test("falls back to target element styles when caret is directly in container", () => {
    const container = document.createElement("div");
    container.contentEditable = "true";
    Object.defineProperty(container, "isContentEditable", { value: true, configurable: true });
    container.style.fontFamily = "Arial, sans-serif";
    container.style.fontSize = "16px";
    container.textContent = "text";
    document.body.appendChild(container);

    const textNode = container.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const ghost = InlineSuggestionView.render({
      target: container,
      text: " more",
      caretRect: { left: 50, top: 20, width: 0, height: 16 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    expect(ghost!.style.fontFamily).toBe("Arial, sans-serif");
    expect(ghost!.style.fontSize).toBe("16px");

    container.remove();
  });

  test("uses caretRect height as lineHeight to prevent baseline misalignment", () => {
    const container = document.createElement("div");
    container.contentEditable = "true";
    Object.defineProperty(container, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(container);

    const heading = document.createElement("h1");
    heading.style.lineHeight = "44.8px";
    heading.textContent = "Title";
    container.appendChild(heading);

    const textNode = heading.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const ghost = InlineSuggestionView.render({
      target: container,
      text: " suffix",
      caretRect: { left: 100, top: 50, width: 0, height: 37 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    // lineHeight must match caretRect.height, not the element's computed lineHeight
    expect(ghost!.style.lineHeight).toBe("37px");
    expect(ghost!.style.height).toBe("37px");
    expect(ghost!.style.overflow).toBe("hidden");

    container.remove();
  });

  test("does not resolve caret element for non-contenteditable targets", () => {
    const input = document.createElement("input");
    input.value = "hello";
    document.body.appendChild(input);

    const ghost = InlineSuggestionView.render({
      target: input,
      text: " world",
      caretRect: { left: 50, top: 20, width: 0, height: 16 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    // For non-contenteditable, styles come from the target itself
    expect(ghost!.style.fontSize).toBe(window.getComputedStyle(input).fontSize);

    input.remove();
  });

  test("removeForEntry only removes ghost for the specified entry", () => {
    const caretRect = { left: 0, top: 0, width: 0, height: 16 } as DOMRect;

    InlineSuggestionView.render({
      target: document.body,
      text: "aaa",
      caretRect,
      entryId: 1,
      doc: document,
    });
    InlineSuggestionView.render({
      target: document.body,
      text: "bbb",
      caretRect,
      entryId: 2,
      doc: document,
    });

    const allBefore = document.querySelectorAll(`.${InlineSuggestionView.CLASS_NAME}`);
    // render() calls removeForEntry(entryId) which only removes same-entry ghosts,
    // so both entry 1 and entry 2 ghosts coexist
    expect(allBefore.length).toBe(2);

    InlineSuggestionView.removeForEntry(1, document);

    const remaining = document.querySelectorAll(`.${InlineSuggestionView.CLASS_NAME}`);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.textContent).toBe("bbb");
  });
});
