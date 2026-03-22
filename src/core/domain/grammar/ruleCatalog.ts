import type { GrammarRuleCatalogEntry } from "./types";

export const GRAMMAR_RULE_CATALOG: readonly GrammarRuleCatalogEntry[] = [
  {
    id: "capitalizeSentenceStart",
    name: "Capitalize sentence starts",
    titleI18nKey: "grammar_rule_capitalize_sentence_start",
    descriptionI18nKey: "grammar_rule_capitalize_sentence_start_desc",
    exampleI18nKey: "grammar_rule_capitalize_sentence_start_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
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
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 20,
  },
  {
    id: "englishPronounICapitalization",
    name: "Capitalize English pronoun I",
    titleI18nKey: "grammar_rule_english_pronoun_i",
    descriptionI18nKey: "grammar_rule_english_pronoun_i_desc",
    exampleI18nKey: "grammar_rule_english_pronoun_i_example",
    languageScope: "en_US",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 25,
  },
  {
    id: "englishContractionNormalization",
    name: "Normalize English contractions",
    titleI18nKey: "grammar_rule_english_contractions",
    descriptionI18nKey: "grammar_rule_english_contractions_desc",
    exampleI18nKey: "grammar_rule_english_contractions_example",
    languageScope: "en_US",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 26,
  },
  {
    id: "englishTypoWhitelistCorrection",
    name: "Correct common English typos",
    titleI18nKey: "grammar_rule_english_typos",
    descriptionI18nKey: "grammar_rule_english_typos_desc",
    exampleI18nKey: "grammar_rule_english_typos_example",
    languageScope: "en_US",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 27,
  },
  {
    id: "doubleSpaceToPeriod",
    name: "Convert double-space to period",
    titleI18nKey: "grammar_rule_double_space_to_period",
    descriptionI18nKey: "grammar_rule_double_space_to_period_desc",
    exampleI18nKey: "grammar_rule_double_space_to_period_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 28,
  },
  {
    id: "englishModalOfCorrection",
    name: "Fix modal verb phrase could of",
    titleI18nKey: "grammar_rule_english_modal_of",
    descriptionI18nKey: "grammar_rule_english_modal_of_desc",
    exampleI18nKey: "grammar_rule_english_modal_of_example",
    languageScope: "en_US",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 29,
  },
  {
    id: "englishYourWelcomeCorrection",
    name: "Fix your welcome phrase",
    titleI18nKey: "grammar_rule_english_your_welcome",
    descriptionI18nKey: "grammar_rule_english_your_welcome_desc",
    exampleI18nKey: "grammar_rule_english_your_welcome_example",
    languageScope: "en_US",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 30,
  },
  {
    id: "englishTheirThereBeVerb",
    name: "Fix their is to there is",
    titleI18nKey: "grammar_rule_english_their_there_be",
    descriptionI18nKey: "grammar_rule_english_their_there_be_desc",
    exampleI18nKey: "grammar_rule_english_their_there_be_example",
    languageScope: "en_US",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 31,
  },
  {
    id: "englishAlotCorrection",
    name: "Correct alot to a lot",
    titleI18nKey: "grammar_rule_english_alot",
    descriptionI18nKey: "grammar_rule_english_alot_desc",
    exampleI18nKey: "grammar_rule_english_alot_example",
    languageScope: "en_US",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 32,
  },
  {
    id: "englishPronounVerbWhitelistAgreement",
    name: "Fix common pronoun-verb mismatches",
    titleI18nKey: "grammar_rule_english_pronoun_verb_agreement",
    descriptionI18nKey: "grammar_rule_english_pronoun_verb_agreement_desc",
    exampleI18nKey: "grammar_rule_english_pronoun_verb_agreement_example",
    languageScope: "en_US",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 33,
  },
  {
    id: "technicalTokenCompaction",
    name: "Compact technical token spacing",
    titleI18nKey: "grammar_rule_technical_compaction",
    descriptionI18nKey: "grammar_rule_technical_compaction_desc",
    exampleI18nKey: "grammar_rule_technical_compaction_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 40,
  },
  {
    id: "mathOperatorSpacing",
    name: "Math operator spacing",
    titleI18nKey: "grammar_rule_math_operator_spacing",
    descriptionI18nKey: "grammar_rule_math_operator_spacing_desc",
    exampleI18nKey: "grammar_rule_math_operator_spacing_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 50,
  },
  {
    id: "slashContextSpacing",
    name: "Slash context spacing",
    titleI18nKey: "grammar_rule_slash_context_spacing",
    descriptionI18nKey: "grammar_rule_slash_context_spacing_desc",
    exampleI18nKey: "grammar_rule_slash_context_spacing_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 60,
  },
  {
    id: "openingBracketSpacing",
    name: "Opening bracket spacing",
    titleI18nKey: "grammar_rule_opening_bracket_spacing",
    descriptionI18nKey: "grammar_rule_opening_bracket_spacing_desc",
    exampleI18nKey: "grammar_rule_opening_bracket_spacing_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 70,
  },
  {
    id: "closingBracketSpacing",
    name: "Closing bracket spacing",
    titleI18nKey: "grammar_rule_closing_bracket_spacing",
    descriptionI18nKey: "grammar_rule_closing_bracket_spacing_desc",
    exampleI18nKey: "grammar_rule_closing_bracket_spacing_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 80,
  },
  {
    id: "commaPeriodSpacing",
    name: "Comma and period spacing",
    titleI18nKey: "grammar_rule_comma_period_spacing",
    descriptionI18nKey: "grammar_rule_comma_period_spacing_desc",
    exampleI18nKey: "grammar_rule_comma_period_spacing_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 90,
  },
  {
    id: "collapseRepeatedSpaces",
    name: "Collapse repeated spaces",
    titleI18nKey: "grammar_rule_collapse_repeated_spaces",
    descriptionI18nKey: "grammar_rule_collapse_repeated_spaces_desc",
    exampleI18nKey: "grammar_rule_collapse_repeated_spaces_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 100,
  },
  {
    id: "trimSpaceBeforeLineBreak",
    name: "Trim spaces before line breaks",
    titleI18nKey: "grammar_rule_trim_space_before_line_break",
    descriptionI18nKey: "grammar_rule_trim_space_before_line_break_desc",
    exampleI18nKey: "grammar_rule_trim_space_before_line_break_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 110,
  },
  {
    id: "neutralPunctuationPolicy",
    name: "Neutral spacing for : ; ! ?",
    titleI18nKey: "grammar_rule_neutral_punctuation",
    descriptionI18nKey: "grammar_rule_neutral_punctuation_desc",
    exampleI18nKey: "grammar_rule_neutral_punctuation_example",
    languageScope: "all",
    safetyTier: "safe",
    defaultRollout: "on",
    recommended: true,
    defaultEnabled: true,
    priority: 120,
  },
  {
    id: "ellipsisShortcut",
    name: "Replace three dots with ellipsis",
    titleI18nKey: "grammar_rule_ellipsis_shortcut",
    descriptionI18nKey: "grammar_rule_ellipsis_shortcut_desc",
    exampleI18nKey: "grammar_rule_ellipsis_shortcut_example",
    languageScope: "all",
    safetyTier: "advanced",
    defaultRollout: "off",
    recommended: false,
    defaultEnabled: false,
    priority: 130,
  },
  {
    id: "emdashShortcut",
    name: "Replace double hyphen with em dash",
    titleI18nKey: "grammar_rule_emdash_shortcut",
    descriptionI18nKey: "grammar_rule_emdash_shortcut_desc",
    exampleI18nKey: "grammar_rule_emdash_shortcut_example",
    languageScope: "all",
    safetyTier: "advanced",
    defaultRollout: "off",
    recommended: false,
    defaultEnabled: false,
    priority: 131,
  },
  {
    id: "smartQuoteNormalization",
    name: "Normalize straight quotes",
    titleI18nKey: "grammar_rule_smart_quote_normalization",
    descriptionI18nKey: "grammar_rule_smart_quote_normalization_desc",
    exampleI18nKey: "grammar_rule_smart_quote_normalization_example",
    languageScope: "all",
    safetyTier: "advanced",
    defaultRollout: "off",
    recommended: false,
    defaultEnabled: false,
    priority: 132,
  },
  {
    id: "duplicatePunctuationCollapse",
    name: "Collapse accidental duplicate punctuation",
    titleI18nKey: "grammar_rule_duplicate_punctuation_collapse",
    descriptionI18nKey: "grammar_rule_duplicate_punctuation_collapse_desc",
    exampleI18nKey: "grammar_rule_duplicate_punctuation_collapse_example",
    languageScope: "all",
    safetyTier: "advanced",
    defaultRollout: "off",
    recommended: false,
    defaultEnabled: false,
    priority: 133,
  },
  {
    id: "autoBracketClose",
    name: "Auto-close brackets and quotes",
    titleI18nKey: "grammar_rule_auto_bracket_close",
    descriptionI18nKey: "grammar_rule_auto_bracket_close_desc",
    exampleI18nKey: "grammar_rule_auto_bracket_close_example",
    languageScope: "all",
    safetyTier: "advanced",
    defaultRollout: "off",
    recommended: false,
    defaultEnabled: false,
    priority: 134,
  },
] as const;

