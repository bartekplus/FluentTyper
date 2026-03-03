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
    set: async (key: string, value: unknown) => {
      store[key] = value;
    },
  } as unknown as SettingsManager & { store: Record<string, unknown> };
}

describe("migrateSettingsV3 – applySpacingRules migration", () => {
  test("migrates applySpacingRules=true to enabledGrammarRules=[spacingRule]", async () => {
    const settings = createMockSettingsManager({ applySpacingRules: true });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["spacingRule"]);
  });

  test("merges spacingRule into existing enabledGrammarRules", async () => {
    const settings = createMockSettingsManager({
      applySpacingRules: true,
      enabledGrammarRules: ["capitalizeFirstLetter"],
    });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["capitalizeFirstLetter", "spacingRule"]);
  });

  test("does not duplicate spacingRule if already present", async () => {
    const settings = createMockSettingsManager({
      applySpacingRules: true,
      enabledGrammarRules: ["spacingRule"],
    });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toEqual(["spacingRule"]);
  });

  test("does not migrate when applySpacingRules=false", async () => {
    const settings = createMockSettingsManager({ applySpacingRules: false });

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toBeUndefined();
  });

  test("does not migrate when applySpacingRules is absent", async () => {
    const settings = createMockSettingsManager({});

    await migrateSettingsV3(settings);

    expect(settings.store["enabledGrammarRules"]).toBeUndefined();
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
