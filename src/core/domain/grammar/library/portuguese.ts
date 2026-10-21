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
export type { PtPerson, PtSubjunctive } from "./portuguese/verbs";
export {
  PT_FORM_ROWS,
  PT_NOT_FINITE,
  PT_NOT_PLURAL_VERBS,
  PT_NOT_VERBS,
  PT_ROW_PERSONS,
  ptConjugate,
  ptFiniteVerb,
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

export { PT_CLAUSE, ptClauseVerb } from "./portuguese/clauses";
export { userWord } from "./portuguese/text";

// Generic helpers that the Portuguese rules read.
export { gluedAfter } from "../review/phraseTemplates";
