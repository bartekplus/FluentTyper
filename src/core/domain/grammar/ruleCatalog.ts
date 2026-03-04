import type { GrammarRuleCatalogEntry } from "./types";

export const GRAMMAR_RULE_CATALOG: readonly GrammarRuleCatalogEntry[] = [
  {
    id: "capitalizeSentenceStart",
    name: "Capitalize sentence starts",
    titleI18nKey: "grammar_rule_capitalize_sentence_start",
    descriptionI18nKey: "grammar_rule_capitalize_sentence_start_desc",
    exampleI18nKey: "grammar_rule_capitalize_sentence_start_example",
    recommended: true,
    defaultEnabled: true,
    priority: 10,
  },
  {
    id: "capitalizeAfterLineBreak",
    name: "Capitalize after line breaks",
    titleI18nKey: "grammar_rule_capitalize_line_break",
    descriptionI18nKey: "grammar_rule_capitalize_line_break_desc",
    exampleI18nKey: "grammar_rule_capitalize_line_break_example",
    recommended: true,
    defaultEnabled: true,
    priority: 20,
  },
  {
    id: "technicalTokenCompaction",
    name: "Compact technical token spacing",
    titleI18nKey: "grammar_rule_technical_compaction",
    descriptionI18nKey: "grammar_rule_technical_compaction_desc",
    exampleI18nKey: "grammar_rule_technical_compaction_example",
    recommended: true,
    defaultEnabled: true,
    priority: 30,
  },
  {
    id: "mathOperatorSpacing",
    name: "Math operator spacing",
    titleI18nKey: "grammar_rule_math_operator_spacing",
    descriptionI18nKey: "grammar_rule_math_operator_spacing_desc",
    exampleI18nKey: "grammar_rule_math_operator_spacing_example",
    recommended: true,
    defaultEnabled: true,
    priority: 40,
  },
  {
    id: "slashContextSpacing",
    name: "Slash context spacing",
    titleI18nKey: "grammar_rule_slash_context_spacing",
    descriptionI18nKey: "grammar_rule_slash_context_spacing_desc",
    exampleI18nKey: "grammar_rule_slash_context_spacing_example",
    recommended: true,
    defaultEnabled: true,
    priority: 50,
  },
  {
    id: "openingBracketSpacing",
    name: "Opening bracket spacing",
    titleI18nKey: "grammar_rule_opening_bracket_spacing",
    descriptionI18nKey: "grammar_rule_opening_bracket_spacing_desc",
    exampleI18nKey: "grammar_rule_opening_bracket_spacing_example",
    recommended: true,
    defaultEnabled: true,
    priority: 60,
  },
  {
    id: "closingBracketSpacing",
    name: "Closing bracket spacing",
    titleI18nKey: "grammar_rule_closing_bracket_spacing",
    descriptionI18nKey: "grammar_rule_closing_bracket_spacing_desc",
    exampleI18nKey: "grammar_rule_closing_bracket_spacing_example",
    recommended: true,
    defaultEnabled: true,
    priority: 70,
  },
  {
    id: "commaPeriodSpacing",
    name: "Comma and period spacing",
    titleI18nKey: "grammar_rule_comma_period_spacing",
    descriptionI18nKey: "grammar_rule_comma_period_spacing_desc",
    exampleI18nKey: "grammar_rule_comma_period_spacing_example",
    recommended: true,
    defaultEnabled: true,
    priority: 80,
  },
  {
    id: "collapseRepeatedSpaces",
    name: "Collapse repeated spaces",
    titleI18nKey: "grammar_rule_collapse_repeated_spaces",
    descriptionI18nKey: "grammar_rule_collapse_repeated_spaces_desc",
    exampleI18nKey: "grammar_rule_collapse_repeated_spaces_example",
    recommended: true,
    defaultEnabled: true,
    priority: 90,
  },
  {
    id: "trimSpaceBeforeLineBreak",
    name: "Trim spaces before line breaks",
    titleI18nKey: "grammar_rule_trim_space_before_line_break",
    descriptionI18nKey: "grammar_rule_trim_space_before_line_break_desc",
    exampleI18nKey: "grammar_rule_trim_space_before_line_break_example",
    recommended: true,
    defaultEnabled: true,
    priority: 100,
  },
  {
    id: "neutralPunctuationPolicy",
    name: "Neutral spacing for : ; ! ?",
    titleI18nKey: "grammar_rule_neutral_punctuation",
    descriptionI18nKey: "grammar_rule_neutral_punctuation_desc",
    exampleI18nKey: "grammar_rule_neutral_punctuation_example",
    recommended: true,
    defaultEnabled: true,
    priority: 110,
  },
] as const;

export type CatalogRuleId = (typeof GRAMMAR_RULE_CATALOG)[number]["id"];

export const GRAMMAR_RULE_IDS: CatalogRuleId[] = GRAMMAR_RULE_CATALOG.map((entry) => entry.id);

export const DEFAULT_V1_GRAMMAR_RULES: CatalogRuleId[] = GRAMMAR_RULE_CATALOG.filter(
  (entry) => entry.defaultEnabled,
).map((entry) => entry.id);

export const RECOMMENDED_V1_GRAMMAR_RULES: CatalogRuleId[] = GRAMMAR_RULE_CATALOG.filter(
  (entry) => entry.recommended,
).map((entry) => entry.id);

const LEGACY_RULE_MAP: Record<string, CatalogRuleId[]> = {
  spacingRule: [
    "commaPeriodSpacing",
    "openingBracketSpacing",
    "closingBracketSpacing",
    "slashContextSpacing",
    "mathOperatorSpacing",
    "technicalTokenCompaction",
    "neutralPunctuationPolicy",
  ],
  capitalizeFirstLetter: ["capitalizeSentenceStart", "capitalizeAfterLineBreak"],
};

export function isCatalogRuleId(value: string): value is CatalogRuleId {
  return GRAMMAR_RULE_IDS.includes(value as CatalogRuleId);
}

export function normalizeGrammarRuleSelection(selection: unknown): CatalogRuleId[] {
  const selected = Array.isArray(selection) ? selection.map((item) => String(item)) : [];
  const expanded: CatalogRuleId[] = [];

  for (const ruleId of selected) {
    if (isCatalogRuleId(ruleId)) {
      expanded.push(ruleId);
      continue;
    }

    const mapped = LEGACY_RULE_MAP[ruleId];
    if (mapped) {
      expanded.push(...mapped);
    }
  }

  const unique = new Set(expanded);
  return GRAMMAR_RULE_IDS.filter((id) => unique.has(id));
}
