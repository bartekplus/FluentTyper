import { isObjectRecord } from "../../guards";
import { SUPPORTED_PREDICTION_LANGUAGE_KEYS, TEXT_EXPANDER_LANG } from "../../lang";
import { GRAMMAR_RULE_CATALOG, isCodeSafeGrammarRule, type CatalogRuleId } from "../ruleCatalog";
import {
  REVIEW_LOCAL_AI_CHECK,
  REVIEW_SPELLING_CHECK,
  type ReviewCategory,
  type ReviewCheckId,
  type ReviewKind,
} from "./types";
import type { LanguagePhraseTables } from "./languagePhraseTables";

interface SupportedReviewMetadata {
  review: "supported";
  defaultEnabled: boolean;
  category: ReviewCategory;
  bulk: "eligible" | "individual";
  /** Why a supported rule stays individual-only, when it does. */
  note?: string;
  /**
   * Review languages, when they differ from the catalog's typing
   * `languageScope` (a Review-only extension of an English typing rule).
   */
  languages?: readonly string[];
}

/**
 * Review metadata for every catalog rule. The Record type makes a new catalog
 * rule a compile error until it is explicitly classified here, so no rule is
 * silently omitted from review or assumed safe to batch. Every supported rule
 * also names its `kind`.
 *
 * `bulk: "eligible"` means the rule's fix is deterministic and batch-approved for
 * "Fix all". The typing-time `safetyTier` is NOT used for that decision.
 */
export type ReviewRuleMetadata =
  | (SupportedReviewMetadata & { kind: ReviewKind })
  | {
      review: "excluded";
      /** Groups the typing rule in settings next to Review's checks. */
      category: ReviewCategory;
      reason: string;
    };

/**
 * Every named review language. Rules that need to know the language (a word
 * list, a number locale, terms authored per language) skip text whose
 * auto-detected language is still unresolved.
 */
const NAMED_LANGUAGES: readonly string[] = SUPPORTED_PREDICTION_LANGUAGE_KEYS.filter(
  (lang) => lang !== TEXT_EXPANDER_LANG,
);

/**
 * The kinds of phrase table authored for each language in languagePhraseTables.ts,
 * restated so the catalog (loaded by every page) does not load the tables;
 * ReviewLanguagePhraseTables.test.ts keeps the two in step.
 */
export const PHRASE_TABLE_KINDS: Readonly<
  Record<string, ReadonlyArray<keyof LanguagePhraseTables>>
> = {
  de: ["words", "phrases", "compounds", "style"],
  fr: ["words", "phrases", "compounds", "style"],
  es: ["words", "phrases", "compounds", "style"],
  pt: ["words", "phrases", "style"],
  pl: ["words", "phrases", "compounds", "style"],
  hr: ["words", "compounds"],
  sv: ["words", "phrases", "compounds", "style"],
  el: ["words", "phrases", "style"],
  ar: ["words", "phrases", "style"],
};

/** English and every language with an authored phrase table of these kinds. */
const withPhraseTables = (...kinds: Array<keyof LanguagePhraseTables>): readonly string[] =>
  NAMED_LANGUAGES.filter(
    (lang) =>
      lang === "en_US" ||
      kinds.some((kind) => PHRASE_TABLE_KINDS[lang.slice(0, 2)]?.includes(kind)),
  );

