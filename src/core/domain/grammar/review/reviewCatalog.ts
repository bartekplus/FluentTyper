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
 * "Fix all".
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

/** A supported rule for `languages` alone, fixed one finding at a time; on unless `off`. */
const only = (
  languages: readonly string[],
  category: ReviewCategory,
  kind: ReviewKind,
  { off = false, note }: { off?: boolean; note?: string } = {},
): ReviewRuleMetadata => ({
  review: "supported",
  defaultEnabled: !off,
  category,
  kind,
  bulk: "individual",
  languages,
  ...(note === undefined ? {} : { note }),
});

export const REVIEW_RULE_METADATA: Record<CatalogRuleId, ReviewRuleMetadata> = {
  englishPhraseCorrections: only(withPhraseTables("words", "phrases"), "grammar", "usage"),
  englishClosedCompounds: only(withPhraseTables("compounds"), "spelling", "boundary"),
  stylePhrasing: only(withPhraseTables("style"), "style", "redundancy", { off: true }),
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
  englishOxfordSpelling: {
    review: "supported",
    defaultEnabled: false,
    category: "spelling",
    kind: "usage",
    bulk: "individual",
    note: "Optional norm: -ise and -isation are correct British English too.",
  },
  englishMissingArticle: {
    review: "supported",
    defaultEnabled: false,
    category: "grammar",
    kind: "agreement",
    bulk: "individual",
    note: "Optional: headlines, notes and set phrases leave articles out.",
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
    languages: ["en_US", "pt_BR"],
  },
  styleRedundancy: {
    review: "supported",
    defaultEnabled: true,
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
  typographicQuotes: only(NAMED_LANGUAGES, "typography", "marks", { off: true }),
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
  greekFinalNu: only(["el_GR"], "spelling", "wordForm"),
  greekStrictFinalNu: only(["el_GR"], "spelling", "wordForm", {
    off: true,
    note: "Optional: everyday writing often drops the ν of τον and keeps the ν of την.",
  }),
  greekQuestionAccent: only(["el_GR"], "spelling", "wordForm"),
  greekPunctuation: only(["el_GR"], "punctuation", "marks", {
    off: true,
    note: "Optional: commas after connectors and single marks follow formal style.",
  }),
  swedishTypography: only(["sv_SE"], "typography", "capitalization"),
  swedishAgreement: only(["sv_SE"], "grammar", "agreement"),
  arabicAgreement: only(["ar_SA"], "grammar", "agreement"),
  arabicCaseEndings: only(["ar_SA"], "grammar", "wordForm"),
  dateTenseConsistency: only(
    ["de_DE", "fr_FR", "es_ES", "pt_BR", "pl_PL", "ar_SA"],
    "grammar",
    "wordForm",
  ),
  arabicDates: only(["ar_SA"], "grammar", "numbers"),
  arabicSyntax: only(["ar_SA"], "grammar", "usage"),
  englishUsagePhrases: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "usage",
    bulk: "individual",
  },
  englishDoubledDegree: only(
    ["en_US", "fr_FR", "es_ES", "pt_BR", "pl_PL", "hr_HR", "sv_SE", "el_GR"],
    "grammar",
    "wordForm",
  ),
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
  polishNumerals: only(["pl_PL"], "grammar", "numbers"),
  polishDates: only(["pl_PL"], "grammar", "numbers"),
  polishMisplacedComma: only(["pl_PL"], "punctuation", "marks"),
  polishMissingComma: only(["pl_PL"], "punctuation", "marks"),
  polishPrepositionForms: only(["pl_PL"], "grammar", "wordForm"),
  polishCaseAgreement: only(["pl_PL"], "grammar", "agreement"),
  polishTypography: only(["pl_PL"], "typography", "spacing"),
  polishQuotes: only(["pl_PL"], "typography", "marks", { off: true }),
  polishCapitalization: only(["pl_PL"], "typography", "capitalization"),

  englishDateConsistency: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "numbers",
    bulk: "individual",
  },
  englishTenseConsistency: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    kind: "wordForm",
    bulk: "individual",
  },
  englishSentenceFragment: {
    review: "supported",
    defaultEnabled: false,
    category: "grammar",
    kind: "usage",
    bulk: "individual",
  },
  // English tables and typography (review/english/, en-tables2).
  englishApostrophes: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
  },
  englishNotation: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    kind: "numbers",
    bulk: "individual",
  },
  englishTypography: {
    review: "supported",
    defaultEnabled: false,
    category: "typography",
    kind: "marks",
    bulk: "individual",
    languages: ["en_US", "fr_FR", "pt_BR", "es_ES"],
    note: "Optional typography: x, ->, (c) and straight quotes are correct too.",
  },
  stylePassiveVoice: {
    review: "supported",
    defaultEnabled: false,
    category: "style",
    kind: "readability",
    bulk: "individual",
    note: "Optional style note without a fix: the passive is often the right choice.",
  },
  englishPunctuation: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
  },
  styleIntroductoryComma: only(["en_US", "pt_BR"], "punctuation", "marks", {
    off: true,
    note: "Optional: many writers leave out the comma after a short opening phrase.",
  }),
  styleClauseComma: {
    review: "supported",
    defaultEnabled: false,
    category: "punctuation",
    kind: "marks",
    bulk: "individual",
    note: "Optional: short joined clauses often go without the comma.",
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
  englishRepeatedWords: only(NAMED_LANGUAGES, "grammar", "repetition"),
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
  portugueseAccentParonyms: only(["pt_BR"], "grammar", "confusedWords"),
  portugueseConfusions: only(["pt_BR"], "grammar", "confusedWords"),
  portugueseContractions: only(["pt_BR"], "grammar", "wordForm"),
  portugueseNumberFormat: only(["pt_BR"], "typography", "numbers"),
  portugueseTypographyStyle: only(["pt_BR"], "typography", "numbers", {
    off: true,
    note: "Optional typography: a plain x and digits in formulas are common in Brazilian text.",
  }),
  portugueseCliticPlacement: only(["pt_BR"], "grammar", "wordForm"),
  portugueseAO90: only(["pt_BR"], "spelling", "boundary", {
    off: true,
    note: "Optional: texts in the pre-1990 European spelling hyphenate prefixes and capitalize months.",
  }),
  portugueseDates: only(["pt_BR"], "grammar", "numbers"),
  portugueseCommas: only(["pt_BR"], "punctuation", "marks"),
  portugueseAgreement: only(["pt_BR"], "grammar", "agreement"),
  // Spanish Review checks (review/spanish/).
  spanishAccents: only(["es_ES"], "spelling", "typo"),
  spanishConfusions: only(["es_ES"], "grammar", "confusedWords"),
  spanishTypography: only(["es_ES"], "typography", "numbers"),
  spanishAgreement: only(["es_ES"], "grammar", "agreement"),
  spanishQuotes: only(["es_ES"], "typography", "marks", { off: true }),
  spanishTypographyStyle: only(["es_ES"], "typography", "numbers", {
    off: true,
    note: "Optional typography: Spain writes a decimal comma, but the point is accepted too.",
  }),
  // French (review/french/)
  frenchVerbForms: only(["fr_FR"], "grammar", "wordForm"),
  frenchHomophones: only(["fr_FR"], "grammar", "confusedWords"),
  frenchHyphenation: only(["fr_FR"], "spelling", "boundary"),
  frenchSubjectVerbAgreement: only(["fr_FR"], "grammar", "agreement"),
  frenchElision: only(["fr_FR"], "spelling", "boundary"),
  frenchDates: only(["fr_FR"], "grammar", "numbers"),
  frenchNounNumber: only(["fr_FR"], "grammar", "agreement"),
  frenchNounGender: only(["fr_FR"], "grammar", "agreement"),
  frenchAdjectiveAgreement: only(["fr_FR"], "grammar", "agreement"),
  frenchTout: only(["fr_FR"], "grammar", "agreement"),
  frenchMood: only(["fr_FR"], "grammar", "wordForm"),
  frenchMissingNe: only(["fr_FR"], "style", "wordForm", {
    off: true,
    note: "Optional: spoken French drops the ne of a negation.",
  }),
  frenchOrdinals: only(["fr_FR"], "typography", "numbers", {
    off: true,
    note: "Optional: 2ème and 1ère are common; typographic usage writes 2e and 1re.",
  }),
  frenchCommas: only(["fr_FR"], "punctuation", "marks"),
  // German-only Review checks (review/german/).
  germanNounCasing: only(["de_DE"], "typography", "capitalization"),
  germanPrepositionCase: only(["de_DE"], "grammar", "agreement"),
  germanConfusedWords: only(["de_DE"], "grammar", "confusedWords"),
  germanAdjectiveForms: only(["de_DE"], "grammar", "wordForm"),
  germanSuspendedHyphen: only(["de_DE"], "punctuation", "marks"),
  germanAbbreviations: only(["de_DE"], "typography", "marks"),
  germanQuotes: only(["de_DE"], "typography", "marks"),
  germanAbbreviationSpacing: only(["de_DE"], "typography", "spacing", { off: true }),
  germanDates: only(["de_DE"], "punctuation", "numbers"),
  germanCompounds: only(["de_DE"], "grammar", "boundary"),
  germanCommas: only(["de_DE"], "punctuation", "marks"),
  germanVerbAgreement: only(["de_DE"], "grammar", "agreement"),
  germanArticleGender: only(["de_DE"], "grammar", "agreement"),
  germanQuestionMarks: only(["de_DE"], "punctuation", "marks", { off: true }),
  germanNumbers: only(["de_DE"], "grammar", "numbers"),
  germanStraightQuotes: only(["de_DE"], "typography", "marks", { off: true }),
  germanColloquial: only(["de_DE"], "style", "usage", { off: true }),
  germanRecommendedSpelling: only(["de_DE"], "style", "usage", { off: true }),
  germanTypography: only(["de_DE"], "typography", "marks", {
    off: true,
    note: "Optional typography: x and * between numbers are common in plain text.",
  }),
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
