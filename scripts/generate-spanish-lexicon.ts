// Derives the small Spanish word-class lexicon behind Review's Spanish checks from the Hunspell
// dictionary the extension ships (es_ES.dic/.aff), with the nouns it folds into a verb's forms
// ("deporte", "descarga") read back from the bundled Presage n-gram counts (ngrams.trie/.counts).
// Writes src/core/domain/grammar/review/spanish/spanishLexicon.generated.ts.
// Usage: bun run generate:spanish-lexicon
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BLOOM_ALPHABET,
  bloomBits,
} from "../src/core/domain/grammar/implementations/helpers/EnglishLexicon";
import {
  NOUN_ENDING,
  SPANISH_BLOOM_HASHES,
} from "../src/core/domain/grammar/review/spanish/lexicon";
import { encodeWords } from "../src/core/domain/grammar/review/swedish/lexicon";
import { readMarisa } from "./generate-polish-lexicon";

const root = resolve(import.meta.dir, "..");
export const SPANISH_LEXICON_SOURCES = {
  dic: resolve(root, "resources_js/es_ES/hunspell/es_ES.dic"),
  aff: resolve(root, "resources_js/es_ES/hunspell/es_ES.aff"),
  trie: resolve(root, "resources_js/es_ES/ngrams_db/ngrams.trie"),
  counts: resolve(root, "resources_js/es_ES/ngrams_db/ngrams.counts"),
  out: resolve(root, "src/core/domain/grammar/review/spanish/spanishLexicon.generated.ts"),
};

// The .aff's conjugation flags (R/E -ar and regular, I/X irregular groups), the gender flag G
// (an adjective or a noun with -o/-a forms) and the plural flag S.
const VERB_FLAGS = /[REIX]/;
// Prefix flags whose words are often another kind than their base (a-, micro-).
const UNSAFE_PREFIXES = new Set(["a", "m"]);
// 16 bits per key and 11 hashes keep the filter's false positives near 0.05%.
const BLOOM_BITS_PER_KEY = 16;

type Rule = { flag: string; strip: string; add: string; cond: RegExp };

/** The .aff's suffix (SFX) or prefix (PFX) rules. */
function parseAffixes(aff: string, kind: "SFX" | "PFX"): Rule[] {
  const rules: Rule[] = [];
  for (const line of aff.split("\n")) {
    const [type, flag, strip, add, cond] = line.trim().split(/\s+/);
    if (type !== kind || cond === undefined) continue;
    const pattern = cond === "." ? "" : cond;
    rules.push({
      flag,
      strip: strip === "0" ? "" : strip,
      add: (add === "0" ? "" : add).split("/")[0],
      cond: new RegExp(kind === "SFX" ? `${pattern}$` : `^${pattern}`),
    });
  }
  return rules;
}

const ACCENTS: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };
const plain = (word: string) => word.replace(/[áéíóú]/g, (c) => ACCENTS[c]);

/* ------------------------------------------------------------ n-gram counts */

// What comes before a noun and never before a finite verb: determiners and prepositions ("la"
// and "los" are clitics too, "esta" may be an unaccented "está"), and what comes before a verb.
const NOMINAL_CUE = new Set(
  (
    "de en con sin por sobre desde hasta contra hacia según tras el un una del al este ese " +
    "aquel su sus mi mis tus nuestro nuestra nuestros nuestras unos unas estos esos esas cada " +
    "otro otra otros otras primer primera nuevo nueva gran buen buena mucho mucha muchos muchas"
  ).split(" "),
);
const VERBAL_CUE = new Set(
  "que se no lo le les me te nos él ella ellos ellas también ya quien yo tú usted".split(" "),
);

type Counts = {
  words: Map<string, number>;
  nominal: Map<string, number>;
  verbal: Map<string, number>;
};

/** Unigram counts, and how often a word follows a nominal or a verbal cue. */
export function ngramCounts(trie: ArrayBuffer, counts: ArrayBuffer): Counts {
  const values = new Int32Array(counts);
  const out: Counts = { words: new Map(), nominal: new Map(), verbal: new Map() };
  readMarisa(trie).forEach((key, id) => {
    const count = values[id + 1];
    if (key.startsWith("1 ")) out.words.set(key.slice(2), count);
    if (!key.startsWith("2 ")) return;
    const [cue, word] = key.slice(2).split(" ");
    const cues = NOMINAL_CUE.has(cue) ? out.nominal : VERBAL_CUE.has(cue) ? out.verbal : null;
    if (cues) cues.set(word, (cues.get(word) ?? 0) + count);
  });
  return out;
}

