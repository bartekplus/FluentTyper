import { describe, expect, test } from "bun:test";
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
});
