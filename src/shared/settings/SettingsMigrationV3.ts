import { getSettingStorageAliases, SettingField } from "../contracts/settings";
import type { JsonValue } from "../settingsManager";
import { SettingsManager } from "../settingsManager";

async function readFirstDefined(
  settings: SettingsManager,
  keys: string[],
): Promise<unknown> {
  for (const key of keys) {
    const value = await settings.get(key);
    if (typeof value !== "undefined") {
      return value;
    }
  }
  return undefined;
}

export async function readSettingWithAliases(
  settings: SettingsManager,
  field: SettingField,
): Promise<unknown> {
  return readFirstDefined(settings, getSettingStorageAliases(field));
}

export async function migrateSettingsV3(
  settings: SettingsManager,
): Promise<void> {
  try {
    const fieldsToNormalize: SettingField[] = ["enabled"];
    for (const field of fieldsToNormalize) {
      const aliases = getSettingStorageAliases(field);
      const canonical = aliases[0];
      const value = await readFirstDefined(settings, aliases);
      if (typeof value === "undefined") {
        continue;
      }
      await settings.set(canonical, value as JsonValue);
    }
  } catch (error) {
    console.warn("[SettingsMigrationV3] Failed to migrate settings:", error);
  }
}
