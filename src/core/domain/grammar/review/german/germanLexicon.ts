import { BLOOM_ALPHABET, bloomBits } from "../../implementations/helpers/EnglishLexicon";
import {
  ADJECTIVE_BLOOM,
  FINITE_NOUNS,
  INFINITIVE_CASCADE,
  NOUN_CASCADE,
  VERB_BLOOM,
} from "./germanLexicon.generated";
import * as GENDER_DATA from "./germanGender.generated";
import {
  ACCUSATIVE_VERBS,
  ADJECTIVE_NOUNS,
  DATIVE_VERBS,
  NGRAM_NOUNS,
  NOUNS_OVER_ADJECTIVES,
} from "./germanUsage.generated";

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
    (w.endsWith("te") && infinitive(`${w.slice(0, -2)}en`)) ||
    // "leistete", "wartete": a stem in -t or -d.
    (w.endsWith("ete") && infinitive(`${w.slice(0, -3)}en`))
  );
}

export function germanNounReading(word: string): GermanNounReading | null {
  const w = word.normalize("NFC");
  finite ??= frontDecoded(FINITE_NOUNS);
  extra ??= new Set([...EXTRA_NOUNS.split(" "), ...frontDecoded(NGRAM_NOUNS)]);
  if (finite.has(w)) return "finite";
  if (extra.has(w)) return "noun";
  nounCascade ??= decodeCascade(NOUN_CASCADE);
  if (!inCascade(nounCascade, w)) return null;
  infinitiveCascade ??= decodeCascade(INFINITIVE_CASCADE);
  return inCascade(infinitiveCascade, w) ? "infinitive" : "noun";
}

let nounsOverAdjectives: Set<string> | undefined;
let dativeVerbs: Set<string> | undefined;
let accusativeVerbs: Set<string> | undefined;

/**
 * A lowercase noun form that is also an adjective form but, after a determiner, reads as the
 * noun far more often ("das alter", "auf die spitze"; not "die alte", "eine kleine").
 */
export function germanNounOverAdjective(word: string): boolean {
  nounsOverAdjectives ??= frontDecoded(NOUNS_OVER_ADJECTIVES);
  return nounsOverAdjectives.has(word.normalize("NFC"));
}

let adjectiveNouns: Set<string> | undefined;
/** A lowercase noun form that is also an adjective form, read either way ("wunder", "defekt"). */
export function germanAdjectiveNoun(word: string): boolean {
  adjectiveNouns ??= frontDecoded(ADJECTIVE_NOUNS);
  return adjectiveNouns.has(word.normalize("NFC"));
}

/** The case of the one object a finite verb form takes ("hilft": dative, "fragt": accusative). */
export function germanVerbObjectCase(word: string): "dative" | "accusative" | null {
  const w = word.normalize("NFC");
  dativeVerbs ??= frontDecoded(DATIVE_VERBS);
  accusativeVerbs ??= frontDecoded(ACCUSATIVE_VERBS);
  if (dativeVerbs.has(w)) return "dative";
  return accusativeVerbs.has(w) ? "accusative" : null;
}

/** An adjective lemma that inflects ("klein", "original"); loose, about 0.3% false yeses. */
export function germanAdjective(word: string): boolean {
  adjectiveBloom ??= decode(ADJECTIVE_BLOOM);
  return has(adjectiveBloom, word.normalize("NFC"));
}

/** A noun form's gender ("x": masculine or neuter) and whether it may also be a plural. */
export type GermanGender = "f" | "m" | "n" | "x";
export type GermanGenderReading = { gender: GermanGender; plural: boolean };

// Nouns of two genders by meaning or region ("der/die See", "der/das Teil", "die/das Mail"),
// which one sense's counts may hide (authored).
const TWO_GENDERS = new Set(
  (
    "kunde see leiter heide kiefer mangel weise flur marsch tau mast laster erbe gehalt " +
    "steuer tor hut mark bund bauer otter junge gefallen verdienst moment golf schild band teil " +
    "single gummi joghurt liter meter virus filter radar spray blog event curry ketchup keks " +
    "bonbon dotter lasso cola mail email sakko pyjama account web laptop yoga tunnel match " +
    "pony silvester gelee biotop radio butter tram gulasch messer fuß morgen"
  ).split(" "),
);
// Compound heads whose compounds differ in gender ("der Mut", "die Armut"; "das Ende",
// "die Legende"; "der Aufwand", "die Leinwand"; "der Rat", "die Heirat").
const MIXED_HEADS = new Set("mut ende wand rat gift wort macht mal art".split(" "));
// Particles and prepositions that start verb-made nouns of their own gender ("der Einwand").
const PARTICLES = new Set(
  (
    "ab an auf aus bei da durch ein empor fort gegen her hin hinter mit nach neben ob " +
    "über um unter vor weg wider zu zurück zusammen"
  ).split(" "),
);
const SUFFIX_GENDERS: Array<[RegExp, GermanGenderReading]> = [
  // "der Sprung", "der Schwung", "der Dung": no -ung nouns made from verbs.
  [/(?<!spr|schw|^d)(?:ung|heit|keit|schaft|tion|sion|tät)$/, { gender: "f", plural: false }],
  [/ismus$/, { gender: "m", plural: false }],
];
const FEMININE = { gender: "f", plural: false } as const;
const DIMINUTIVE = { gender: "n", plural: true } as const;
const deumlaut = (stem: string) => stem.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
const isNoun = (stem: string) =>
  stem.length >= 3 && (germanNounReading(stem) !== null || germanNounReading(`${stem}e`) !== null);
