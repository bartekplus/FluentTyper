// The rule library (library.ts): the Spanish lexicon and Spanish word helpers. The names start
// with "es" (ES_ for word sets): other languages have helpers of the same kind.
export type {
  Around as SpanishAround,
  Token as SpanishToken,
  Tokens as SpanishTokens,
} from "../review/spanish/common";
export type { Agreement as SpanishAgreement } from "../review/spanish/lexicon";
export type {
  Determiner as SpanishDeterminer,
  Gender as SpanishGender,
  Noun as SpanishNoun,
} from "../review/spanish/nouns";
export {
  around as esAround,
  attributeOf as esAttributeOf,
  BOUNDARY as ES_BOUNDARY,
  carryCase as esCarryCase,
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
  tokenAt as esTokenAt,
  tokenize as esTokens,
  verbLike as esVerbLike,
} from "../review/spanish/common";
export {
  ACCENTED_NOMINAL as ES_ACCENTED_NOMINAL,
  accentLast as esAccentLast,
  attribute as esAttribute,
  finiteVerb as esFiniteVerb,
  genderedForm as esGenderedForm,
  isGenderedEntry as esIsGenderedEntry,
  isGerund as esIsGerund,
  isInvariantEntry as esIsInvariantEntry,
  isNoun as esIsNoun,
  isNounEntry as esIsNounEntry,
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
export {
  contextYear as esContextYear,
  daysInMonth as esDaysInMonth,
  nearestDayOn as esNearestDayOn,
  weekdayOf as esWeekdayOf,
  yearsFor as esYearsFor,
} from "../review/reviewClock";
export { invalidIsoDate as esInvalidIsoDate } from "../review/isoDates";
// The clause reader that the agreement checks of several languages share.
export type {
  ClauseProfile as SpanishClauseProfile,
  ClauseToken as SpanishClauseToken,
} from "../review/clauseReader";
export {
  skipComplements as esSkipComplements,
  skipCoordinated as esSkipCoordinated,
  skipPostnominal as esSkipPostnominal,
  verbAfterRelative as esVerbAfterRelative,
} from "../review/clauseReader";