export const REVIEW_RULE_METADATA: Record<CatalogRuleId, ReviewRuleMetadata> = {
  englishPhraseCorrections: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "usage",
    bulk: "individual",
    languages: withPhraseTables("words", "phrases"),
  },
  englishClosedCompounds: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    kind: "boundary",
    bulk: "individual",
    languages: withPhraseTables("compounds"),
  },
  stylePhrasing: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "redundancy",
    bulk: "individual",
    languages: withPhraseTables("style"),
  },
  styleContractions: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "usage",
    bulk: "individual",
  },
  styleOxfordComma: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "marks",
    bulk: "individual",
  },
  styleNoOxfordComma: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "marks",
    bulk: "individual",
  },
  styleAlternativePhrasing: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "usage",
    bulk: "individual",
    note: "Optional style: both forms of these phrases are correct English.",
  },
  englishPossibleErrors: {
    review: "supported",
    defaultEnabled: false,
    category: "grammar",
    kind: "usage",
    bulk: "individual",
    note: "Optional: these forms are usually mistakes but can be correct, or are quoted on purpose.",
  },
  englishAmericanSpelling: {
    review: "supported",
    defaultEnabled: false,
    category: "spelling",
    kind: "usage",
    bulk: "individual",
    note: "Optional dialect: British forms are correct English too.",
  },
  englishBritishSpelling: {
    review: "supported",
    defaultEnabled: false,
    category: "spelling",
    kind: "usage",
    bulk: "individual",
    note: "Optional dialect: American forms are correct English too.",
  },
  styleWordChoice: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "usage",
    bulk: "individual",
  },
  styleSpelledNumbers: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "numbers",
    bulk: "individual",
  },
  styleRedundancy: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "redundancy",
    bulk: "individual",
  },
  styleLongSentence: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "readability",
    bulk: "individual",
  },
  preferredTerminology: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "terminology",
    bulk: "individual",
    note: "Requires an explicitly enabled user-authored terminology configuration.",
    languages: NAMED_LANGUAGES,
  },
  englishCanonicalCasing: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "capitalization",
    bulk: "individual",
  },
  unclosedQuotation: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
  },
  quoteSpacing: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "spacing",
    bulk: "individual",
    note: "A straight quotation mark does not say whether it opens or closes.",
  },
  primeSymbols: {
    review: "supported",
    defaultEnabled: false,
    category: "typography",
    kind: "numbers",
    bulk: "individual",
    note: "Optional typography: typewriter quotes for feet and minutes are common.",
  },
  greekFinalNu: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    kind: "wordForm",
    bulk: "individual",
    languages: ["el_GR"],
  },
  greekStrictFinalNu: {
    review: "supported",
    defaultEnabled: false,
    category: "spelling",
    kind: "wordForm",
    bulk: "individual",
    languages: ["el_GR"],
    note: "Optional: everyday writing often drops the ν of τον and keeps the ν of την.",
  },
  greekQuestionAccent: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    kind: "wordForm",
    bulk: "individual",
    languages: ["el_GR"],
  },
  greekPunctuation: {
    review: "supported",
    defaultEnabled: false,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
    languages: ["el_GR"],
    note: "Optional: commas after connectors and single marks follow formal style.",
  },
  swedishTypography: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "capitalization",
    bulk: "individual",
    languages: ["sv_SE"],
  },
  swedishAgreement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
    languages: ["sv_SE"],
  },
  arabicAgreement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
    languages: ["ar_SA"],
  },
  arabicCaseEndings: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
    languages: ["ar_SA"],
  },
  arabicDates: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "numbers",
    bulk: "individual",
    languages: ["ar_SA"],
  },
  englishUsagePhrases: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "usage",
    bulk: "individual",
  },
  englishDoubledDegree: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
    languages: ["en_US", "fr_FR", "es_ES", "pt_BR", "pl_PL", "hr_HR", "sv_SE", "el_GR"],
  },
  englishCountability: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
  },
  englishContextualCompounds: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "boundary",
    bulk: "individual",
  },
  englishNounNumber: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
  },
  englishPerfectParticiples: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
  },
  englishVerbComplements: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
  },
  englishFixedPrepositions: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "usage",
    bulk: "individual",
  },
  englishItsContext: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
  },
  englishLetsContext: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
  },
  englishElsePossessive: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
  },
  englishSubjectVerbAgreement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
  },
  englishExistentialAgreement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
  },
  englishThenThan: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
  },
  englishYourYouAre: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
  },
  englishTheirThereTheyAre: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
  },
  englishToToo: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
  },
  englishWereWhere: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
  },
  englishIrregularForms: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
  },
  englishPossessiveNouns: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
  },
  // Polish-only Review checks (review/polish/).
  polishNumerals: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "numbers",
    bulk: "individual",
    languages: ["pl_PL"],
  },
  polishDates: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "numbers",
    bulk: "individual",
    languages: ["pl_PL"],
  },
  polishMisplacedComma: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
    languages: ["pl_PL"],
  },
  polishMissingComma: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
    languages: ["pl_PL"],
  },
  polishPrepositionForms: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
    languages: ["pl_PL"],
  },

  englishDateConsistency: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "numbers",
    bulk: "individual",
  },

  englishPronounCase: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
  },
  englishSentenceStructure: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "usage",
    bulk: "individual",
  },
  englishConfusedWords: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
  },
  englishAuxiliaryBaseVerb: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
  },
  englishRepeatedWords: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "repetition",
    bulk: "individual",
    languages: NAMED_LANGUAGES,
  },
  capitalizeSentenceStart: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "capitalization",
    bulk: "eligible",
  },
  capitalizeAfterLineBreak: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "capitalization",
    bulk: "individual",
    note: "Line starts in poems, lists and hard-wrapped text are often lowercase on purpose.",
  },
  englishPronounICapitalization: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "capitalization",
    bulk: "eligible",
  },
  englishContractionNormalization: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    kind: "typo",
    bulk: "eligible",
    languages: ["en_US", "fr_FR", "de_DE", "pt_BR"],
  },
  englishTypoWhitelistCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    kind: "typo",
    bulk: "eligible",
  },
  doubleSpaceToPeriod: {
    review: "excluded",
    category: "punctuation",
    reason: "Typing shortcut: existing double spaces are not sentence ends.",
  },
  englishModalOfCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "eligible",
  },
  englishYourWelcomeCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "eligible",
  },
  englishTheirThereBeVerb: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "eligible",
  },
  englishAlotCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    kind: "boundary",
    bulk: "eligible",
    languages: ["en_US", "de_DE", "fr_FR", "es_ES", "pt_BR", "pl_PL", "sv_SE", "hr_HR"],
  },
  englishPronounVerbWhitelistAgreement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "eligible",
  },
  englishArticleAnCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
    note: "Initial-sound heuristic; a letter, name or identifier can look like an article.",
  },
  englishOrdinalSuffix: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "numbers",
    bulk: "eligible",
  },
  englishProperNounCapitalization: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "capitalization",
    bulk: "eligible",
    languages: ["en_US", "de_DE"],
  },
  technicalTokenCompaction: {
    review: "excluded",
    category: "punctuation",
    reason: 'Ambiguous in finished text: "Chapter 3: 5 tips" is not a clock time.',
  },
  mathOperatorSpacing: {
    review: "excluded",
    category: "punctuation",
    reason: "Typing-time style; existing operators are often code or notation.",
  },
  measurementUnitFormatting: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "numbers",
    bulk: "individual",
    note: "Units in technical prose (CSS, product names) are meaning-sensitive.",
    languages: NAMED_LANGUAGES,
  },
  currencySpacing: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "numbers",
    bulk: "eligible",
    languages: NAMED_LANGUAGES,
  },
  slashContextSpacing: {
    review: "excluded",
    category: "punctuation",
    reason: "Typing convenience; spacing around an existing slash is style, not an error.",
  },
  openingBracketSpacing: {
    review: "excluded",
    category: "punctuation",
    reason: 'Typing convenience that only spaces code-like "){"; not prose proofreading.',
  },
  closingBracketSpacing: {
    review: "excluded",
    category: "punctuation",
    reason: "Bracket spacing in finished text is often notation, Markdown or intervals.",
  },
  commaPeriodSpacing: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "spacing",
    bulk: "eligible",
  },
  collapseRepeatedSpaces: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "spacing",
    bulk: "eligible",
  },
  trimSpaceBeforeLineBreak: {
    review: "excluded",
    category: "punctuation",
    reason: "Invisible, and two trailing spaces are a Markdown line break.",
  },
  ellipsisShortcut: {
    review: "supported",
    defaultEnabled: false,
    category: "typography",
    kind: "marks",
    bulk: "individual",
    note: "Optional typography: three periods are correct too.",
  },
  emdashShortcut: {
    review: "supported",
    defaultEnabled: false,
    category: "typography",
    kind: "marks",
    bulk: "individual",
    note: "Optional typography; en or em dash is a house style.",
  },
  smartQuoteNormalization: {
    review: "excluded",
    category: "typography",
    reason: "Typing convenience; straight quotes in finished text may be code or deliberate.",
  },
  frenchPunctuationSpacing: {
    review: "excluded",
    category: "punctuation",
    reason: "Typing-time typography convention; invisible no-break space changes.",
  },
  duplicatePunctuationCollapse: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "repetition",
    bulk: "eligible",
  },
  autoBracketClose: {
    review: "excluded",
    category: "punctuation",
    reason: "Typing convenience: review never inserts closing brackets.",
  },
  // Portuguese Review checks (review/portuguese/).
  portugueseAccentParonyms: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
    languages: ["pt_BR"],
  },
  portugueseConfusions: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
    languages: ["pt_BR"],
  },
  portugueseContractions: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
    languages: ["pt_BR"],
  },
  portugueseNumberFormat: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "numbers",
    bulk: "individual",
    languages: ["pt_BR"],
  },
  portugueseTypographyStyle: {
    review: "supported",
    defaultEnabled: false,
    category: "typography",
    kind: "numbers",
    bulk: "individual",
    languages: ["pt_BR"],
    note: "Optional typography: a plain x and digits in formulas are common in Brazilian text.",
  },
  portugueseCliticPlacement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
    languages: ["pt_BR"],
  },
  portugueseAO90: {
    review: "supported",
    defaultEnabled: false,
    category: "spelling",
    kind: "boundary",
    bulk: "individual",
    languages: ["pt_BR"],
    note: "Optional: texts in the pre-1990 European spelling hyphenate prefixes and capitalize months.",
  },
  // Spanish Review checks (review/spanish/).
  spanishAccents: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    kind: "typo",
    bulk: "individual",
    languages: ["es_ES"],
  },
  spanishConfusions: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
    languages: ["es_ES"],
  },
  spanishTypography: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "numbers",
    bulk: "individual",
    languages: ["es_ES"],
  },
  // French (review/french/)
  frenchVerbForms: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
    languages: ["fr_FR"],
  },
  frenchHomophones: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
    languages: ["fr_FR"],
  },
  frenchHyphenation: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    kind: "boundary",
    bulk: "individual",
    languages: ["fr_FR"],
  },
  frenchSubjectVerbAgreement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
    languages: ["fr_FR"],
  },
  frenchElision: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    kind: "boundary",
    bulk: "individual",
    languages: ["fr_FR"],
  },
  frenchDates: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "numbers",
    bulk: "individual",
    languages: ["fr_FR"],
  },
  frenchNounNumber: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
    languages: ["fr_FR"],
  },
  // German-only Review checks (review/german/).
  germanNounCasing: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "capitalization",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanPrepositionCase: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanConfusedWords: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "confusedWords",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanAdjectiveForms: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanSuspendedHyphen: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanAbbreviations: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "marks",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanQuotes: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "marks",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanAbbreviationSpacing: {
    review: "supported",
    defaultEnabled: false,
    category: "typography",
    kind: "spacing",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanDates: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "numbers",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanCompounds: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "boundary",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanCommas: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanVerbAgreement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanQuestionMarks: {
    review: "supported",
    defaultEnabled: false,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanNumbers: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "numbers",
    bulk: "individual",
    languages: ["de_DE"],
  },
  germanStraightQuotes: {
    review: "supported",
    defaultEnabled: false,
    category: "typography",
    kind: "marks",
    bulk: "individual",
    languages: ["de_DE"],
  },
};