let genders: Map<string, GermanGenderReading> | undefined;

function genderTable(): Map<string, GermanGenderReading> {
  if (genders) return genders;
  genders = new Map();
  const lists = GENDER_DATA as unknown as Record<string, string>;
  for (const [i, code] of [...GENDER_DATA.GENDERS].entries()) {
    const gender = code.toLowerCase() as GermanGender;
    const reading = { gender, plural: code !== gender };
    for (const word of frontDecoded(lists[`GENDER_${i}`])) genders.set(word, reading);
  }
  return genders;
}

// "Lehrer", "Fahrer", "Käufer": a person or tool named after its verb is masculine and its own
// plural; these are not (authored).
const NOT_AGENTS = new Set("messer wetter lager gewitter trauer leber".split(" "));
const AGENT = { gender: "m", plural: true } as const;
const agentNoun = (w: string) => {
  const stem = /^(\p{Ll}{3,})er$/u.exec(w)?.[1];
  if (!stem || NOT_AGENTS.has(w)) return false;
  // "Vorsitzender", "Angestellter", "Bekannter": an adjective or participle used as a noun.
  if (/end$|^\p{Ll}*ge\p{Ll}+t$|^(?:ver|be|er|ent|zer)\p{Ll}+t$/u.test(stem)) return false;
  if (germanAdjective(stem)) return false;
  return [stem, deumlaut(stem)].some((s) => germanInfinitive(`${s}en`));
};

/**
 * Whether a word can open a compound: a noun (with its linking -s, -es, -n or -en), an
 * adjective or a verb stem ("Haus|tür", "Verkehrs|schild", "Groß|stadt", "Schreib|tisch").
 */
function compoundStart(first: string): boolean {
  if (PARTICLES.has(first)) return false;
  for (const stem of new Set([first, first.replace(/(?:e?s|e?n)$/, "")])) {
    if (stem.length < 3) continue;
    if (germanNounReading(stem) !== null || germanAdjective(stem)) return true;
    if (germanInfinitive(`${stem}en`) || germanInfinitive(`${stem}n`)) return true;
  }
  return false;
}

/**
 * The gender of a noun form, from the n-gram table, its compound head ("Haustür" as "Tür"), the
 * feminine -in of a masculine noun, or a suffix that fixes it ("-ung" is left out: "der
 * Sprung"). Null when unknown or of two genders.
 */
export function germanGender(word: string): GermanGenderReading | null {
  const w = word.toLowerCase().normalize("NFC");
  if (TWO_GENDERS.has(w)) return null;
  const table = genderTable();
  const known = table.get(w);
  if (known) return known;
  for (let i = 3; i <= w.length - 3; i++) {
    const head = w.slice(i);
    const mixed = TWO_GENDERS.has(head) || MIXED_HEADS.has(head);
    const agent = !mixed && !table.has(head) && head.length >= 5 && agentNoun(head);
    if (!mixed && !agent && !table.has(head)) continue;
    // A long head after a long first part needs no check of the first part
    // ("Kostenvoran|schlag").
    if ((head.length < 5 || i < 4) && !compoundStart(w.slice(0, i))) continue;
    return mixed ? null : agent ? AGENT : table.get(head)!;
  }
  if (agentNoun(w)) return AGENT;
  // "Lehrerin", "Polizistin": the feminine of a person noun.
  if (/(?:er|ist|ent|ant|eur|or|at|oge)in$/.test(w) && isNoun(w.slice(0, -2))) return FEMININE;
  // "Häuschen", "Brötchen", "Fräulein": a diminutive ("Kuchen", "Kirchen" are not).
  // "Kirchen" is the plural of "Kirche".
  const small = /^(.+)(?:chen|lein)$/.exec(w);
  if (
    small &&
    germanNounReading(w.slice(0, -1)) === null &&
    (isNoun(small[1]) || isNoun(deumlaut(small[1])))
  ) {
    return DIMINUTIVE;
  }
  return SUFFIX_GENDERS.find(([suffix]) => suffix.test(w))?.[1] ?? null;
}
