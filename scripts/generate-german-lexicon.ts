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
  gender: resolve(root, "src/core/domain/grammar/review/german/germanGender.generated.ts"),
  usage: resolve(root, "src/core/domain/grammar/review/german/germanUsage.generated.ts"),
  trie: resolve(root, "resources_js/de_DE/ngrams_db/ngrams.trie"),
  counts: resolve(root, "resources_js/de_DE/ngrams_db/ngrams.counts"),
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
  // Forms read as some other word by an entry that is no adjective ("zeit", "paar", "mit").
  const plainOther = new Set<string>();
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
      if (reading === "other" && !flags.includes("A")) plainOther.add(form);
      for (const rule of wordPrefixes)
        if (flags.includes(rule.flag)) read(rule.add + form, reading);
    }
  }
  const nounOnly: string[] = [];
  const finite: string[] = [];
  const infinitive: string[] = [];
  const ambiguous: string[] = [];
  for (const noun of [...nouns].sort()) {
    const readings = lower.get(noun);
    if (!readings) nounOnly.push(noun);
    else if (readings.has("other")) ambiguous.push(noun);
    else if (readings.has("infinitive")) infinitive.push(noun);
    else finite.push(noun);
  }
  const verbs = [...lower].filter(([, readings]) => readings.has("infinitive")).map(([w]) => w);
  return {
    nounOnly,
    finite,
    infinitive,
    ambiguous,
    // Noun forms whose other readings are adjective or verb forms ("alter", "spitze").
    adjectiveNouns: ambiguous.filter((w) => !plainOther.has(w)),
    // Noun forms that are also an adverb, preposition, numeral or other uninflected word
    // ("angst", "ehe", "kraft", "morgen").
    otherNouns: ambiguous.filter((w) => plainOther.has(w)),
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

// Determiners whose form shows one gender of a singular noun, or rules one out. "der", "die"
// and "den" also serve other cases and the plural, so "den" only counts before a noun that no
// dative plural spells and "die" only marks a form that may be plural.
const FEMININE_DETERMINERS = ["eine", "einer", "jede"];
const MASCULINE_DETERMINERS = ["einen", "jeden"];
const NEUTER_DETERMINERS = ["das", "dieses", "jedes"];
const NOT_FEMININE_DETERMINERS = [
  "ein",
  "einem",
  "eines",
  "dem",
  "des",
  "kein",
  "keinem",
  "keines",
];
// Masculine and neuter nouns in these endings are often their own plural ("der Lehrer",
// "die Lehrer"; "das Gebirge", "die Gebirge"), and a noun + s may be an -s plural
// ("des Autos", "die Autos").
const OWN_PLURAL = /(?:e|er|el|en|chen|lein)$/;
const CLEAR_MAJORITY = 20;

/**
 * "det word count" lines for every determiner + word bigram of the n-gram database the extension
 * ships (resources_js/de_DE/ngrams_db, lowercased), read with the marisa-trie Python package the
 * n-gram scripts already use (scripts/requirements.txt). Null when Python or the package is missing.
 */
export function readGermanDeterminerBigrams(): string | null {
  const program = [
    "import sys, marisa_trie, numpy",
    "t = marisa_trie.Trie(); t.load(sys.argv[1])",
    "c = numpy.fromfile(sys.argv[2], dtype=numpy.int32)",
    "d = set(sys.argv[3].split())",
    "rows = sorted(f'{k[2:]} {c[i + 1]}' for k, i in t.items('2 ') if k.split()[1] in d)",
    "print('\\n'.join(rows))",
  ].join("\n");
  const determiners = [
    ...FEMININE_DETERMINERS,
    ...MASCULINE_DETERMINERS,
    ...NEUTER_DETERMINERS,
    ...NOT_FEMININE_DETERMINERS,
    "den",
    "die",
  ];
  try {
    const run = Bun.spawnSync([
      "python3",
      "-c",
      program,
      GERMAN_LEXICON_SOURCES.trie,
      GERMAN_LEXICON_SOURCES.counts,
      determiners.join(" "),
    ]);
    return run.exitCode === 0 ? run.stdout.toString() : null;
  } catch {
    return null;
  }
}

const NUMBER_WORDS =
  /^(?:null|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)(?:er|ern)?$|(?:zig|ßig)(?:er|ern)$/;

/**
 * Noun genders the n-gram counts show, for lowercase forms that are only nouns. A form is
 * feminine when only feminine determiners precede it, masculine or neuter when only that
 * gender's and the shared ones do, "x" (masculine or neuter) when only the shared ones do; a
 * form seen with determiners of two genders is left out. Upper case marks a masculine or neuter
 * form that may also be a plural ("die Lehrer"): its ending allows it or "die" precedes it.
 */
export function buildGermanGender(dic: string, aff: string, bigrams: string): string {
  // Any infinitive is also a neuter noun ("das Wagen"): those forms are left out.
  // Noun forms that are also an uninflected word count too ("freund", "weg"), but not the ones
  // that are also adjective forms ("alter", "wert", which would name the gender of "Schalter"
  // and "Schwert" as compound heads) or numbers ("die Vier", "ein vierter").
  const { nounOnly, finite, verbs } = deriveGermanLexicon(dic, aff);
  const verbForms = new Set(finite);
  const nouns = new Set([
    ...nounOnly,
    ...finite,
    ...deriveNounsAfterArticles(dic, aff).filter((w) => !NUMBER_WORDS.test(w)),
  ]);
  const counts = new Map<string, Map<string, number>>();
  for (const line of bigrams.split("\n")) {
    const [det, word, count] = line.split(" ");
    if (!nouns.has(word)) continue;
    let row = counts.get(word);
    if (!row) counts.set(word, (row = new Map()));
    row.set(det, Number(count));
  }
  const lists: Record<string, string[]> = { f: [], m: [], M: [], n: [], N: [], x: [], X: [] };
  for (const [word, row] of counts) {
    const sum = (dets: string[]) => dets.reduce((total, det) => total + (row.get(det) ?? 0), 0);
    // "jeden Tages", "dieses Jahres": a genitive, not the accusative or the neuter.
    const genitive = word.endsWith("s");
    const feminine = sum(FEMININE_DETERMINERS);
    const masculine =
      sum(genitive ? ["einen"] : MASCULINE_DETERMINERS) +
      (/(?:en|rn|ln|s)$/.test(word) ? 0 : sum(["den"]));
    // "das macht", "das würde": the pronoun before a verb form spelled like a noun.
    const verbForm = verbForms.has(word);
    const neuter =
      sum(genitive ? ["das"] : NEUTER_DETERMINERS) - (verbForm ? (row.get("das") ?? 0) : 0);
    const notFeminine = sum(NOT_FEMININE_DETERMINERS);
    // One gender's evidence must outweigh the others' twentyfold: "auf der einen Seite" puts
    // an adjective "einen" before a feminine noun now and then.
    const clear = (own: number, others: number) => own > 0 && own >= others * CLEAR_MAJORITY;
    let gender: string;
    if (clear(feminine, masculine + neuter + notFeminine)) gender = "f";
    else if (clear(masculine, feminine + neuter)) gender = "m";
    else if (clear(neuter, feminine + masculine)) gender = "n";
    else if (clear(notFeminine, feminine) && !masculine && !neuter) gender = "x";
    else continue;
    const sPlural = word.endsWith("s") && nouns.has(word.slice(0, -1));
    const plural = gender !== "f" && (OWN_PLURAL.test(word) || sPlural || row.has("die"));
    lists[plural ? gender.toUpperCase() : gender].push(word);
  }
  // "der Kinder": the genitive plural of a neuter noun in -er, not a masculine; "Spieler"
  // (spielen) and "Eigentümer" name a person.
  const neuter = new Set([...lists.n, ...lists.N]);
  const infinitives = new Set(verbs);
  for (const key of Object.keys(lists)) {
    lists[key] = lists[key].filter((word) => {
      const stem = /^(\p{Ll}{3,})er$/u.exec(word)?.[1];
      if (!stem || /tüm$/.test(stem)) return true;
      const plain = stem.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
      const stems = [stem, plain];
      return !stems.some((s) => neuter.has(s)) || stems.some((s) => infinitives.has(`${s}en`));
    });
  }
  const line = (name: string, value: string) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-german-lexicon.ts from de_DE.dic/.aff and the de_DE",
    "// n-gram database. Do not edit.",
    '// Noun forms by the gender their determiners show, front-coded: "x" is masculine or neuter;',
    "// upper case, the form may also be a plural.",
    line("GENDERS", Object.keys(lists).join("")),
    ...Object.values(lists).map((words, i) => line(`GENDER_${i}`, frontCode(words.sort()))),
    "",
  ].join("\n");
}

