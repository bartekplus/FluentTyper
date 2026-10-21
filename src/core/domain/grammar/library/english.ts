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
  evidence as enEvidence,
  frontedObjectBefore as enFrontedObjectBefore,
  info as enInfo,
  nounOnly as enNounOnly,
  objectGapBefore as enObjectGapBefore,
  tokensAfter as enTokensAfter,
  wordBefore as enWordBefore,
} from "../review/english/slotWords";
export type { Token as EnToken } from "../review/english/slotWords";

// Noun number and mass nouns (library/english/nouns.ts).
export { nounNumber as enNounNumber, wordsAfter as enWordsAfter } from "./english/nouns";

// Collective nouns and clause openings (library/english/words.ts).
export { COLLECTIVE as EN_COLLECTIVE, opensClause as enOpensClause } from "./english/words";

// Participles and noun-to-verb forms (library/english/verbs.ts).
export { nounVerb as enNounVerb, participle as enParticiple } from "./english/verbs";

// Dotted tokens of prose and quoted mentions (library/english/words.ts).
export { quotedMention as enQuotedMention } from "./english/words";

// The casing of a fix like the typed words (library/english/words.ts).
export { recase as enRecase } from "./english/words";

// Group 1 (agreementSlots, clauseAgreementSlots, missingVerbSlots, relativeSlots,
// agreementFrames, realWordFrames, verbSlots): lexicon readings that its rules read.
export { englishNounPair } from "../implementations/helpers/EnglishLexicon";
// Group nounNumber/count/determiner/noNot/clause/complement/slip/verbGroup/wordClass slots:
// the lexicon names that their rules read.
export {
  englishCountNoun,
  englishLexiconInflect,
  englishListedNoun,
  englishVerbNouns,
} from "../implementations/helpers/EnglishLexicon";
export {
  IRREGULAR as EN_IRREGULAR,
  IRREGULAR_PLURALS as EN_IRREGULAR_PLURALS,
} from "./english/nouns";
export type { EnglishWordInfo as EnWordInfo } from "../implementations/helpers/EnglishLexicon";
export { readWord as enReadWord } from "./english/readings";
// Group idioms5 (idioms2-5, slot confusions, contraction, neighbour and typo slots, misheard
// words): the text before an index and the word after it (review/phraseTemplates).
export { before as enBefore, nextWord as enNextWord } from "../review/phraseTemplates";
// A long word the lexicon lists as a plain noun only ("information").

// Group 6 (collocation, noun, clause, tense and date slots): lexicon data and inflection.
export { ENGLISH_VERB_FORMS as EN_VERB_FORMS } from "../implementations/helpers/EnglishVerbForms";

// Group 6: the calendar of the date checks, and the named phrase tables of en.yaml.
export { weekdaysFor as enWeekdaysFor } from "../review/reviewClock";
export { enTable } from "./english/tables";
// Group 5 (remaining, fixedPhrases, grammarStyle2, idioms1, confusions1, confusions2,
// compoundForms, lexical): the listed nouns of the lexicon and the irregular verb table.
export { englishListedWithoutPlural as enListedWithoutPlural } from "../implementations/helpers/EnglishLexicon";

// Group 5: the text before an index and the word after it.

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
  clauseWordsBefore as enClauseWordsBefore,
  wordsAround as enWordsAround,
} from "./english/clauseWords";
export type {
  ClauseWord as EnClauseWord,
  WordsAround as EnWordsAround,
} from "./english/clauseWords";

// Group 5: views, and the findings of a frame rule by its id (library/english/views.ts).
export { inView as enInView, ruleFindings as enRuleFindings } from "./english/views";

// Group 5: a read through a cache that a rule file keeps (library/english/cache.ts).
// Group 3 (grammarStyle1, articles, confusionSlots, everydaySlots, wordFormSlots, punctuation,
// typography, apostrophes, plainStyle).

// The findings of another frame rule (library/english/rules.ts).
