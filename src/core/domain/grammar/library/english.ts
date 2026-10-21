// The rule library (library.ts): the English lexicon and English word helpers. The names have
// an `en` prefix (or `english`, for the lexicon) so that they do not clash with the names of
// other areas.

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
  evidence as enEvidence,
  frontedObjectBefore as enFrontedObjectBefore,
  info as enInfo,
  nounOnly as enNounOnly,
  objectGapBefore as enObjectGapBefore,
  tokensAfter as enTokensAfter,
  wordBefore as enWordBefore,
} from "../review/english/slotWords";
export type { Token as EnToken } from "../review/english/slotWords";

// Noun number, the irregular plurals and the words after a position (library/english/nouns.ts).
export {
  IRREGULAR as EN_IRREGULAR,
  IRREGULAR_PLURALS as EN_IRREGULAR_PLURALS,
  nounNumber as enNounNumber,
  wordsAfter as enWordsAfter,
} from "./english/nouns";

// Collective nouns, clause openings, quoted mentions and the casing of a fix like the typed
// words (library/english/words.ts).
export {
  COLLECTIVE as EN_COLLECTIVE,
  opensClause as enOpensClause,
  quotedMention as enQuotedMention,
  recase as enRecase,
} from "./english/words";

// Participles and noun-to-verb forms (library/english/verbs.ts).
export { nounVerb as enNounVerb, participle as enParticiple } from "./english/verbs";

// The lexicon: readings, noun pairs, listed nouns, inflection and the verb table.
export {
  englishCountNoun,
  englishLexiconInflect,
  englishListedNoun,
  englishListedWithoutPlural as enListedWithoutPlural,
  englishNounPair,
  englishVerbNouns,
} from "../implementations/helpers/EnglishLexicon";
export type { EnglishWordInfo as EnWordInfo } from "../implementations/helpers/EnglishLexicon";
export { readWord as enReadWord } from "./english/readings";
export { ENGLISH_VERB_FORMS as EN_VERB_FORMS } from "../implementations/helpers/EnglishVerbForms";

// The text before an index and the word after it (review/phraseTemplates).
export { before as enBefore, nextWord as enNextWord } from "../review/phraseTemplates";

// The weekdays of the date checks, and the named phrase tables of en.yaml.
export { weekdaysFor as enWeekdaysFor } from "../review/reviewClock";
export { enTable } from "./english/tables";

// The word key (lowercase, ’ as ') and the tokens around a target in its text block
// (library/english/blockTokens.ts).
export { wordKey as enWordKey } from "../implementations/helpers/GenericRuleShared";
export {
  blockTokensAfter as enBlockTokensAfter,
  blockTokensBefore as enBlockTokensBefore,
  isBlockWord as enIsBlockWord,
} from "./english/blockTokens";
export type { BlockHit as EnBlockHit, BlockToken as EnBlockToken } from "./english/blockTokens";

// The words around a position in its clause and the clause bounds (library/english/clauseWords.ts).
export {
  clauseClosesAt as enClauseClosesAt,
  clauseOpensAt as enClauseOpensAt,
  clauseWordsBefore as enClauseWordsBefore,
  wordsAround as enWordsAround,
} from "./english/clauseWords";
export type {
  ClauseWord as EnClauseWord,
  WordsAround as EnWordsAround,
} from "./english/clauseWords";

// Views, and the findings of another frame rule by its id (library/english/views.ts).
export { inView as enInView, ruleFindings as enRuleFindings } from "./english/views";
