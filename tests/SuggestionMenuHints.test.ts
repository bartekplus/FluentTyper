import { describe, expect, test } from "bun:test";
import {
  acceptKeyLabels,
  buildSuggestionKeyHints,
} from "../src/core/domain/suggestionPopup/keyHints";

describe("SuggestionMenuHints", () => {
  test("lists exactly the accept keys enabled in the options", () => {
    expect(
      acceptKeyLabels({ autocompleteOnTab: true, autocompleteOnEnter: false, autocomplete: false }),
    ).toEqual(["Tab"]);
    expect(
      acceptKeyLabels({ autocompleteOnTab: false, autocompleteOnEnter: true, autocomplete: true }),
    ).toEqual(["⏎", "Space"]);
    expect(
      acceptKeyLabels({
        autocompleteOnTab: false,
        autocompleteOnEnter: false,
        autocomplete: false,
      }),
    ).toEqual([]);
  });

  test("drops the accept and pick hints when no key does that", () => {
    const hints = buildSuggestionKeyHints({ acceptKeys: [], digitCount: 0, language: "de-DE" });
    expect(hints).toEqual([
      { keys: "↑↓", label: "navigieren" },
      { keys: "Esc", label: "schließen" },
    ]);
  });
});
