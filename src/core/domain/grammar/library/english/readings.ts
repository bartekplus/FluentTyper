// The rule library (library/english.ts): lexicon readings and forms of typed English words.
import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";

/** The lexicon reading of a typed word in any case, or null for no word. */
export const readWord = (word: string | undefined) =>
  word ? englishWordInfo(word.toLowerCase()) : null;

/** The past participle of a verb lemma: the listed irregular form, else the inflected one. */
export function participleOf(lemma: string): string | null {
  const forms = englishVerbForms(lemma);
  if (forms && forms.lemma === lemma) return forms.participle;
  return englishInflect(lemma, "past");
}
