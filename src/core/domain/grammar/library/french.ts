// The rule library (library.ts): the French lexicon and French word helpers.
import type { VerbReading, VerbSlot } from "../review/french/frenchLexicon";
import type { Token as FrenchToken } from "../review/french/frenchTokens";
import type { RawFinding } from "../review/reviewDetectors";

export { finding } from "../review/finding";
export { invalidIsoDate } from "../review/isoDates";
export { accentedNoun, hAspire } from "./french/words";
export { firstNameGender } from "../review/french/firstNames";
// TRANSITIONAL: these move to fr.yaml when their modules are ported.
export { subjectEndsAt } from "../review/french/agreement";
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

/** The index of the first token from `from` on that fails `test`; the length of `tokens` when
 * there is none. */
export function skipWhile(
  tokens: readonly FrenchToken[],
  from: number,
  test: (token: FrenchToken) => boolean,
): number {
  let i = from;
  while (tokens[i] && test(tokens[i])) i++;
  return i;
}

/** The match of a sticky (`y`) regex at `index` of `text`, or null. */
export function execAt(pattern: RegExp, text: string, index: number): RegExpExecArray | null {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

/** Whether a verb slot is a finite form of one of the persons (a mask of JE ... ILS). */
export const hasPerson = (slot: VerbSlot, persons: number): boolean =>
  typeof slot === "number" && (slot & persons) > 0;

/** A test of a verb reading. */
export type ReadingTest = (reading: VerbReading) => boolean;
/** A finding whose evidence starts at a token (or at the match when there is none). */
export type TokenFix = (context: FrenchToken | undefined) => RawFinding | null;
/** A finding whose evidence ends at an index. */
export type EndFix = (end: number) => RawFinding | null;
/** A finding with fixed evidence. */
export type PlainFix = () => RawFinding | null;
/** A finding with fixed evidence and these alternatives. */
export type AlternativesFix = (alternatives: string[]) => RawFinding;
/** A finding on a word with these alternatives, or null (wordFinding). */
export type WordFix = (alternatives: string[]) => RawFinding | null;

/** Whether a verb reading is a finite form (not an infinitive or a participle). */
export const finiteReading = (reading: VerbReading): boolean => typeof reading.slot === "number";

export type {
  AdjectiveReading,
  Gender as FrenchGender,
  Inflection,
  VerbReading,
  VerbSlot,
} from "../review/french/frenchLexicon";
