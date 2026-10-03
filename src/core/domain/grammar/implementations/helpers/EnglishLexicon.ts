import {
  FLAG_CODES,
  FLAG_SINGLE,
  FLAG_TABLE,
  NOUN_BLOOM,
  NOUN_PLURAL_EXCEPTIONS,
  PREFIX_RULES,
  SUFFIX_RULES,
  TOKENS,
  WORD_FLAGS,
  WORDS,
} from "./englishLexicon.generated";
import { ENGLISH_VERB_FORMS } from "./EnglishVerbForms";

/** Which form of its lemma a verb reading is. A regular -ed form is both past and participle. */
type EnglishVerbForm = "base" | "third" | "past" | "participle" | "ing";

export interface EnglishWordInfo {
  verbs: readonly { lemma: string; form: EnglishVerbForm }[];
  noun: boolean;
  plural: boolean;
  adjective: boolean;
  adverb: boolean;
}

type Rule = { flag: string; strip: string; add: string; cond: RegExp };
type Lexicon = {
  words: Map<string, string>;
  suffixes: Rule[];
  prefixes: Rule[];
  irregular: Map<string, { lemma: string; form: EnglishVerbForm }[]>;
};

let lexicon: Lexicon | undefined;

// Decoded once, on first use. Flags are the .aff's plus the generator's lowercase pseudo-flags:
// v base verb, q doubles its final consonant (c -> ck) before -ed/-ing, w keeps its -e before
// -ing (ie -> ying), n noun, a adjective, r adverb.
function load(): Lexicon {
  if (lexicon) return lexicon;
  const parse = (rules: string, suffix: boolean) =>
    rules.split(";").map((rule) => {
      const [flag, strip, add, cond] = rule.split(" ");
      return { flag, strip, add, cond: new RegExp(suffix ? `${cond}$` : `^${cond}`) };
    });
  const table = FLAG_TABLE.split(" ");
  const tokens = new Map(TOKENS.split(" ").map((token) => [token[0], token.slice(1)]));
  const codes = new Map([...FLAG_CODES].map((c, i) => [c, i]));
  const words = new Map<string, string>();
  const text = WORDS.replace(/[^a-z\d]/g, (mark) => tokens.get(mark)!);
  let word = "";
  let at = 0;
  // "<shared prefix length digit><letters>" records; a hand loop decodes ~2x faster than matchAll.
  for (let i = 0; i < text.length;) {
    const shared = text.charCodeAt(i++) - 48;
    let end = i;
    while (end < text.length && text.charCodeAt(end) > 57) end++;
    word = word.slice(0, shared) + text.slice(i, end);
    i = end;
    let code = codes.get(WORD_FLAGS[at++])!;
    if (code >= FLAG_SINGLE)
      code = FLAG_SINGLE + (code - FLAG_SINGLE) * FLAG_CODES.length + codes.get(WORD_FLAGS[at++])!;
    words.set(word, table[code]);
  }
  const irregular: Lexicon["irregular"] = new Map();
  for (const { lemma, third, past, participle } of ENGLISH_VERB_FORMS)
    for (const [form, kind] of [
      [lemma, "base"],
      [third, "third"],
      [past, "past"],
      [participle, "participle"],
    ] as const)
      (irregular.get(form) ?? irregular.set(form, []).get(form)!).push({ lemma, form: kind });
  return (lexicon = {
    words,
    suffixes: parse(SUFFIX_RULES, true),
    prefixes: parse(PREFIX_RULES, false),
    irregular,
  });
}

/**
 * Flags of a dictionary word joined with those of the words its prefix flags spell: "configure"
 * is listed (configure/B) and also con+figure, whose flags make it a verb.
 */
function entry(word: string): string | undefined {
  const { words, prefixes } = load();
  let flags = words.get(word);
  for (const rule of prefixes) {
    if (!word.startsWith(rule.add)) continue;
    const base = rule.strip + word.slice(rule.add.length);
    const prefixed = rule.cond.test(base) ? words.get(base) : undefined;
    if (prefixed?.includes(rule.flag)) flags = (flags ?? "") + prefixed;
  }
  return flags;
}