/**
 * Every bigram and trigram of the n-gram database as "w1 w2 [w3] count" lines (lowercased),
 * read as readGermanDeterminerBigrams does. Null when Python or the package is missing.
 */
export function readGermanNgrams(): string | null {
  const program = [
    "import sys, marisa_trie, numpy",
    "t = marisa_trie.Trie(); t.load(sys.argv[1])",
    "c = numpy.fromfile(sys.argv[2], dtype=numpy.int32)",
    "rows = sorted(f'{k[2:]} {c[i + 1]}' for p in ('2 ', '3 ') for k, i in t.items(p))",
    "print('\\n'.join(rows))",
  ].join("\n");
  try {
    const run = Bun.spawnSync(
      ["python3", "-c", program, GERMAN_LEXICON_SOURCES.trie, GERMAN_LEXICON_SOURCES.counts],
      { stdout: "pipe" },
    );
    return run.exitCode === 0 ? run.stdout.toString() : null;
  } catch {
    return null;
  }
}

// Determiners that never stand alone as a pronoun, so the word after them heads or opens a noun
// phrase; "der", "die", "das", "dem", "den" and dies-words also are pronouns ("die gut passen").
const EIN_STEMS = ["ein", "kein", "mein", "dein", "sein", "ihr", "unser", "eur"];
const NOUN_DETERMINERS = [
  "des",
  "im",
  "am",
  "zum",
  "zur",
  "vom",
  "beim",
  "ins",
  ...EIN_STEMS.flatMap((stem) => ["e", "en", "em", "er", "es"].map((end) => stem + end)),
  "ein",
  "kein",
  "mein",
  "dein",
  "unser",
  "euer",
];
const DETERMINER_STEMS =
  /^(?:ein|kein|mein|dein|sein|ihr|unser|eu|dies|jen|jed|welch|manch|solch|all|d)$/;
