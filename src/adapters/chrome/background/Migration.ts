// Handles migration/version logic for FluentTyper extension
import { SUPPORTED_LANGUAGES, resolveEnabledLanguages } from "@core/domain/lang";
import { JsonValue, SettingsManager } from "@core/application/settingsManager";
import { KEY_ENABLED_LANGUAGES, KEY_SITE_PROFILES } from "@core/domain/constants";
import { resolveSiteProfiles } from "@core/domain/siteProfiles";

/**
 * Migrates storage and language settings to the latest version.
 * @param lastVersion - The previous version string.
 */
export async function migrateToLocalStore(lastVersion?: string): Promise<void> {
  const currentVersion = chrome.runtime.getManifest().version;
  const migrateStore =
    !lastVersion ||
    lastVersion.localeCompare("2023.09.30", undefined, {
      numeric: true,
      sensitivity: "base",
    }) <= 0;

  const updateLang =
    !lastVersion ||
    lastVersion.localeCompare("2024.04.21", undefined, {
      numeric: true,
      sensitivity: "base",
    }) <= 0;

  let settingsManager: SettingsManager | null = null;

  if (migrateStore) {
    chrome.storage.sync.get(null, (result: { [key: string]: unknown }) => {
      chrome.storage.local.set(result);
      chrome.storage.local.set({ lastVersion: currentVersion });
    });
  }

  if (updateLang) {
    settingsManager = settingsManager || new SettingsManager();
    const langProps: Array<"language" | "fallbackLanguage"> = [
      "language",
      "fallbackLanguage",
    ];
    for (const langProp of langProps) {
      const language = await settingsManager.get(langProp);
      for (const key of Object.keys(SUPPORTED_LANGUAGES)) {
        if (key.startsWith(language as string)) {
          await settingsManager.set(langProp, key);
          break;
        }
      }
    }
  }

  settingsManager = settingsManager || new SettingsManager();
  const enabledLanguages = resolveEnabledLanguages(
    await settingsManager.get(KEY_ENABLED_LANGUAGES),
  );
  const siteProfiles = resolveSiteProfiles(
    await settingsManager.get(KEY_SITE_PROFILES),
    enabledLanguages,
  );
  await settingsManager.set(
    KEY_SITE_PROFILES,
    siteProfiles as unknown as JsonValue,
  );

  chrome.storage.local.set({ lastVersion: currentVersion });
}
