import {
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_GRAMMAR_RULES_V3_BACKUP,
  KEY_GRAMMAR_RULES_V3_MIGRATED,
} from "@core/domain/constants";
import {
  DEFAULT_V3_GRAMMAR_RULES,
  PRE_V3_RECOMMENDED_GRAMMAR_RULES,
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

function getRawGrammarRulesSnapshot(existing: unknown): string[] {
  if (!Array.isArray(existing)) {
    return [];
  }
  return existing.filter((item): item is string => typeof item === "string");
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

export async function migrateSettingsV6(settings: SettingsManager): Promise<void> {
  try {
    const migrated = await readRaw(settings, KEY_GRAMMAR_RULES_V3_MIGRATED);
    if (migrated === true) {
      return;
    }

    const existing = await readRaw(settings, KEY_ENABLED_GRAMMAR_RULES);
    const rawSnapshot = getRawGrammarRulesSnapshot(existing);

    const backup = await readRaw(settings, KEY_GRAMMAR_RULES_V3_BACKUP);
    if (!Array.isArray(backup)) {
      await writeRaw(settings, KEY_GRAMMAR_RULES_V3_BACKUP, rawSnapshot as JsonValue);
    }

    const normalizedExisting = normalizeGrammarRuleSelection(rawSnapshot);
    if (arraysEqual(normalizedExisting, PRE_V3_RECOMMENDED_GRAMMAR_RULES)) {
      await writeRaw(settings, KEY_ENABLED_GRAMMAR_RULES, DEFAULT_V3_GRAMMAR_RULES as JsonValue);
    }

    await writeRaw(settings, KEY_GRAMMAR_RULES_V3_MIGRATED, true as JsonValue);
  } catch (error) {
    console.warn("[SettingsMigrationV6] Failed to migrate settings:", error);
  }
}