const PRONOUN_DETERMINERS = ["der", "die", "das", "den", "dem", "diese", "dieser", "dieses"];
/** Whether an adjective with this ending may follow the determiner (weak or mixed ending). */
function endingFits(det: string, ending: string): boolean {
  const bare = /^(?:ein|kein|mein|dein|sein|ihr|unser|euer)$/.test(det);
  if (ending === "er" || ending === "es") return bare;
  if (ending === "en") return det !== "ins" && det !== "das" && !bare;
  if (ending === "e") return /^(?:d(?:er|ie|as)|dies(?:e|er|es)|\p{Ll}+e)$/u.test(det) && !bare;
  return false;
}
// Words after a noun that no attributive adjective is followed by: a genitive or a new phrase,
// a preposition, a conjunction, a finite verb.
const AFTER_NOUN = new Set(
  (
    "der des die das dem den ein eine einer eines von vom auf für mit im in an am bei zu zur " +
    "zum über unter vor nach aus gegen und oder ist sind war waren wird werden hat haben hatte " +
    "kann können muss soll gilt geht steht liegt bleibt"
  ).split(" "),
);
// "die gut passen", "die hinter der Tür": after a pronoun the word may be an adverb or a
// preposition, so only a genitive after it counts.
const AFTER_PRONOUN = new Set("des eines meines seines ihres unseres dieses".split(" "));
// Noun-phrase evidence must outweigh the adjective or adverb uses threefold, over at least
// this many counted n-grams (the database drops n-grams seen fewer than about 60 times).
const NOUN_MAJORITY = 3;
const MIN_EVIDENCE = 60;
// A form in -e seen only after feminine or plural determiners, this often, is a feminine or
// plural noun ("die Spitze", "der Wüste"): an adjective in -e also follows "das".
const FEMININE_EVIDENCE = 150;

