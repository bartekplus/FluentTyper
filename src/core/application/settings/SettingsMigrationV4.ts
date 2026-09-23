import { KEY_GRAMMAR_RULES_V1_BACKUP, KEY_GRAMMAR_RULES_V1_MIGRATED } from "@core/domain/constants";
import { RECOMMENDED_V1_GRAMMAR_RULES } from "@core/domain/grammar/ruleCatalog";
import type { SettingsManager } from "../settingsManager";
import { migrateGrammarRuleSelection } from "./settingsAccess";

export async function migrateSettingsV4(settings: SettingsManager): Promise<void> {
  await migrateGrammarRuleSelection(settings, {
    label: "SettingsMigrationV4",
    migratedKey: KEY_GRAMMAR_RULES_V1_MIGRATED,
    backupKey: KEY_GRAMMAR_RULES_V1_BACKUP,
    shouldReplace: (snapshot) =>
      snapshot.length === 0 ||
      snapshot.some((ruleId) => ruleId === "spacingRule" || ruleId === "capitalizeFirstLetter"),
    nextRules: RECOMMENDED_V1_GRAMMAR_RULES,
  });
}
