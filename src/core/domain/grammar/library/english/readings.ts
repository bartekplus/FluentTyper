// The rule library (library/english.ts): lexicon readings of typed English words.
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";

/** The lexicon reading of a typed word in any case, or null for no word. */
export const readWord = (word: string | undefined) =>
  word ? englishWordInfo(word.toLowerCase()) : null;
