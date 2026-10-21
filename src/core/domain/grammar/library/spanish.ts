// The rule library (library.ts): the Spanish lexicon and Spanish word helpers. The names start
// with "es" (ES_ for word sets): other languages have helpers of the same kind.
export type {
  Around as SpanishAround,
  Token as SpanishToken,
  Tokens as SpanishTokens,
} from "../review/spanish/common";

export type { Determiner as SpanishDeterminer } from "../review/spanish/nouns";
export {
  around as esAround,
  attributeOf as esAttributeOf,
  BOUNDARY as ES_BOUNDARY,
  CLITICS as ES_CLITICS,
  CONJUNCTIONS as ES_CONJUNCTIONS,
  DETERMINERS as ES_DETERMINERS,
  GIVEN_NAMES as ES_GIVEN_NAMES,
  INVARIANT as ES_INVARIANT,
  isBoundary as esIsBoundary,
  isInfinitive as esIsInfinitive,
  keepsTyped as esKeepsTyped,
  OPENING as ES_OPENING,
  PREPOSITIONS as ES_PREPOSITIONS,
  PRENOMINAL as ES_PRENOMINAL,
  replaceToken as esReplaceToken,
  SER as ES_SER,
  subjectAt as esSubjectAt,
  tokenize as esTokens,
  verbLike as esVerbLike,
} from "../review/spanish/common";
export {
  ACCENTED_NOMINAL as ES_ACCENTED_NOMINAL,
  attribute as esAttribute,
  finiteVerb as esFiniteVerb,
  genderedForm as esGenderedForm,
  isGenderedEntry as esIsGenderedEntry,
  isGerund as esIsGerund,
  isInvariantEntry as esIsInvariantEntry,
  isNoun as esIsNoun,
  isVerb as esIsVerb,
  NOUN_ENDING as ES_NOUN_ENDING,
  nounForm as esNounForm,
  participle as esParticiple,
  plain as esPlain,
  presentInfinitive as esPresentInfinitive,
  secondPersonVerb as esSecondPersonVerb,
  subjunctiveLike as esSubjunctiveLike,
} from "../review/spanish/lexicon";
export {
  DETERMINER as ES_DETERMINER,
  EITHER as ES_EITHER_GENDER,
  EITHER_ENDING as ES_EITHER_ENDING,
  genderless as esGenderless,
  NOT_NOUNS as ES_NOT_NOUNS,
  NUMBER_WORDS as ES_NUMBER_WORDS,
  otherGender as esOtherGender,
  pluralOf as esPluralOf,
  readNoun as esReadNoun,
  singulars as esSingulars,
} from "../review/spanish/nouns";
export { monthNumber as esMonthNumber } from "../review/spanish/typography";
// Dates: the calendar, and the ISO date frame of every language.

// The clause reader that the agreement checks of several languages share.
