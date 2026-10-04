import { describe, expect, test } from "bun:test";
import { migrateSettingsV10 } from "../src/core/application/settings/SettingsMigrationV10";
import {
  KEY_LEGACY_DISPLAY_LANG_HEADER,
  KEY_SHOW_SUGGESTION_FOOTER,
} from "../src/core/domain/constants";
import { memorySettings } from "./support/fakeSettings";

describe("migrateSettingsV10", () => {
  test("keeps the prediction language on for users who had turned it on", async () => {
    const settings = memorySettings({ [KEY_LEGACY_DISPLAY_LANG_HEADER]: true });

    await migrateSettingsV10(settings);

    expect(settings.store[KEY_SHOW_SUGGESTION_FOOTER]).toBe(true);
  });

  test("leaves the footer off by default, and never overrides a later choice", async () => {
    const untouched = memorySettings({ [KEY_LEGACY_DISPLAY_LANG_HEADER]: false });
    await migrateSettingsV10(untouched);
    expect(untouched.store[KEY_SHOW_SUGGESTION_FOOTER]).toBeUndefined();

    const turnedOff = memorySettings({
      [KEY_LEGACY_DISPLAY_LANG_HEADER]: true,
      [KEY_SHOW_SUGGESTION_FOOTER]: false,
    });
    await migrateSettingsV10(turnedOff);
    expect(turnedOff.store[KEY_SHOW_SUGGESTION_FOOTER]).toBe(false);
  });
});