// A noun the dictionary folds into a verb is common in the plural ("deportes", never a verb
// form after -o) and, for -a/-e forms, more common than its verb's other forms ("deporte" over
// "deportar") or seen after determiners and prepositions rather than before verbs ("la
// descarga", "de descarga"). Thresholds are counts in the bundled model.
const MIN_COUNT = 10;
const MIN_CUE = 20;

function foldedNouns(
  counts: Counts,
  verbsOf: Map<string, string[]>,
  paradigms: Map<string, string[]>,
  nominal: Set<string>,
  spelled: Set<string>,
): { nouns: string[]; adjectives: string[] } {
  const f = (word: string) => counts.words.get(word) ?? 0;
  const found = new Set<string>();
  for (const [word, infinitives] of verbsOf) {
    if (nominal.has(word) || word.length < 4 || f(word) < MIN_COUNT) continue;
    // The plural spells a different word: "redes" (red), "páginas" typed plain, "dimos".
    if (!/[aeo]$/u.test(word) || /[dlnrsxyzj]e$/u.test(word) || spelled.has(`${word}s`)) continue;
    if (word.endsWith("o") && verbsOf.has(`${word}s`)) continue;
    const plural = f(`${word}s`);
    if (plural < MIN_COUNT || (!word.endsWith("o") && plural < 2 * f(`${word}n`))) continue;
    const own = new Set([word, `${word}s`, `${word}n`]);
    let verb = 0;
    for (const infinitive of infinitives)
      for (const form of paradigms.get(infinitive) ?? [])
        if (!own.has(form) && !nominal.has(form)) verb = Math.max(verb, f(form));
    const cue = counts.nominal.get(word) ?? 0;
    if (
      word.endsWith("o") ||
      f(word) + plural >= 2 * verb ||
      (cue >= MIN_CUE && cue >= 3 * (counts.verbal.get(word) ?? 0))
    )
      found.add(word);
  }
  // "profundo" with "profunda": an adjective with both gender forms.
  const adjectives = [...found].filter((w) => w.endsWith("o") && found.has(`${w.slice(0, -1)}a`));
  for (const w of adjectives) {
    found.delete(w);
    found.delete(`${w.slice(0, -1)}a`);
  }
  return { nouns: [...found], adjectives };
}

/**
 * Bloom keys: "a" + the masculine form of every word with -o/-a gender forms (adjectives and
 * nouns like "niño"), "n" + every plural-taking entry without gender forms (nouns), and the
 * nouns the dictionary only spells as a verb's forms. The infinitive of every conjugated verb,
 * listed in full. Plus the accented nouns and adjectives whose unaccented spelling is a form of
 * some verb ("término" / "termino"), listed in full.
 */
