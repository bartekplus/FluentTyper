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

    // "rich wrld" => replace "wrld" (offsets 5..9) with "world"
    adapter.replaceTextByOffsets(editable, 5, 9, "world", 10);

    expect(editable.textContent).toBe("rich world");
    expect(editable.querySelector("b")?.textContent).toBe("rich");
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
});