/**
 * Lowercase noun forms whose only other reading is an adjective form ("alter", "spitze", "wert")
 * and that the n-gram counts show as nouns after a determiner far more often than as adjectives
 * or adverbs: a determiner whose adjective ending the form cannot have ("im alter", "ein wertes"),
 * an article or preposition after "determiner + form" ("den wert des"), only feminine or plural
 * determiners before a form in -e. Adjective evidence: an adjective after the form ("gut
 * gemachte", an adverb) or a noun after "determiner + form" ("eine kleine stadt").
 */
export function deriveNounsOverAdjectives(dic: string, aff: string, ngrams: string) {
  const { adjectiveNouns, nounOnly, finite, adjectives } = deriveGermanLexicon(dic, aff);
  const candidates = new Set(adjectiveNouns);
  const nouns = new Set([...nounOnly, ...finite]);
  const lemmas = new Set(adjectives);
  // Determiners inflect like adjectives ("dieser", "ihres") and are listed as such.
  const adjectiveForm = (w: string) => {
    const m = /^(\p{Ll}+?)(?:e|en|er|es|em)$/u.exec(w);
    if (!m || DETERMINER_STEMS.test(m[1])) return false;
    return lemmas.has(m[1]) || lemmas.has(`${m[1]}e`) || /^ge\p{Ll}+t$/u.test(m[1]);
  };
  const nounDets = new Set(NOUN_DETERMINERS);
  const pronounDets = new Set(PRONOUN_DETERMINERS);
  const noun = new Map<string, number>();
  const adjective = new Map<string, number>();
  const det = new Map<string, Map<string, number>>();
  const add = (map: Map<string, number>, word: string, count: number) =>
    map.set(word, (map.get(word) ?? 0) + count);
  for (const line of ngrams.split("\n")) {
    const parts = line.split(" ");
    const count = Number(parts.pop());
    if (parts.length === 2) {
      const [a, b] = parts;
      if (candidates.has(a) && adjectiveForm(b)) add(adjective, a, count);
      if (candidates.has(b) && (nounDets.has(a) || pronounDets.has(a))) {
        let row = det.get(b);
        if (!row) det.set(b, (row = new Map()));
        row.set(a, count);
      }
    } else if (parts.length === 3) {
      const [a, b, c] = parts;
      if (!candidates.has(b) || !(nounDets.has(a) || pronounDets.has(a))) continue;
      if (nouns.has(c) || adjectiveForm(c)) add(adjective, b, count);
      else if ((nounDets.has(a) ? AFTER_NOUN : AFTER_PRONOUN).has(c)) add(noun, b, count);
    }
  }
  for (const [word, row] of det) {
    const ending = /(?:en|em|er|es|e)$/.exec(word)?.[0] ?? "";
    // An uninflected form after any determiner may be an adverb ("ein gut gemachter").
    if (!ending) continue;
    for (const [d, count] of row)
      if (nounDets.has(d) && !endingFits(d, ending)) add(noun, word, count);
    if (ending !== "e") continue;
    const neuter = ["das", "dieses", "ein", "kein"].some((d) => row.has(d));
    const feminine = neuter ? 0 : [...row.values()].reduce((sum, count) => sum + count, 0);
    if (feminine >= FEMININE_EVIDENCE) add(noun, word, feminine);
  }
  return [...candidates]
    .filter((w) => {
      const n = noun.get(w) ?? 0;
      return n >= MIN_EVIDENCE && n >= NOUN_MAJORITY * (adjective.get(w) ?? 0);
    })
    .sort();
}

// Verbs whose one object is a dative ("helfen", "danken") or an accusative ("fragen",
// "besuchen"), with no second object that would let the other case in ("ich gebe dem Mann den
// Ball"); verbs that also take a free dative ("ich kaufe dem Kind ein Eis") are left out.
// Each line: the infinitive, then any strong forms; the weak endings are spelled from the
// stem, and only forms the dictionary knows are kept (authored).
const DATIVE_VERBS = [
  "helfen hilf hilfst hilft half halfst halfen halft",
  "gefallen gefällst gefällt gefiel gefielst gefielen gefielt",
  "widersprechen widersprich widersprichst widerspricht widersprach widersprachen",
  "danken",
  "antworten",
  "gehorchen",
  "vertrauen",
  "misstrauen",
  "gratulieren",
  "begegnen",
  "schaden",
  "nützen",
  "ähneln",
  "drohen",
  "folgen",
  "applaudieren",
  "schmeicheln",
  "kondolieren",
  "gehören",
];
const ACCUSATIVE_VERBS = [
  "kennen kannte kanntest kannten kanntet",
  "treffen triff triffst trifft traf trafst trafen",
  "fragen",
  "besuchen",
  "lieben",
  "hassen",
  "verwünschen",
  "beantworten",
  "vermissen",
  "begleiten",
  "beobachten",
  "unterstützen",
  "kritisieren",
  "loben",
  "beleidigen",
  "verletzen",
  "heiraten",
  "küssen",
  "umarmen",
  "bewundern",
  "respektieren",
  "enttäuschen",
  "ignorieren",
  "verteidigen",
  "betreuen",
  "informieren",
  "verklagen",
  "anlügen",
];
const DATIVE_OBJECTS = ["ihm", "mir", "dir", "einem", "dem"];
const ACCUSATIVE_OBJECTS = ["ihn", "mich", "dich", "einen"];

