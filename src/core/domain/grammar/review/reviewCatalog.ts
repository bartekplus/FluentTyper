import { isObjectRecord } from "../../guards";
import { GRAMMAR_RULE_CATALOG, isCodeSafeGrammarRule, type CatalogRuleId } from "../ruleCatalog";
import {
  REVIEW_LOCAL_AI_CHECK,
  REVIEW_SPELLING_CHECK,
  type ReviewCategory,
  type ReviewCheckId,
} from "./types";

/**
 * Review metadata for every catalog rule. The Record type makes a new catalog
 * rule a compile error until it is explicitly classified here, so no rule is
 * silently omitted from review or assumed safe to batch.
 *
 * `bulk: "eligible"` means the rule's fix is deterministic and batch-approved for
 * "Fix all". The typing-time `safetyTier` is NOT used for that decision.
 */
export type ReviewRuleMetadata =
  | {
      review: "supported";
      defaultEnabled: boolean;
      category: ReviewCategory;
      bulk: "eligible" | "individual";
      /** Why a supported rule stays individual-only, when it does. */
      note?: string;
    }
  | { review: "excluded"; reason: string };

export const REVIEW_RULE_METADATA: Record<CatalogRuleId, ReviewRuleMetadata> = {
  englishContextualCompounds: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishNounNumber: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishPerfectParticiples: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishVerbComplements: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishFixedPrepositions: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishItsContext: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishLetsContext: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishElsePossessive: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishExistentialAgreement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishThenThan: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishYourYouAre: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishTheirThereTheyAre: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishToToo: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },

  englishAuxiliaryBaseVerb: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  englishRepeatedWords: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
  },
  capitalizeSentenceStart: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    bulk: "eligible",
  },
  capitalizeAfterLineBreak: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    bulk: "individual",
    note: "Line starts in poems, lists and hard-wrapped text are often lowercase on purpose.",
  },
  englishPronounICapitalization: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    bulk: "eligible",
  },
  englishContractionNormalization: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    bulk: "eligible",
  },
  englishTypoWhitelistCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    bulk: "eligible",
  },
  doubleSpaceToPeriod: {
    review: "excluded",
    reason: "Typing shortcut: existing double spaces are not sentence ends.",
  },
  englishModalOfCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "eligible",
  },
  englishYourWelcomeCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "eligible",
  },
  englishTheirThereBeVerb: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "eligible",
  },
  englishAlotCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "spelling",
    bulk: "eligible",
  },
  englishPronounVerbWhitelistAgreement: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "eligible",
  },
  englishArticleAnCorrection: {
    review: "supported",
    defaultEnabled: true,
    category: "grammar",
    bulk: "individual",
    note: "Word-list heuristic; a letter or identifier can look like an article.",
  },
  englishOrdinalSuffix: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    bulk: "eligible",
  },
  englishProperNounCapitalization: {
    review: "supported",
    defaultEnabled: true,
    category: "typography",
    bulk: "eligible",
  },
  technicalTokenCompaction: {
    review: "excluded",
    reason: 'Ambiguous in finished text: "Chapter 3: 5 tips" is not a clock time.',
  },
  mathOperatorSpacing: {
    review: "excluded",
    reason: "Typing-time style; existing operators are often code or notation.",
  },
  measurementUnitFormatting: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    bulk: "individual",
    note: "Units in technical prose (CSS, product names) are meaning-sensitive.",
  },
  currencySpacing: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    bulk: "eligible",
  },
  slashContextSpacing: {
    review: "excluded",
    reason: "Typing convenience; spacing around an existing slash is style, not an error.",
  },
  openingBracketSpacing: {
    review: "excluded",
    reason: 'Typing convenience that only spaces code-like "){"; not prose proofreading.',
  },
  closingBracketSpacing: {
    review: "excluded",
    reason: "Bracket spacing in finished text is often notation, Markdown or intervals.",
  },
  commaPeriodSpacing: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    bulk: "eligible",
  },
  collapseRepeatedSpaces: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    bulk: "eligible",
  },
  trimSpaceBeforeLineBreak: {
    review: "excluded",
    reason: "Invisible, and two trailing spaces are a Markdown line break.",
  },
  ellipsisShortcut: { review: "excluded", reason: "Typing shortcut, not an error." },
  emdashShortcut: { review: "excluded", reason: "Typing shortcut, not an error." },
  smartQuoteNormalization: {
    review: "excluded",
    reason: "Typing convenience; straight quotes in finished text may be code or deliberate.",
  },
  frenchPunctuationSpacing: {
    review: "excluded",
    reason: "Typing-time typography convention; invisible no-break space changes.",
  },
  duplicatePunctuationCollapse: {
    review: "supported",
    defaultEnabled: true,
    category: "punctuation",
    bulk: "eligible",
  },
  autoBracketClose: {
    review: "excluded",
    reason: "Typing convenience: review never inserts closing brackets.",
  },
};

/** Review's dictionary check: individual only, and the user always picks the word. */
const REVIEW_SPELLING_METADATA: ReviewRuleMetadata = {
  review: "supported",
  defaultEnabled: true,
  category: "spelling",
  bulk: "individual",
  note: "An unknown word has several possible corrections, or none: the user picks.",
};

/** Local AI corrections: generated text, so never batched; the category is set per finding. */
const REVIEW_LOCAL_AI_METADATA: ReviewRuleMetadata = {
  review: "supported",
  defaultEnabled: false,
  category: "grammar",
  bulk: "individual",
  note: "Generated by the optional local model: the user accepts each correction.",
};

export function reviewMetadataFor(ruleId: ReviewCheckId): ReviewRuleMetadata {
  if (ruleId === REVIEW_SPELLING_CHECK) return REVIEW_SPELLING_METADATA;
  if (ruleId === REVIEW_LOCAL_AI_CHECK) return REVIEW_LOCAL_AI_METADATA;
  return REVIEW_RULE_METADATA[ruleId];
}

/** Catalog order; the coverage map shown in docs and asserted by tests. */
export function reviewCoverageMap(): Array<{ ruleId: CatalogRuleId } & ReviewRuleMetadata> {
  return GRAMMAR_RULE_CATALOG.map((entry) => ({
    ruleId: entry.id,
    ...REVIEW_RULE_METADATA[entry.id],
  }));
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