/** Review's dictionary check: individual only, and the user always picks the word. */
const REVIEW_SPELLING_METADATA: SupportedReviewMetadata = {
  review: "supported",
  defaultEnabled: true,
  category: "spelling",
  bulk: "individual",
  note: "An unknown word has several possible corrections, or none: the user picks.",
};

/** Local AI corrections: generated text, so never batched; the category is set per finding. */
const REVIEW_LOCAL_AI_METADATA: SupportedReviewMetadata = {
  review: "supported",
  defaultEnabled: false,
  category: "grammar",
  bulk: "individual",
  note: "Generated by the optional local model: the user accepts each correction.",
};

export function reviewMetadataFor(
  ruleId: ReviewCheckId,
): SupportedReviewMetadata | ReviewRuleMetadata {
  if (ruleId === REVIEW_SPELLING_CHECK) return REVIEW_SPELLING_METADATA;
  if (ruleId === REVIEW_LOCAL_AI_CHECK) return REVIEW_LOCAL_AI_METADATA;
  return REVIEW_RULE_METADATA[ruleId];
}

/** A native rule's kind; none for the dictionary check (its category says it) or Local AI. */
export function reviewKind(ruleId: ReviewCheckId): ReviewKind | undefined {
  const metadata = isReviewSupportedRule(ruleId) ? REVIEW_RULE_METADATA[ruleId] : undefined;
  return metadata?.review === "supported" ? metadata.kind : undefined;
}

