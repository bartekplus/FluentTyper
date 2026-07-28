import type { SettingField } from "@core/domain/contracts/settings";
import {
  getAliasedSettingFields,
  getSettingStorageAliases,
  getSettingStorageKey,
} from "@core/domain/contracts/settings";
import { KEY_AUTO_CAPITALIZE, KEY_LEGACY_APPLY_SPACING_RULES } from "@core/domain/constants";
import type { SettingsManager } from "../settingsManager";
import {
  readFirstDefinedSetting,
  readRawSetting,
  removeRawSetting,
  writeRawSetting,
} from "./settingsAccess";

export { readSettingWithAliases } from "./settingsAccess";

export async function migrateSettingsV3(settings: SettingsManager): Promise<void> {
  try {
    const fieldsToNormalize: SettingField[] = getAliasedSettingFields();
    for (const field of fieldsToNormalize) {
      const aliases = getSettingStorageAliases(field);
      const canonical = aliases[0];
      const aliasKeys = aliases.slice(1);
      const canonicalValue = await readRawSetting(settings, canonical);
      const aliasValue = await readFirstDefinedSetting(settings, aliasKeys);

      if (typeof canonicalValue === "undefined" && typeof aliasValue !== "undefined") {
        await writeRawSetting(settings, canonical, aliasValue as never);
      }

      for (const aliasKey of aliasKeys) {
        if (typeof (await readRawSetting(settings, aliasKey)) !== "undefined") {
          await removeRawSetting(settings, aliasKey);
        }
      }
    }

    // Migrate legacy applySpacingRules boolean → enabledGrammarRules array
    const legacyValue = await readRawSetting(settings, KEY_LEGACY_APPLY_SPACING_RULES);
    if (typeof legacyValue !== "undefined") {
      if (legacyValue === true) {
        const grammarKey = getSettingStorageKey("enabledGrammarRules");
        const existing = await readRawSetting(settings, grammarKey);
        if (typeof existing === "undefined") {
          await writeRawSetting(settings, grammarKey, ["spacingRule"] as never);
        }
      }
      await writeRawSetting(settings, KEY_LEGACY_APPLY_SPACING_RULES, false);
    }

    // Migrate legacy autoCapitalize boolean to grammar rule selection once.
    // We mark the legacy key as false after migration to avoid re-enabling
    // the rule on every startup if the user later disables it in grammar rules.
    const legacyAutoCapitalize = await readRawSetting(settings, KEY_AUTO_CAPITALIZE);
    if (legacyAutoCapitalize === true) {
      const grammarKey = getSettingStorageKey("enabledGrammarRules");
      const existing = await readRawSetting(settings, grammarKey);
      const currentRules = Array.isArray(existing) ? existing.map((rule) => String(rule)) : [];

      if (!currentRules.includes("capitalizeFirstLetter")) {
        await writeRawSetting(settings, grammarKey, [
          ...currentRules,
          "capitalizeFirstLetter",
        ] as never);
      }
      await writeRawSetting(settings, KEY_AUTO_CAPITALIZE, false);
    }
  } catch (error) {
    console.warn("[SettingsMigrationV3] Failed to migrate settings:", error);
  }
}
