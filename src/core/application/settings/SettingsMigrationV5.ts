import { KEY_GRAMMAR_RULES_V2_BACKUP, KEY_GRAMMAR_RULES_V2_MIGRATED } from "@core/domain/constants";
import {
  RECOMMENDED_V1_GRAMMAR_RULES,
  RECOMMENDED_V2_GRAMMAR_RULES,
} from "@core/domain/grammar/ruleCatalog";
import type { SettingsManager } from "../settingsManager";
import { areStringArraysEqual, migrateGrammarRuleSelection } from "./settingsAccess";

export async function migrateSettingsV5(settings: SettingsManager): Promise<void> {
  await migrateGrammarRuleSelection(settings, {
    label: "SettingsMigrationV5",
    migratedKey: KEY_GRAMMAR_RULES_V2_MIGRATED,
    backupKey: KEY_GRAMMAR_RULES_V2_BACKUP,
    shouldReplace: (snapshot) =>
      snapshot.length === 0 || areStringArraysEqual(snapshot, RECOMMENDED_V1_GRAMMAR_RULES),
    nextRules: RECOMMENDED_V2_GRAMMAR_RULES,
  });
}