/** The finite forms of a verb line that the dictionary spells. */
function verbForms(line: string, words: Set<string>): string[] {
  const [infinitive, ...strong] = line.split(" ");
  const stem = /[lr]n$/.test(infinitive) ? infinitive.slice(0, -1) : infinitive.slice(0, -2);
  const short = stem.replace(/e([lr])$/, "$1");
  const endings = ["e", "st", "est", "t", "et", "te", "test", "ten", "tet", "ete", "eten"];
  const forms = [infinitive, ...strong, `${short}e`, ...endings.map((end) => stem + end)];
  return [...new Set(forms)].filter((form) => words.has(form));
}

/**
 * The verb forms of each case table, each verb kept only when the bigram counts do not show it
 * more often before the other case's pronouns ("hilft dir", not "hilft dich").
 */
export function deriveGovernedVerbs(dic: string, aff: string, ngrams: string) {
  const words = new Set(deriveGermanLexicon(dic, aff).lowercaseWords);
  const counts = new Map<string, number>();
  for (const line of ngrams.split("\n")) {
    const parts = line.split(" ");
    if (parts.length === 3) counts.set(`${parts[0]} ${parts[1]}`, Number(parts[2]));
  }
  const evidence = (forms: string[], objects: string[]) =>
    forms.reduce(
      (sum, form) => sum + objects.reduce((s, o) => s + (counts.get(`${form} ${o}`) ?? 0), 0),
      0,
    );
  const table = (lines: string[], own: string[], other: string[]) =>
    lines
      .map((line) => verbForms(line, words))
      .filter((forms) => evidence(forms, other) <= evidence(forms, own))
      .flat()
      .sort();
  return {
    dative: table(DATIVE_VERBS, DATIVE_OBJECTS, ACCUSATIVE_OBJECTS),
    accusative: table(ACCUSATIVE_VERBS, ACCUSATIVE_OBJECTS, DATIVE_OBJECTS),
  };
}

// Uninflected words that also follow an article inside a longer phrase or as a pronoun ("ein
// über Jahre gewachsenes", "ein paar", "ein mehr oder weniger", "ein extra für ihn"): their noun
// forms are left to other checks (authored).
const NOT_NOUNS_AFTER_ARTICLES = new Set(
  (
    "abseits abwärts alias allein angesichts anfangs anti au aufwärts auseinander außen auswärts " +
    "bei binnen blanko brutto eingangs einwärts extra falls flugs gegen gen hoch hüben innen längs " +
    "links mal mangels mehr mit mittels namens neben netto nicht online paar piano quer rechts " +
    "rings samt schon selbst sofort sonder super teils trotz türkis vor vorab wegen wett wieder " +
    "zusammen zwecks zwischen über allzweck"
  ).split(" "),
);

/**
 * Noun forms that are also an uninflected word ("angst", "ehe", "kraft", "morgen") and read as
 * the noun after an article that is no pronoun ("keine angst", "seine ehe", "am morgen").
 */
export function deriveNounsAfterArticles(dic: string, aff: string): string[] {
  return deriveGermanLexicon(dic, aff).otherNouns.filter((w) => !NOT_NOUNS_AFTER_ARTICLES.has(w));
}

