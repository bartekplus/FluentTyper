import { describe, expect, test } from "bun:test";
import { migrateSettingsV6 } from "../src/core/application/settings/SettingsMigrationV6";
import type { SettingsManager } from "../src/core/application/settingsManager";
import {
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_GRAMMAR_RULES_V3_BACKUP,
  KEY_GRAMMAR_RULES_V3_MIGRATED,
} from "../src/core/domain/constants";
import {
  DEFAULT_V3_GRAMMAR_RULES,
  PRE_V3_RECOMMENDED_GRAMMAR_RULES,
} from "../src/core/domain/grammar/ruleCatalog";

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

describe("migrateSettingsV6", () => {
  test("upgrades to v3 safe-on defaults only when selection still equals pre-v3 recommended set", async () => {
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: PRE_V3_RECOMMENDED_GRAMMAR_RULES.slice(),
    });

    await migrateSettingsV6(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(DEFAULT_V3_GRAMMAR_RULES);
    expect(settings.store[KEY_GRAMMAR_RULES_V3_BACKUP]).toEqual(PRE_V3_RECOMMENDED_GRAMMAR_RULES);
    expect(settings.store[KEY_GRAMMAR_RULES_V3_MIGRATED]).toBe(true);
  });

  test("keeps custom rule selection unchanged", async () => {
    const customRules = ["capitalizeSentenceStart", "commaPeriodSpacing"];
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: customRules,
    });

    await migrateSettingsV6(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(customRules);
    expect(settings.store[KEY_GRAMMAR_RULES_V3_BACKUP]).toEqual(customRules);
    expect(settings.store[KEY_GRAMMAR_RULES_V3_MIGRATED]).toBe(true);
  });

  test("is idempotent when migration marker exists", async () => {
    const customRules = ["capitalizeSentenceStart"];
    const settings = createMockSettingsManager({
      [KEY_ENABLED_GRAMMAR_RULES]: customRules,
      [KEY_GRAMMAR_RULES_V3_BACKUP]: ["backup"],
      [KEY_GRAMMAR_RULES_V3_MIGRATED]: true,
    });

    await migrateSettingsV6(settings);

    expect(settings.store[KEY_ENABLED_GRAMMAR_RULES]).toEqual(customRules);
    expect(settings.store[KEY_GRAMMAR_RULES_V3_BACKUP]).toEqual(["backup"]);
  });
});
