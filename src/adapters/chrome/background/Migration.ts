import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { SettingsManager } from "@core/application/settingsManager";
import { getSettingStorageKey } from "@core/domain/contracts/settings";
import { resolveSiteProfiles } from "@core/domain/siteProfiles";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { SiteProfileRepository } from "@core/application/repositories/SiteProfileRepository";

const LEGACY_REVERT_ON_BACKSPACE_KEY = "revertOnBackspace";
const LAST_VERSION_CUTOFF_STORE = "2023.09.30";
const LAST_VERSION_CUTOFF_LANGUAGE = "2024.04.21";

export async function migrateToLocalStore(lastVersion?: string): Promise<void> {
  const currentVersion = chrome.runtime.getManifest().version;
  const settingsManager = new SettingsManager();

  if (shouldMigrate(lastVersion, LAST_VERSION_CUTOFF_STORE)) {
    chrome.storage.sync.get(null, (result: { [key: string]: unknown }) => {
      void chrome.storage.local.set(result);
      void chrome.storage.local.set({ lastVersion: currentVersion });
    });
  }

  if (shouldMigrate(lastVersion, LAST_VERSION_CUTOFF_LANGUAGE)) {
    await migrateLanguageSettings(settingsManager);
  }

  if (typeof settingsManager.removeRaw === "function") {
    await settingsManager.removeRaw(LEGACY_REVERT_ON_BACKSPACE_KEY);
  }

  const coreSettings = new CoreSettingsRepository(settingsManager);
  const siteProfileRepository = new SiteProfileRepository(settingsManager);
  const enabledLanguages = await coreSettings.getEnabledLanguages();
  const rawSiteProfiles = await siteProfileRepository.getRawSiteProfiles();
  await siteProfileRepository.setSiteProfiles(resolveSiteProfiles(rawSiteProfiles, enabledLanguages));

  void chrome.storage.local.set({ lastVersion: currentVersion });
}

function shouldMigrate(lastVersion: string | undefined, cutoffVersion: string): boolean {
  return (
    !lastVersion ||
    lastVersion.localeCompare(cutoffVersion, undefined, {
      numeric: true,
      sensitivity: "base",
    }) <= 0
  );
}

async function migrateLanguageSettings(settingsManager: SettingsManager): Promise<void> {
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
