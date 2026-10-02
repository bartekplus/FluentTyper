// Derives the German noun lexicon behind Review's noun-casing check from the Hunspell dictionary
// the extension ships (de_DE.dic/.aff). The dictionary lists nouns capitalized and every other
// word lowercase, so a lowercase noun form can be told apart from a verb or adjective that
// happens to share its spelling ("die kosten" / "kosten", "der griff" / "griff").
// Writes src/core/domain/grammar/review/german/germanLexicon.generated.ts.
// Usage: bun run generate:german-lexicon
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BLOOM_ALPHABET,
  bloomBits,
} from "../src/core/domain/grammar/implementations/helpers/EnglishLexicon";

type Rule = { flag: string; strip: string; add: string; cond: RegExp; onlyInCompound: boolean };

const root = resolve(import.meta.dir, "..");
export const GERMAN_LEXICON_SOURCES = {
  dic: resolve(root, "resources_js/de_DE/hunspell/de_DE.dic"),
  aff: resolve(root, "resources_js/de_DE/hunspell/de_DE.aff"),
  out: resolve(root, "src/core/domain/grammar/review/german/germanLexicon.generated.ts"),
};

// The igerman98 suffix flags that spell finite verb endings; the others spell noun and
// adjective endings. The bare entry of a verb is its infinitive (also the 1st/3rd plural).
const FINITE_FLAGS = "IXYZW";
// Hunspell control flags: ONLYINCOMPOUND, NEEDAFFIX and FORBIDDENWORD.
const COMPOUND_ONLY = "o";
const NEED_AFFIX = "h";
const FORBIDDEN = "d";
// The cascades' first levels set how often an unknown word reads as a noun (2^-8) or a
// noun as an infinitive; a verb read falsely only costs a finding, so its filter is looser.
const NOUN_GOLOMB_BITS = 8;
const INFINITIVE_GOLOMB_BITS = 6;
const VERB_BITS_PER_WORD = 8;
const ADJECTIVE_BITS_PER_WORD = 12;

type Reading = "finite" | "infinitive" | "other";

function parseAff(aff: string): { suffixes: Rule[]; prefixes: Rule[] } {
  const suffixes: Rule[] = [];
  const prefixes: Rule[] = [];
  for (const line of aff.split("\n")) {
    const [kind, flag, strip, addRaw, cond] = line.trim().split(/\s+/);
    if ((kind !== "SFX" && kind !== "PFX") || cond === undefined) continue;
    const [add, continuation = ""] = addRaw.split("/");
    const pattern = cond === "." ? "" : cond;
    (kind === "SFX" ? suffixes : prefixes).push({
      flag,
      strip: strip === "0" ? "" : strip,
      add: add === "0" ? "" : add,
      cond: new RegExp(kind === "SFX" ? `${pattern}$` : `^${pattern}`),
      onlyInCompound: continuation.includes(COMPOUND_ONLY),
    });
  }
  return { suffixes, prefixes };
}