// The n-gram counts a word must show after determiners, and the share of its counts that is,
// to be read as a noun the dictionary lacks.
const NGRAM_NOUN_EVIDENCE = 100;
const NGRAM_NOUN_SHARE = 0.5;
// Endings of adjective and participle forms, which follow a determiner too ("die
// umweltfreundlichste", "die eingereichten").
const ADJECTIVE_LIKE = /(?:lich|ig|isch|bar|sam|haft|los|voll|end|t|st)(?:e|en|er|es|em)?$/;

/**
 * Lowercase words the dictionary lists in no form (it builds compounds such as "vorstellung",
 * "kühlschrank" from parts) that the n-gram counts show mostly right after a determiner
 * ("die vorstellung", "im kühlschrank"): nouns.
 */
export function deriveNgramNouns(dic: string, aff: string, ngrams: string): string[] {
  const { lowercaseWords, nounOnly, finite, infinitive, ambiguous } = deriveGermanLexicon(dic, aff);
  const known = new Set([...lowercaseWords, ...nounOnly, ...finite, ...infinitive, ...ambiguous]);
  const determiners = new Set([...NOUN_DETERMINERS, ...PRONOUN_DETERMINERS, "dieser", "diesen"]);
  const afterDeterminer = new Map<string, number>();
  const total = new Map<string, number>();
  for (const line of ngrams.split("\n")) {
    const parts = line.split(" ");
    if (parts.length !== 3) continue;
    const [a, b, count] = parts;
    if (known.has(b) || b.length < 4 || !/^[a-zäöüß]+$/.test(b) || ADJECTIVE_LIKE.test(b)) {
      continue;
    }
    total.set(b, (total.get(b) ?? 0) + Number(count));
    if (determiners.has(a)) afterDeterminer.set(b, (afterDeterminer.get(b) ?? 0) + Number(count));
  }
  return [...afterDeterminer]
    .filter(([w, n]) => n >= NGRAM_NOUN_EVIDENCE && n >= NGRAM_NOUN_SHARE * total.get(w)!)
    .map(([w]) => w)
    .sort();
}

export function buildGermanUsage(dic: string, aff: string, ngrams: string): string {
  const { dative, accusative } = deriveGovernedVerbs(dic, aff, ngrams);
  const overAdjectives = new Set(deriveNounsOverAdjectives(dic, aff, ngrams));
  const adjectiveNouns = deriveGermanLexicon(dic, aff).adjectiveNouns.filter(
    (w) => !overAdjectives.has(w),
  );
  const line = (name: string, value: string) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-german-lexicon.ts from de_DE.dic/.aff and the de_DE",
    "// n-gram database. Do not edit.",
    "// Front-coded: noun forms that are also adjective or uninflected forms but read as nouns",
    "// after a determiner; finite forms of verbs whose object is a dative, then an accusative.",
    line(
      "NOUNS_OVER_ADJECTIVES",
      frontCode(
        [
          ...deriveNounsOverAdjectives(dic, aff, ngrams),
          ...deriveNounsAfterArticles(dic, aff),
        ].sort(),
      ),
    ),
    "// The other noun forms that are also adjective forms (wunder, defekt).",
    line("ADJECTIVE_NOUNS", frontCode(adjectiveNouns)),
    "// Nouns the dictionary lacks, as the n-gram counts show them after determiners.",
    line("NGRAM_NOUNS", frontCode(deriveNgramNouns(dic, aff, ngrams))),
    line("DATIVE_VERBS", frontCode(dative)),
    line("ACCUSATIVE_VERBS", frontCode(accusative)),
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
  const bigrams = readGermanDeterminerBigrams();
  if (bigrams === null) throw new Error("python3 with marisa-trie and numpy is required");
  const gender = buildGermanGender(dic, aff, bigrams);
  await writeFile(GERMAN_LEXICON_SOURCES.gender, gender);
  console.log(`wrote ${GERMAN_LEXICON_SOURCES.gender} (${gender.length} bytes)`);
  const ngrams = readGermanNgrams();
  if (ngrams === null) throw new Error("python3 with marisa-trie and numpy is required");
  const usage = buildGermanUsage(dic, aff, ngrams);
  await writeFile(GERMAN_LEXICON_SOURCES.usage, usage);
  console.log(`wrote ${GERMAN_LEXICON_SOURCES.usage} (${usage.length} bytes)`);
}