/** Catalog order; the coverage map shown in docs and asserted by tests. */
export function reviewCoverageMap(): Array<{ ruleId: CatalogRuleId } & ReviewRuleMetadata> {
  return GRAMMAR_RULE_CATALOG.map((entry) => ({
    ruleId: entry.id,
    ...REVIEW_RULE_METADATA[entry.id],
  }));
}

const CATALOG_SCOPE = new Map(GRAMMAR_RULE_CATALOG.map((entry) => [entry.id, entry.languageScope]));

/** True when Review runs `ruleId` for text in `lang` ("auto_detect" when unresolved). */
export function runsInReviewLanguage(ruleId: CatalogRuleId, lang: string): boolean {
  const metadata = REVIEW_RULE_METADATA[ruleId];
  if (metadata.review === "supported" && metadata.languages)
    return metadata.languages.includes(lang);
  return CATALOG_SCOPE.get(ruleId) === "all" || lang === "en_US";
}

/** For the settings filter: "en_US" only when Review runs the rule for English alone. */
export function reviewLanguageScope(ruleId: CatalogRuleId): "all" | "en_US" {
  const metadata = REVIEW_RULE_METADATA[ruleId];
  return metadata.review === "supported" && metadata.languages
    ? metadata.languages.some((lang) => lang !== "en_US")
      ? "all"
      : "en_US"
    : (CATALOG_SCOPE.get(ruleId) ?? "en_US");
}

