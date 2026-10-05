import type { GrammarRuleCatalogEntry, GrammarRuleId } from "./types";

/** A native Review-only check. Its settings title and description keys follow its id. */
function reviewOnly<const Id extends string>(
  id: Id,
  priority: number,
  languageScope: GrammarRuleCatalogEntry["languageScope"] = "all",
): GrammarRuleCatalogEntry & { id: Id; typing: false } {
  return {
    id,
    typing: false,
    titleI18nKey: `grammar_rule_${id}`,
    descriptionI18nKey: `grammar_rule_${id}_desc`,
    languageScope,
    priority,
  };
}

const CATALOG = [
  reviewOnly("englishSubjectVerbAgreement", 163, "en_US"),
  // Lowest priorities: a more specific rule proposing the same edit explains it.
  reviewOnly("englishPhraseCorrections", 3, "en_US"),
  reviewOnly("englishClosedCompounds", 2, "en_US"),
  reviewOnly("styleRedundancy", 162, "en_US"),
  reviewOnly("styleLongSentence", 161),
  reviewOnly("stylePhrasing", 1, "en_US"),
  // Opt-in register and list-punctuation styles; the two serial-comma styles oppose each other.
  reviewOnly("styleContractions", 1, "en_US"),
  reviewOnly("styleOxfordComma", 1, "en_US"),
  reviewOnly("styleNoOxfordComma", 1, "en_US"),
  // Opt-in: the other accepted form of a phrase whose usual form stylePhrasing may suggest.
  reviewOnly("styleAlternativePhrasing", 1, "en_US"),
  // Opt-in: wording that is usually a mistake but can be correct, and quoted mentions.
  reviewOnly("englishPossibleErrors", 1, "en_US"),
  // Opt-in dialects: each converts the other's spellings, words and idioms.
  reviewOnly("englishAmericanSpelling", 1, "en_US"),
  reviewOnly("englishBritishSpelling", 1, "en_US"),
  reviewOnly("englishOxfordSpelling", 1, "en_US"),
  reviewOnly("englishMissingArticle", 1, "en_US"),
  // Opt-in house style: full words and spelled-out small numbers.
  reviewOnly("styleWordChoice", 1, "en_US"),
  reviewOnly("styleSpelledNumbers", 1, "en_US"),
  reviewOnly("preferredTerminology", 160),
  reviewOnly("englishCanonicalCasing", 159),
  reviewOnly("quoteSpacing", 171),
  reviewOnly("primeSymbols", 172),
  reviewOnly("greekFinalNu", 173),
  reviewOnly("greekStrictFinalNu", 174),
  reviewOnly("greekQuestionAccent", 175),
  reviewOnly("greekPunctuation", 176),
  reviewOnly("swedishTypography", 177),
  reviewOnly("polishCaseAgreement", 178),
  reviewOnly("polishTypography", 179),
  reviewOnly("polishQuotes", 180),
  reviewOnly("polishCapitalization", 181),
  reviewOnly("swedishAgreement", 178),
  reviewOnly("frenchAdjectiveAgreement", 177),
  reviewOnly("frenchTout", 177),
  reviewOnly("frenchMood", 177),
  reviewOnly("frenchMissingNe", 150),
  reviewOnly("frenchCommas", 150),
  reviewOnly("frenchOrdinals", 150),
  reviewOnly("arabicAgreement", 179),
  reviewOnly("frenchNounGender", 178),
  reviewOnly("arabicCaseEndings", 180),
  reviewOnly("dateTenseConsistency", 139),
  reviewOnly("arabicDates", 181),
  reviewOnly("arabicSyntax", 181),
  reviewOnly("unclosedQuotation", 158),
  reviewOnly("typographicQuotes", 90),
  reviewOnly("englishUsagePhrases", 157, "en_US"),
  reviewOnly("englishDoubledDegree", 156, "en_US"),
  reviewOnly("englishCountability", 155, "en_US"),
  reviewOnly("englishContextualCompounds", 154, "en_US"),
  reviewOnly("englishNounNumber", 153, "en_US"),
  reviewOnly("englishPerfectParticiples", 152, "en_US"),
  reviewOnly("englishVerbComplements", 151, "en_US"),
  reviewOnly("englishFixedPrepositions", 150, "en_US"),
  reviewOnly("englishItsContext", 147, "en_US"),
  reviewOnly("englishLetsContext", 148, "en_US"),
  reviewOnly("englishElsePossessive", 149, "en_US"),
  reviewOnly("englishExistentialAgreement", 146, "en_US"),
  reviewOnly("englishThenThan", 142, "en_US"),
  reviewOnly("englishYourYouAre", 143, "en_US"),
  reviewOnly("englishTheirThereTheyAre", 144, "en_US"),
  reviewOnly("englishToToo", 145, "en_US"),
  reviewOnly("englishWereWhere", 164, "en_US"),
  // Below englishUsagePhrases, whose framed "finded" fix explains the same edit better.
  reviewOnly("englishIrregularForms", 137, "en_US"),
  reviewOnly("englishPossessiveNouns", 138, "en_US"),
  reviewOnly("englishDateConsistency", 139, "en_US"),
  reviewOnly("englishTenseConsistency", 139, "en_US"),
  reviewOnly("englishSentenceFragment", 40, "en_US"),
  // English tables and typography (review/english/, en-tables2).
  reviewOnly("englishApostrophes", 140, "en_US"),
  reviewOnly("englishNotation", 141, "en_US"),
  reviewOnly("englishTypography", 142, "en_US"),
  reviewOnly("stylePassiveVoice", 143, "en_US"),
  reviewOnly("englishPunctuation", 144, "en_US"),
  reviewOnly("styleIntroductoryComma", 145, "en_US"),
  reviewOnly("styleClauseComma", 145, "en_US"),
  // Polish-only Review checks (review/polish/); languages are set in reviewCatalog.
  reviewOnly("polishNumerals", 173),
  reviewOnly("polishDates", 174),
  reviewOnly("polishMisplacedComma", 175),
  reviewOnly("polishMissingComma", 176),
  reviewOnly("polishPrepositionForms", 177),
  // French (review/french/)
  reviewOnly("frenchVerbForms", 173),
  reviewOnly("frenchHomophones", 174),
  reviewOnly("frenchHyphenation", 175),
  reviewOnly("frenchSubjectVerbAgreement", 176),
  reviewOnly("frenchElision", 177),
  reviewOnly("frenchDates", 178),
  reviewOnly("frenchNounNumber", 179),

  reviewOnly("englishPronounCase", 165, "en_US"),
  reviewOnly("englishSentenceStructure", 166, "en_US"),
  reviewOnly("englishConfusedWords", 120, "en_US"),
  reviewOnly("englishAuxiliaryBaseVerb", 141, "en_US"),
  reviewOnly("englishRepeatedWords", 140),
  {
    id: "capitalizeSentenceStart",
    titleI18nKey: "grammar_rule_capitalize_sentence_start",
    descriptionI18nKey: "grammar_rule_capitalize_sentence_start_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 10,
  },
  {
    id: "capitalizeAfterLineBreak",
    titleI18nKey: "grammar_rule_capitalize_line_break",
    descriptionI18nKey: "grammar_rule_capitalize_line_break_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 20,
  },
  {
    id: "englishPronounICapitalization",
    titleI18nKey: "grammar_rule_english_pronoun_i",
    descriptionI18nKey: "grammar_rule_english_pronoun_i_desc",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 25,
  },
  {
    id: "englishContractionNormalization",
    titleI18nKey: "grammar_rule_english_contractions",
    descriptionI18nKey: "grammar_rule_english_contractions_desc",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 26,
  },
  {
    id: "englishTypoWhitelistCorrection",
    titleI18nKey: "grammar_rule_english_typos",
    descriptionI18nKey: "grammar_rule_english_typos_desc",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 27,
  },
  {
    id: "doubleSpaceToPeriod",
    titleI18nKey: "grammar_rule_double_space_to_period",
    descriptionI18nKey: "grammar_rule_double_space_to_period_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 28,
  },
  {
    id: "englishModalOfCorrection",
    titleI18nKey: "grammar_rule_english_modal_of",
    descriptionI18nKey: "grammar_rule_english_modal_of_desc",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 29,
  },
  {
    id: "englishYourWelcomeCorrection",
    titleI18nKey: "grammar_rule_english_your_welcome",
    descriptionI18nKey: "grammar_rule_english_your_welcome_desc",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 30,
  },
  {
    id: "englishTheirThereBeVerb",
    titleI18nKey: "grammar_rule_english_their_there_be",
    descriptionI18nKey: "grammar_rule_english_their_there_be_desc",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 31,
  },
  {
    id: "englishAlotCorrection",
    titleI18nKey: "grammar_rule_english_alot",
    descriptionI18nKey: "grammar_rule_english_alot_desc",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 32,
  },
  {
    id: "englishPronounVerbWhitelistAgreement",
    titleI18nKey: "grammar_rule_english_pronoun_verb_agreement",
    descriptionI18nKey: "grammar_rule_english_pronoun_verb_agreement_desc",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 33,
  },
  {
    id: "englishArticleAnCorrection",
    titleI18nKey: "grammar_rule_english_article_an",
    descriptionI18nKey: "grammar_rule_english_article_an_desc",
    languageScope: "en_US",
    defaultRollout: "off",
    priority: 34,
  },
  {
    id: "englishOrdinalSuffix",
    titleI18nKey: "grammar_rule_english_ordinal_suffix",
    descriptionI18nKey: "grammar_rule_english_ordinal_suffix_desc",
    languageScope: "en_US",
    defaultRollout: "off",
    priority: 35,
  },
  {
    id: "englishProperNounCapitalization",
    titleI18nKey: "grammar_rule_english_proper_nouns",
    descriptionI18nKey: "grammar_rule_english_proper_nouns_desc",
    languageScope: "en_US",
    defaultRollout: "on",
    priority: 36,
  },
  {
    id: "technicalTokenCompaction",
    titleI18nKey: "grammar_rule_technical_compaction",
    descriptionI18nKey: "grammar_rule_technical_compaction_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 40,
  },
  {
    id: "mathOperatorSpacing",
    titleI18nKey: "grammar_rule_math_operator_spacing",
    descriptionI18nKey: "grammar_rule_math_operator_spacing_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 50,
  },
  {
    id: "measurementUnitFormatting",
    titleI18nKey: "grammar_rule_measurement_unit_formatting",
    descriptionI18nKey: "grammar_rule_measurement_unit_formatting_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 55,
  },
  {
    id: "currencySpacing",
    titleI18nKey: "grammar_rule_currency_spacing",
    descriptionI18nKey: "grammar_rule_currency_spacing_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 56,
  },
  {
    id: "slashContextSpacing",
    titleI18nKey: "grammar_rule_slash_context_spacing",
    descriptionI18nKey: "grammar_rule_slash_context_spacing_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 60,
  },
  {
    id: "openingBracketSpacing",
    titleI18nKey: "grammar_rule_opening_bracket_spacing",
    descriptionI18nKey: "grammar_rule_opening_bracket_spacing_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 70,
  },
  {
    id: "closingBracketSpacing",
    titleI18nKey: "grammar_rule_closing_bracket_spacing",
    descriptionI18nKey: "grammar_rule_closing_bracket_spacing_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 80,
  },
  {
    id: "commaPeriodSpacing",
    titleI18nKey: "grammar_rule_comma_period_spacing",
    descriptionI18nKey: "grammar_rule_comma_period_spacing_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 90,
  },
  {
    id: "collapseRepeatedSpaces",
    titleI18nKey: "grammar_rule_collapse_repeated_spaces",
    descriptionI18nKey: "grammar_rule_collapse_repeated_spaces_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 100,
  },
  {
    id: "trimSpaceBeforeLineBreak",
    titleI18nKey: "grammar_rule_trim_space_before_line_break",
    descriptionI18nKey: "grammar_rule_trim_space_before_line_break_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 110,
  },
  {
    id: "ellipsisShortcut",
    titleI18nKey: "grammar_rule_ellipsis_shortcut",
    descriptionI18nKey: "grammar_rule_ellipsis_shortcut_desc",
    languageScope: "all",
    defaultRollout: "off",
    priority: 130,
  },
  {
    id: "emdashShortcut",
    titleI18nKey: "grammar_rule_emdash_shortcut",
    descriptionI18nKey: "grammar_rule_emdash_shortcut_desc",
    languageScope: "all",
    defaultRollout: "off",
    priority: 131,
  },
  {
    id: "smartQuoteNormalization",
    titleI18nKey: "grammar_rule_smart_quote_normalization",
    descriptionI18nKey: "grammar_rule_smart_quote_normalization_desc",
    languageScope: "all",
    defaultRollout: "off",
    priority: 132,
  },
  {
    id: "frenchPunctuationSpacing",
    titleI18nKey: "grammar_rule_french_punctuation_spacing",
    descriptionI18nKey: "grammar_rule_french_punctuation_spacing_desc",
    languageScope: "all",
    defaultRollout: "off",
    priority: 133,
  },
  {
    id: "duplicatePunctuationCollapse",
    titleI18nKey: "grammar_rule_duplicate_punctuation_collapse",
    descriptionI18nKey: "grammar_rule_duplicate_punctuation_collapse_desc",
    languageScope: "all",
    defaultRollout: "off",
    priority: 134,
  },
  {
    id: "autoBracketClose",
    titleI18nKey: "grammar_rule_auto_bracket_close",
    descriptionI18nKey: "grammar_rule_auto_bracket_close_desc",
    languageScope: "all",
    defaultRollout: "off",
    priority: 135,
    codeSafe: true,
  },
  // Portuguese Review checks (review/portuguese/).
  reviewOnly("portugueseAccentParonyms", 310),
  reviewOnly("portugueseConfusions", 311),
  reviewOnly("portugueseContractions", 312),
  reviewOnly("portugueseNumberFormat", 313),
  reviewOnly("portugueseTypographyStyle", 314),
  reviewOnly("portugueseCliticPlacement", 315),
  reviewOnly("portugueseAO90", 316),
  reviewOnly("portugueseDates", 317),
  reviewOnly("portugueseCommas", 318),
  reviewOnly("portugueseAgreement", 319),
  // Spanish Review checks (review/spanish/).
  reviewOnly("spanishAccents", 166),
  reviewOnly("spanishConfusions", 167),
  reviewOnly("spanishTypography", 168),
  reviewOnly("spanishAgreement", 169),
  reviewOnly("spanishQuotes", 170),
  reviewOnly("spanishTypographyStyle", 171),
  // German-only Review checks (review/german/).
  reviewOnly("germanNounCasing", 37),
  reviewOnly("germanPrepositionCase", 160),
  reviewOnly("germanConfusedWords", 150),
  reviewOnly("germanAdjectiveForms", 155),
  reviewOnly("germanSuspendedHyphen", 120),
  reviewOnly("germanAbbreviations", 110),
  reviewOnly("germanQuotes", 100),
  reviewOnly("germanAbbreviationSpacing", 105),
  reviewOnly("germanDates", 115),
  reviewOnly("germanCompounds", 125),
  reviewOnly("germanCommas", 110),
  reviewOnly("germanVerbAgreement", 120),
  reviewOnly("germanArticleGender", 158),
  reviewOnly("germanQuestionMarks", 100),
  reviewOnly("germanNumbers", 120),
  reviewOnly("germanStraightQuotes", 95),
  reviewOnly("germanColloquial", 60),
  reviewOnly("germanRecommendedSpelling", 55),
  reviewOnly("germanTypography", 40),
] as const satisfies readonly GrammarRuleCatalogEntry[];

/** Every catalog rule id: the typing rules (GrammarRuleId) and the Review-only checks. */
export type CatalogRuleId = (typeof CATALOG)[number]["id"];

/**
 * Opposite rules: each one undoes the fix of the others, so only one rule of a group can be on.
 * Review keeps the first enabled rule of a group in catalog order.
 */
export const EXCLUSIVE_RULE_GROUPS: readonly (readonly CatalogRuleId[])[] = [
  ["styleOxfordComma", "styleNoOxfordComma"],
  ["englishAmericanSpelling", "englishBritishSpelling"],
];

/** The other rules of `ruleId`'s exclusive group; none when it is in no group. */
export function exclusiveRivals(ruleId: string): readonly CatalogRuleId[] {
  const group = EXCLUSIVE_RULE_GROUPS.find((ids) => ids.includes(ruleId as CatalogRuleId)) ?? [];
  return group.filter((id) => id !== ruleId);
}

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
