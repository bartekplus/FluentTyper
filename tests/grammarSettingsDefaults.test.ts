import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { Store } from "../src/core/application/storage/Store";
import { KEY_ENABLED_GRAMMAR_RULES } from "../src/core/domain/constants";

const originalChrome = globalThis.chrome;

function localSettingsStore(): Store {
  (globalThis as { chrome?: typeof chrome }).chrome = undefined;
  return new Store("settings", {
    [KEY_ENABLED_GRAMMAR_RULES]: {},
  });
}

afterEach(() => {
  globalThis.chrome = originalChrome;
});

describe("grammar settings defaults", () => {
  test("stores no overrides when the setting is missing or reset", async () => {
    const store = localSettingsStore();
    expect(await store.get(KEY_ENABLED_GRAMMAR_RULES)).toEqual({});

    await store.remove(KEY_ENABLED_GRAMMAR_RULES);
    expect(await localSettingsStore().get(KEY_ENABLED_GRAMMAR_RULES)).toEqual({});
  });

  test.each([[{}], [{ capitalizeSentenceStart: false }], [["capitalizeSentenceStart"]]])(
    "preserves an explicit stored value: %j",
    async (value) => {
      localStorage.setItem(`store.settings.${KEY_ENABLED_GRAMMAR_RULES}`, JSON.stringify(value));

      expect(await localSettingsStore().get(KEY_ENABLED_GRAMMAR_RULES)).toEqual(value);
    },
  );
});
