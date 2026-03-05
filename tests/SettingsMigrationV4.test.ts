import { describe, expect, test } from "bun:test";
import { migrateSettingsV4 } from "../src/core/application/settings/SettingsMigrationV4";
import type { SettingsManager } from "../src/core/application/settingsManager";
import {
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_GRAMMAR_RULES_V1_BACKUP,
  KEY_GRAMMAR_RULES_V1_MIGRATED,
} from "../src/core/domain/constants";
import { RECOMMENDED_V1_GRAMMAR_RULES } from "../src/core/domain/grammar/ruleCatalog";

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

describe("migrateSettingsV4", () => {
  test("force-sets recommended v1 grammar rules and stores exact backup once", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: ["legacyX", "spacingRule", "spacingRule"],
    });

    await migrateSettingsV4(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(RECOMMENDED_V1_GRAMMAR_RULES);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_BACKUP]).toEqual([
      "legacyX",
      "spacingRule",
      "spacingRule",
    ]);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_MIGRATED]).toBe(true);
  });

  test("is idempotent when migration marker is already set", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: ["customRule"],
      [KEY_GRAMMAR_RULES_V1_BACKUP]: ["existingBackup"],
      [KEY_GRAMMAR_RULES_V1_MIGRATED]: true,
    });

    await migrateSettingsV4(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(["customRule"]);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_BACKUP]).toEqual(["existingBackup"]);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_MIGRATED]).toBe(true);
  });

  test("does not overwrite an existing backup value", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: ["spacingRule"],
      [KEY_GRAMMAR_RULES_V1_BACKUP]: ["existingBackup"],
    });

    await migrateSettingsV4(settings);

    expect(settings.store[KEY_GRAMMAR_RULES_V1_BACKUP]).toEqual(["existingBackup"]);
    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(RECOMMENDED_V1_GRAMMAR_RULES);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_MIGRATED]).toBe(true);
  });

  test("falls back to get/set when getRaw/setRaw are unavailable", async () => {
    const store: Record<string, unknown> = {
      [KEY_ENABLED_GRAMMAR_RULES]: ["spacingRule"],
    };
    const settings = {
      get: async (key: string) => store[key] as never,
      set: async (key: string, value: unknown) => {
        store[key] = value;
      },
    } as unknown as SettingsManager;

    await migrateSettingsV4(settings);

    expect(store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(RECOMMENDED_V1_GRAMMAR_RULES);
    expect(store[KEY_GRAMMAR_RULES_V1_BACKUP]).toEqual(["spacingRule"]);
    expect(store[KEY_GRAMMAR_RULES_V1_MIGRATED]).toBe(true);
  });

  test("stores only string entries when existing value is a mixed array", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: ["spacingRule", 42, "spacingRule"],
    });

    await migrateSettingsV4(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(RECOMMENDED_V1_GRAMMAR_RULES);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_BACKUP]).toEqual(["spacingRule", "spacingRule"]);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_MIGRATED]).toBe(true);
  });

  test("stores empty backup when existing value is not an array", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: "spacingRule",
    });

    await migrateSettingsV4(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(RECOMMENDED_V1_GRAMMAR_RULES);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_BACKUP]).toEqual([]);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_MIGRATED]).toBe(true);
  });

  test("preserves custom grammar selection when it no longer uses legacy rule ids", async () => {
    const customSelection = ["commaPeriodSpacing", "duplicatePunctuationCollapse"];
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: customSelection,
    });

    await migrateSettingsV4(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(customSelection);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_BACKUP]).toEqual(customSelection);
    expect(settings.store[KEY_GRAMMAR_RULES_V1_MIGRATED]).toBe(true);
  });
});
