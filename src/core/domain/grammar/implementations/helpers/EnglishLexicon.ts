import {
  FLAG_CODES,
  FLAG_SINGLE,
  FLAG_TABLE,
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
  prefixFlags: string[];
  irregular: Map<string, { lemma: string; form: EnglishVerbForm }[]>;
};

let lexicon: Lexicon | undefined;

// Decoded once, on first use. Flags are the .aff's plus the generator's lowercase pseudo-flags:
// v base verb, q doubles its final consonant (c -> ck) before -ed/-ing, w keeps its -e before
// -ing (ie -> ying), n noun, a adjective, r adverb, s a plain -s form (months), f a -ves plural
// (lives); s and f are suffix rules too. c a count noun by the n-grams.
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
  const prefixes = parse(PREFIX_RULES, false);
  return (lexicon = {
    words,
    suffixes: parse(SUFFIX_RULES, true),
    prefixes,
    prefixFlags: [...new Set(prefixes.map((rule) => rule.flag))],
    irregular,
  });
}

/**
 * Flags of a dictionary word joined with those of the words its prefix flags spell: "configure"
 * is listed (configure/B) and also con+figure, whose flags make it a verb.
 */
function entry(word: string): string | undefined {
  const { words, prefixes, prefixFlags } = load();
  let flags = words.get(word);
  for (const rule of prefixes) {
    if (!word.startsWith(rule.add)) continue;
    const base = rule.strip + word.slice(rule.add.length);
    const prefixed = rule.cond.test(base) ? words.get(base) : undefined;
    if (!prefixed?.includes(rule.flag)) continue;
    // A verb's adjective reading does not cross a prefix (fine -> refine, long -> prolong), nor
    // a noun's past one its possessive does not take (pose -> propose; see the generator).
    const drop = `${prefixed.includes("v") ? "a" : ""}${
      prefixed.includes(String(prefixFlags.indexOf(rule.flag))) ? "n" : ""
    }`;
    flags = (flags ?? "") + (drop ? prefixed.replace(new RegExp(`[${drop}]`, "g"), "") : prefixed);
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
  let info = INFO.get(w);
  if (info === undefined) {
    // Review asks about the same words from many frames: one reading per word.
    if (INFO.size >= 50_000) INFO.clear();
    info = readWordInfo(w);
    INFO.set(w, info);
  }
  return info;
}
const INFO = new Map<string, EnglishWordInfo | null>();

function readWordInfo(w: string): EnglishWordInfo | null {
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
      case "s":
        if (isVerb) verb(base, "third");
        if (flags.includes("n")) info.noun = info.plural = true;
        break;
      case "f": // lives, halves
        info.noun = info.plural = true;
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
      case "R": // nicer; walker; "later" is late's, not lat's
        if (adjective) info.adjective = true;
        else if (isVerb || !list.some((r) => r.via === "R" && r.flags.includes("a")))
          info.noun = true;
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
  return Object.freeze({ verbs: Object.freeze([...verbs.values()]), ...info });
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
 * The -s, past or -ing form of a lowercase base verb as the dictionary spells it (englishInflect
 * reads the irregular table first). null when the lexicon knows `lemma` but not as a base verb ("such", "combated");
 * undefined when it does not know the word, or knows the verb but not that form.
 */
export function englishLexiconInflect(
  lemma: string,
  form: "third" | "past" | "ing",
): string | null | undefined {
  const flags = entry(lemma);
  // Not listed but read as another word's form (combated, nicer): not a base verb either.
  if (flags === undefined) return englishWordInfo(lemma) ? null : undefined;
  if (!flags.includes("v")) return null;
  const doubled = flags.includes("q") && lemma + (lemma.endsWith("c") ? "k" : lemma.at(-1));
  if (form === "third")
    return (
      (flags.includes("s") && `${lemma}s`) ||
      (flags.includes("S") && suffix(lemma, "S")) ||
      undefined
    );
  if (form === "past")
    return (flags.includes("D") && suffix(lemma, "D")) || (doubled && `${doubled}ed`) || undefined;
  if (flags.includes("w")) return keepE(lemma);
  return (flags.includes("G") && suffix(lemma, "G")) || (doubled && `${doubled}ing`) || undefined;
}

/**
 * The singular and regular -s plural of a lowercase dictionary noun, from either form
 * ("issue" or "issues" -> issue/issues), or null. Irregular plurals and nouns the
 * dictionary lists without a plural flag are not covered.
 */
export function englishNounPair(word: string): { singular: string; plural: string } | null {
  if (!/^[a-z]+$/.test(word)) return null;
  for (const { base, flags, via } of readings(word)) {
    const flag = pluralFlag(flags);
    if (!flags.includes("n") || !flag) continue;
    if (via === flag) return { singular: base, plural: word };
    const plural = via === "" && suffix(base, flag);
    if (plural) return { singular: base, plural };
  }
  return null;
}

/**
 * True for a lowercase singular noun the bundled n-grams show mostly counted: its plural is
 * common and "much" never comes before it ("ball", "message", "guy"). Many such nouns have a
 * mass use too ("a lot of experience"): use it as evidence, not as proof.
 */
export function englishCountNoun(word: string): boolean {
  const flags = entry(word); // con+test reads as test
  return !!flags && flags.includes("c") && flags.includes("n");
}

/** The flag that spells a noun's plural: -ves (lives), a plain -s (months) or the .aff's -s. */
const pluralFlag = (flags: string) => ["f", "s", "S"].find((flag) => flags.includes(flag));

/**
 * Nouns the dictionary derives from a lowercase base verb by its -ion and -ment flags
 * ("translate" -> translation, "improve" -> improvement), dictionary-listed ones only.
 */
export function englishVerbNouns(lemma: string): string[] {
  const flags = entry(lemma);
  if (!flags?.includes("v")) return [];
  return ["N", "L"].flatMap((flag) => {
    const noun = flags.includes(flag) && suffix(lemma, flag);
    return noun && noun !== lemma ? [noun] : [];
  });
}

export const BLOOM_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BLOOM_HASHES = 7;

/** The bits a word sets in a Bloom filter of `size` bits (FNV-1a and djb2, double hashing). */
export function bloomBits(word: string, size: number, hashes = BLOOM_HASHES): number[] {
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
  for (let i = 0; i < hashes; i++) bits.push((h1 + i * h2) % size);
  return bits;
}

/** The 6-bit groups of `text`, one for each BLOOM_ALPHABET character. */
export function decodeBits(text: string): Uint8Array {
  const groups = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) groups[i] = BLOOM_ALPHABET.indexOf(text[i]);
  return groups;
}

/** True when the Bloom `filter` (from decodeBits) has every bit that `word` sets. */
export const bloomHas = (filter: Uint8Array, word: string, hashes?: number) =>
  bloomBits(word, filter.length * 6, hashes).every(
    (bit) => (filter[(bit / 6) | 0] >> (bit % 6)) & 1,
  );

// A long noun with nothing but a plural to say: "student", "meatloaf".
const plainNoun = (flags: string | undefined) =>
  !!flags && /^[Sfs]?n$/.test(flags.replace("c", ""));

/**
 * The number of a lowercase noun of six letters or more that the dictionary lists only as a
 * noun ("student", "students"), or null. Exact.
 */
export function englishListedNoun(word: string): "singular" | "plural" | null {
  const w = word.toLowerCase();
  if (w.length < 6 || !/^[a-z]+$/.test(w)) return null;
  if (plainNoun(load().words.get(w))) return "singular";
  return readings(w).some(
    (r) => r.base.length > 5 && r.via !== "" && r.via === pluralFlag(r.flags) && plainNoun(r.flags),
  )
    ? "plural"
    : null;
}

/**
 * True when the dictionary lists `noun` (a long plain noun, see englishListedNoun) with no plural
 * and the n-grams show none: "meatloaf", "punctuation".
 */
export function englishListedWithoutPlural(noun: string): boolean {
  const w = noun.toLowerCase();
  return englishListedNoun(w) === "singular" && load().words.get(w)!.replace("c", "") === "n";
}
