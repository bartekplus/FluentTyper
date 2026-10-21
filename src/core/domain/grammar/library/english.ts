// The rule library (library.ts): the English lexicon and English word helpers. The names have
// an `en` prefix so that they do not clash with the names of other areas.

// Words around a position, closed word classes and lexicon readings (review/english/slotWords).
export {
  ADVERBS as EN_ADVERBS,
  AUXILIARIES as EN_AUXILIARIES,
  BE_FINITE as EN_BE_FINITE,
  DETERMINERS as EN_DETERMINERS,
  FUNCTION_WORDS as EN_FUNCTION_WORDS,
  OBJECT_PRONOUNS as EN_OBJECT_PRONOUNS,
  PERMISSION_AFTER as EN_PERMISSION_AFTER,
  PREPOSITIONS as EN_PREPOSITIONS,
  SUBJECT_PRONOUNS as EN_SUBJECT_PRONOUNS,
  WH_WORDS as EN_WH_WORDS,
  adverb as enAdverb,
  afterBreak as enAfterBreak,
  clauseAfter as enClauseAfter,
  english as enEnglish,
  evidence as enEvidence,
  frontedObjectBefore as enFrontedObjectBefore,
  info as enInfo,
  nounOnly as enNounOnly,
  objectGapBefore as enObjectGapBefore,
  plain as enPlain,
  pushSlot as enPushSlot,
  tokensAfter as enTokensAfter,
  wordBefore as enWordBefore,
} from "../review/english/slotWords";
export type { SlotRule as EnSlotRule, Token as EnToken } from "../review/english/slotWords";

// Noun number and mass nouns (library/english/nouns.ts).
export {
  MASS as EN_MASS,
  nounNumber as enNounNumber,
  wordsAfter as enWordsAfter,
} from "./english/nouns";

// Collective nouns and clause openings (library/english/words.ts).
export { COLLECTIVE as EN_COLLECTIVE, opensClause as enOpensClause } from "./english/words";

// Participles and noun-to-verb forms (library/english/verbs.ts).
export { nounVerb as enNounVerb, participle as enParticiple } from "./english/verbs";

// Dotted tokens of prose and quoted mentions (library/english/words.ts).
export {
  PROSE_DOTTED_TOKEN as EN_PROSE_DOTTED_TOKEN,
  quotedMention as enQuotedMention,
} from "./english/words";

// The casing of a fix like the typed words (library/english/words.ts).
export { recase as enRecase } from "./english/words";

// Group 1 (agreementSlots, clauseAgreementSlots, missingVerbSlots, relativeSlots,
// agreementFrames, realWordFrames, verbSlots): lexicon readings that its rules read.
export { englishCountNoun, englishNounPair } from "../implementations/helpers/EnglishLexicon";
