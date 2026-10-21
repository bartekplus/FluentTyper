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

// Participles and noun-to-verb forms (review/english/realWordFrames).
export {
  nounVerb as enNounVerb,
  participle as enParticiple,
} from "../review/english/realWordFrames";

// Dotted tokens of prose and quoted mentions (library/english/words.ts).
export {
  PROSE_DOTTED_TOKEN as EN_PROSE_DOTTED_TOKEN,
  quotedMention as enQuotedMention,
} from "./english/words";

// The casing of a fix like the typed words (library/english/words.ts).
export { recase as enRecase } from "./english/words";

// Group 5 (remaining, fixedPhrases, grammarStyle2, idioms1, confusions1, confusions2,
// compoundForms, lexical): the listed nouns of the lexicon and the irregular verb table.
export {
  englishListedNoun as enListedNoun,
  englishListedWithoutPlural as enListedWithoutPlural,
} from "../implementations/helpers/EnglishLexicon";
export { ENGLISH_VERB_FORMS as EN_VERB_FORMS } from "../implementations/helpers/EnglishVerbForms";
// Group 5: the text before an index and the word after it.
export { before as enBefore, nextWord as enNextWord } from "../review/phraseTemplates";
// Group 5: the word key (lowercase, ’ as ') and the tokens around a target in its text block
// (library/english/blockTokens.ts).
export { wordKey as enWordKey } from "../implementations/helpers/GenericRuleShared";
export {
  blockTokensAfter as enBlockTokensAfter,
  blockTokensBefore as enBlockTokensBefore,
  isBlockWord as enIsBlockWord,
} from "./english/blockTokens";
export type { BlockHit as EnBlockHit, BlockToken as EnBlockToken } from "./english/blockTokens";
// Group 5: the words around a position in its clause and the clause bounds
// (library/english/clauseWords.ts), and a word glued to the text after it.
export {
  clauseClosesAt as enClauseClosesAt,
  clauseOpensAt as enClauseOpensAt,
  clauseWordsAfter as enClauseWordsAfter,
  clauseWordsBefore as enClauseWordsBefore,
  wordsAround as enWordsAround,
} from "./english/clauseWords";
export type {
  ClauseWord as EnClauseWord,
  WordsAround as EnWordsAround,
} from "./english/clauseWords";
export { gluedAfter as enGluedAfter } from "../review/phraseTemplates";
