import { afterEach, describe, expect, test } from "bun:test";
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
