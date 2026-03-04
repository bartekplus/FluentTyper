import { describe, expect, test } from "bun:test";
import { migrateSettingsV5 } from "../src/core/application/settings/SettingsMigrationV5";
import type { SettingsManager } from "../src/core/application/settingsManager";
import {
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_GRAMMAR_RULES_V2_BACKUP,
  KEY_GRAMMAR_RULES_V2_MIGRATED,
} from "../src/core/domain/constants";
import { RECOMMENDED_V2_GRAMMAR_RULES } from "../src/core/domain/grammar/ruleCatalog";

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

describe("migrateSettingsV5", () => {
  test("force-sets recommended v2 grammar rules and stores exact backup once", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: ["legacyX", "commaPeriodSpacing", "commaPeriodSpacing"],
    });

    await migrateSettingsV5(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(RECOMMENDED_V2_GRAMMAR_RULES);
    expect(settings.store[KEY_GRAMMAR_RULES_V2_BACKUP]).toEqual([
      "legacyX",
      "commaPeriodSpacing",
      "commaPeriodSpacing",
    ]);
    expect(settings.store[KEY_GRAMMAR_RULES_V2_MIGRATED]).toBe(true);
  });

  test("is idempotent when migration marker is already set", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: ["customRule"],
      [KEY_GRAMMAR_RULES_V2_BACKUP]: ["existingBackup"],
      [KEY_GRAMMAR_RULES_V2_MIGRATED]: true,
    });

    await migrateSettingsV5(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(["customRule"]);
    expect(settings.store[KEY_GRAMMAR_RULES_V2_BACKUP]).toEqual(["existingBackup"]);
    expect(settings.store[KEY_GRAMMAR_RULES_V2_MIGRATED]).toBe(true);
  });
});
