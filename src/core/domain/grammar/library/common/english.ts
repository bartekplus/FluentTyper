// The rule library (library.ts): questions about English words that read the English lexicon.
import {
  englishListedNoun,
  englishListedWithoutPlural,
  englishNounPair,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { knownEnglishNounNumber } from "../../implementations/helpers/EnglishNounNumber";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";

// The closed word classes are built at the first use: a content script that loads the library
// for the typing rules does not build them.
const words = (list: string) => list.split(" ");
let functionWords: ReadonlySet<string> | undefined;

/**
 * True for an English function word that the lexicon also lists as a noun or verb ("in", "it",
 * "up", "now"): determiners, pronouns, wh-words, prepositions, adverbs without a class,
 * conjunctions, auxiliaries and quantifiers.
 */
export function isEnglishFunctionWord(word: string): boolean {
  functionWords ??= new Set([
    ...words(
      "a an the my your our his her their this that these those some any no every each another",
    ),
    ...words("me him us them you her it i he she we they what where when why how who which"),
    ...words(
      "whatever of in on at by for from with without about into onto upon between among " +
        "through during until against near under over toward towards within across along around " +
        "behind beyond inside outside off out up down past via per like despite throughout",
    ),
    ...words(
      "not never always also just still really so too already probably definitely certainly " +
        "actually basically finally simply totally completely absolutely pretty quite rather " +
        "almost nearly sometimes usually often now then here there way far much even only very " +
        "literally seriously truly obviously clearly apparently surely hardly barely maybe " +
        "perhaps again soon once ever all",
    ),
    ...words(
      "and or but nor yet so as than if whether because since though although while unless to " +
        "is are was were be been being am have has had do does did can could will would shall " +
        "should may might must own other others such same both either neither more most less " +
        "least few many several",
    ),
  ]);
  return functionWords.has(word);
}

// Irregular plurals the dictionary does not link to their singular, and plural-looking nouns
// that are singular or invariant ("a means", "a series", "a big thanks").
let irregular: ReadonlyMap<string, string> | undefined;
let irregularPlurals: ReadonlyMap<string, string> | undefined;
let invariant: ReadonlySet<string> | undefined;

function nounTables() {
  if (!irregular) {
    const pairs = words(
      "man men woman women child children person people foot feet tooth teeth mouse mice goose " +
        "geese criterion criteria phenomenon phenomena stimulus stimuli analysis analyses crisis " +
        "crises thesis theses hypothesis hypotheses diagnosis diagnoses parenthesis parentheses " +
        "cactus cacti fungus fungi nucleus nuclei radius radii appendix appendices matrix matrices " +
        "vertex vertices alumnus alumni curriculum curricula bacterium bacteria ox oxen knife knives " +
        "wife wives life lives half halves wolf wolves shelf shelves thief thieves loaf loaves leaf " +
        "leaves freshman freshmen gentleman gentlemen chairman chairmen policeman policemen fireman " +
        "firemen fisherman fishermen salesman salesmen spokesman spokesmen businessman businessmen " +
        "workman workmen postman postmen snowman snowmen grandchild grandchildren",
    ).flatMap((w, i, all) => (i % 2 ? [] : [[w, all[i + 1]] as const]));
    irregular = new Map(pairs);
    irregularPlurals = new Map(pairs.map(([s, p]) => [p, s]));
    invariant = new Set(
      words(
        "means series species news odds headquarters crossroads barracks gallows whereabouts " +
          "thanks kudos savings sales works premises remains lens bus gas yes congrats outskirts " +
          "arms goods lots data media percent pence head stone fold clogs guys folks sigma " +
          "innings tens hundreds thousands millions billions dozens youth today tonight tomorrow " +
          "yesterday overnight sometimes",
      ),
    );
  }
  return { irregular, irregularPlurals: irregularPlurals!, invariant: invariant! };
}

function regularPlural(word: string): string {
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

type NounNumber = { singular: string; plural: string; number: "singular" | "plural" };

// The lexicon is static: many frames ask about the same words, so each word is read once.
const NOUN_NUMBERS = new Map<string, NounNumber | null>();

/** Singular/plural forms of a lowercase noun and which one it is, or null. */
export function englishNounNumber(word: string): NounNumber | null {
  let found = NOUN_NUMBERS.get(word);
  if (found === undefined) {
    if (NOUN_NUMBERS.size >= 50_000) NOUN_NUMBERS.clear();
    NOUN_NUMBERS.set(word, (found = readNounNumber(word)));
  }
  return found;
}

function readNounNumber(word: string): NounNumber | null {
  const tables = nounTables();
  if (
    tables.invariant.has(word) ||
    /(?:ics|wards|doors|stairs|works)$/.test(word) ||
    isEnglishFunctionWord(word)
  )
    return null;
  const plural = tables.irregular.get(word);
  if (plural) return { singular: word, plural, number: "singular" };
  const singular = tables.irregularPlurals.get(word);
  if (singular) return { singular, plural: word, number: "plural" };
  const pair = englishNounPair(word);
  if (pair) return { ...pair, number: word === pair.plural ? "plural" : "singular" };
  // Long plain nouns without a dictionary plural: regular plurals.
  const listed = englishListedNoun(word);
  // "dolphins" may hit the filter too: a listed stem before -s makes it the plural.
  if (
    listed === "singular" &&
    /s$/.test(word) &&
    englishListedNoun(word.slice(0, -1)) === "singular"
  )
    return null;
  if (listed === "singular" && !englishListedWithoutPlural(word) && !englishWordInfo(word))
    return { singular: word, plural: regularPlural(word), number: "singular" };
  if (listed === "plural" && !englishWordInfo(word)) {
    const stem = [word.replace(/ies$/, "y"), word.replace(/es$/, ""), word.slice(0, -1)].find(
      (s) => s !== word && englishListedNoun(s) === "singular" && regularPlural(s) === word,
    );
    if (stem) return { singular: stem, plural: word, number: "plural" };
  }
  // Derived nouns ("hikers" from hike + -er + -s) read as plain plurals only.
  const read = englishWordInfo(word);
  if (read?.plural && !read.verbs.length && !read.adjective && /ers$/.test(word)) {
    const stem = englishWordInfo(word.slice(0, -1));
    if (stem?.noun && !stem.plural && !stem.verbs.length)
      return { singular: word.slice(0, -1), plural: word, number: "plural" };
  }
  return null;
}

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
