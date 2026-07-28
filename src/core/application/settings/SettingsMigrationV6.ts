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
import type { SettingsManager } from "../settingsManager";
import {
  areStringArraysEqual,
  readRawSetting,
  readStringArraySnapshot,
  writeRawSetting,
} from "./settingsAccess";

export async function migrateSettingsV6(settings: SettingsManager): Promise<void> {
  try {
    const migrated = await readRawSetting(settings, KEY_GRAMMAR_RULES_V3_MIGRATED);
    if (migrated === true) {
      return;
    }

    const existing = await readRawSetting(settings, KEY_ENABLED_GRAMMAR_RULES);
    const rawSnapshot = readStringArraySnapshot(existing);

    const backup = await readRawSetting(settings, KEY_GRAMMAR_RULES_V3_BACKUP);
    if (!Array.isArray(backup)) {
      await writeRawSetting(settings, KEY_GRAMMAR_RULES_V3_BACKUP, rawSnapshot);
    }

    const current = await readRawSetting(settings, KEY_ENABLED_GRAMMAR_RULES);
    const currentSnapshot = readStringArraySnapshot(current);
    const rulesChangedSinceSnapshot = !areStringArraysEqual(currentSnapshot, rawSnapshot);

    const normalizedExisting = normalizeGrammarRuleSelection(rawSnapshot);
    if (
      !rulesChangedSinceSnapshot &&
      areStringArraysEqual(normalizedExisting, PRE_V3_RECOMMENDED_GRAMMAR_RULES)
    ) {
      await writeRawSetting(settings, KEY_ENABLED_GRAMMAR_RULES, DEFAULT_V3_GRAMMAR_RULES);
    }

    await writeRawSetting(settings, KEY_GRAMMAR_RULES_V3_MIGRATED, true);
  } catch (error) {
    console.warn("[SettingsMigrationV6] Failed to migrate settings:", error);
  }
}
