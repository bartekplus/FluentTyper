import { describe, test, expect } from "bun:test";
import { migrateSettingsV3 } from "../src/core/application/settings/SettingsMigrationV3";
import { readSettingWithAliases } from "../src/core/application/settings/settingsAccess";
import { memorySettings } from "./support/fakeSettings";

describe("migrateSettingsV3 – applySpacingRules migration", () => {
  test("migrates applySpacingRules=true to enabledGrammarRules=[spacingRule]", async () => {
    const settings = memorySettings({ applySpacingRules: true });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["spacingRule"]);
    expect(settings.store["applySpacingRules"]).toBe(false);
  });

  test("does not migrate spacingRule if enabledGrammarRules is already initialized", async () => {
    const settings = memorySettings({
      applySpacingRules: true,
      enabledGrammarRules: ["capitalizeFirstLetter"],
    });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["capitalizeFirstLetter"]);
    expect(settings.store["applySpacingRules"]).toBe(false);
  });

  test("does not migrate when applySpacingRules=false", async () => {
    const settings = memorySettings({ applySpacingRules: false });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toBeUndefined();
    expect(settings.store["applySpacingRules"]).toBe(false);
  });

  test("does not migrate when applySpacingRules is absent", async () => {
    const settings = memorySettings({});

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toBeUndefined();
    expect(settings.store["applySpacingRules"]).toBeUndefined();
  });

  test("migrates autoCapitalize=true to enabledGrammarRules including capitalizeFirstLetter", async () => {
    const settings = memorySettings({ autoCapitalize: true });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["capitalizeFirstLetter"]);
    expect(settings.store["autoCapitalize"]).toBe(false);
  });

  test("migrates applySpacingRules and autoCapitalize together", async () => {
    const settings = memorySettings({
      applySpacingRules: true,
      autoCapitalize: true,
    });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["spacingRule", "capitalizeFirstLetter"]);
    expect(settings.store["applySpacingRules"]).toBe(false);
    expect(settings.store["autoCapitalize"]).toBe(false);
  });

  test.each([
    ["applySpacingRules", "spacingRule"],
    ["autoCapitalize", "capitalizeFirstLetter"],
  ])("does not re-apply %s after the user clears enabledGrammarRules", async (legacyKey, rule) => {
    const settings = memorySettings({ [legacyKey]: true });

    await migrateSettingsV3(settings);
    expect(settings.store["enabledGrammarRules"]).toEqual([rule]);
    expect(settings.store[legacyKey]).toBe(false);

    await settings.set("enabledGrammarRules", []);
    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual([]);
    expect(settings.store[legacyKey]).toBe(false);
  });

  test("normalizes tribute alias keys to suggestion canonical keys", async () => {
    const settings = memorySettings({
      tributeBgLight: "#abc123",
      tributeTextLight: "#111111",
    });

    await migrateSettingsV3(settings);

    expect(settings.store["suggestionBgLight"]).toBe("#abc123");
    expect(settings.store["suggestionTextLight"]).toBe("#111111");
    expect(settings.store["tributeBgLight"]).toBeUndefined();
    expect(settings.store["tributeTextLight"]).toBeUndefined();
  });
});

describe("readSettingWithAliases", () => {
  test("reads canonical key", async () => {
    const settings = memorySettings({ enable: true });
    const value = await readSettingWithAliases(settings, "enabled");
    expect(value).toBe(true);
  });

  test("falls back to alias when canonical is absent", async () => {
    const settings = memorySettings({ enabled: true });
    const value = await readSettingWithAliases(settings, "enabled");
    expect(value).toBe(true);
  });
});
