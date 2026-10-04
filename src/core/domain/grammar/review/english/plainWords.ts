import { englishLexiconInflect } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import type { ReviewDetectorEntry } from "../reviewDetectors";

// More optional plain-English rows (stylePhrasing, off by default): formal verbs with an
// everyday twin ("obtain" -> "get"), wordy phrases ("the majority of" -> "most"), negated
// pairs ("not many" -> "few"), and pairs that say a thing twice ("true facts"). Verbs that
// are also nouns ("attempt", "purchase") stay out.

/** Every form of a regular or listed verb, mapped to the same form of its plain twin. */
function verbFor(lemma: string, plain: string): PhraseRow[] {
  const forms = (verb: string) => [
    verb,
    ...(["third", "past", "ing"] as const).map((form) => englishLexiconInflect(verb, form) ?? ""),
  ];
  const typed = forms(lemma);
  const twin = forms(plain);
  return typed.flatMap((form, i): PhraseRow[] => (form && twin[i] ? [[form, twin[i]]] : []));
}

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];

export const STYLE: readonly PhraseRow[] = [
  ...verbFor("obtain", "get"),
  ...verbFor("acquire", "get"),
  ...verbFor("accompany", "go with"),
  ...verbFor("accelerate", "speed up"),
  ["adjacent to", "next to"],
  ["in respect of", "about"],
  ["attributable to", "because of"],
  ["at the moment,", "now,"],
  [["the majority of", "a majority of"], "most"],
  ["majority of the", "most of the"],
  [["make decision about", "make a decision on"], "decide on"],
  ["made a decision to", "decided to"],
  ["make a decision to", "decide to"],
  ["not many", "few"],
  ["not the same", "different"],
  ["not unlike", ["like", "similar to"]],
  ["not very often", "rarely"],
  ["for the most part", "mostly"],
  ["in a timely manner", "promptly"],
  ["gather up", "gather"],
  ["exactly the same", "the same"],
  ["general public", "public"],
  ["many different", "many"],
  ["an established fact", "a fact"],
  ["true facts", "facts"],
  ["try and", "try to"],
  ...["help", "helps", "helped"].flatMap((help) =>
    ["me", "you", "him", "her", "us", "them"].map((who): PhraseRow => [
      `${help} ${who} to`,
      `${help} ${who}`,
    ]),
  ),
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [];
