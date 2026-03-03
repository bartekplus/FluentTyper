import type { SettingField } from "@core/domain/contracts/settings";
import {
  getAliasedSettingFields,
  getSettingStorageAliases,
  getSettingStorageKey,
} from "@core/domain/contracts/settings";
import { KEY_AUTO_CAPITALIZE, KEY_LEGACY_APPLY_SPACING_RULES } from "@core/domain/constants";
import type { JsonValue } from "../settingsManager";
import type { SettingsManager } from "../settingsManager";

function hasRawRead(settings: SettingsManager): settings is SettingsManager & {
  getRaw: (key: string) => Promise<unknown>;
} {
  return typeof (settings as { getRaw?: unknown }).getRaw === "function";
}

function hasRawWrite(settings: SettingsManager): settings is SettingsManager & {
  setRaw: (key: string, value: JsonValue) => Promise<void>;
  removeRaw: (key: string) => Promise<void>;
} {
  return (
    typeof (settings as { setRaw?: unknown }).setRaw === "function" &&
    typeof (settings as { removeRaw?: unknown }).removeRaw === "function"
  );
}

async function readRaw(settings: SettingsManager, key: string): Promise<unknown> {
  if (hasRawRead(settings)) {
    return settings.getRaw(key);
  }
  return settings.get(key);
}

async function writeRaw(settings: SettingsManager, key: string, value: JsonValue): Promise<void> {
  if (hasRawWrite(settings)) {
    await settings.setRaw(key, value);
    return;
  }
  await settings.set(key, value);
}

async function removeRaw(settings: SettingsManager, key: string): Promise<void> {
  if (hasRawWrite(settings)) {
    await settings.removeRaw(key);
    return;
  }
  await settings.set(key, undefined as unknown as JsonValue);
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
