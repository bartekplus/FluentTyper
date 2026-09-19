import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { Store } from "../src/core/application/storage/Store";
import { KEY_ENABLED_GRAMMAR_RULES } from "../src/core/domain/constants";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../src/core/domain/grammar/ruleCatalog";

const originalChrome = globalThis.chrome;

function localSettingsStore(): Store {
  (globalThis as { chrome?: typeof chrome }).chrome = undefined;
  return new Store("settings", {
    [KEY_ENABLED_GRAMMAR_RULES]: DEFAULT_CURRENT_GRAMMAR_RULES,
  });
}

afterEach(() => {
  globalThis.chrome = originalChrome;
});

describe("grammar settings defaults", () => {
  test("applies current rules when the setting is missing or reset", async () => {
    const store = localSettingsStore();
    expect(await store.get(KEY_ENABLED_GRAMMAR_RULES)).toEqual(DEFAULT_CURRENT_GRAMMAR_RULES);

    await store.remove(KEY_ENABLED_GRAMMAR_RULES);
    expect(await localSettingsStore().get(KEY_ENABLED_GRAMMAR_RULES)).toEqual(
      DEFAULT_CURRENT_GRAMMAR_RULES,
    );
  });

  test.each([[[]], [["capitalizeSentenceStart"]]])(
    "preserves an explicit stored selection: %j",
    async (selection) => {
      localStorage.setItem(
        `store.settings.${KEY_ENABLED_GRAMMAR_RULES}`,
        JSON.stringify(selection),
      );

      expect(await localSettingsStore().get(KEY_ENABLED_GRAMMAR_RULES)).toEqual(selection);
    },
  );
});
