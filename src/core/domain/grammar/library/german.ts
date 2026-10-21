// The rule library (library.ts): the German lexicon and German word helpers.
export {
  deumlaut,
  germanAdjective,
  germanAdjectiveNoun,
  germanGender,
  germanInfinitive,
  germanListedNoun,
  germanMayBeNoun,
  germanNounOverAdjective,
  germanNounReading,
  germanPastInfinitives,
  germanTwoGenders,
  germanVerbLike,
  germanVerbObjectCase,
} from "../review/german/germanLexicon";
export {
  englishLine as deEnglishLine,
  englishWords as deEnglishWords,
  likeTyped as deLikeTyped,
  tokensAfter as deTokensAfter,
  tokensBefore as deTokensBefore,
} from "../review/german/shared";

export { utcDate as deUtcDate } from "../review/reviewClock";
export type { GermanGenderReading } from "../review/german/germanLexicon";
export {
  germanAuxiliary,
  germanFiniteInfinitive,
  germanFittingForms,
  germanInfinitiveOf,
  germanModal,
  germanNotVerb,
  germanPluralNoun,
  germanVerbForms,
} from "./german/verbs";
export type { GermanSlot } from "./german/verbs";
export {
  germanAdjectiveEnding,
  germanCaseFits,
  germanContraction,
  germanDeterminer,
  germanDeterminerFits,
  germanDeterminerFor,
  germanDeterminerReadings,
} from "./german/declension";
export type { GermanCase, GermanCaseGender, GermanDeterminer } from "./german/declension";
export { deWordBefore } from "./german/words";
