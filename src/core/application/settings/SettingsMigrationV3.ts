import {
  getAliasedSettingFields,
  getSettingStorageAliases,
  getSettingStorageKey,
  type SettingField,
} from "@core/domain/contracts/settings";
import { KEY_AUTO_CAPITALIZE, KEY_LEGACY_APPLY_SPACING_RULES } from "@core/domain/constants";
import type { SettingsManager } from "../settingsManager";
import { readFirstDefinedSetting } from "./settingsAccess";

export async function migrateSettingsV3(settings: SettingsManager): Promise<void> {
  try {
    const fieldsToNormalize: SettingField[] = getAliasedSettingFields();
    for (const field of fieldsToNormalize) {
      const aliases = getSettingStorageAliases(field);
      const canonical = aliases[0];
      const aliasKeys = aliases.slice(1);
      const canonicalValue = await settings.getRaw(canonical);
      const aliasValue = await readFirstDefinedSetting(settings, aliasKeys);

      if (typeof canonicalValue === "undefined" && typeof aliasValue !== "undefined") {
        await settings.setRaw(canonical, aliasValue as never);
      }

      for (const aliasKey of aliasKeys) {
        if (typeof (await settings.getRaw(aliasKey)) !== "undefined") {
          await settings.removeRaw(aliasKey);
        }
      }
    }

    // Migrate legacy applySpacingRules boolean → enabledGrammarRules array
    const legacyValue = await settings.getRaw(KEY_LEGACY_APPLY_SPACING_RULES);
    if (typeof legacyValue !== "undefined") {
      if (legacyValue === true) {
        const grammarKey = getSettingStorageKey("enabledGrammarRules");
        const existing = await settings.getRaw(grammarKey);
        if (typeof existing === "undefined") {
          await settings.setRaw(grammarKey, ["spacingRule"]);
        }
      }
      await settings.setRaw(KEY_LEGACY_APPLY_SPACING_RULES, false);
    }

    // Migrate legacy autoCapitalize boolean to grammar rule selection once.
    // We mark the legacy key as false after migration to avoid re-enabling
    // the rule on every startup if the user later disables it in grammar rules.
    const legacyAutoCapitalize = await settings.getRaw(KEY_AUTO_CAPITALIZE);
    if (legacyAutoCapitalize === true) {
      const grammarKey = getSettingStorageKey("enabledGrammarRules");
      const existing: unknown = await settings.getRaw(grammarKey);
      const currentRules = Array.isArray(existing) ? existing.map((rule) => String(rule)) : [];

      if (!currentRules.includes("capitalizeFirstLetter")) {
        await settings.setRaw(grammarKey, [...currentRules, "capitalizeFirstLetter"]);
      }
      await settings.setRaw(KEY_AUTO_CAPITALIZE, false);
    }
  } catch (error) {
    console.warn("[SettingsMigrationV3] Failed to migrate settings:", error);
  }
}
