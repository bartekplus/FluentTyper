// The rule library (library.ts): questions about English words that read the English lexicon.
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { knownEnglishNounNumber } from "../../implementations/helpers/EnglishNounNumber";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";

/**
 * A lowercase plural noun: "noun", "ambiguous" when it is also an -s verb (houses, changes),
 * else null. The lexicon omits long nouns that only take a plural, so an unknown long -s word
 * (centuries, developers) is one.
 */
export function pluralNoun(word: string): "noun" | "ambiguous" | null {
  if (word !== word.toLowerCase()) return null;
  if (knownEnglishNounNumber(word) === "plural") return "noun";
  const info = englishWordInfo(word);
  if (!info) return word.length > 6 && /[^siu]s$/.test(word) ? "noun" : null;
  if (!info.plural) return null;
  return info.verbs.some((verb) => verb.form === "third") ? "ambiguous" : "noun";
}

/**
 * True when `word` (any case) is the simple past of exactly one verb of the verb form table
 * ("lay" is lay's lemma and lie's past, so it is not).
 */
export function isUniquePast(word: string): boolean {
  const entry = englishVerbForms(word);
  return !!entry && entry.past === word.toLowerCase();
}
