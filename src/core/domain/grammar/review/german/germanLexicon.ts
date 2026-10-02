import { BLOOM_ALPHABET, bloomBits } from "../../implementations/helpers/EnglishLexicon";
import {
  ADJECTIVE_BLOOM,
  FINITE_NOUNS,
  INFINITIVE_CASCADE,
  NOUN_CASCADE,
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

type Level = (word: string) => boolean;
type Cascade = Level[];
let nounCascade: Cascade | undefined;
let infinitiveCascade: Cascade | undefined;
let verbBloom: Uint8Array | undefined;
let adjectiveBloom: Uint8Array | undefined;
let finite: Set<string> | undefined;
let extra: Set<string> | undefined;

function decode(text: string): Uint8Array {
  const filter = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) filter[i] = BLOOM_ALPHABET.indexOf(text[i]);
  return filter;
}
const has = (filter: Uint8Array, word: string, hashes?: number) =>
  bloomBits(word, filter.length * 6, hashes).every(
    (bit) => (filter[(bit / 6) | 0] >> (bit % 6)) & 1,
  );

/** A Golomb-coded set "g<r>.<n>.<count>.<bits>" (see scripts/generate-german-lexicon.ts). */
function golomb(text: string): Level {
  const [header, payload] = [
    text.slice(1, text.lastIndexOf(".")),
    text.slice(text.lastIndexOf(".") + 1),
  ];
  const [r, n, count] = header.split(".").map(Number);
  const bits = decode(payload);
  const values = new Uint32Array(count);
  let at = 0;
  const bit = () => (bits[(at / 6) | 0] >> (at++ % 6)) & 1;
  let value = 0;
  for (let i = 0; i < count; i++) {
    let gap = 0;
    while (bit()) gap += 2 ** r;
    for (let b = 0; b < r; b++) gap += bit() << b;
    values[i] = value += gap;
  }
  const range = n * 2 ** r;
  return (word) => {
    const hash = bloomBits(word, range, 1)[0];
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (values[mid] === hash) return true;
      if (values[mid] < hash) low = mid + 1;
      else high = mid - 1;
    }
    return false;
  };
}

const decodeCascade = (text: string): Cascade =>
  text.split(" ").map((level) => {
    if (level.startsWith("g")) return golomb(level);
    const hashes = Number(level[0]);
    const filter = decode(level.slice(1));
    return (word: string) => has(filter, word, hashes);
  });
/** A word is in the cascade's set when the first level that lacks it is an odd one. */
function inCascade(cascade: Cascade, word: string): boolean {
  const miss = cascade.findIndex((level, i) => !level(`${i}${word}`));
  return (miss < 0 ? cascade.length : miss) % 2 === 1;
}
/** "0aal3e3bbinde": each word after the prefix it shares with the one before. */
function frontDecoded(text: string): Set<string> {
  const words = new Set<string>();
  let previous = "";
  for (const [, shared, rest] of text.matchAll(/(\d)(\D*)/g)) {
    previous = previous.slice(0, Number(shared)) + rest;
    words.add(previous);
  }
  return words;
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
  finite ??= frontDecoded(FINITE_NOUNS);
  extra ??= new Set(EXTRA_NOUNS.split(" "));
  if (finite.has(w)) return "finite";
  if (extra.has(w)) return "noun";
  nounCascade ??= decodeCascade(NOUN_CASCADE);
  if (!inCascade(nounCascade, w)) return null;
  infinitiveCascade ??= decodeCascade(INFINITIVE_CASCADE);
  return inCascade(infinitiveCascade, w) ? "infinitive" : "noun";
}

/** An adjective lemma that inflects ("klein", "original"); loose, about 0.3% false yeses. */
export function germanAdjective(word: string): boolean {
  adjectiveBloom ??= decode(ADJECTIVE_BLOOM);
  return has(adjectiveBloom, word.normalize("NFC"));
}
