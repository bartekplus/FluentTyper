// The rule library (library.ts): the French lexicon and French word helpers.
import { verbReadings, type VerbReading, type VerbSlot } from "../review/french/frenchLexicon";
import type { Token as FrenchToken } from "../review/french/frenchTokens";
import type { RawFinding } from "../review/reviewDetectors";

export { accentedNoun, hAspire } from "./french/words";
export { firstNameGender } from "../review/french/firstNames";
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
  compoundsStartingWith,
  conjugate,
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

/** The persons of a verb slot that are also in `persons` (0 for a slot that is no finite form). */
export const maskPersons = (slot: VerbSlot, persons: number): number =>
  typeof slot === "number" ? slot & persons : 0;

/** The persons a word can agree with as a finite form of the verb `lemma` (0 when none). */
export const lemmaPersons = (word: string, lemma: string): number =>
  verbReadings(word).reduce(
    (mask, r) => (r.lemma === lemma && typeof r.slot === "number" ? mask | r.slot : mask),
    0,
  );

/** The first person of a mask of persons (JE before TU before IL ...). */
export const lowestPerson = (mask: number): number => mask & -mask;

/**
 * The sentence around `index`: from the character after the last `stop` mark before it to the
 * next `stop` mark, and at most `reach` characters on each side.
 */
export function sentenceBounds(
  text: string,
  index: number,
  reach: number,
  stop: RegExp,
): [number, number] {
  const first = Math.max(0, index - reach);
  const last = Math.min(text.length, index + reach);
  let start = index;
  while (start > first && !stop.test(text[start - 1])) start--;
  let end = index;
  while (end < last && !stop.test(text[end])) end++;
  return [start, end];
}

/** Whether a verb reading is a finite form (not an infinitive or a participle). */
export const finiteReading = (reading: VerbReading): boolean => typeof reading.slot === "number";

export type {
  AdjectiveReading,
  Gender as FrenchGender,
  Inflection,
  VerbReading,
} from "../review/french/frenchLexicon";