export type CatalogRuleId = (typeof GRAMMAR_RULE_CATALOG)[number]["id"];

export const GRAMMAR_RULE_IDS: CatalogRuleId[] = GRAMMAR_RULE_CATALOG.map((entry) => entry.id);

const V1_RECOMMENDED_RULES: CatalogRuleId[] = [
  "capitalizeSentenceStart",
  "capitalizeAfterLineBreak",
  "technicalTokenCompaction",
  "mathOperatorSpacing",
  "slashContextSpacing",
  "openingBracketSpacing",
  "closingBracketSpacing",
  "commaPeriodSpacing",
  "collapseRepeatedSpaces",
  "trimSpaceBeforeLineBreak",
  "neutralPunctuationPolicy",
];

const V2_RECOMMENDED_MIDDLE_RULES: CatalogRuleId[] = [
  "englishPronounICapitalization",
  "englishContractionNormalization",
  "englishTypoWhitelistCorrection",
];

// This is the pre-v3 recommended set (current users migrated by V5).
const V2_RECOMMENDED_RULES: CatalogRuleId[] = [
  ...V1_RECOMMENDED_RULES.slice(0, 2),
  ...V2_RECOMMENDED_MIDDLE_RULES,
  ...V1_RECOMMENDED_RULES.slice(2),
];

