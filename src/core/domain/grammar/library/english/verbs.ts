// The rule library (library/english.ts): English verb forms that the lexicon does not give
// directly: the past participle of a lemma and the verb of a noun.
import { wordTable } from "../../review/wordTable";
import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import { FUNCTION_WORDS } from "../../review/english/slotWords";

const read = (word: string) => (word ? englishWordInfo(word.toLowerCase()) : null);
const baseVerb = (word: string) =>
  !!read(word)?.verbs.some((v) => v.form === "base" && v.lemma === word.toLowerCase());

/** The past participle of a base verb: irregular table first. */
export const participle = (lemma: string) => {
  const irregular = englishVerbForms(lemma);
  return irregular?.lemma === lemma ? irregular.participle : englishInflect(lemma, "past");
};

// Nouns whose verb the suffix rules below do not reach.
const NOUN_VERBS: Record<string, string> = wordTable({
  life: "live",
  belief: "believe",
  relief: "relieve",
  grief: "grieve",
  proof: "prove",
  threat: "threaten",
  intent: "intend",
  advice: "advise",
  choice: "choose",
  multiple: "multiply",
});

/** The base verb a noun stands for ("complaint" -> complain, "departures" -> depart). */
export function nounVerb(noun: string): string | null {
  const singular = /ies$/.test(noun)
    ? `${noun.slice(0, -3)}y`
    : /(?:[^s]s|ss)$/.test(noun) && !/ss$/.test(noun)
      ? noun.slice(0, -1)
      : noun;
  const r = read(singular);
  if (NOUN_VERBS[singular]) return r?.verbs.length ? null : NOUN_VERBS[singular];
  if (!r?.noun || r.verbs.length || r.adjective || r.adverb || FUNCTION_WORDS.has(singular))
    return null;
  const candidates = [
    singular.replace(/aint$/, "ain"),
    singular.replace(/ery$/, "er"),
    singular.replace(/ure$/, ""),
    singular.replace(/ure$/, "e"),
    singular.replace(/al$/, ""),
    singular.replace(/al$/, "e"),
  ];
  // "depart", "deliver": a verb, maybe also a noun; not an adjective.
  return candidates.find((c) => c !== singular && baseVerb(c) && !read(c)?.adjective) ?? null;
}
