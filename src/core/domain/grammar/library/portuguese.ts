// The rule library (library.ts): the Brazilian Portuguese lexicon and Brazilian Portuguese word helpers.
export type { PtNoun } from "./portuguese/nouns";
export {
  PT_NOT_NOUNS,
  PT_SINGULAR_IN_S,
  ptAccentedTwins,
  ptFiniteLookalike,
  ptNoun,
  ptPlainVowels,
  ptPlural,
  ptSingular,
  ptVerbTwin,
} from "./portuguese/nouns";
export type { PtPerson, PtSubjunctive, PtVerbReading } from "./portuguese/verbs";
export {
  PT_FORM_ROWS,
  PT_IRREGULAR_STEM,
  PT_NOT_FINITE,
  PT_NOT_PLURAL_VERBS,
  PT_NOT_VERBS,
  PT_ROW_PERSONS,
  ptConjugate,
  ptFiniteVerb,
  ptFirstPersonStem,
  ptFutureOfPast,
  ptInfinitive,
  ptInflect,
  ptKnownVerb,
  ptPastOfFuture,
  ptPluralVerb,
  ptRStem,
  ptSingularVerb,
  ptSubjunctive,
  ptVerbReadings,
  ptVerbSlots,
  ptVerbStems,
} from "./portuguese/verbs";
export type { PtClauseVerb } from "./portuguese/clauses";
export { PT_CLAUSE, ptClauseVerb } from "./portuguese/clauses";
export { userWord } from "./portuguese/text";

// Generic helpers that the Portuguese rules read.
export { applyWordCase } from "../implementations/helpers/GenericRuleShared";
export { finding } from "../review/finding";
export { gluedAfter } from "../review/phraseTemplates";
export { resolveMeasurementLocale } from "../measurement/registry";
export { contextYear, daysInMonth, nearestDayOn, weekdayOf, yearsFor } from "../review/reviewClock";
export {
  clauseTokensAfter,
  skipComplements,
  skipCoordinated,
  skipPostnominal,
  verbAfterRelative,
} from "../review/clauseReader";