const keepE = (lemma: string) =>
  lemma.endsWith("ie") ? `${lemma.slice(0, -2)}ying` : `${lemma}ing`;

type Reading = { base: string; flags: string; via: string; add?: string };

// ponytail: prefix + suffix ignores the .aff's cross-product field (T, V, H are N), so a few
// unlisted words like "unhappiest" read as known.
function readings(word: string): Reading[] {
  const out: Reading[] = [];
  const own = entry(word);
  if (own !== undefined) out.push({ base: word, flags: own, via: "" });
  for (const rule of load().suffixes) {
    if (!word.endsWith(rule.add)) continue;
    const base = word.slice(0, word.length - rule.add.length) + rule.strip;
    const flags = base && rule.cond.test(base) ? entry(base) : undefined;
    if (flags?.includes(rule.flag)) out.push({ base, flags, via: rule.flag, add: rule.add });
  }
  // stopped, panicking; agreeing, dying
  const doubled = /^([a-z]*([b-df-hj-np-tv-z]))(?:\2|(?<=c)k)(ed|ing)$/.exec(word);
  const flags = doubled && entry(doubled[1]);
  // An irregular lemma doubles only before -ing: running, not "runned".
  const irregular = doubled?.[3] === "ed" && load().irregular.has(doubled[1]);
  if (flags?.includes("q") && !irregular)
    out.push({ base: doubled![1], flags, via: doubled![3] === "ed" ? "D" : "G" });
  for (const base of [word.slice(0, -3), `${word.slice(0, -4)}ie`]) {
    const kept = keepE(base) === word && entry(base);
    if (kept && kept.includes("w")) out.push({ base, flags: kept, via: "G" });
  }
  return out;
}

/**
 * What the en_US dictionary says a word can be, read through its affix flags and the irregular
 * verb table, or null when the lexicon does not know it. Lowercased first. Proper nouns and
 * nouns longer than five letters with nothing but a plural (family, problem) are left out, so
 * null means unknown, not misspelled. Pure and synchronous.
 */
export function englishWordInfo(word: string): EnglishWordInfo | null {
  const w = word.toLowerCase();
  if (!/^[a-z]+$/.test(w)) return null;
  const list = readings(w);
  const irregular = load().irregular.get(w) ?? [];
  if (!list.length && !irregular.length) return null;
  const verbs = new Map<string, { lemma: string; form: EnglishVerbForm }>();
  const verb = (lemma: string, form: EnglishVerbForm) =>
    verbs.set(`${lemma} ${form}`, { lemma, form });
  const info = { noun: false, plural: false, adjective: false, adverb: false };
  for (const { base, flags, via, add } of list) {
    const isVerb = flags.includes("v");
    const adjective = flags.includes("a");
    switch (via) {
      case "":
        if (isVerb) verb(base, "base");
        info.noun ||= flags.includes("n");
        info.adjective ||= adjective;
        info.adverb ||= flags.includes("r");
        break;
      case "S":
        if (isVerb) verb(base, "third");
        if (flags.includes("n")) info.noun = info.plural = true;
        break;
      case "D": // the table owns an irregular verb's past: not "singed" for sing, "lighted"
        if (!isVerb)
          info.adjective = true; // fanged, bearded
        else if (!load().irregular.has(base)) {
          verb(base, "past");
          verb(base, "participle");
        }
        break;
      case "G":
        if (isVerb) verb(base, "ing");
        break;
      case "Y": // quickly; friendly, monthly are adjectives too
        info.adverb = true;
        info.adjective ||= !adjective;
        break;
      case "R": // nicer; walker
        if (adjective) info.adjective = true;
        else info.noun = true;
        break;
      case "T":
      case "V":
      case "B":
        info.adjective = true;
        break;
      case "P":
      case "L":
        info.noun = true;
        break;
      case "N": // deletion, not harden
        info.noun ||= add !== "en";
        break;
      case "Z":
      case "J":
      case "X":
        info.noun ||= add !== "ens";
        info.plural ||= add !== "ens";
        break;
    }
  }
  for (const reading of irregular) verb(reading.lemma, reading.form);
  return { verbs: [...verbs.values()], ...info };
}

