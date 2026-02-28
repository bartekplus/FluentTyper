// Handles migration/version logic for FluentTyper extension
import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { SettingsManager } from "@core/application/settingsManager";
import { getSettingStorageKey } from "@core/domain/contracts/settings";
import { resolveSiteProfiles } from "@core/domain/siteProfiles";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { SiteProfileRepository } from "@core/application/repositories/SiteProfileRepository";

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
    const langProps: Array<"language" | "fallbackLanguage"> = ["language", "fallbackLanguage"];
    for (const langProp of langProps) {
      const storageKey = getSettingStorageKey(langProp);
      const language = await settingsManager.get(storageKey);
      for (const key of Object.keys(SUPPORTED_LANGUAGES)) {
        if (typeof language === "string" && key.startsWith(language)) {
          await settingsManager.set(storageKey, key);
          break;
        }
      }
    }
  }

  settingsManager = settingsManager || new SettingsManager();
  const coreSettings = new CoreSettingsRepository(settingsManager);
  const siteProfileRepository = new SiteProfileRepository(settingsManager);
  const enabledLanguages = await coreSettings.getEnabledLanguages();
  const rawSiteProfiles = await siteProfileRepository.getRawSiteProfiles();
  const siteProfiles = resolveSiteProfiles(rawSiteProfiles, enabledLanguages);
  await siteProfileRepository.setSiteProfiles(siteProfiles);

  chrome.storage.local.set({ lastVersion: currentVersion });
}