const copyRuleIds = (ruleIds: readonly CatalogRuleId[]): CatalogRuleId[] => [...ruleIds];

export const DEFAULT_V1_GRAMMAR_RULES: CatalogRuleId[] = copyRuleIds(V1_RECOMMENDED_RULES);

export const RECOMMENDED_V1_GRAMMAR_RULES: CatalogRuleId[] = copyRuleIds(V1_RECOMMENDED_RULES);

export const DEFAULT_V2_GRAMMAR_RULES: CatalogRuleId[] = copyRuleIds(V2_RECOMMENDED_RULES);

export const RECOMMENDED_V2_GRAMMAR_RULES: CatalogRuleId[] = copyRuleIds(V2_RECOMMENDED_RULES);

export const DEFAULT_V3_GRAMMAR_RULES: CatalogRuleId[] = GRAMMAR_RULE_CATALOG.filter(
  (entry) => entry.defaultRollout === "on",
).map((entry) => entry.id);

export const RECOMMENDED_V3_GRAMMAR_RULES: CatalogRuleId[] = GRAMMAR_RULE_CATALOG.filter(
  (entry) => entry.recommended,
).map((entry) => entry.id);

export const PRE_V3_RECOMMENDED_GRAMMAR_RULES: CatalogRuleId[] = RECOMMENDED_V2_GRAMMAR_RULES;

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
