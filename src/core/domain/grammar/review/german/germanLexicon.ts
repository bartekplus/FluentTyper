import { BLOOM_ALPHABET, bloomBits } from "../../implementations/helpers/EnglishLexicon";
import {
  FINITE_NOUNS,
  INFINITIVE_NOUNS,
  NOUN_BLOOM,
  NOUN_BLOOM_EXCEPTIONS,
  VERB_BLOOM,
} from "./germanLexicon.generated";

/**
 * What a lowercase German word is when it is also a noun form: only a noun ("zugriff" is not
 * a word unless capitalized), a noun or a finite verb form ("griff", "stelle"), or a noun or an
 * infinitive ("kosten", "fällen"). Null: not a noun, or also an adjective, adverb or other word.
 */
export type GermanNounReading = "noun" | "finite" | "infinitive";

// Nouns the bundled dictionary lacks, in their lowercase forms (authored).
const EXTRA_NOUNS = "mühe träne weile eile zeit";

let bloom: Uint8Array | undefined;
let verbBloom: Uint8Array | undefined;
let exceptions: Set<string> | undefined;
let finite: Set<string> | undefined;
let infinitive: Set<string> | undefined;
let extra: Set<string> | undefined;

function decode(text: string): Uint8Array {
  const filter = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) filter[i] = BLOOM_ALPHABET.indexOf(text[i]);
  return filter;
}
const has = (filter: Uint8Array, word: string) =>
  bloomBits(word, filter.length * 6).every((bit) => (filter[(bit / 6) | 0] >> (bit % 6)) & 1);

function inBloom(word: string): boolean {
  bloom ??= decode(NOUN_BLOOM);
  exceptions ??= new Set(NOUN_BLOOM_EXCEPTIONS.split(" "));
  return !exceptions.has(word) && has(bloom, word);
}

/** An infinitive in the dictionary ("laufen", "sammeln"); loose like germanVerbLike. */
export function germanInfinitive(word: string): boolean {
  verbBloom ??= decode(VERB_BLOOM);
  return /(?:en|ln|rn)$/.test(word) && has(verbBloom, word.normalize("NFC"));
}

/**
 * Whether a lowercase word may be a verb: an infinitive (or 1st/3rd plural), a 1st singular
 * ("gebe") or a past form ("machte", "machten"). Loose: a false yes only loses a finding.
 */
export function germanVerbLike(word: string): boolean {
  verbBloom ??= decode(VERB_BLOOM);
  const filter = verbBloom;
  const infinitive = (stem: string) => has(filter, stem);
  const w = word.normalize("NFC");
  if (w.endsWith("en") && infinitive(w)) return true;
  if (w.endsWith("ten") && infinitive(`${w.slice(0, -3)}en`)) return true;
  if (!w.endsWith("e")) return false;
  return (
    infinitive(`${w}n`) ||
    infinitive(`${w.slice(0, -1)}en`) ||
    (w.endsWith("te") && infinitive(`${w.slice(0, -2)}en`))
  );
}

export function germanNounReading(word: string): GermanNounReading | null {
  const w = word.normalize("NFC");
  finite ??= new Set(FINITE_NOUNS.split(" "));
  infinitive ??= new Set(INFINITIVE_NOUNS.split(" "));
  extra ??= new Set(EXTRA_NOUNS.split(" "));
  if (finite.has(w)) return "finite";
  if (infinitive.has(w)) return "infinitive";
  return extra.has(w) || inBloom(w) ? "noun" : null;
}