export function deriveSpanishLexicon(dic: string, aff: string, counts: Counts) {
  const rules = parseAffixes(aff, "SFX");
  const prefixes = parseAffixes(aff, "PFX");
  const entries = dic
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !/^\p{Lu}/u.test(line))
    .map((line) => {
      const [word, flags = ""] = line.split("/");
      return [word, flags] as const;
    });
  const keys = new Set<string>();
  const verbs: string[] = [];
  const verbForms = new Set<string>();
  const verbsOf = new Map<string, string[]>();
  const paradigms = new Map<string, string[]>();
  const nominal = new Set<string>();
  const expand = (word: string, flags: string, only: RegExp) => {
    const out: string[] = [];
    for (const r of rules)
      if (
        only.test(r.flag) &&
        flags.includes(r.flag) &&
        word.endsWith(r.strip) &&
        r.cond.test(word)
      )
        out.push(word.slice(0, word.length - r.strip.length) + r.add);
    return out;
  };
  // "presa" with the prefix flag "i" spells "empresa": the prefixed words are entries too,
  // except "a-" ("caso" -> "acaso") and "micro-" ("onda" -> "microonda"), which spell other
  // words than the base's kind.
  const prefixed = (word: string, flags: string) =>
    prefixes
      .filter((r) => !UNSAFE_PREFIXES.has(r.flag))
      .filter((r) => flags.includes(r.flag) && word.startsWith(r.strip) && r.cond.test(word))
      .map((r) => r.add + word.slice(r.strip.length));
  for (const [word, flags] of entries.flatMap(([word, flags]) =>
    [word, ...prefixed(word, flags)].map((base) => [base, flags] as const),
  )) {
    if (VERB_FLAGS.test(flags)) {
      verbs.push(word);
      const forms = expand(word, flags, VERB_FLAGS);
      paradigms.set(word, [word, ...forms]);
      for (const form of forms) {
        verbForms.add(form);
        // Infinitives with enclitics ("acercarse") are no noun's spelling.
        if (!/[aeií]r(?:se|me|te|nos|os|lo|la|le|los|las|les)+$/u.test(form))
          verbsOf.set(form, [...(verbsOf.get(form) ?? []), word]);
      }
    }
    if (flags.includes("G")) keys.add(`a${word}`);
    // Nouns their ending already tells ("acción", "ciudad") need no key.
    else if (flags.includes("S") && !NOUN_ENDING.test(word)) keys.add(`n${word}`);
    if (/[GS]/.test(flags))
      for (const form of [word, ...expand(word, flags, /[GS]/)]) nominal.add(form);
  }
  // "ingles" and "cortes" are nouns too: only twins whose plain spelling is just a verb form.
  const accented = [...nominal]
    .filter((word) => /[áéíóú]/.test(word) && !nominal.has(plain(word)))
    .filter((word) => verbForms.has(plain(word)))
    .sort();
  const spelled = new Set([...entries.map(([word]) => plain(word)), ...[...nominal].map(plain)]);
  const folded = foldedNouns(counts, verbsOf, paradigms, nominal, spelled);
  for (const word of folded.nouns) keys.add(`n${word}`);
  for (const word of folded.adjectives) keys.add(`a${word}`);
  return { keys: [...keys].sort(), verbs: [...new Set(verbs)].sort(), accented };
}

function bloom(keys: string[]): string {
  const size = Math.ceil((keys.length * BLOOM_BITS_PER_KEY) / 6) * 6;
  const bits = new Uint8Array(size);
  for (const key of keys)
    for (const bit of bloomBits(key, size, SPANISH_BLOOM_HASHES)) bits[bit] = 1;
  let filter = "";
  for (let i = 0; i < size; i += 6) {
    let value = 0;
    for (let b = 0; b < 6; b++) value |= bits[i + b] << b;
    filter += BLOOM_ALPHABET[value];
  }
  return filter;
}

/** Infinitive stems by ending, front-coded: { ar: "cant,...", er: ..., ir: ..., ír: ... }. */
function verbStems(verbs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ending of ["ar", "er", "ir", "ír"])
    out[ending] = encodeWords(verbs.filter((v) => v.endsWith(ending)).map((v) => v.slice(0, -2)));
  return out;
}

export function buildSpanishLexicon(
  dic: string,
  aff: string,
  trie: ArrayBuffer,
  counts: ArrayBuffer,
): string {
  const { keys, verbs, accented } = deriveSpanishLexicon(dic, aff, ngramCounts(trie, counts));
  const line = (name: string, value: string) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-spanish-lexicon.ts from es_ES.dic/.aff and the n-gram",
    "// counts. Do not edit.",
    line("SPANISH_BLOOM", bloom(keys)),
    `export const SPANISH_VERBS = {`,
    ...Object.entries(verbStems(verbs)).map(
      ([ending, stems]) => `  ${ending}: ${JSON.stringify(stems)},`,
    ),
    "};",
    line("SPANISH_ACCENTED_NOMINALS", accented.join(" ")),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [dic, aff, trie, counts] = await Promise.all([
    readFile(SPANISH_LEXICON_SOURCES.dic, "utf8"),
    readFile(SPANISH_LEXICON_SOURCES.aff, "utf8"),
    Bun.file(SPANISH_LEXICON_SOURCES.trie).arrayBuffer(),
    Bun.file(SPANISH_LEXICON_SOURCES.counts).arrayBuffer(),
  ]);
  const source = buildSpanishLexicon(dic, aff, trie, counts);
  await writeFile(SPANISH_LEXICON_SOURCES.out, source);
  console.log(`wrote ${SPANISH_LEXICON_SOURCES.out} (${source.length} bytes)`);
}
