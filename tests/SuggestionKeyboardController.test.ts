import { describe, expect, test } from "bun:test";
import { SuggestionKeyboardController } from "../src/adapters/chrome/content-script/suggestions/SuggestionKeyboardController";

describe("SuggestionKeyboardController", () => {
  test("builds active key set from runtime config", () => {
    const keys = SuggestionKeyboardController.buildActiveKeys({
      autocompleteOnEnter: true,
      autocompleteOnTab: false,
      revertOnBackspace: true,
    });

    expect(keys).toEqual(["Escape", "ArrowUp", "ArrowDown", "Space", "Enter", "Backspace"]);
  });
});
