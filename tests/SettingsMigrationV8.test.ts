import { describe, expect, spyOn, test } from "bun:test";
import { runSettingsMigrations } from "../src/core/application/settings/migrations";
import { migrateSettingsV5 } from "../src/core/application/settings/SettingsMigrationV5";
import { migrateSettingsV6 } from "../src/core/application/settings/SettingsMigrationV6";
import { migrateSettingsV8 } from "../src/core/application/settings/SettingsMigrationV8";
import {
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_LEGACY_DISPLAY_LANG_HEADER,
  KEY_SHOW_SUGGESTION_FOOTER,
} from "../src/core/domain/constants";
import {
  DEFAULT_CURRENT_GRAMMAR_RULES,
  DEFAULT_V3_GRAMMAR_RULES,
  RECOMMENDED_V1_GRAMMAR_RULES,
  RECOMMENDED_V2_GRAMMAR_RULES,
  normalizeGrammarRuleSelection,
} from "../src/core/domain/grammar/ruleCatalog";
import { resolveGrammarRuleSelection } from "../src/core/domain/grammar/GrammarRuleSettings";
import { memorySettings } from "./support/fakeSettings";

describe("migrateSettingsV8", () => {
  test("converts an empty legacy selection (Disable all) without inheriting new defaults", async () => {
    const settings = memorySettings({
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
    const settings = memorySettings({
      [KEY_ENABLED_GRAMMAR_RULES]: selection,
      enable: false,
    });

    await migrateSettingsV8(settings);

    expect(Array.isArray(settings.store[KEY_ENABLED_GRAMMAR_RULES])).toBe(false);
    expect(resolveGrammarRuleSelection(settings.store[KEY_ENABLED_GRAMMAR_RULES])).toEqual([
      ...selection,
      "englishProperNounCapitalization",
      "measurementUnitFormatting",
      "currencySpacing",
    ]);
    expect(settings.store.enable).toBe(false);
  });

  test("does not materialize missing settings", async () => {
    const settings = memorySettings({});

    await migrateSettingsV8(settings);

    expect(KEY_ENABLED_GRAMMAR_RULES in settings.store).toBe(false);
  });

  test("preserves an override map with an explicit measurement opt-out", async () => {
    const overrides = { measurementUnitFormatting: false, commaPeriodSpacing: true };
    const settings = memorySettings({ [KEY_ENABLED_GRAMMAR_RULES]: overrides });

    await migrateSettingsV8(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toBe(overrides);
    expect(resolveGrammarRuleSelection(overrides)).not.toContain("measurementUnitFormatting");
  });

  test("inherits measurement formatting after V6 upgrades the historical selection", async () => {
    const settings = memorySettings({
      [KEY_ENABLED_GRAMMAR_RULES]: RECOMMENDED_V2_GRAMMAR_RULES.slice(),
    });

    await migrateSettingsV6(settings);
    await migrateSettingsV8(settings);

    const resolved = resolveGrammarRuleSelection(settings.store[KEY_ENABLED_GRAMMAR_RULES]);
    expect(
      resolved.filter(
        (id) =>
          id !== "measurementUnitFormatting" &&
          id !== "currencySpacing" &&
          id !== "englishProperNounCapitalization",
      ),
    ).toEqual(normalizeGrammarRuleSelection(DEFAULT_V3_GRAMMAR_RULES));
    expect(resolved).toContain("measurementUnitFormatting");
  });

  test.each([[["commaPeriodSpacing", 1]], ["invalid"]])(
    "keeps malformed settings unchanged: %j",
    async (value) => {
      const settings = memorySettings({ [KEY_ENABLED_GRAMMAR_RULES]: value });

      await migrateSettingsV8(settings);

      expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(value);
    },
  );

  test("retries conversion after a failed write", async () => {
    const settings = memorySettings({ [KEY_ENABLED_GRAMMAR_RULES]: [] }, { failOnce: true });

    await expect(migrateSettingsV8(settings)).rejects.toThrow("write failed");
    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual([]);

    await migrateSettingsV8(settings);
    expect(resolveGrammarRuleSelection(settings.store[KEY_ENABLED_GRAMMAR_RULES])).toEqual([]);
  });

  test("runSettingsMigrations logs a failed migration and still runs the next ones", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const settings = memorySettings(
      { [KEY_ENABLED_GRAMMAR_RULES]: [], [KEY_LEGACY_DISPLAY_LANG_HEADER]: true },
      { failOnce: true },
    );

    await runSettingsMigrations(settings);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(settings.store[KEY_SHOW_SUGGESTION_FOOTER]).toBe(true);
    warn.mockRestore();
  });

  describe("stored selections naming the retired neutralPunctuationPolicy", () => {
    async function upgrade(stored: unknown): Promise<unknown> {
      const settings = memorySettings({ [KEY_ENABLED_GRAMMAR_RULES]: stored });
      await migrateSettingsV5(settings);
      await migrateSettingsV6(settings);
      await migrateSettingsV8(settings);
      return settings.store[KEY_ENABLED_GRAMMAR_RULES];
    }

    test.each([
      ["the v1 recommended set", RECOMMENDED_V1_GRAMMAR_RULES],
      ["the v2 recommended set", RECOMMENDED_V2_GRAMMAR_RULES],
    ])("%s still upgrades to the current defaults", async (_label, stored) => {
      // V5 and V6 still recognize the exact stored snapshots, retired id and all.
      expect(stored).toContain("neutralPunctuationPolicy");
      expect(resolveGrammarRuleSelection(await upgrade(stored.slice()))).toEqual(
        DEFAULT_CURRENT_GRAMMAR_RULES,
      );
    });

    test("a customized selection keeps its live rules", async () => {
      const resolved = resolveGrammarRuleSelection(
        await upgrade(["commaPeriodSpacing", "neutralPunctuationPolicy"]),
      );
      expect(resolved).toContain("commaPeriodSpacing");
      expect(resolved).not.toContain("capitalizeSentenceStart");
      expect(resolved).not.toContain("neutralPunctuationPolicy");
    });
  });
});
