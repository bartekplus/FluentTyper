// Derives the Polish noun and adjective forms behind Review's case and agreement checks from the
// Hunspell dictionary the extension ships (pl_PL.dic/.aff), keeping the forms the bundled
// Presage n-gram model counts as common (ngrams.trie/.counts), so the table stays small.
// Writes src/core/domain/grammar/review/polish/lexicon.generated.ts.
// Usage: bun run generate:polish-lexicon
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import { encodeWords } from "../src/core/domain/grammar/review/swedish/lexicon";
import { adjectiveForms } from "../src/core/domain/grammar/review/polish/lexicon";
import {
  ADJECTIVE,
  ALL_CASES,
  CASES,
  FEMININE,
  MASCULINE,
  NEUTER,
  NOT_NOUN,
  VERB,
  VIRILE,
} from "../src/core/domain/grammar/review/polish/lexicon";

const root = resolve(import.meta.dir, "..");
export const POLISH_LEXICON_SOURCES = {
  dic: resolve(root, "resources_js/pl_PL/hunspell/pl_PL.dic"),
  aff: resolve(root, "resources_js/pl_PL/hunspell/pl_PL.aff"),
  trie: resolve(root, "resources_js/pl_PL/ngrams_db/ngrams.trie"),
  counts: resolve(root, "resources_js/pl_PL/ngrams_db/ngrams.counts"),
  out: resolve(root, "src/core/domain/grammar/review/polish/lexicon.generated.ts"),
};

/* ------------------------------------------------------------ n-gram counts */

// A minimal reader for the marisa-trie file Presage loads: it walks the LOUDS tree in order and
// restores every key, whose id is its rank among terminal nodes.
interface Bits {
  units: Uint8Array;
  size: number;
  ones: number;
}
interface LoudsTrie {
  link: Bits;
  terminal: Bits;
  bases: Uint8Array;
  extras: Uint8Array;
  extraBits: number;
  tail: Uint8Array;
  tailEnds: Bits;
  next: LoudsTrie | null;
  parent: Int32Array;
  linkRank: Int32Array;
}
const bitAt = (bits: Bits | Uint8Array, i: number) =>
  ((bits instanceof Uint8Array ? bits : bits.units)[i >> 3] >> (i & 7)) & 1;

function readMarisa(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  let pos = 16; // "We love Marisa."
  const u32 = () => ((pos += 4), view.getUint32(pos - 4, true));
  const u64 = () => ((pos += 8), Number(view.getBigUint64(pos - 8, true)));
  const vector = () => {
    const size = u64();
    const bytes = new Uint8Array(buffer, pos, size);
    pos += size + ((8 - (size % 8)) % 8);
    return bytes;
  };
  const bitVector = (): Bits => {
    const units = vector();
    const size = u32();
    const ones = u32();
    vector(); // rank index
    vector(); // select0 index
    vector(); // select1 index
    return { units, size, ones };
  };
  const trie = (): LoudsTrie => {
    const louds = bitVector();
    const terminal = bitVector();
    const link = bitVector();
    const bases = vector();
    const extras = vector();
    const extraBits = u32();
    u32(); // mask
    u64(); // size
    const tail = vector();
    const tailEnds = bitVector();
    const next = link.ones !== 0 && tail.length === 0 ? trie() : null;
    vector(); // cache
    u32(); // level-1 nodes
    u32(); // config
    // LOUDS: "10" for the super root, then for each node one 1 per child and a 0.
    const parent = new Int32Array(bases.length);
    for (let node = 0, cursor = 2, child = 1; node < bases.length; node++, cursor++)
      for (; cursor < louds.size && bitAt(louds, cursor); cursor++) parent[child++] = node;
    const linkRank = new Int32Array(bases.length);
    for (let i = 0, rank = 0; i < bases.length; i++) {
      linkRank[i] = rank;
      rank += bitAt(link, i);
    }
    return { link, terminal, bases, extras, extraBits, tail, tailEnds, next, parent, linkRank };
  };
  const top = trie();

  const label = (t: LoudsTrie, node: number, out: number[]) => {
    if (!bitAt(t.link, node)) return void out.push(t.bases[node]);
    let extra = 0;
    for (let b = 0, at = t.linkRank[node] * t.extraBits; b < t.extraBits; b++, at++)
      extra |= bitAt(t.extras, at) << b;
    const link = t.bases[node] | (extra << 8);
    // A next-level trie holds reversed strings, so walking up to its root reads them forward.
    if (t.next) for (let n = link; n !== 0; n = t.next.parent[n]) label(t.next, n, out);
    else if (t.tailEnds.size === 0) for (let p = link; t.tail[p] !== 0; p++) out.push(t.tail[p]);
    else for (let p = link; out.push(t.tail[p]), !bitAt(t.tailEnds, p); p++);
  };
  const decoder = new TextDecoder();
  const paths: number[][] = [[]];
  const keys: string[] = [];
  for (let node = 1; node < top.bases.length; node++) {
    const path = paths[top.parent[node]].slice();
    label(top, node, path);
    paths[node] = path;
    if (bitAt(top.terminal, node)) keys.push(decoder.decode(new Uint8Array(path)));
  }
  return keys;
}

