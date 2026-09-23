import { describe, expect, test } from "bun:test";
import { migrateSettingsV6 } from "../src/core/application/settings/SettingsMigrationV6";
import { migrateSettingsV8 } from "../src/core/application/settings/SettingsMigrationV8";
import type { SettingsManager } from "../src/core/application/settingsManager";
import { KEY_ENABLED_GRAMMAR_RULES } from "../src/core/domain/constants";
import {
  DEFAULT_V3_GRAMMAR_RULES,
  RECOMMENDED_V2_GRAMMAR_RULES,
} from "../src/core/domain/grammar/ruleCatalog";
import { resolveGrammarRuleSelection } from "../src/core/domain/grammar/GrammarRuleSettings";

function createMockSettingsManager(
  seed: Record<string, unknown>,
  failOnce = false,
): SettingsManager & { store: Record<string, unknown> } {
  const store = { ...seed };
  return {
    store,
    get: async (key: string) => store[key] as never,
    getRaw: async (key: string) => store[key] as never,
    set: async (key: string, value: unknown) => {
      store[key] = value;
    },
    setRaw: async (key: string, value: unknown) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("write failed");
      }
      store[key] = value;
    },
    removeRaw: async (key: string) => {
      delete store[key];
    },
  } as unknown as SettingsManager & { store: Record<string, unknown> };
}

describe("migrateSettingsV8", () => {
  test("converts an empty legacy selection (Disable all) without inheriting new defaults", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: [],
      enable: false,
    });

    await migrateSettingsV8(settings);

    expect(Array.isArray(settings.store[KEY_ENABLED_GRAMMAR_RULES])).toBe(false);
    expect(resolveGrammarRuleSelection(settings.store[KEY_ENABLED_GRAMMAR_RULES])).toEqual([]);
    expect(settings.store.enable).toBe(false);
  });

  test("converts a non-empty legacy selection while inheriting measurement formatting", async () => {
    const selection = ["capitalizeSentenceStart"];
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: selection,
      enable: false,
    });

    await migrateSettingsV8(settings);

    expect(Array.isArray(settings.store[KEY_ENABLED_GRAMMAR_RULES])).toBe(false);
    expect(resolveGrammarRuleSelection(settings.store[KEY_ENABLED_GRAMMAR_RULES])).toEqual([
      ...selection,
      "measurementUnitFormatting",
      "currencySpacing",
    ]);
    expect(settings.store.enable).toBe(false);
  });

  test("does not materialize missing settings", async () => {
    const settings = createMockSettingsManager({});

    await migrateSettingsV8(settings);

    expect(KEY_ENABLED_GRAMMAR_RULES in settings.store).toBe(false);
  });

  test("preserves an override map with an explicit measurement opt-out", async () => {
    const overrides = { measurementUnitFormatting: false, commaPeriodSpacing: true };
    const settings = createMockSettingsManager({ [KEY_ENABLED_GRAMMAR_RULES]: overrides });

    await migrateSettingsV8(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toBe(overrides);
    expect(resolveGrammarRuleSelection(overrides)).not.toContain("measurementUnitFormatting");
  });

  test("inherits measurement formatting after V6 upgrades the historical selection", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: RECOMMENDED_V2_GRAMMAR_RULES.slice(),
    });

    await migrateSettingsV6(settings);
    await migrateSettingsV8(settings);

    const resolved = resolveGrammarRuleSelection(settings.store[KEY_ENABLED_GRAMMAR_RULES]);
    expect(
      resolved.filter((id) => id !== "measurementUnitFormatting" && id !== "currencySpacing"),
    ).toEqual(DEFAULT_V3_GRAMMAR_RULES);
    expect(resolved).toContain("measurementUnitFormatting");
  });

  test.each([[["commaPeriodSpacing", 1]], ["invalid"]])(
    "keeps malformed settings unchanged: %j",
    async (value) => {
      const settings = createMockSettingsManager({ [KEY_ENABLED_GRAMMAR_RULES]: value });

      await migrateSettingsV8(settings);

      expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(value);
    },
  );

  test("retries conversion after a failed write", async () => {
    const settings = createMockSettingsManager({ [KEY_ENABLED_GRAMMAR_RULES]: [] }, true);

    await migrateSettingsV8(settings);
    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual([]);

    await migrateSettingsV8(settings);
    expect(resolveGrammarRuleSelection(settings.store[KEY_ENABLED_GRAMMAR_RULES])).toEqual([]);
  });
});