/** Lowercase noun forms, and every reading of each lowercase standalone word. */
export function deriveGermanLexicon(dic: string, aff: string) {
  const { suffixes, prefixes } = parseAff(aff);
  // Only the un- and ver- prefixes spell standalone words; the others spell compound pieces.
  const wordPrefixes = prefixes.filter((r) => r.flag === "U" || r.flag === "V");
  const nouns = new Set<string>();
  const lower = new Map<string, Set<Reading>>();
  const adjectives = new Set<string>();
  const read = (form: string, reading: Reading) => {
    let readings = lower.get(form);
    if (!readings) lower.set(form, (readings = new Set()));
    readings.add(reading);
  };
  for (const line of dic.split("\n").slice(1)) {
    if (!line || /^\s/.test(line)) continue;
    const [word, flags = ""] = line.trim().split("/");
    if (flags.includes(COMPOUND_ONLY) || flags.includes(FORBIDDEN)) continue;
    const capitalized = /^[A-ZÄÖÜ]/.test(word);
    const forms: [string, Reading][] = [];
    // An inflecting adjective: its bare lemma ("klein", "original").
    if (!capitalized && flags.includes("A")) adjectives.add(word);
    // A capitalized compound head ("Rasen/hij") is still a noun on its own.
    if (capitalized || !flags.includes(NEED_AFFIX)) {
      const verb = /[IXY]/.test(flags) && /n$/.test(word);
      const finiteStem = !verb && flags.includes("Z");
      forms.push([word, verb ? "infinitive" : finiteStem ? "finite" : "other"]);
    }
    for (const rule of suffixes) {
      if (rule.onlyInCompound || !flags.includes(rule.flag) || !rule.cond.test(word)) continue;
      if (!word.endsWith(rule.strip)) continue;
      const form = word.slice(0, word.length - rule.strip.length) + rule.add;
      forms.push([form, FINITE_FLAGS.includes(rule.flag) ? "finite" : "other"]);
    }
    for (const [form, reading] of forms) {
      if (capitalized) {
        if (/^[A-ZÄÖÜ][a-zäöüß]+$/.test(form)) nouns.add(form.toLowerCase());
        continue;
      }
      read(form, reading);
      for (const rule of wordPrefixes)
        if (flags.includes(rule.flag)) read(rule.add + form, reading);
    }
  }
  const nounOnly: string[] = [];
  const finite: string[] = [];
  const infinitive: string[] = [];
  for (const noun of [...nouns].sort()) {
    const readings = lower.get(noun);
    if (!readings) nounOnly.push(noun);
    else if (readings.has("other")) continue;
    else if (readings.has("infinitive")) infinitive.push(noun);
    else finite.push(noun);
  }
  const verbs = [...lower].filter(([, readings]) => readings.has("infinitive")).map(([w]) => w);
  return {
    nounOnly,
    finite,
    infinitive,
    verbs: verbs.sort(),
    adjectives: [...adjectives].sort(),
    lowercaseWords: [...lower.keys()].sort(),
  };
}

/** A Bloom filter as six bits per character of BLOOM_ALPHABET, lowest bit first. */
function bloom(words: string[], bitsPerWord: number, hashes?: number) {
  const size = Math.max(6, Math.ceil((words.length * bitsPerWord) / 6) * 6);
  const bits = new Uint8Array(size);
  for (const word of words) for (const bit of bloomBits(word, size, hashes)) bits[bit] = 1;
  let filter = "";
  for (let i = 0; i < size; i += 6) {
    let value = 0;
    for (let b = 0; b < 6; b++) value |= bits[i + b] << b;
    filter += BLOOM_ALPHABET[value];
  }
  return filter;
}

/**
 * A Golomb-coded set: each word hashed into [0, n·2^r), sorted, and the gaps written as a
 * unary quotient and an r-bit remainder, six bits per character, lowest bit first. About
 * r + 1.5 bits a word for a false-positive rate of 2^-r. Written "g<r>.<n>.<count>.<bits>".
 */
function golomb(words: string[], r: number): { text: string; has: (word: string) => boolean } {
  const range = words.length * 2 ** r;
  const values = [...new Set(words.map((w) => bloomBits(w, range, 1)[0]))].sort((a, b) => a - b);
  const bits: number[] = [];
  let previous = 0;
  for (const value of values) {
    const gap = value - previous;
    previous = value;
    for (let q = Math.floor(gap / 2 ** r); q > 0; q--) bits.push(1);
    bits.push(0);
    for (let b = 0; b < r; b++) bits.push((gap >> b) & 1);
  }
  let payload = "";
  for (let i = 0; i < bits.length; i += 6) {
    let value = 0;
    for (let b = 0; b < 6; b++) value |= (bits[i + b] ?? 0) << b;
    payload += BLOOM_ALPHABET[value];
  }
  const set = new Set(values);
  return {
    text: `g${r}.${words.length}.${values.length}.${payload}`,
    has: (word) => set.has(bloomBits(word, range, 1)[0]),
  };
}

