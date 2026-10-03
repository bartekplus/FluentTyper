// Derives the small Spanish word-class lexicon behind Review's Spanish checks from the Hunspell
// dictionary the extension ships (es_ES.dic/.aff), with the nouns it folds into a verb's forms
// ("deporte", "descarga") read back from the bundled Presage n-gram counts (ngrams.trie/.counts).
// Writes src/core/domain/grammar/review/spanish/spanishLexicon.generated.ts.
// Usage: bun run generate:lexicons spanish
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  NOUN_ENDING,
  SPANISH_BLOOM_HASHES,
} from "../src/core/domain/grammar/review/spanish/lexicon";
import { encodeWordGraph } from "../src/core/domain/grammar/review/wordGraph";
import { bloom, parseAffixRules, readNgrams } from "./lexiconTools";

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
  determiner: Map<string, number>;
  article: Map<string, number>;
  degree: Map<string, number>;
};

/** Unigram counts, and how often a word follows a nominal or a verbal cue. */
function ngramCounts(trie: ArrayBuffer, counts: ArrayBuffer): Counts {
  const out: Counts = {
    words: new Map(),
    nominal: new Map(),
    verbal: new Map(),
    determiner: new Map(),
    article: new Map(),
    degree: new Map(),
  };
  const add = (map: Map<string, number>, word: string, count: number) =>
    map.set(word, (map.get(word) ?? 0) + count);
  for (const [key, count] of readNgrams(trie, counts)) {
    if (key.startsWith("1 ")) out.words.set(key.slice(2), count);
    if (!key.startsWith("2 ")) continue;
    const [cue, word] = key.slice(2).split(" ");
    const cues = NOMINAL_CUE.has(cue) ? out.nominal : VERBAL_CUE.has(cue) ? out.verbal : null;
    if (cues) add(cues, word, count);
    if (DETERMINER_CUE.has(cue)) add(out.determiner, word, count);
    if (DETERMINER_CUE.has(cue) || FEMININE_CUE.has(cue)) add(out.article, word, count);
    if (DEGREE_CUE.has(cue)) add(out.degree, word, count);
  }
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
 * nouns the dictionary only spells as a verb's forms; "c" + every verb whose stem changes
 * under stress ("contar" -> "cuenta"). The infinitive of every conjugated verb,
 * listed in full. Plus the accented nouns and adjectives whose unaccented spelling is a form of
 * some verb ("término" / "termino"), listed in full.
 */
function deriveSpanishLexicon(dic: string, aff: string, counts: Counts) {
  const affixes = parseAffixRules(aff);
  const rules = affixes.filter((r) => r.kind === "SFX");
  const prefixes = affixes.filter((r) => r.kind === "PFX");
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
      paradigms.set(word, [...(paradigms.get(word) ?? [word]), ...forms]);
      for (const form of forms) {
        verbForms.add(form);
        // Infinitives with enclitics ("acercarse") are no noun's spelling.
        if (!/[aeií]r(?:se|me|te|nos|os|lo|la|le|los|las|les)+$/u.test(form))
          verbsOf.set(form, [...(verbsOf.get(form) ?? []), word]);
      }
    }
    if (flags.includes("G") && !falseGender(counts, word)) keys.add(`a${word}`);
    // Nouns their ending already tells ("acción", "ciudad") need no key.
    else if (flags.includes("S") && !NOUN_ENDING.test(word)) keys.add(`n${word}`);
    if (/[GS]/.test(flags))
      for (const form of [word, ...expand(word, flags, /[GS]/)]) nominal.add(form);
  }
  // "confesar" spells "confiesa", never "confesa": a verb with no present on its plain stem
  // changes the stem under stress ("cuenta", "pide", "tiene").
  for (const [verb, forms] of paradigms) {
    const third = `${verb.slice(0, -2)}${verb.endsWith("ar") ? "a" : "e"}`;
    if (!forms.some((form) => plain(form) === third)) keys.add(`c${verb}`);
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
  for (const word of genderedNouns(counts, keys)) keys.add(`n${word}`);
  for (const word of bareTwins(counts, keys, new Set(verbs))) keys.delete(`n${word}`);
  // The dictionary lists "nuevo" and "nueva", "enfermo" and "enferma" as unrelated nouns.
  for (const word of ["nuevo", "enfermo"]) keys.add(`a${word}`);
  return {
    keys: [...keys].sort(),
    verbs: [...new Set(verbs)].sort(),
    accented,
    plurals: denominalPlurals(counts, keys, new Set(verbs), nominal),
  };
}

/**
 * Nouns and adjectives in a consonant whose plural is also the subjunctive of the -ar verb
 * made from them ("españoles", "colores"), where the model saw the noun more often than the
 * verb's own forms: there the plural reads first ("señales" stays both).
 */
function denominalPlurals(
  counts: Counts,
  keys: Set<string>,
  verbs: Set<string>,
  nominal: Set<string>,
): string[] {
  const VERB_ENDINGS = ["ar", "a", "an", "o", "ó", "ado", "ando", "aba", "aron", "amos"];
  const found = new Set<string>();
  for (const key of keys) {
    const word = key.slice(1);
    if (!/[^aeiouáéíóú]$/u.test(word) || !verbs.has(`${word}ar`)) continue;
    const verb = VERB_ENDINGS.map((e) => `${word}${e}`)
      .filter((form) => !nominal.has(form))
      .reduce((sum, form) => sum + f(counts, form), 0);
    if (f(counts, word) + f(counts, `${word}es`) > verb) found.add(word);
  }
  return [...found].sort();
}

