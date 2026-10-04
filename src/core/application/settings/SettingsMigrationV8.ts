import { KEY_ENABLED_GRAMMAR_RULES } from "@core/domain/constants";
import { migrateLegacyGrammarRuleSelection } from "@core/domain/grammar/GrammarRuleSettings";
import type { SettingsManager } from "../settingsManager";

export async function migrateSettingsV8(settings: SettingsManager): Promise<void> {
  const existing = await settings.getRaw(KEY_ENABLED_GRAMMAR_RULES);
  const overrides = migrateLegacyGrammarRuleSelection(existing);
  if (overrides) {
    await settings.setRaw(KEY_ENABLED_GRAMMAR_RULES, overrides);
  }
}
