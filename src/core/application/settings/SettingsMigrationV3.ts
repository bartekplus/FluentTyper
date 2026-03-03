import type { SettingField } from "@core/domain/contracts/settings";
import {
  getAliasedSettingFields,
  getSettingStorageAliases,
  getSettingStorageKey,
} from "@core/domain/contracts/settings";
import { KEY_AUTO_CAPITALIZE, KEY_LEGACY_APPLY_SPACING_RULES } from "@core/domain/constants";
import type { JsonValue } from "../settingsManager";
import type { SettingsManager } from "../settingsManager";

async function readRaw(settings: SettingsManager, key: string): Promise<unknown> {
  return settings.getRaw(key);
}

async function writeRaw(settings: SettingsManager, key: string, value: JsonValue): Promise<void> {
  await settings.setRaw(key, value);
}

async function removeRaw(settings: SettingsManager, key: string): Promise<void> {
  await settings.removeRaw(key);
}

async function readFirstDefined(settings: SettingsManager, keys: string[]): Promise<unknown> {
  for (const key of keys) {
    const value = await readRaw(settings, key);
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
    const fieldsToNormalize: SettingField[] = getAliasedSettingFields();
    for (const field of fieldsToNormalize) {
      const aliases = getSettingStorageAliases(field);
      const canonical = aliases[0];
      const aliasKeys = aliases.slice(1);
      const canonicalValue = await readRaw(settings, canonical);
      const aliasValue = await readFirstDefined(settings, aliasKeys);

      if (typeof canonicalValue === "undefined" && typeof aliasValue !== "undefined") {
        await writeRaw(settings, canonical, aliasValue as JsonValue);
      }

      for (const aliasKey of aliasKeys) {
        if (typeof (await readRaw(settings, aliasKey)) !== "undefined") {
          await removeRaw(settings, aliasKey);
        }
      }
    }

    // Migrate legacy applySpacingRules boolean → enabledGrammarRules array
    const legacyValue = await readRaw(settings, KEY_LEGACY_APPLY_SPACING_RULES);
    if (typeof legacyValue !== "undefined") {
      if (legacyValue === true) {
        const grammarKey = getSettingStorageKey("enabledGrammarRules");
        const existing = await readRaw(settings, grammarKey);
        if (typeof existing === "undefined") {
          await writeRaw(settings, grammarKey, ["spacingRule"] as JsonValue);
        }
      }
      await writeRaw(settings, KEY_LEGACY_APPLY_SPACING_RULES, false);
    }

    // Migrate legacy autoCapitalize boolean to grammar rule selection once.
    // We mark the legacy key as false after migration to avoid re-enabling
    // the rule on every startup if the user later disables it in grammar rules.
    const legacyAutoCapitalize = await readRaw(settings, KEY_AUTO_CAPITALIZE);
    if (legacyAutoCapitalize === true) {
      const grammarKey = getSettingStorageKey("enabledGrammarRules");
      const existing = await readRaw(settings, grammarKey);
      const currentRules = Array.isArray(existing) ? existing.map((rule) => String(rule)) : [];

      if (!currentRules.includes("capitalizeFirstLetter")) {
        await writeRaw(settings, grammarKey, [
          ...currentRules,
          "capitalizeFirstLetter",
        ] as JsonValue);
      }
      await writeRaw(settings, KEY_AUTO_CAPITALIZE, false);
    }
  } catch (error) {
    console.warn("[SettingsMigrationV3] Failed to migrate settings:", error);
  }
}
