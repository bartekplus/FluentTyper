import { KEY_ENABLED_GRAMMAR_RULES } from "@core/domain/constants";
import { migrateLegacyGrammarRuleSelection } from "@core/domain/grammar/GrammarRuleSettings";
import type { SettingsManager } from "../settingsManager";

export async function migrateSettingsV8(settings: SettingsManager): Promise<void> {
  try {
    const existing = await settings.getRaw(KEY_ENABLED_GRAMMAR_RULES);
    const overrides = migrateLegacyGrammarRuleSelection(existing);
    if (overrides) {
      await settings.setRaw(KEY_ENABLED_GRAMMAR_RULES, overrides);
    }
  } catch (error) {
    console.warn("[SettingsMigrationV8] Failed to migrate settings:", error);
  }
}