/** Unigram counts of the n-gram model: "1 <word>" keys, counts indexed by key id + 1. */
export function unigrams(trie: ArrayBuffer, counts: ArrayBuffer): Map<string, number> {
  const keys = readMarisa(trie);
  const values = new Int32Array(counts);
  const words = new Map<string, number>();
  keys.forEach((key, id) => {
    if (key.startsWith("1 ")) words.set(key.slice(2), values[id + 1]);
  });
  return words;
}

/* ------------------------------------------------------------- affix rules */

type Rule = { flag: string; strip: string; add: string; cond: RegExp };

export function parseAffixes(aff: string): Map<string, Rule[]> {
  const rules = new Map<string, Rule[]>();
  for (const line of aff.split("\n")) {
    const [kind, flag, strip, add, cond] = line.trim().split(/\s+/);
    if ((kind !== "SFX" && kind !== "PFX") || cond === undefined) continue;
    const list = rules.get(flag) ?? [];
    list.push({
      flag,
      strip: strip === "0" ? "" : strip,
      add: add === "0" ? "" : add,
      cond: new RegExp(kind === "PFX" ? `^${cond}` : `${cond === "." ? "" : cond}$`),
    });
    rules.set(flag, list);
  }
  return rules;
}

// pl_PL.aff groups endings by paradigm, not by case, so each noun flag is read with the case
// its endings spell. These flags inflect nouns; X/x/Y/K adjectives; the rest verbs.
export const NOUN_FLAGS = "NMTsUOVQnAmoqZzPSDCwRLrutWlp";
// Y spells the virile plural ("nowi"), which no preposition, demonstrative or numeral checked
// here takes, so it says nothing about a noun after them.
const ADJECTIVE_FLAGS = "XxK";
const c = (spec: string) =>
  spec
    .split(" ")
    .reduce((mask, tag) => mask | (1 << (CASES.indexOf(tag[0]) + (tag[1] === "p" ? 7 : 0))), 0);
const PLURAL_OBLIQUE: Array<[RegExp, number]> = [
  [/om$/, c("Dp")],
  [/mi$/, c("Ip")],
  [/ch$/, c("Lp")],
];
const NOM_PLURAL = c("Np Ap Vp");
const GEN_PLURAL = c("Gp Ap");

