// The rule library (library.ts): the French lexicon and French word helpers.
export { finding } from "../review/finding";
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
export type {
  AdjectiveReading,
  Gender as FrenchGender,
  Inflection,
  VerbReading,
  VerbSlot,
} from "../review/french/frenchLexicon";
