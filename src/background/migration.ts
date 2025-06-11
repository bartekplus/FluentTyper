// Handles migration/version logic for FluentTyper extension
import { SUPPORTED_LANGUAGES } from "../shared/lang";
import { SettingsManager } from "../shared/settingsManager";

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

  if (migrateStore) {
    chrome.storage.sync.get(null, (result: { [key: string]: any }) => {
      chrome.storage.local.set(result);
      chrome.storage.local.set({ lastVersion: currentVersion });
    });
  }

  if (updateLang) {
    const settingsManager = new SettingsManager();
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
  chrome.storage.local.set({ lastVersion: currentVersion });
}
