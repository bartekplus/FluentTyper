import { describe, test, expect } from "bun:test";
import {
  migrateSettingsV3,
  readSettingWithAliases,
} from "../src/core/application/settings/SettingsMigrationV3";
import type { SettingsManager } from "../src/core/application/settingsManager";

function createMockSettingsManager(
  seed: Record<string, unknown>,
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
      store[key] = value;
    },
    removeRaw: async (key: string) => {
      delete store[key];
    },
  } as unknown as SettingsManager & { store: Record<string, unknown> };
}

describe("migrateSettingsV3 – applySpacingRules migration", () => {
  test("migrates applySpacingRules=true to enabledGrammarRules=[spacingRule]", async () => {
    const settings = createMockSettingsManager({ applySpacingRules: true });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["spacingRule"]);
    expect(settings.store["applySpacingRules"]).toBe(false);
  });

  test("does not migrate spacingRule if enabledGrammarRules is already initialized", async () => {
    const settings = createMockSettingsManager({
      applySpacingRules: true,
      enabledGrammarRules: ["capitalizeFirstLetter"],
    });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["capitalizeFirstLetter"]);
    expect(settings.store["applySpacingRules"]).toBe(false);
  });

  test("does not migrate when applySpacingRules=false", async () => {
    const settings = createMockSettingsManager({ applySpacingRules: false });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toBeUndefined();
    expect(settings.store["applySpacingRules"]).toBe(false);
  });

  test("does not migrate when applySpacingRules is absent", async () => {
    const settings = createMockSettingsManager({});

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toBeUndefined();
    expect(settings.store["applySpacingRules"]).toBeUndefined();
  });

  test("migrate once -> user sets enabledGrammarRules=[] -> rerun migration -> value must stay []", async () => {
    const settings = createMockSettingsManager({ applySpacingRules: true });

    // First migration
    await migrateSettingsV3(settings);
    expect(settings.store["enabledGrammarRules"]).toEqual(["spacingRule"]);
    expect(settings.store["applySpacingRules"]).toBe(false);

    // User explicitly disables the rule
    await settings.set("enabledGrammarRules", []);

    // Rerun migration
    await migrateSettingsV3(settings);

    // Value must stay []
    expect(settings.store["enabledGrammarRules"]).toEqual([]);
    expect(settings.store["applySpacingRules"]).toBe(false);
  });

  test("migrates autoCapitalize=true to enabledGrammarRules including capitalizeFirstLetter", async () => {
    const settings = createMockSettingsManager({ autoCapitalize: true });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["capitalizeFirstLetter"]);
    expect(settings.store["autoCapitalize"]).toBe(false);
  });

  test("migrates applySpacingRules and autoCapitalize together", async () => {
    const settings = createMockSettingsManager({
      applySpacingRules: true,
      autoCapitalize: true,
    });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["spacingRule", "capitalizeFirstLetter"]);
    expect(settings.store["applySpacingRules"]).toBe(false);
    expect(settings.store["autoCapitalize"]).toBe(false);
  });

  test("does not re-apply capitalizeFirstLetter after migration marker", async () => {
    const settings = createMockSettingsManager({ autoCapitalize: true });

    await migrateSettingsV3(settings);
    expect(settings.store["enabledGrammarRules"]).toEqual(["capitalizeFirstLetter"]);
    expect(settings.store["autoCapitalize"]).toBe(false);

    await settings.set("enabledGrammarRules", []);
    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual([]);
    expect(settings.store["autoCapitalize"]).toBe(false);
  });

  test("normalizes tribute alias keys to suggestion canonical keys", async () => {
    const settings = createMockSettingsManager({
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
    const settings = createMockSettingsManager({ enable: true });
    const value = await readSettingWithAliases(settings, "enabled");
    expect(value).toBe(true);
  });

  test("falls back to alias when canonical is absent", async () => {
    const settings = createMockSettingsManager({ enabled: true });
    const value = await readSettingWithAliases(settings, "enabled");
    expect(value).toBe(true);
  });
});
