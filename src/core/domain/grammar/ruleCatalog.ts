import type { GrammarRuleCatalogEntry, GrammarRuleId } from "./types";

export const GRAMMAR_RULE_CATALOG: readonly GrammarRuleCatalogEntry[] = [
  {
    id: "englishSubjectVerbAgreement",
    typing: false,
    titleI18nKey: "review_msg_pronoun_verb",
    languageScope: "en_US",
    priority: 163,
  },
  {
    id: "englishPhraseCorrections",
    typing: false,
    titleI18nKey: "review_msg_phrase_correction",
    languageScope: "en_US",
    // Lowest priorities: a more specific rule proposing the same edit explains it.
    priority: 3,
  },
  {
    id: "englishClosedCompounds",
    typing: false,
    titleI18nKey: "review_msg_closed_compound",
    languageScope: "en_US",
    priority: 2,
  },
  {
    id: "styleRedundancy",
    typing: false,
    titleI18nKey: "review_msg_style_redundancy",
    languageScope: "en_US",
    priority: 162,
  },
  {
    id: "styleLongSentence",
    typing: false,
    titleI18nKey: "review_msg_style_long_sentence",
    languageScope: "all",
    priority: 161,
  },
  {
    id: "stylePhrasing",
    typing: false,
    titleI18nKey: "review_msg_style_phrasing",
    languageScope: "en_US",
    priority: 1,
  },
  // Opt-in register and list-punctuation styles; the two serial-comma styles oppose each other.
  {
    id: "styleContractions",
    typing: false,
    titleI18nKey: "review_msg_avoid_contractions",
    languageScope: "en_US",
    priority: 1,
  },
  {
    id: "styleOxfordComma",
    typing: false,
    titleI18nKey: "review_msg_oxford_comma",
    languageScope: "en_US",
    priority: 1,
  },
  {
    id: "styleNoOxfordComma",
    typing: false,
    titleI18nKey: "review_msg_no_oxford_comma",
    languageScope: "en_US",
    priority: 1,
  },
  // Opt-in: the other accepted form of a phrase whose usual form stylePhrasing may suggest.
  {
    id: "styleAlternativePhrasing",
    typing: false,
    titleI18nKey: "review_msg_alternative_phrasing",
    languageScope: "en_US",
    priority: 1,
  },
  // Opt-in: wording that is usually a mistake but can be correct, and quoted mentions.
  {
    id: "englishPossibleErrors",
    typing: false,
    titleI18nKey: "review_msg_possible_error",
    languageScope: "en_US",
    priority: 1,
  },
  // Opt-in dialects: each converts the other's spellings, words and idioms.
  {
    id: "englishAmericanSpelling",
    typing: false,
    titleI18nKey: "review_msg_american_spelling",
    languageScope: "en_US",
    priority: 1,
  },
  {
    id: "englishBritishSpelling",
    typing: false,
    titleI18nKey: "review_msg_british_spelling",
    languageScope: "en_US",
    priority: 1,
  },
  // Opt-in house style: full words and spelled-out small numbers.
  {
    id: "styleWordChoice",
    typing: false,
    titleI18nKey: "review_msg_word_choice",
    languageScope: "en_US",
    priority: 1,
  },
  {
    id: "styleSpelledNumbers",
    typing: false,
    titleI18nKey: "review_msg_spelled_numbers",
    languageScope: "en_US",
    priority: 1,
  },
  {
    id: "preferredTerminology",
    typing: false,
    titleI18nKey: "review_msg_preferred_terminology",
    languageScope: "all",
    priority: 160,
  },
  {
    id: "englishCanonicalCasing",
    typing: false,
    titleI18nKey: "review_msg_canonical_casing",
    languageScope: "all",
    priority: 159,
  },
  {
    id: "quoteSpacing",
    typing: false,
    titleI18nKey: "review_msg_quote_spacing",
    languageScope: "all",
    priority: 171,
  },
  {
    id: "primeSymbols",
    typing: false,
    titleI18nKey: "review_msg_prime_symbols",
    languageScope: "all",
    priority: 172,
  },
  {
    id: "unclosedQuotation",
    typing: false,
    titleI18nKey: "review_msg_quotation_balance",
    languageScope: "all",
    priority: 158,
  },
  {
    id: "englishUsagePhrases",
    typing: false,
    titleI18nKey: "review_msg_usage_phrases",
    languageScope: "en_US",
    priority: 157,
  },
  {
    id: "englishDoubledDegree",
    typing: false,
    titleI18nKey: "review_msg_doubled_degree",
    languageScope: "en_US",
    priority: 156,
  },
  {
    id: "englishCountability",
    typing: false,
    titleI18nKey: "review_msg_countability",
    languageScope: "en_US",
    priority: 155,
  },
  {
    id: "englishContextualCompounds",
    typing: false,
    titleI18nKey: "review_msg_compounds",
    languageScope: "en_US",
    priority: 154,
  },
  {
    id: "englishNounNumber",
    typing: false,
    titleI18nKey: "review_msg_demonstrative_number",
    languageScope: "en_US",
    priority: 153,
  },
  {
    id: "englishPerfectParticiples",
    typing: false,
    titleI18nKey: "review_msg_perfect_participle",
    languageScope: "en_US",
    priority: 152,
  },
  {
    id: "englishVerbComplements",
    typing: false,
    titleI18nKey: "review_msg_verb_complements",
    languageScope: "en_US",
    priority: 151,
  },
  {
    id: "englishFixedPrepositions",
    typing: false,
    titleI18nKey: "review_msg_fixed_prepositions",
    languageScope: "en_US",
    priority: 150,
  },
  {
    id: "englishItsContext",
    typing: false,
    titleI18nKey: "review_msg_its_contraction",
    languageScope: "en_US",
    priority: 147,
  },
  {
    id: "englishLetsContext",
    typing: false,
    titleI18nKey: "review_msg_lets_contraction",
    languageScope: "en_US",
    priority: 148,
  },
  {
    id: "englishElsePossessive",
    typing: false,
    titleI18nKey: "review_msg_else_possessive",
    languageScope: "en_US",
    priority: 149,
  },
  {
    id: "englishExistentialAgreement",
    typing: false,
    titleI18nKey: "review_msg_existential_agreement",
    languageScope: "en_US",
    priority: 146,
  },
  {
    id: "englishThenThan",
    typing: false,
    titleI18nKey: "review_msg_then_than",
    languageScope: "en_US",
    priority: 142,
  },
  {
    id: "englishYourYouAre",
    typing: false,
    titleI18nKey: "review_msg_your_you_are",
    languageScope: "en_US",
    priority: 143,
  },
  {
    id: "englishTheirThereTheyAre",
    typing: false,
    titleI18nKey: "review_msg_their_possessive",
    languageScope: "en_US",
    priority: 144,
  },
  {
    id: "englishToToo",
    typing: false,
    titleI18nKey: "review_msg_to_too",
    languageScope: "en_US",
    priority: 145,
  },
  {
    id: "englishWereWhere",
    typing: false,
    titleI18nKey: "review_msg_were_where",
    languageScope: "en_US",
    priority: 164,
  },
  {
    id: "englishIrregularForms",
    typing: false,
    titleI18nKey: "review_msg_irregular_form",
    languageScope: "en_US",
    // Below englishUsagePhrases, whose framed "finded" fix explains the same edit better.
    priority: 137,
  },
  {
    id: "englishPossessiveNouns",
    typing: false,
    titleI18nKey: "review_msg_noun_possessive",
    languageScope: "en_US",
    priority: 138,
  },

  {
    id: "englishPronounCase",
    typing: false,
    titleI18nKey: "review_msg_pronoun_subject_case",
    languageScope: "en_US",
    priority: 165,
  },
  {
    id: "englishSentenceStructure",
    typing: false,
    titleI18nKey: "review_msg_sentence_structure",
    languageScope: "en_US",
    priority: 166,
  },
  {
    id: "englishConfusedWords",
    typing: false,
    titleI18nKey: "review_msg_confused_word",
    languageScope: "en_US",
    priority: 120,
  },
  {
    id: "englishAuxiliaryBaseVerb",
    typing: false,
    titleI18nKey: "review_msg_auxiliary_base",
    languageScope: "en_US",
    priority: 141,
  },
  {
    id: "englishRepeatedWords",
    typing: false,
    titleI18nKey: "review_msg_repeated_words",
    languageScope: "all",
    priority: 140,
  },
  {
    id: "capitalizeSentenceStart",
    titleI18nKey: "grammar_rule_capitalize_sentence_start",
    descriptionI18nKey: "grammar_rule_capitalize_sentence_start_desc",
    exampleI18nKey: "grammar_rule_capitalize_sentence_start_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 10,
  },
  {
    id: "capitalizeAfterLineBreak",
    titleI18nKey: "grammar_rule_capitalize_line_break",
    descriptionI18nKey: "grammar_rule_capitalize_line_break_desc",
    exampleI18nKey: "grammar_rule_capitalize_line_break_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 20,
  },
  {
    id: "englishPronounICapitalization",
    titleI18nKey: "grammar_rule_english_pronoun_i",
    descriptionI18nKey: "grammar_rule_english_pronoun_i_desc",
    exampleI18nKey: "grammar_rule_english_pronoun_i_example",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 25,
  },
  {
    id: "englishContractionNormalization",
    titleI18nKey: "grammar_rule_english_contractions",
    descriptionI18nKey: "grammar_rule_english_contractions_desc",
    exampleI18nKey: "grammar_rule_english_contractions_example",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 26,
  },
  {
    id: "englishTypoWhitelistCorrection",
    titleI18nKey: "grammar_rule_english_typos",
    descriptionI18nKey: "grammar_rule_english_typos_desc",
    exampleI18nKey: "grammar_rule_english_typos_example",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 27,
  },
  {
    id: "doubleSpaceToPeriod",
    titleI18nKey: "grammar_rule_double_space_to_period",
    descriptionI18nKey: "grammar_rule_double_space_to_period_desc",
    exampleI18nKey: "grammar_rule_double_space_to_period_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 28,
  },
  {
    id: "englishModalOfCorrection",
    titleI18nKey: "grammar_rule_english_modal_of",
    descriptionI18nKey: "grammar_rule_english_modal_of_desc",
    exampleI18nKey: "grammar_rule_english_modal_of_example",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 29,
  },
  {
    id: "englishYourWelcomeCorrection",
    titleI18nKey: "grammar_rule_english_your_welcome",
    descriptionI18nKey: "grammar_rule_english_your_welcome_desc",
    exampleI18nKey: "grammar_rule_english_your_welcome_example",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 30,
  },
  {
    id: "englishTheirThereBeVerb",
    titleI18nKey: "grammar_rule_english_their_there_be",
    descriptionI18nKey: "grammar_rule_english_their_there_be_desc",
    exampleI18nKey: "grammar_rule_english_their_there_be_example",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 31,
  },
  {
    id: "englishAlotCorrection",
    titleI18nKey: "grammar_rule_english_alot",
    descriptionI18nKey: "grammar_rule_english_alot_desc",
    exampleI18nKey: "grammar_rule_english_alot_example",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 32,
  },
  {
    id: "englishPronounVerbWhitelistAgreement",
    titleI18nKey: "grammar_rule_english_pronoun_verb_agreement",
    descriptionI18nKey: "grammar_rule_english_pronoun_verb_agreement_desc",
    exampleI18nKey: "grammar_rule_english_pronoun_verb_agreement_example",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 33,
  },
  {
    id: "englishArticleAnCorrection",
    titleI18nKey: "grammar_rule_english_article_an",
    descriptionI18nKey: "grammar_rule_english_article_an_desc",
    exampleI18nKey: "grammar_rule_english_article_an_example",
    languageScope: "en_US",
    defaultRollout: "off",
    priority: 34,
  },
  {
    id: "englishOrdinalSuffix",
    titleI18nKey: "grammar_rule_english_ordinal_suffix",
    descriptionI18nKey: "grammar_rule_english_ordinal_suffix_desc",
    exampleI18nKey: "grammar_rule_english_ordinal_suffix_example",
    languageScope: "en_US",
    defaultRollout: "off",
    priority: 35,
  },
  {
    id: "englishProperNounCapitalization",
    titleI18nKey: "grammar_rule_english_proper_nouns",
    descriptionI18nKey: "grammar_rule_english_proper_nouns_desc",
    exampleI18nKey: "grammar_rule_english_proper_nouns_example",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 36,
  },
  {
    id: "technicalTokenCompaction",
    titleI18nKey: "grammar_rule_technical_compaction",
    descriptionI18nKey: "grammar_rule_technical_compaction_desc",
    exampleI18nKey: "grammar_rule_technical_compaction_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 40,
  },
  {
    id: "mathOperatorSpacing",
    titleI18nKey: "grammar_rule_math_operator_spacing",
    descriptionI18nKey: "grammar_rule_math_operator_spacing_desc",
    exampleI18nKey: "grammar_rule_math_operator_spacing_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 50,
  },
  {
    id: "measurementUnitFormatting",
    titleI18nKey: "grammar_rule_measurement_unit_formatting",
    descriptionI18nKey: "grammar_rule_measurement_unit_formatting_desc",
    exampleI18nKey: "grammar_rule_measurement_unit_formatting_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 55,
  },
  {
    id: "currencySpacing",
    titleI18nKey: "grammar_rule_currency_spacing",
    descriptionI18nKey: "grammar_rule_currency_spacing_desc",
    exampleI18nKey: "grammar_rule_currency_spacing_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 56,
  },
  {
    id: "slashContextSpacing",
    titleI18nKey: "grammar_rule_slash_context_spacing",
    descriptionI18nKey: "grammar_rule_slash_context_spacing_desc",
    exampleI18nKey: "grammar_rule_slash_context_spacing_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 60,
  },
  {
    id: "openingBracketSpacing",
    titleI18nKey: "grammar_rule_opening_bracket_spacing",
    descriptionI18nKey: "grammar_rule_opening_bracket_spacing_desc",
    exampleI18nKey: "grammar_rule_opening_bracket_spacing_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 70,
  },
  {
    id: "closingBracketSpacing",
    titleI18nKey: "grammar_rule_closing_bracket_spacing",
    descriptionI18nKey: "grammar_rule_closing_bracket_spacing_desc",
    exampleI18nKey: "grammar_rule_closing_bracket_spacing_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 80,
  },
  {
    id: "commaPeriodSpacing",
    titleI18nKey: "grammar_rule_comma_period_spacing",
    descriptionI18nKey: "grammar_rule_comma_period_spacing_desc",
    exampleI18nKey: "grammar_rule_comma_period_spacing_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 90,
  },
  {
    id: "collapseRepeatedSpaces",
    titleI18nKey: "grammar_rule_collapse_repeated_spaces",
    descriptionI18nKey: "grammar_rule_collapse_repeated_spaces_desc",
    exampleI18nKey: "grammar_rule_collapse_repeated_spaces_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 100,
  },
  {
    id: "trimSpaceBeforeLineBreak",
    titleI18nKey: "grammar_rule_trim_space_before_line_break",
    descriptionI18nKey: "grammar_rule_trim_space_before_line_break_desc",
    exampleI18nKey: "grammar_rule_trim_space_before_line_break_example",
    languageScope: "all",
    defaultRollout: "on",
    priority: 110,
  },
  {
    id: "ellipsisShortcut",
    titleI18nKey: "grammar_rule_ellipsis_shortcut",
    descriptionI18nKey: "grammar_rule_ellipsis_shortcut_desc",
    exampleI18nKey: "grammar_rule_ellipsis_shortcut_example",
    languageScope: "all",
    defaultRollout: "off",
    priority: 130,
  },
  {
    id: "emdashShortcut",
    titleI18nKey: "grammar_rule_emdash_shortcut",
    descriptionI18nKey: "grammar_rule_emdash_shortcut_desc",
    exampleI18nKey: "grammar_rule_emdash_shortcut_example",
    languageScope: "all",
    defaultRollout: "off",
    priority: 131,
  },
  {
    id: "smartQuoteNormalization",
    titleI18nKey: "grammar_rule_smart_quote_normalization",
    descriptionI18nKey: "grammar_rule_smart_quote_normalization_desc",
    exampleI18nKey: "grammar_rule_smart_quote_normalization_example",
    languageScope: "all",
    defaultRollout: "off",
    priority: 132,
  },
  {
    id: "frenchPunctuationSpacing",
    titleI18nKey: "grammar_rule_french_punctuation_spacing",
    descriptionI18nKey: "grammar_rule_french_punctuation_spacing_desc",
    exampleI18nKey: "grammar_rule_french_punctuation_spacing_example",
    languageScope: "all",
    defaultRollout: "off",
    priority: 133,
  },
  {
    id: "duplicatePunctuationCollapse",
    titleI18nKey: "grammar_rule_duplicate_punctuation_collapse",
    descriptionI18nKey: "grammar_rule_duplicate_punctuation_collapse_desc",
    exampleI18nKey: "grammar_rule_duplicate_punctuation_collapse_example",
    languageScope: "all",
    defaultRollout: "off",
    priority: 134,
  },
  {
    id: "autoBracketClose",
    titleI18nKey: "grammar_rule_auto_bracket_close",
    descriptionI18nKey: "grammar_rule_auto_bracket_close_desc",
    exampleI18nKey: "grammar_rule_auto_bracket_close_example",
    languageScope: "all",
    defaultRollout: "off",
    priority: 135,
    codeSafe: true,
  },
] as const;

