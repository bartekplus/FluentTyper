import {
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_GRAMMAR_RULES_V1_BACKUP,
  KEY_GRAMMAR_RULES_V1_MIGRATED,
} from "@core/domain/constants";
import {
  RECOMMENDED_V1_GRAMMAR_RULES,
  normalizeGrammarRuleSelection,
} from "@core/domain/grammar/ruleCatalog";
import type { JsonValue } from "../settingsManager";
import type { SettingsManager } from "../settingsManager";

type RawSettingsAccess = {
  getRaw?: (key: string) => Promise<unknown>;
  setRaw?: (key: string, value: JsonValue) => Promise<void>;
};

async function readRaw(settings: SettingsManager, key: string): Promise<unknown> {
  const maybeRawSettings = settings as unknown as RawSettingsAccess;
  if (typeof maybeRawSettings.getRaw === "function") {
    return maybeRawSettings.getRaw(key);
  }
  return settings.get(key);
}

async function writeRaw(settings: SettingsManager, key: string, value: JsonValue): Promise<void> {
  const maybeRawSettings = settings as unknown as RawSettingsAccess;
  if (typeof maybeRawSettings.setRaw === "function") {
    await maybeRawSettings.setRaw(key, value);
    return;
  }
  await settings.set(key, value);
}

export async function migrateSettingsV4(settings: SettingsManager): Promise<void> {
  try {
    const migrated = await readRaw(settings, KEY_GRAMMAR_RULES_V1_MIGRATED);
    if (migrated === true) {
      return;
    }

    const existing = await readRaw(settings, KEY_ENABLED_GRAMMAR_RULES);
    const normalizedExisting = normalizeGrammarRuleSelection(existing);

    const backup = await readRaw(settings, KEY_GRAMMAR_RULES_V1_BACKUP);
    if (!Array.isArray(backup)) {
      await writeRaw(settings, KEY_GRAMMAR_RULES_V1_BACKUP, normalizedExisting as JsonValue);
    }

    await writeRaw(settings, KEY_ENABLED_GRAMMAR_RULES, RECOMMENDED_V1_GRAMMAR_RULES as JsonValue);
    await writeRaw(settings, KEY_GRAMMAR_RULES_V1_MIGRATED, true as JsonValue);
  } catch (error) {
    console.warn("[SettingsMigrationV4] Failed to migrate settings:", error);
  }
}
