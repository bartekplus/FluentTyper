import { KEY_GRAMMAR_RULES_V3_BACKUP, KEY_GRAMMAR_RULES_V3_MIGRATED } from "@core/domain/constants";
import {
  DEFAULT_V3_GRAMMAR_RULES,
  RECOMMENDED_V2_GRAMMAR_RULES,
  normalizeGrammarRuleSelection,
} from "@core/domain/grammar/ruleCatalog";
import type { SettingsManager } from "../settingsManager";
import { areStringArraysEqual, migrateGrammarRuleSelection } from "./settingsAccess";

export async function migrateSettingsV6(settings: SettingsManager): Promise<void> {
  await migrateGrammarRuleSelection(settings, {
    label: "SettingsMigrationV6",
    migratedKey: KEY_GRAMMAR_RULES_V3_MIGRATED,
    backupKey: KEY_GRAMMAR_RULES_V3_BACKUP,
    shouldReplace: (snapshot) =>
      areStringArraysEqual(normalizeGrammarRuleSelection(snapshot), RECOMMENDED_V2_GRAMMAR_RULES),
    nextRules: DEFAULT_V3_GRAMMAR_RULES,
  });
}
