import { afterEach, describe, expect, test } from "bun:test";
import { InlineSuggestionView } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionView";

describe("InlineSuggestionView", () => {
  afterEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
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
});
