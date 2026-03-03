import { describe, expect, test } from "bun:test";
import { SuggestionEntryRegistry } from "../src/adapters/chrome/content-script/suggestions/SuggestionEntryRegistry";
import { createSuggestionEntry } from "./suggestionTestUtils";

describe("SuggestionEntryRegistry", () => {
  test("registers and resolves entries by id and element", () => {
    const registry = new SuggestionEntryRegistry();
    const elem = document.createElement("input");
    const id = registry.allocateId();
    const entry = createSuggestionEntry({ id, elem });

    registry.register(entry);

    expect(registry.getById(id)).toBe(entry);
    expect(registry.getByElement(elem)).toBe(entry);
    expect(registry.isAttached(elem)).toBe(true);
  });

  test("clear removes all entries and stale element mappings", () => {
    const registry = new SuggestionEntryRegistry();
    const elem = document.createElement("input");
    const id = registry.allocateId();
    registry.register(createSuggestionEntry({ id, elem }));

    registry.clear();

    expect(registry.size).toBe(0);
    expect(registry.getByElement(elem)).toBeUndefined();
    expect(registry.unregister(id)).toBeUndefined();
  });
});
