// The rule library (library.ts): the Polish lexicon and Polish word helpers. The names have a
// "pl" prefix: other languages have their own lexicon helpers.
export {
  caseLike as plCaseLike,
  findingAt as plFindingAt,
  sentenceStartAt as plSentenceStart,
  userOrNamed as plUserOrNamed,
} from "../review/polish/shared";
export {
  ALL_CASES as PL_ALL_CASES,
  FEMININE as PL_FEMININE,
  MASCULINE as PL_MASCULINE,
  NEUTER as PL_NEUTER,
  PLURAL as PL_PLURAL,
  SINGULAR as PL_SINGULAR,
  VERB as PL_VERB,
  VIRILE as PL_VIRILE,
  adjectiveAgrees as plAdjectiveAgrees,
  adjectiveForm as plAdjectiveForm,
  adjectiveOf as plAdjectiveOf,
  agreeingEndings as plAgreeingEndings,
  ambiguousAdjective as plAmbiguousAdjective,
  ambiguousVerb as plAmbiguousVerb,
  cases as plCases,
  finiteVerb as plFiniteVerb,
  hasAdjective as plHasAdjective,
  imperativeVerb as plImperativeVerb,
  impersonalVerb as plImpersonalVerb,
  inflect as plInflect,
  listedVerb as plListedVerb,
  menOnlyPlural as plMenOnlyPlural,
  menPluralShape as plMenPluralShape,
  nounTags as plNounTags,
  onlyNoun as plOnlyNoun,
  pastByShape as plPastByShape,
  perfectiveVerb as plPerfectiveVerb,
  placeForm as plPlaceForm,
  readingCases as plReadingCases,
  virileAdjective as plVirileAdjective,
  virileLemma as plVirileLemma,
} from "../review/polish/lexicon";
export { GENITIVE as PL_MONTHS_GENITIVE } from "../review/polish/dates";
export {
  contextYear as plContextYear,
  daysInMonth as plDaysInMonth,
  weekdayOf as plWeekdayOf,
  yearsFor as plYearsFor,
} from "../review/reviewClock";
export { invalidIsoDate as plInvalidIsoDate } from "../review/isoDates";
export { tagsAnd, tagsCases, tagsOr, tagsWithout } from "./polish/tags";
export type { PlReadWord, PlWord } from "./polish/words";
export { plWords } from "./polish/words";