/** The cases a form spelled by `flag` can carry, by its ending. Unknown: every case. */
export function flagCases(flag: string, form: string, lemma: string): number {
  for (const [ending, mask] of PLURAL_OBLIQUE)
    if (ending.test(form) && /[NZWVrij]/.test(flag)) return mask;
  switch (flag) {
    case "s":
    case "z":
    case "A":
    case "q":
    case "t":
    case "o":
    case "w":
      return NOM_PLURAL;
    case "T":
    case "S":
    case "l":
    case "D":
    case "m":
    case "n":
      return GEN_PLURAL;
    case "C":
      return NOM_PLURAL | GEN_PLURAL;
    case "O":
    case "Q":
    case "P":
    case "R":
    case "u":
      if (/owi$/.test(form)) return c("Ds");
      if (/em$/.test(form)) return c("Is");
      if (/a$/.test(form)) return c("Gs As");
      if (/u$/.test(form)) return c("Gs Ds Ls Vs");
      if (/e$/.test(form)) return c("Ls Vs");
      if (/owie$/.test(form)) return c("Np Vp");
      if (/i$/.test(form)) return NOM_PLURAL | GEN_PLURAL;
      return ALL_CASES;
    case "U":
      if (/em$/.test(form)) return c("Is");
      if (/a$/.test(form)) return c("Gs") | NOM_PLURAL;
      if (/u$/.test(form)) return c("Ds Ls");
      if (/e$/.test(form)) return c("Ls");
      return ALL_CASES;
    case "V":
      if (/a$/.test(form)) return NOM_PLURAL;
      return GEN_PLURAL;
    case "i":
    case "j":
      // Verbal nouns: "pisanie", "pisania", "pisaniu", "pisaniem", "pisań".
      if (/e$/.test(form)) return c("Ns As Vs");
      if (/a$/.test(form)) return c("Gs") | NOM_PLURAL;
      if (/u$/.test(form)) return c("Ds Ls");
      if (/em$/.test(form)) return c("Is");
      return GEN_PLURAL;
    case "M":
    case "p":
    case "L":
      // "panią" is also the accusative of "pani"; "książką" is only the instrumental.
      if (/ą$/.test(form)) return c("Is") | (lemma.endsWith("i") ? c("As") : 0);
      if (/ę$/.test(form)) return c("As");
      if (/o$/.test(form)) return c("Vs");
      if (/u$/.test(form)) return c("Vs");
      if (/ej$/.test(form)) return ALL_CASES;
      // "osoby", "kości": the genitive singular is also the plural's nominative (and genitive).
      if (/[iy]$/.test(form)) return c("Gs Ds Ls Vs") | NOM_PLURAL | GEN_PLURAL;
      if (/e$/.test(form)) return c("Ds Ls");
      return c("Gs Ds Ls Vs");
    default:
      return ALL_CASES;
  }
}

/** The cases and gender of a noun lemma's own form, or 0 when it is not read as a noun. */
export function lemmaTags(word: string, flags: string): number {
  const consonant = /[^aeiouyąęó]$/.test(word);
  if (/[OQPRu]/.test(flags) || (consonant && /[NTsSZzDC]/.test(flags) && !/M/.test(flags)))
    return c("Ns As") | MASCULINE | (/[ow]/.test(flags) ? VIRILE : 0);
  if (/[Wl]/.test(flags)) return NOM_PLURAL | (word.endsWith("i") ? GEN_PLURAL : 0);
  if (/(?:um|[oeę])$/.test(word) && /[UV]/.test(flags))
    return (word.endsWith("um") ? c("Ns Gs Ds As Is Ls Vs") : c("Ns As Vs")) | NEUTER;
  // An -a noun with a virile plural ("kierowcy", "poeci", "kolegów") is masculine, though
  // some ("logopeda") name women too.
  if (/a$/.test(word) && /[Mp]/.test(flags))
    return c("Ns") | (/[qoT]/.test(flags) ? MASCULINE | FEMININE | VIRILE : FEMININE);
  if (consonant && /M/.test(flags)) return c("Ns As") | FEMININE;
  return 0;
}

/* ------------------------------------------------------------------ build */

// Function words the dictionary also lists as nouns: "jak" (a yak), "bez" (lilac), "niż"
// (a lowland), "tam" (dams), "ktoś", "coś", the numerals "kilka" (a sprat) and
// "tysiąc" read as a number, "lada" (a counter) beside the particle, the pronoun "sam", "warta"
// (worth) beside the noun (a guard), the
// adverbs "zbyt", "prawo", "lewo", the prepositions "poza", "koło", "dzięki", and
// abbreviations written without their dot.
const NOT_NOUNS = (
  "jak bez niż tam ktoś coś kilka tysiąc lada sam warta gratis zbyt prawo lewo brutto netto " +
  "poza koło dzięki ul nr art akt pkt ust lit"
).split(" ");
/** Irregular plurals the paradigm flags do not spell. */
const EXTRA: Record<string, string> = { ręce: "Np Ap Vp", razy: "Gp", procent: "Gp" };
/** How common (summed over its forms) a noun must be to be listed. */
const MIN_COUNT = 200;
/** How common (summed over its forms) an adjective or passive participle must be to be listed. */
const MIN_ADJECTIVE_COUNT = 300;
// Participles inflect like adjectives; the other verb flags spell finite forms.
const PARTICIPLE_FLAGS = "EvgG";
const VERB_FLAGS = "HIBdkeJFh";

