import { describe, expect, test } from "bun:test";
import { migrateSettingsV10 } from "../src/core/application/settings/SettingsMigrationV10";
import type { SettingsManager } from "../src/core/application/settingsManager";
import {
  KEY_LEGACY_DISPLAY_LANG_HEADER,
  KEY_SHOW_SUGGESTION_FOOTER,
} from "../src/core/domain/constants";

function createMockSettingsManager(
  seed: Record<string, unknown>,
): SettingsManager & { store: Record<string, unknown> } {
  const store = { ...seed };
  return {
    store,
    getRaw: async (key: string) => store[key] as never,
    setRaw: async (key: string, value: unknown) => {
      store[key] = value;
    },
  } as unknown as SettingsManager & { store: Record<string, unknown> };
}

describe("migrateSettingsV10", () => {
  test("keeps the prediction language on for users who had turned it on", async () => {
    const settings = createMockSettingsManager({ [KEY_LEGACY_DISPLAY_LANG_HEADER]: true });

    await migrateSettingsV10(settings);

    expect(settings.store[KEY_SHOW_SUGGESTION_FOOTER]).toBe(true);
  });

  test("leaves the footer off by default, and never overrides a later choice", async () => {
    const untouched = createMockSettingsManager({ [KEY_LEGACY_DISPLAY_LANG_HEADER]: false });
    await migrateSettingsV10(untouched);
    expect(untouched.store[KEY_SHOW_SUGGESTION_FOOTER]).toBeUndefined();

    const turnedOff = createMockSettingsManager({
      [KEY_LEGACY_DISPLAY_LANG_HEADER]: true,
      [KEY_SHOW_SUGGESTION_FOOTER]: false,
    });
    await migrateSettingsV10(turnedOff);
    expect(turnedOff.store[KEY_SHOW_SUGGESTION_FOOTER]).toBe(false);
  });
});