const f = (counts: Counts, word: string) => counts.words.get(word) ?? 0;

/**
 * "azul/GS" would spell "azula", "mercantil/GS" "mercantila": a gender flag on a word in a
 * consonant whose feminine the model never saw while it saw the word is no gender pair. Agent
 * nouns in -dor, -tor, -sor do make one ("programadora"), however rare.
 */
function falseGender(counts: Counts, word: string): boolean {
  return (
    /[dlrz]$/u.test(word) &&
    !/[dts]or$/u.test(word) &&
    f(counts, word) >= MIN_COUNT &&
    f(counts, `${word}a`) === 0
  );
}

// Adjectives that come after a determiner as often as nouns do: ordinals, possessives,
// "mismo", "propio", "último".
const PRENOMINAL =
  /^(?:mismo|propio|último|próximo|máximo|mínimo|primero?|segundo|tercero?|cuarto|quinto|medio|verdadero|contrario|respectivo|mío|tuyo|suyo|nuestro|vuestro)$/u;
const DETERMINER_CUE = new Set(
  (
    "el los un unos del al este estos ese esos aquel aquellos mi mis tu tus su sus nuestro " +
    "nuestros"
  ).split(" "),
);
const FEMININE_CUE = new Set(
  (
    "la las una unas esta estas esa esas aquella aquellas tu mi nuestra nuestras cada otra " +
    "otras"
  ).split(" "),
);
const DEGREE_CUE = new Set("muy tan bastante demasiado más menos es son está están".split(" "));

/**
 * Gender pairs that are nouns ("señor", "niño", "profesor"): their masculine forms follow a
 * determiner in at least 40% of their uses and never a degree word or a copula ("muy bueno",
 * "está lleno").
 */
function genderedNouns(counts: Counts, keys: Set<string>): string[] {
  return [...keys]
    .filter((key) => key.startsWith("a"))
    .map((key) => key.slice(1))
    .filter((word) => {
      if (PRENOMINAL.test(word)) return false;
      const forms = [word, /[aeiouáéíóú]$/u.test(word) ? `${word}s` : `${word}es`];
      const total = forms.reduce((sum, form) => sum + f(counts, form), 0);
      const det = forms.reduce((sum, form) => sum + (counts.determiner.get(form) ?? 0), 0);
      const degree = forms.reduce((sum, form) => sum + (counts.degree.get(form) ?? 0), 0);
      return total >= MIN_COUNT && det >= 0.4 * total && degree < 0.01 * total;
    });
}

/**
 * "comprado/S", "preciosa/S": the dictionary also files some participles and feminine
 * adjectives as nouns. A plural-taking entry that is the regular participle of a verb or the
 * feminine of a gender pair is a noun only where the model saw it after a determiner more
 * often than after a degree word or a copula ("la entrada", "la física", "el resultado"; never
 * "muy llena", "ha recibido"), or far more often than its other gender form ("lata" over
 * "lato", "costado" with no "costada").
 */
function bareTwins(counts: Counts, keys: Set<string>, verbs: Set<string>): string[] {
  const twin = (word: string) => {
    const part = /^(\p{L}+)(ad|id)[oa]$/u.exec(word);
    if (
      part &&
      (part[2] === "ad" ? [`${part[1]}ar`] : [`${part[1]}er`, `${part[1]}ir`]).some((v) =>
        verbs.has(v),
      )
    )
      return true;
    return word.endsWith("a") && keys.has(`a${word.slice(0, -1)}o`);
  };
  const cue = (map: Map<string, number>, word: string) =>
    (map.get(word) ?? 0) + (map.get(`${word}s`) ?? 0);
  return [...keys]
    .filter((key) => key.startsWith("n") && twin(key.slice(1)))
    .map((key) => key.slice(1))
    .filter((word) => {
      const article = cue(counts.article, word);
      if (article >= MIN_CUE && article >= cue(counts.degree, word)) return false;
      // A masculine participle outnumbers its feminine anyway, in every perfect ("ha comprado").
      const feminine = word.endsWith("a");
      const other = `${word.slice(0, -1)}${feminine ? "o" : "a"}`;
      return f(counts, word) < (feminine ? 4 : 20) * f(counts, other);
    });
}

export function buildSpanishLexicon(
  dic: string,
  aff: string,
  trie: ArrayBuffer,
  counts: ArrayBuffer,
): string {
  const { keys, verbs, accented, plurals } = deriveSpanishLexicon(
    dic,
    aff,
    ngramCounts(trie, counts),
  );
  const line = (name: string, value: string) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-spanish-lexicon.ts from es_ES.dic/.aff and the n-gram",
    "// counts. Do not edit.",
    line("SPANISH_BLOOM", bloom(keys, BLOOM_BITS_PER_KEY, SPANISH_BLOOM_HASHES)),
    "// Word graphs (review/wordGraph.ts): the infinitives, and the accented nominals.",
    line("SPANISH_VERBS", encodeWordGraph(verbs.filter((v) => /(?:ar|er|ir|ír)$/.test(v)))),
    line("SPANISH_ACCENTED_NOMINALS", encodeWordGraph(accented)),
    line("SPANISH_DENOMINAL_PLURALS", plurals.join(" ")),
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
