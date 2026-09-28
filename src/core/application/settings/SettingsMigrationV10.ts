import { KEY_LEGACY_DISPLAY_LANG_HEADER, KEY_SHOW_SUGGESTION_FOOTER } from "@core/domain/constants";
import type { SettingsManager } from "../settingsManager";

/**
 * "Show language of prediction" became "Show key hints and language", under a
 * new key: users who had turned the language on keep seeing it. Only while the
 * new setting has never been set, so it runs as often as needed and never
 * overrides a later choice.
 */
export async function migrateSettingsV10(settings: SettingsManager): Promise<void> {
  try {
    if ((await settings.getRaw(KEY_SHOW_SUGGESTION_FOOTER)) !== undefined) {
      return;
    }
    if ((await settings.getRaw(KEY_LEGACY_DISPLAY_LANG_HEADER)) === true) {
      await settings.setRaw(KEY_SHOW_SUGGESTION_FOOTER, true);
    }
  } catch (error) {
    console.warn("[SettingsMigrationV10] Failed to migrate settings:", error);
  }
}