/**
 * A filter cascade (as in CRLite) that answers exactly for every word in `members` or
 * `others`: level 0 holds the members, level 1 the others level 0 lets through, level 2 the
 * members level 1 catches, and so on until a level lets nothing through. Levels are joined by
 * spaces and salt their words with their index. Level 0 is a Golomb-coded set, so words in
 * neither list read as members at a rate of 2^-r; the others are Bloom filters that start
 * with their hash count.
 */
function cascade(members: string[], others: string[], r: number): string {
  const levels: string[] = [];
  let include = members;
  let exclude = others;
  for (let level = 0; include.length > 0; level++) {
    const salted = include.map((w) => `${level}${w}`);
    let passes: (word: string) => boolean;
    if (level === 0) {
      const set = golomb(salted, r);
      levels.push(set.text);
      passes = (w) => set.has(`0${w}`);
    } else {
      // Later levels thin out the words the level before let through; a false yes costs a
      // word in the next level, so the more words would pass, the more bits each gets.
      const bitsPerWord = Math.max(3, 1.44 * Math.log2(exclude.length / include.length));
      const hashes = Math.max(1, Math.round(bitsPerWord * Math.LN2));
      const filter = bloom(salted, bitsPerWord, hashes);
      levels.push(`${hashes}${filter}`);
      const size = filter.length * 6;
      const on = (bit: number) => (BLOOM_ALPHABET.indexOf(filter[(bit / 6) | 0]) >> (bit % 6)) & 1;
      passes = (w) => bloomBits(`${level}${w}`, size, hashes).every(on);
    }
    [include, exclude] = [exclude.filter(passes), include];
  }
  return levels.join(" ");
}

/** Sorted words with the shared prefix of each with the one before as one digit (0–9). */
function frontCode(words: string[]): string {
  let previous = "";
  return words
    .map((word) => {
      let shared = 0;
      while (shared < 9 && word[shared] === previous[shared]) shared++;
      previous = word;
      return `${shared}${word.slice(shared)}`;
    })
    .join("");
}

export function buildGermanLexicon(dic: string, aff: string): string {
  const { nounOnly, finite, infinitive, verbs, adjectives, lowercaseWords } = deriveGermanLexicon(
    dic,
    aff,
  );
  const nouns = new Set([...nounOnly, ...finite, ...infinitive]);
  // Prettier's layout, so the committed file passes format:check as written.
  const line = (name: string, value: string) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-german-lexicon.ts from de_DE.dic/.aff. Do not edit.",
    "// Lowercased noun forms that are no other word when lowercase, or only a finite verb form",
    "// or an infinitive (a filter cascade, exact on the dictionary's lowercase words); which of",
    "// those are infinitives (a cascade); the finite ones (front-coded); then every infinitive",
    "// and every adjective lemma (Bloom filters).",
    line(
      "NOUN_CASCADE",
      cascade(
        [...nouns].sort(),
        lowercaseWords.filter((w) => !nouns.has(w)),
        NOUN_GOLOMB_BITS,
      ),
    ),
    line("INFINITIVE_CASCADE", cascade(infinitive, nounOnly, INFINITIVE_GOLOMB_BITS)),
    line("FINITE_NOUNS", frontCode(finite)),
    line("VERB_BLOOM", bloom(verbs, VERB_BITS_PER_WORD)),
    line("ADJECTIVE_BLOOM", bloom(adjectives, ADJECTIVE_BITS_PER_WORD)),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [dic, aff] = await Promise.all([
    readFile(GERMAN_LEXICON_SOURCES.dic, "utf8"),
    readFile(GERMAN_LEXICON_SOURCES.aff, "utf8"),
  ]);
  const source = buildGermanLexicon(dic, aff);
  await writeFile(GERMAN_LEXICON_SOURCES.out, source);
  console.log(`wrote ${GERMAN_LEXICON_SOURCES.out} (${source.length} bytes)`);
}