/** Every form an entry spells, with what it is: noun tags, ADJECTIVE, VERB or NOT_NOUN. */
function* spell(
  affixes: Map<string, Rule[]>,
  word: string,
  flags: string,
): Generator<[form: string, mask: number, paradigm: "noun" | "gerund" | null]> {
  const own = lemmaTags(word, flags);
  const gender = own & (MASCULINE | FEMININE | NEUTER | VIRILE);
  if (own) yield [word, own, "noun"];
  if (/[XxY]/.test(flags)) yield [word, ADJECTIVE, null];
  const verb = /[HIBdkeJFhEvgGij]/.test(flags);
  if (own ? verb : !/[XxY]/.test(flags)) yield [word, verb ? VERB : NOT_NOUN, null];
  const spelled: string[] = [];
  for (const flag of flags) {
    if (flag === "b" || flag === "Y") continue;
    for (const rule of affixes.get(flag) ?? []) {
      if (!word.endsWith(rule.strip) || !rule.cond.test(word)) continue;
      const form = word.slice(0, word.length - rule.strip.length) + rule.add;
      spelled.push(form);
      if (flag === "i" || flag === "j")
        yield [form, flagCases(flag, form, word) | NEUTER, "gerund"];
      else if (NOUN_FLAGS.includes(flag))
        yield own ? [form, flagCases(flag, form, word) | gender, "noun"] : [form, NOT_NOUN, null];
      else if (ADJECTIVE_FLAGS.includes(flag) || PARTICIPLE_FLAGS.includes(flag))
        yield [form, ADJECTIVE, null];
      else yield [form, VERB_FLAGS.includes(flag) ? VERB : NOT_NOUN, null];
    }
  }
  // "nie-" (flag b) joins adjectives, adverbs and verbal nouns; none of them is read as a noun.
  if (flags.includes("b"))
    for (const form of [word, ...spelled]) yield [`nie${form}`, NOT_NOUN, null];
}

/**
 * An entry's noun paradigm, verbal-noun paradigm and other forms. */
function entryTables(
  affixes: Map<string, Rule[]>,
  word: string,
  flags: string,
): [Map<string, number>, Map<string, number>, Map<string, number>] {
  const tables = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  for (const [form, mask, paradigm] of spell(affixes, word, flags)) {
    const table = tables[paradigm === "noun" ? 0 : paradigm === "gerund" ? 1 : 2];
    table.set(form, (table.get(form) ?? 0) | mask);
  }
  return tables as [Map<string, number>, Map<string, number>, Map<string, number>];
}

/** The longest prefix the forms share. */
function stemOf(forms: Iterable<string>): string {
  let stem: string | undefined;
  for (const form of forms) {
    stem ??= form;
    while (!form.startsWith(stem)) stem = stem.slice(0, -1);
  }
  return stem ?? "";
}

