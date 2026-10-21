// The rule library (library/english.ts): the number of English nouns, read from the generated
// lexicon and the irregular forms, and the words after a position.
import {
  englishListedNoun,
  englishListedWithoutPlural,
  englishNounPair,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { ENGLISH_MASS_NOUNS } from "../../implementations/helpers/EnglishCountability";
import type { DetectContext } from "../../review/reviewDetectors";
import { FUNCTION_WORDS, type Token } from "../../review/english/slotWords";

// Nouns used uncountably that a/an and many never take: "an advice", "many money".
export const MASS = ENGLISH_MASS_NOUNS;

// Irregular plurals the dictionary does not link to their singular.
export const IRREGULAR = new Map(
  (
    "man men woman women child children person people foot feet tooth teeth mouse mice goose " +
    "geese criterion criteria phenomenon phenomena stimulus stimuli analysis analyses crisis " +
    "crises thesis theses hypothesis hypotheses diagnosis diagnoses parenthesis parentheses " +
    "cactus cacti fungus fungi nucleus nuclei radius radii appendix appendices matrix matrices " +
    "vertex vertices alumnus alumni curriculum curricula bacterium bacteria ox oxen knife knives " +
    "wife wives life lives half halves wolf wolves shelf shelves thief thieves loaf loaves leaf " +
    "leaves freshman freshmen gentleman gentlemen chairman chairmen policeman policemen fireman " +
    "firemen fisherman fishermen salesman salesmen spokesman spokesmen businessman businessmen " +
    "workman workmen postman postmen snowman snowmen grandchild grandchildren"
  )
    .split(" ")
    .flatMap((w, i, all) => (i % 2 ? [] : [[w, all[i + 1]] as const])),
);
export const IRREGULAR_PLURALS = new Map([...IRREGULAR].map(([s, p]) => [p, s]));
// Plural-looking nouns that are singular or invariant: "a means", "a series", "a big thanks".
export const INVARIANT = new Set(
  (
    "means series species news odds headquarters crossroads barracks gallows whereabouts thanks " +
    "kudos savings sales works premises remains lens bus gas yes congrats outskirts arms goods " +
    "lots data media percent pence head stone fold clogs guys folks sigma innings tens hundreds " +
    "thousands millions billions dozens youth today tonight tomorrow yesterday overnight sometimes"
  ).split(" "),
);

export type NounNumber = { singular: string; plural: string; number: "singular" | "plural" };

// The word token of tokensAfter, with no other token kind.
const WORD =
  /[ \t\u00a0]*([A-Za-z]+(?:['’][A-Za-z]+)?)(?![\p{L}\p{M}\p{N}_@/#\\-]|\.[\p{L}\p{N}])/uy;

/**
 * The tokens of tokensAfter(ctx, index, count) before the first token that is not a word. It
 * reads no token after that one.
 */
export function wordsAfter(ctx: DetectContext, index: number, count: number): Token[] {
  const words: Token[] = [];
  WORD.lastIndex = index;
  for (let m = WORD.exec(ctx.text); m && words.length < count; m = WORD.exec(ctx.text)) {
    const text = m[1];
    const end = m.index + m[0].length;
    words.push({ text, lower: text.toLowerCase(), start: end - text.length, end, kind: "word" });
  }
  return words;
}

// The lexicon is static: many frames ask about the same words, so each word is read once.
const NOUN_NUMBERS = new Map<string, NounNumber | null>();

/** Singular/plural forms of a lowercase noun and which one it is, or null. */
export function nounNumber(word: string): NounNumber | null {
  let found = NOUN_NUMBERS.get(word);
  if (found === undefined) {
    if (NOUN_NUMBERS.size >= 50_000) NOUN_NUMBERS.clear();
    NOUN_NUMBERS.set(word, (found = readNounNumber(word)));
  }
  return found;
}

function readNounNumber(word: string): NounNumber | null {
  if (
    INVARIANT.has(word) ||
    /(?:ics|wards|doors|stairs|works)$/.test(word) ||
    FUNCTION_WORDS.has(word)
  )
    return null;
  const irregular = IRREGULAR.get(word);
  if (irregular) return { singular: word, plural: irregular, number: "singular" };
  const singular = IRREGULAR_PLURALS.get(word);
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

function regularPlural(word: string): string {
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}