export function isReviewSupportedRule(ruleId: string): ruleId is CatalogRuleId {
  return (
    Object.hasOwn(REVIEW_RULE_METADATA, ruleId) &&
    REVIEW_RULE_METADATA[ruleId as CatalogRuleId].review === "supported"
  );
}

/** Every rule review can run, in catalog order. */
export const REVIEW_SUPPORTED_RULE_IDS: readonly CatalogRuleId[] = GRAMMAR_RULE_CATALOG.map(
  (entry) => entry.id,
).filter(isReviewSupportedRule);

/** Stored values contain only supported native IDs and booleans, never reviewed text. */
export function normalizeReviewRuleOverrides(value: unknown): Record<string, boolean> {
  if (value === undefined) return {};
  if (!isObjectRecord(value)) return reviewRuleSelectionToOverrides([]);
  return Object.fromEntries(
    REVIEW_SUPPORTED_RULE_IDS.filter((id) => Object.hasOwn(value, id)).map((id) => [
      id,
      typeof value[id] === "boolean" ? value[id] : false,
    ]),
  );
}

export function reviewRuleSelectionToOverrides(
  selection: readonly string[],
): Record<string, boolean> {
  const selected = new Set(selection);
  return Object.fromEntries(REVIEW_SUPPORTED_RULE_IDS.map((id) => [id, selected.has(id)]));
}

/** Review preferences are independent from typing switches; absent choices inherit explicit defaults. */
export function reviewRuleIds({
  codeMode,
  overrides,
}: {
  codeMode: boolean;
  overrides?: unknown;
}): CatalogRuleId[] {
  const choices = normalizeReviewRuleOverrides(overrides);
  return REVIEW_SUPPORTED_RULE_IDS.filter((id) => {
    const metadata = REVIEW_RULE_METADATA[id];
    return (
      (!codeMode || isCodeSafeGrammarRule(id)) &&
      (choices[id] ?? (metadata.review === "supported" && metadata.defaultEnabled))
    );
  });
}

export const DEFAULT_LONG_SENTENCE_WORDS = 35;

/** A preference, not a quality score. Invalid persisted values use the documented default. */
export function longSentenceThreshold(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 200
    ? value
    : DEFAULT_LONG_SENTENCE_WORDS;
}