export type CatalogRuleId = (typeof GRAMMAR_RULE_CATALOG)[number]["id"];

export const TYPING_RULE_CATALOG = GRAMMAR_RULE_CATALOG.filter(
  (
    entry,
  ): entry is Extract<GrammarRuleCatalogEntry, { typing?: undefined }> & {
    id: GrammarRuleId;
  } => entry.typing !== false,
);

export const TYPING_RULE_IDS = TYPING_RULE_CATALOG.map((entry) => entry.id);

export const GRAMMAR_RULE_IDS: CatalogRuleId[] = GRAMMAR_RULE_CATALOG.map((entry) => entry.id);

// Historical snapshots below are exact stored values, compared against real
// stored settings by the V4-V6 migrations. They may name retired rules
// ("neutralPunctuationPolicy"), so they are plain strings, never edited.
export const RECOMMENDED_V1_GRAMMAR_RULES: string[] = [
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

// This is the pre-v3 recommended set (current users migrated by V5).
export const RECOMMENDED_V2_GRAMMAR_RULES: string[] = [
  ...RECOMMENDED_V1_GRAMMAR_RULES.slice(0, 2),
  "englishPronounICapitalization",
  "englishContractionNormalization",
  "englishTypoWhitelistCorrection",
  ...RECOMMENDED_V1_GRAMMAR_RULES.slice(2),
];

// Historical snapshots used by V6 migration. Keep these exact when the live catalog grows.
export const DEFAULT_V3_GRAMMAR_RULES: string[] = [
  "capitalizeSentenceStart",
  "capitalizeAfterLineBreak",
  "englishPronounICapitalization",
  "englishContractionNormalization",
  "englishTypoWhitelistCorrection",
  "doubleSpaceToPeriod",
  "englishModalOfCorrection",
  "englishYourWelcomeCorrection",
  "englishTheirThereBeVerb",
  "englishAlotCorrection",
  "englishPronounVerbWhitelistAgreement",
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

export const DEFAULT_CURRENT_GRAMMAR_RULES: CatalogRuleId[] = TYPING_RULE_CATALOG.filter(
  (entry) => entry.defaultRollout === "on",
).map((entry) => entry.id);

const CODE_SAFE_RULE_IDS: ReadonlySet<string> = new Set(
  GRAMMAR_RULE_CATALOG.filter((entry) => entry.codeSafe).map((entry) => entry.id),
);

export function isCodeSafeGrammarRule(ruleId: string): boolean {
  return CODE_SAFE_RULE_IDS.has(ruleId);
}

const LEGACY_RULE_MAP: Record<string, CatalogRuleId[]> = {
  spacingRule: [
    "commaPeriodSpacing",
    "openingBracketSpacing",
    "closingBracketSpacing",
    "slashContextSpacing",
    "mathOperatorSpacing",
    "technicalTokenCompaction",
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
  return TYPING_RULE_IDS.filter((id) => unique.has(id));
}
