import type { SettingField } from "@core/domain/contracts/settings";
import { getSettingStorageAliases, getSettingStorageKey } from "@core/domain/contracts/settings";
import { KEY_LEGACY_APPLY_SPACING_RULES } from "@core/domain/constants";
import type { JsonValue } from "../settingsManager";
import type { SettingsManager } from "../settingsManager";

async function readFirstDefined(settings: SettingsManager, keys: string[]): Promise<unknown> {
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

export async function migrateSettingsV3(settings: SettingsManager): Promise<void> {
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

    // Migrate legacy applySpacingRules boolean → enabledGrammarRules array
    const legacyValue = await settings.get(KEY_LEGACY_APPLY_SPACING_RULES);
    if (typeof legacyValue !== "undefined") {
      if (legacyValue === true) {
        const grammarKey = getSettingStorageKey("enabledGrammarRules");
        const existing = await settings.get(grammarKey);
        if (typeof existing === "undefined") {
          await settings.set(grammarKey, ["spacingRule"] as JsonValue);
        }
      }
      await settings.set(KEY_LEGACY_APPLY_SPACING_RULES, false);
    }
  } catch (error) {
    console.warn("[SettingsMigrationV3] Failed to migrate settings:", error);
  }
}