/** True when the lexicon knows `word` as one of the verb `forms`. */
export function hasVerbForm(word: string, ...forms: EnglishVerbForm[]): boolean {
  return !!englishWordInfo(word)?.verbs.some((v) => forms.includes(v.form));
}

function suffix(lemma: string, flag: string): string | false {
  const rule = load().suffixes.find(
    (r) => r.flag === flag && r.cond.test(lemma) && lemma.endsWith(r.strip),
  );
  return !!rule && lemma.slice(0, lemma.length - rule.strip.length) + rule.add;
}

/**
 * The -s, past or -ing form of a lowercase base verb as the dictionary spells it, irregular
 * table first. null when the lexicon knows `lemma` but not as a base verb ("such", "combated");
 * undefined when it does not know the word, or knows the verb but not that form.
 */
export function englishLexiconInflect(
  lemma: string,
  form: "third" | "past" | "ing",
): string | null | undefined {
  const irregular = ENGLISH_VERB_FORMS.find((row) => row.lemma === lemma);
  if (irregular && form !== "ing") return irregular[form];
  const flags = entry(lemma);
  // Not listed but read as another word's form (combated, nicer): not a base verb either.
  if (flags === undefined) return englishWordInfo(lemma) ? null : undefined;
  if (!flags.includes("v")) return null;
  const doubled = flags.includes("q") && lemma + (lemma.endsWith("c") ? "k" : lemma.at(-1));
  if (form === "third") return (flags.includes("S") && suffix(lemma, "S")) || undefined;
  if (form === "past")
    return (flags.includes("D") && suffix(lemma, "D")) || (doubled && `${doubled}ed`) || undefined;
  if (flags.includes("w")) return keepE(lemma);
  return (flags.includes("G") && suffix(lemma, "G")) || (doubled && `${doubled}ing`) || undefined;
}

export const BLOOM_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BLOOM_HASHES = 7;

/** The bits a word sets in a Bloom filter of `size` bits (FNV-1a and djb2, double hashing). */
export function bloomBits(word: string, size: number): number[] {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b, 33) ^ c;
  }
  const h1 = a >>> 0;
  const h2 = (b | 1) >>> 0;
  const bits: number[] = [];
  for (let i = 0; i < BLOOM_HASHES; i++) bits.push((h1 + i * h2) % size);
  return bits;
}

let bloom: Uint8Array | undefined;
let pluralExceptions: Set<string> | undefined;
function inBloom(word: string): boolean {
  if (!bloom) {
    bloom = new Uint8Array(NOUN_BLOOM.length);
    for (let i = 0; i < NOUN_BLOOM.length; i++) bloom[i] = BLOOM_ALPHABET.indexOf(NOUN_BLOOM[i]);
  }
  const filter = bloom;
  return bloomBits(word, filter.length * 6).every(
    (bit) => (filter[(bit / 6) | 0] >> (bit % 6)) & 1,
  );
}

/**
 * The number of a lowercase word the lexicon leaves out because the dictionary lists it only
 * as a long plain noun ("student", "students"), or null. A Bloom filter answers, so about 1%
 * of other words read as such a noun too: use it to tell words from typos, never to correct.
 */
export function englishListedNoun(word: string): "singular" | "plural" | null {
  const w = word.toLowerCase();
  if (w.length < 6 || !/^[a-z]+$/.test(w)) return null;
  if (inBloom(w)) return "singular";
  const stems = [w.slice(0, -1)];
  if (w.endsWith("es")) stems.push(w.slice(0, -2));
  if (w.endsWith("ies")) stems.push(`${w.slice(0, -3)}y`);
  return w.endsWith("s") && stems.some((stem) => stem.length > 5 && inBloom(stem))
    ? "plural"
    : null;
}

/**
 * True when the dictionary lists `noun` (a left-out noun, see englishListedNoun) without an -s
 * plural: "meatloaf" (meatloaves), "punctuation". Exact for listed nouns.
 */
export function englishListedWithoutPlural(noun: string): boolean {
  const w = noun.toLowerCase();
  pluralExceptions ??= new Set(NOUN_PLURAL_EXCEPTIONS.split(" "));
  return englishListedNoun(w) === "singular" && inBloom(`!${w}`) && !pluralExceptions.has(w);
}
