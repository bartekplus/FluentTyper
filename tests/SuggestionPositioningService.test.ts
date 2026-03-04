import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionPositioningService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPositioningService";
import { createRect } from "./suggestionTestUtils";

class CaretPositioningService extends SuggestionPositioningService {
  constructor(private readonly rect: DOMRect | null) {
    super();
  }

  public override getCaretRect(): DOMRect | null {
    return this.rect;
  }
}

describe("SuggestionPositioningService", () => {
  const rangeCtor = (globalThis as { Range?: typeof Range }).Range;
  let originalRangeRectDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
    if (rangeCtor) {
      originalRangeRectDescriptor = Object.getOwnPropertyDescriptor(
        rangeCtor.prototype,
        "getBoundingClientRect",
      );
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (rangeCtor) {
      if (originalRangeRectDescriptor) {
        Object.defineProperty(
          rangeCtor.prototype,
          "getBoundingClientRect",
          originalRangeRectDescriptor,
        );
      } else {
        delete (rangeCtor.prototype as { getBoundingClientRect?: () => DOMRect })
          .getBoundingClientRect;
      }
    }
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  test("positions menu when caret rect exists", () => {
    const service = new CaretPositioningService(createRect(50, 60, 0, 16));
    const menu = document.createElement("div");
    const target = document.createElement("input");
    Object.defineProperty(menu, "offsetWidth", { value: 220, configurable: true });
    Object.defineProperty(menu, "offsetHeight", { value: 180, configurable: true });

    const positioned = service.positionMenu(menu, target);

    expect(positioned).toBe(true);
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.zIndex).toBe("2147483647");
  });

  test("returns false when caret rect cannot be resolved", () => {
    const service = new CaretPositioningService(null);
    const menu = document.createElement("div");
    const target = document.createElement("input");

    const positioned = service.positionMenu(menu, target);
    expect(positioned).toBe(false);
  });

  test("cleans up marker fallback and keeps selection valid for zero-height ranges", () => {
    if (!rangeCtor) {
      return;
    }

    Object.defineProperty(rangeCtor.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => createRect(20, 30, 0, 0),
    });
    const insertNodeSpy = jest.spyOn(rangeCtor.prototype, "insertNode");

    const service = new SuggestionPositioningService();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.appendChild(document.createTextNode("hello"));
    document.body.appendChild(editable);

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    const textNode = editable.firstChild as Text;
    range.setStart(textNode, 2);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const rect = service.getCaretRect(editable);

    expect(rect).not.toBeNull();
    expect(insertNodeSpy).toHaveBeenCalledTimes(1);
    expect(editable.querySelector("span")).toBeNull();
    expect(editable.textContent).toBe("hello");
    expect(selection.rangeCount).toBe(1);
    const restoredRange = selection.getRangeAt(0);
    expect(restoredRange.collapsed).toBe(true);
    expect(editable.contains(restoredRange.startContainer)).toBe(true);
  });

  test("always removes marker fallback node even if marker measurement throws", () => {
    if (!rangeCtor) {
      return;
    }

    Object.defineProperty(rangeCtor.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => createRect(20, 30, 0, 0),
    });
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ): DOMRect {
      if (this.textContent === "\u200b") {
        throw new Error("marker rect failed");
      }
      return createRect(10, 10, 120, 20);
    });

    const service = new SuggestionPositioningService();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.appendChild(document.createTextNode("hello"));
    document.body.appendChild(editable);

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }

    const range = document.createRange();
    const textNode = editable.firstChild as Text;
    range.setStart(textNode, 2);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(() => service.getCaretRect(editable)).toThrow("marker rect failed");
    expect(editable.querySelector("span")).toBeNull();
    expect(editable.textContent).toBe("hello");
    expect(selection.rangeCount).toBe(1);
    const restoredRange = selection.getRangeAt(0);
    expect(restoredRange.collapsed).toBe(true);
    expect(editable.contains(restoredRange.startContainer)).toBe(true);
  });
});
