// The rule library (library.ts): the French lexicon and French word helpers.
import type { VerbSlot } from "../review/french/frenchLexicon";
import type { Token as FrenchToken } from "../review/french/frenchTokens";

export { finding } from "../review/finding";
export { invalidIsoDate } from "../review/isoDates";
export { accentedNoun, hAspire } from "./french/words";
export { firstNameGender } from "../review/french/firstNames";
// TRANSITIONAL: these move to fr.yaml when their modules are ported.
export { sontForSon } from "../review/french/homophones";
export { contextYear, daysInMonth, nearestDayOn, weekdayOf, yearsFor } from "../review/reviewClock";
export {
  applyWordCase,
  carryCase,
  detectWordCase,
} from "../implementations/helpers/GenericRuleShared";
export {
  CLITICS,
  PREPOSITIONS,
  SENTENCE_START,
  SUBJECT_PRONOUNS,
  capitalizedName,
  tokensAfter,
  tokensBefore,
  wordFinding,
} from "../review/french/frenchTokens";
export type { Token as FrenchToken } from "../review/french/frenchTokens";
export {
  IL,
  ILS,
  JE,
  NOUS,
  TU,
  VOUS,
  adjectiveReadings,
  authoredGenderable,
  compoundsStartingWith,
  conjugate,
  endingGender,
  finitePersons,
  genderable,
  inflect,
  isDictionaryCompound,
  isFrenchWord,
  isInflectedNoun,
  isNounLemma,
  isVerbHomograph,
  isVerbLemma,
  nounGender,
  pastParticiple,
  pluralSingulars,
  suffixGender,
  verbReadings,
} from "../review/french/frenchLexicon";

/** The index of the first token from `from` on whose word is not in `words`; the length of
 * `tokens` when there is none. */
export function skipWords(
  tokens: readonly FrenchToken[],
  from: number,
  words: ReadonlySet<string>,
): number {
  let i = from;
  while (tokens[i] && words.has(tokens[i].w)) i++;
  return i;
}

/** Whether a verb slot is a finite form of one of the persons (a mask of JE ... ILS). */
export const hasPerson = (slot: VerbSlot, persons: number): boolean =>
  typeof slot === "number" && (slot & persons) > 0;

export type {
  AdjectiveReading,
  Gender as FrenchGender,
  Inflection,
  VerbReading,
  VerbSlot,
} from "../review/french/frenchLexicon";
