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

// Prefixes of verbs whose past the dictionary lists only as bare words ("outgrew", "foresaw").
// Not "be": "bespoke" is an adjective the lexicon does not mark.
const PAST_PREFIXES = ["out", "over", "under", "re", "mis", "fore", "with", "up"];

/**
 * A simple past that differs from its participle and its base, with its lemma and participle.
 * Prefixed pasts the dictionary lists only as bare words ("outgrew", "foresaw") borrow the table
 * row of their stem. `ambiguous`: the past is also a word written on purpose (saw, found).
 */
export function simplePastOnly(
  word: string,
): { lemma: string; participle: string; ambiguous: boolean } | null {
  const forms = englishVerbForms(word);
  if (forms)
    return word === forms.past && word !== forms.participle && word !== forms.lemma
      ? { ...forms, ambiguous: forms.ambiguous.includes(word) }
      : null;
  for (const prefix of PAST_PREFIXES) {
    if (!word.startsWith(prefix)) continue;
    const stem = englishVerbForms(word.slice(prefix.length));
    if (!stem || stem.past !== word.slice(prefix.length)) continue;
    if (stem.past === stem.participle || stem.past === stem.lemma) continue;
    const info = englishWordInfo(word);
    if (!info || info.verbs.length || info.noun || info.adjective) continue;
    return { lemma: prefix + stem.lemma, participle: prefix + stem.participle, ambiguous: false };
  }
  return null;
}
