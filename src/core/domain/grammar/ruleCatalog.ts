import type { GrammarRuleCatalogEntry, GrammarRuleId } from "./types";

/** A native Review-only check: off by default, one message for its title. */
function reviewOnly<const Id extends string>(
  id: Id,
  messageKey: string,
  priority: number,
  languageScope: GrammarRuleCatalogEntry["languageScope"] = "all",
): GrammarRuleCatalogEntry & { id: Id; typing: false } {
  return { id, typing: false, titleI18nKey: messageKey, languageScope, priority };
}

const CATALOG = [
  reviewOnly("englishSubjectVerbAgreement", "review_msg_pronoun_verb", 163, "en_US"),
  // Lowest priorities: a more specific rule proposing the same edit explains it.
  reviewOnly("englishPhraseCorrections", "review_msg_phrase_correction", 3, "en_US"),
  reviewOnly("englishClosedCompounds", "review_msg_closed_compound", 2, "en_US"),
  reviewOnly("styleRedundancy", "review_msg_style_redundancy", 162, "en_US"),
  reviewOnly("styleLongSentence", "review_msg_style_long_sentence", 161),
  reviewOnly("stylePhrasing", "review_msg_style_phrasing", 1, "en_US"),
  // Opt-in register and list-punctuation styles; the two serial-comma styles oppose each other.
  reviewOnly("styleContractions", "review_msg_avoid_contractions", 1, "en_US"),
  reviewOnly("styleOxfordComma", "review_msg_oxford_comma", 1, "en_US"),
  reviewOnly("styleNoOxfordComma", "review_msg_no_oxford_comma", 1, "en_US"),
  // Opt-in: the other accepted form of a phrase whose usual form stylePhrasing may suggest.
  reviewOnly("styleAlternativePhrasing", "review_msg_alternative_phrasing", 1, "en_US"),
  // Opt-in: wording that is usually a mistake but can be correct, and quoted mentions.
  reviewOnly("englishPossibleErrors", "review_msg_possible_error", 1, "en_US"),
  // Opt-in dialects: each converts the other's spellings, words and idioms.
  reviewOnly("englishAmericanSpelling", "review_msg_american_spelling", 1, "en_US"),
  reviewOnly("englishBritishSpelling", "review_msg_british_spelling", 1, "en_US"),
  reviewOnly("englishOxfordSpelling", "review_msg_oxford_spelling", 1, "en_US"),
  reviewOnly("englishMissingArticle", "review_msg_missing_article", 1, "en_US"),
  // Opt-in house style: full words and spelled-out small numbers.
  reviewOnly("styleWordChoice", "review_msg_word_choice", 1, "en_US"),
  reviewOnly("styleSpelledNumbers", "review_msg_spelled_numbers", 1, "en_US"),
  reviewOnly("preferredTerminology", "review_msg_preferred_terminology", 160),
  reviewOnly("englishCanonicalCasing", "review_msg_canonical_casing", 159),
  reviewOnly("quoteSpacing", "review_msg_quote_spacing", 171),
  reviewOnly("primeSymbols", "review_msg_prime_symbols", 172),
  reviewOnly("greekFinalNu", "review_msg_greek_final_nu", 173),
  reviewOnly("greekStrictFinalNu", "review_msg_greek_strict_final_nu", 174),
  reviewOnly("greekQuestionAccent", "review_msg_greek_question_accent", 175),
  reviewOnly("greekPunctuation", "review_msg_greek_intro_comma", 176),
  reviewOnly("swedishTypography", "review_msg_swedish_typography", 177),
  reviewOnly("polishCaseAgreement", "review_msg_pl_agreement", 178),
  reviewOnly("polishTypography", "review_msg_pl_typography", 179),
  reviewOnly("polishQuotes", "review_msg_pl_quotes", 180),
  reviewOnly("polishCapitalization", "review_msg_pl_capitals", 181),
  reviewOnly("swedishAgreement", "review_msg_swedish_agreement", 178),
  reviewOnly("frenchAdjectiveAgreement", "review_msg_fr_adjective_agreement", 177),
  reviewOnly("frenchTout", "review_msg_fr_tout", 177),
  reviewOnly("frenchMood", "review_msg_fr_subjunctive", 177),
  reviewOnly("frenchMissingNe", "review_msg_fr_missing_ne", 150),
  reviewOnly("frenchCommas", "review_msg_fr_stray_comma", 150),
  reviewOnly("frenchOrdinals", "review_msg_fr_ordinal", 150),
  reviewOnly("arabicAgreement", "review_msg_arabic_agreement", 179),
  reviewOnly("frenchNounGender", "review_msg_fr_noun_gender", 178),
  reviewOnly("arabicCaseEndings", "review_msg_arabic_case_endings", 180),
  reviewOnly("dateTenseConsistency", "review_msg_date_tense", 139),
  reviewOnly("arabicDates", "review_msg_arabic_dates", 181),
  reviewOnly("arabicSyntax", "review_msg_arabic_syntax", 181),
  reviewOnly("unclosedQuotation", "review_msg_quotation_balance", 158),
  reviewOnly("typographicQuotes", "review_msg_typographic_quotes", 90),
  reviewOnly("englishUsagePhrases", "review_msg_usage_phrases", 157, "en_US"),
  reviewOnly("englishDoubledDegree", "review_msg_doubled_degree", 156, "en_US"),
  reviewOnly("englishCountability", "review_msg_countability", 155, "en_US"),
  reviewOnly("englishContextualCompounds", "review_msg_compounds", 154, "en_US"),
  reviewOnly("englishNounNumber", "review_msg_demonstrative_number", 153, "en_US"),
  reviewOnly("englishPerfectParticiples", "review_msg_perfect_participle", 152, "en_US"),
  reviewOnly("englishVerbComplements", "review_msg_verb_complements", 151, "en_US"),
  reviewOnly("englishFixedPrepositions", "review_msg_fixed_prepositions", 150, "en_US"),
  reviewOnly("englishItsContext", "review_msg_its_contraction", 147, "en_US"),
  reviewOnly("englishLetsContext", "review_msg_lets_contraction", 148, "en_US"),
  reviewOnly("englishElsePossessive", "review_msg_else_possessive", 149, "en_US"),
  reviewOnly("englishExistentialAgreement", "review_msg_existential_agreement", 146, "en_US"),
  reviewOnly("englishThenThan", "review_msg_then_than", 142, "en_US"),
  reviewOnly("englishYourYouAre", "review_msg_your_you_are", 143, "en_US"),
  reviewOnly("englishTheirThereTheyAre", "review_msg_their_possessive", 144, "en_US"),
  reviewOnly("englishToToo", "review_msg_to_too", 145, "en_US"),
  reviewOnly("englishWereWhere", "review_msg_were_where", 164, "en_US"),
  // Below englishUsagePhrases, whose framed "finded" fix explains the same edit better.
  reviewOnly("englishIrregularForms", "review_msg_irregular_form", 137, "en_US"),
  reviewOnly("englishPossessiveNouns", "review_msg_noun_possessive", 138, "en_US"),
  reviewOnly("englishDateConsistency", "review_msg_weekday_mismatch", 139, "en_US"),
  reviewOnly("englishTenseConsistency", "review_msg_tense_time_word", 139, "en_US"),
  reviewOnly("englishSentenceFragment", "review_msg_sentence_fragment", 40, "en_US"),
  // English tables and typography (review/english/, en-tables2).
  reviewOnly("englishApostrophes", "review_msg_plural_apostrophe", 140, "en_US"),
  reviewOnly("englishNotation", "review_msg_english_digit_groups", 141, "en_US"),
  reviewOnly("englishTypography", "review_msg_typographic_symbol", 142, "en_US"),
  reviewOnly("stylePassiveVoice", "review_msg_passive_voice", 143, "en_US"),
  reviewOnly("englishPunctuation", "review_msg_stray_comma", 144, "en_US"),
  reviewOnly("styleIntroductoryComma", "review_msg_introductory_comma", 145, "en_US"),
  reviewOnly("styleClauseComma", "review_msg_clause_comma", 145, "en_US"),
  // Polish-only Review checks (review/polish/); languages are set in reviewCatalog.
  reviewOnly("polishNumerals", "review_msg_pl_numeral_suffix", 173),
  reviewOnly("polishDates", "review_msg_pl_impossible_date", 174),
  reviewOnly("polishMisplacedComma", "review_msg_pl_misplaced_comma", 175),
  reviewOnly("polishMissingComma", "review_msg_pl_missing_comma", 176),
  reviewOnly("polishPrepositionForms", "review_msg_pl_preposition_form", 177),
  // French (review/french/)
  reviewOnly("frenchVerbForms", "review_msg_fr_infinitive", 173),
  reviewOnly("frenchHomophones", "review_msg_fr_homophone", 174),
  reviewOnly("frenchHyphenation", "review_msg_fr_hyphen", 175),
  reviewOnly("frenchSubjectVerbAgreement", "review_msg_fr_subject_verb", 176),
  reviewOnly("frenchElision", "review_msg_fr_elision", 177),
  reviewOnly("frenchDates", "review_msg_fr_date", 178),
  reviewOnly("frenchNounNumber", "review_msg_fr_noun_number", 179),

  reviewOnly("englishPronounCase", "review_msg_pronoun_subject_case", 165, "en_US"),
  reviewOnly("englishSentenceStructure", "review_msg_sentence_structure", 166, "en_US"),
  reviewOnly("englishConfusedWords", "review_msg_confused_word", 120, "en_US"),
  reviewOnly("englishAuxiliaryBaseVerb", "review_msg_auxiliary_base", 141, "en_US"),
  reviewOnly("englishRepeatedWords", "review_msg_repeated_words", 140),
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
  // Portuguese Review checks (review/portuguese/).
  reviewOnly("portugueseAccentParonyms", "review_msg_pt_accent_paronym", 310),
  reviewOnly("portugueseConfusions", "review_msg_pt_confusions", 311),
  reviewOnly("portugueseContractions", "review_msg_pt_contraction", 312),
  reviewOnly("portugueseNumberFormat", "review_msg_pt_number_format", 313),
  reviewOnly("portugueseTypographyStyle", "review_msg_pt_typography_style", 314),
  reviewOnly("portugueseCliticPlacement", "review_msg_pt_proclisis", 315),
  reviewOnly("portugueseAO90", "review_msg_pt_ao90", 316),
  reviewOnly("portugueseDates", "review_msg_pt_invalid_date", 317),
  reviewOnly("portugueseCommas", "review_msg_pt_comma", 318),
  reviewOnly("portugueseAgreement", "review_msg_pt_agreement", 319),
  // Spanish Review checks (review/spanish/).
  reviewOnly("spanishAccents", "review_msg_spanish_accent", 166),
  reviewOnly("spanishConfusions", "review_msg_spanish_confusion", 167),
  reviewOnly("spanishTypography", "review_msg_spanish_conjunction", 168),
  reviewOnly("spanishAgreement", "review_msg_spanish_agreement", 169),
  reviewOnly("spanishQuotes", "review_msg_spanish_quotes", 170),
  reviewOnly("spanishTypographyStyle", "review_msg_spanish_decimal", 171),
  // German-only Review checks (review/german/).
  reviewOnly("germanNounCasing", "review_msg_german_noun_case", 37),
  reviewOnly("germanPrepositionCase", "review_msg_german_preposition_case", 160),
  reviewOnly("germanConfusedWords", "review_msg_contextual_grammar", 150),
  reviewOnly("germanAdjectiveForms", "review_msg_german_adjective_ending", 155),
  reviewOnly("germanSuspendedHyphen", "review_msg_german_suspended_hyphen", 120),
  reviewOnly("germanAbbreviations", "review_msg_german_abbreviation", 110),
  reviewOnly("germanQuotes", "review_msg_german_quotes", 100),
  reviewOnly("germanAbbreviationSpacing", "review_msg_german_abbreviation_spacing", 105),
  reviewOnly("germanDates", "review_msg_german_invalid_date", 115),
  reviewOnly("germanCompounds", "review_msg_closed_compound", 125),
  reviewOnly("germanCommas", "review_msg_german_comma", 110),
  reviewOnly("germanVerbAgreement", "review_msg_german_verb_agreement", 120),
  reviewOnly("germanArticleGender", "review_msg_german_article_gender", 158),
  reviewOnly("germanQuestionMarks", "review_msg_question_mark", 100),
  reviewOnly("germanNumbers", "review_msg_german_numbers", 120),
  reviewOnly("germanStraightQuotes", "review_msg_german_quotes", 95),
  reviewOnly("germanColloquial", "review_msg_german_colloquial", 60),
  reviewOnly("germanRecommendedSpelling", "review_msg_german_recommended_spelling", 55),
  reviewOnly("germanTypography", "review_msg_german_typography", 40),
] as const satisfies readonly GrammarRuleCatalogEntry[];

/** Every catalog rule id: the typing rules (GrammarRuleId) and the Review-only checks. */
export type CatalogRuleId = (typeof CATALOG)[number]["id"];

export const GRAMMAR_RULE_CATALOG: readonly (GrammarRuleCatalogEntry & { id: CatalogRuleId })[] =
  CATALOG;

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