export async function buildPolishLexicon(
  dic: string,
  aff: string,
  trie: ArrayBuffer,
  counts: ArrayBuffer,
): Promise<string> {
  const frequency = unigrams(trie, counts);
  const affixes = parseAffixes(aff);
  const entries = dic
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split("/") as [string, string?])
    .filter(([word]) => word && !/\p{Lu}/u.test(word));

  // 1. The paradigms of common nouns (and of verbal nouns): form -> tags.
  const paradigms: Array<Map<string, number>> = [];
  for (const [word, flags = ""] of entries) {
    const [nouns, gerunds] = entryTables(affixes, word, flags);
    for (const table of [nouns, gerunds]) {
      let total = 0;
      for (const form of table.keys()) total += frequency.get(form) ?? 0;
      if (total >= MIN_COUNT) paradigms.push(table);
    }
  }

  // 2. What every entry says about those forms; what the paradigms miss is an exception.
  const listed = new Map<string, number>();
  for (const table of paradigms)
    for (const [form, mask] of table) listed.set(form, (listed.get(form) ?? 0) | mask);
  const full = new Map(listed);
  for (const [word, flags = ""] of entries)
    for (const table of entryTables(affixes, word, flags))
      for (const [form, mask] of table) if (full.has(form)) full.set(form, full.get(form)! | mask);
  for (const word of NOT_NOUNS) if (full.has(word)) full.set(word, full.get(word)! | NOT_NOUN);
  for (const [word, spec] of Object.entries(EXTRA))
    if (full.has(word)) full.set(word, full.get(word)! | c(spec));

  // 3. Paradigm classes: a stem and its endings with their tags.
  const palette = new Map<number, number>();
  const classes = new Map<string, number>();
  const byClass: string[][] = [];
  for (const table of paradigms) {
    const stem = stemOf(table.keys());
    const key = [...table]
      .map(([form, mask]) => {
        if (!palette.has(mask)) palette.set(mask, palette.size);
        return `${form.slice(stem.length)}:${palette.get(mask)!.toString(36)}`;
      })
      .sort()
      .join(" ");
    if (!classes.has(key)) classes.set(key, classes.size);
    (byClass[classes.get(key)!] ??= []).push(stem);
  }
  // 4. Adjectives and passive participles, by their masculine form ("dobry", "polski",
  // "ostatni", "zrobiony"); active participles in -ący govern an object and are left out.
  const adjectives = new Set<string>();
  const adjectiveCount = (lemma: string) =>
    adjectiveForms(lemma).reduce((sum, form) => sum + (frequency.get(form) ?? 0), 0);
  for (const [word, flags = ""] of entries) {
    const lemmas = /x/.test(flags) ? [word] : [];
    if (flags.includes("E"))
      for (const rule of affixes.get("E") ?? [])
        if (word.endsWith(rule.strip) && rule.cond.test(word) && rule.add.endsWith("y"))
          lemmas.push(word.slice(0, word.length - rule.strip.length) + rule.add);
    for (const lemma of lemmas)
      if (/^\p{Ll}+$/u.test(lemma) && /[yi]$/.test(lemma) && !/ący$/.test(lemma))
        if (adjectiveCount(lemma) >= MIN_ADJECTIVE_COUNT) adjectives.add(lemma);
  }

  // The adjective table already marks its own forms, so exceptions leave that bit to it.
  const adjectiveSpelled = new Set([...adjectives].flatMap((lemma) => adjectiveForms(lemma)));
  // Adjective forms another entry spells too ("przeszły" is also a verb, "dobra" a noun).
  const ambiguous = new Set<string>();
  for (const [word, flags = ""] of entries)
    for (const [form, mask] of spell(affixes, word, flags))
      if (mask !== ADJECTIVE && adjectiveSpelled.has(form)) ambiguous.add(form);
  const exceptions = new Map<number, string[]>();
  for (const [form, mask] of full) {
    let extra = mask & ~listed.get(form)!;
    if (adjectiveSpelled.has(form)) extra &= ~ADJECTIVE;
    if (!extra) continue;
    const list = exceptions.get(extra) ?? [];
    list.push(form);
    exceptions.set(extra, list);
  }

  const constant = (name: string, value: string) =>
    `export const ${name} = ${JSON.stringify(value)};`;
  const property = ([mask, forms]: [number, string[]]) =>
    `${JSON.stringify(mask.toString(36))}: ${JSON.stringify(encodeWords(forms))},`;
  const source = `// Generated by bun scripts/generate-polish-lexicon.ts from pl_PL.dic/.aff and the n-gram counts. Do not edit.
/** The tag masks the classes use, in base 36. */
${constant("TAGS", [...palette.keys()].map((mask) => mask.toString(36)).join(" "))}
/** Paradigm classes: "ending:tags" pairs (an index into TAGS), one class per line. */
${constant("CLASSES", [...classes.keys()].join("\n"))}
/** Each class's front-coded stems, one class per line. */
${constant("STEMS", byClass.map((stems) => encodeWords(stems)).join("\n"))}
/** Front-coded adjectives and passive participles, by their masculine form. */
${constant("ADJECTIVES", encodeWords([...adjectives]))}
/** Adjective forms that are also another word ("przeszły", "dobra"). */
${constant("AMBIGUOUS_ADJECTIVES", encodeWords([...ambiguous]))}
/** Tags a form has beyond its paradigms (another entry spells it too). */
export const EXCEPTIONS: Readonly<Record<string, string>> = {
${[...exceptions]
  .sort((a, b) => a[0] - b[0])
  .map(property)
  .join("\n")}
};
`;
  // Printed as the format check expects (printWidth 100, quoted keys only where needed).
  return format(source, {
    ...(await resolveConfig(POLISH_LEXICON_SOURCES.out)),
    parser: "typescript",
  });
}

if (import.meta.main) {
  const S = POLISH_LEXICON_SOURCES;
  const [dic, aff] = await Promise.all([readFile(S.dic, "utf8"), readFile(S.aff, "utf8")]);
  const [trie, counts] = await Promise.all([
    Bun.file(S.trie).arrayBuffer(),
    Bun.file(S.counts).arrayBuffer(),
  ]);
  const out = await buildPolishLexicon(dic, aff, trie, counts);
  await writeFile(S.out, out);
  console.log(`wrote ${S.out} (${Buffer.byteLength(out)} bytes)`);
}
