// Derives the English part-of-speech lexicon behind Review's grammar rules from the Hunspell
// dictionary the extension ships (en_US.dic/.aff) plus the authored irregular verb table.
// Writes src/core/domain/grammar/implementations/helpers/englishLexicon.generated.ts.
// Usage: bun run generate:english-lexicon
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ENGLISH_VERB_FORMS } from "../src/core/domain/grammar/implementations/helpers/EnglishVerbForms";
import { type AffixRule as Rule, bloom, bloomHas, parseAffixRules } from "./lexiconTools";

const root = resolve(import.meta.dir, "..");
export const LEXICON_SOURCES = {
  dic: resolve(root, "resources_js/en_US/hunspell/en_US.dic"),
  aff: resolve(root, "resources_js/en_US/hunspell/en_US.aff"),
  out: resolve(root, "src/core/domain/grammar/implementations/helpers/englishLexicon.generated.ts"),
};

// Suffix flags the runtime reads (M, the possessive, only spells "'s" forms; the compound flags
// only spell ordinals), plus every prefix flag.
const SUFFIX_FLAGS = "SDGRTYPZJNXVBLH";
// Pseudo-flags, lowercase so they never clash with the .aff's: v base verb, q doubles its final
// consonant (or c -> ck) before -ed/-ing, w keeps its -e before -ing (or ie -> ying), n noun,
// a adjective, r adverb. Digits on a noun name the prefix flags (by .aff order) its noun
// reading does not cross.
const CLASS_FLAGS = "vqwnar0123456789";
const PURE_NOUN_LETTERS = 5;
// The nouns left out still answer "is this a word" through a Bloom filter: 10 bits per key
// keeps false positives under 1% for ~38 KB.
const BLOOM_BITS_PER_WORD = 10;

function parseAff(aff: string): { suffixes: Rule[]; prefixes: Rule[] } {
  const rules = parseAffixRules(aff);
  return {
    suffixes: rules.filter((r) => r.kind === "SFX"),
    prefixes: rules.filter((r) => r.kind === "PFX"),
  };
}

/** Every [stem, flag] whose suffix rule spells `word` from a dictionary stem. */
function unsuffixed(word: string, rules: Rule[], lex: Map<string, Set<string>>, flags: string) {
  const out: [string, string][] = [];
  for (const r of rules) {
    if (!flags.includes(r.flag) || !word.endsWith(r.add)) continue;
    const stem = word.slice(0, word.length - r.add.length) + r.strip;
    if (stem !== word && stem && r.cond.test(stem) && lex.has(stem)) out.push([stem, r.flag]);
  }
  return out;
}

// Nouns whose -ly (presently) belongs to an equally common adjective: "the members present".
const NOUN_ADJECTIVES = new Set(["present"]);

const fromLy = (word: string): string[] =>
  [
    word.slice(0, -2), // quick-ly
    /ily$/.test(word) ? `${word.slice(0, -3)}y` : "", // happi-ly, not tru-ly as "try"
    /uly$/.test(word) ? `${word.slice(0, -2)}e` : "", // tru-ly, du-ly
    `${word.slice(0, -1)}e`, // possibl-y, gentl-y
    // basic-ally, full-y, shrill-y; only those endings ("understandably" is not understand +
    // -ably, "bally" not ball + -y).
    /ally$/.test(word) ? word.slice(0, -4) : "",
    /[iou]lly$/.test(word) ? word.slice(0, -1) : "",
  ].filter((base) => base.length > 2);

export function buildEnglishLexicon(dic: string, aff: string): string {
  const { suffixes, prefixes } = parseAff(aff);
  const omitted: string[] = [];
  const entries = deriveEnglishLexicon(dic, aff, omitted);
  return render(entries, suffixes, prefixes, omitted);
}

/**
 * Sorted [word, flags] records: kept .aff flags plus the pseudo-flags. Left-out nouns go to
 * `omitted`, followed by "!noun" when the dictionary gives them no -s plural.
 */
export function deriveEnglishLexicon(
  dic: string,
  aff: string,
  omitted: string[] = [],
): [string, string][] {
  const { suffixes, prefixes } = parseAff(aff);
  const used = new Set([...suffixes, ...prefixes].map((r) => r.flag));
  if ([...CLASS_FLAGS].some((flag) => used.has(flag))) throw new Error("pseudo-flag clash");
  const keep = new Set([...SUFFIX_FLAGS, ...prefixes.map((r) => r.flag)]);
  const prefixFlags = [...new Set(prefixes.map((r) => r.flag))];
  if (prefixFlags.length > 10) throw new Error("more prefix flags than digit marks");

  // Lowercase words only: proper nouns, abbreviations with capitals and apostrophe forms stay out.
  const lex = new Map<string, Set<string>>();
  const possessive = new Set<string>();
  // The prefixes a noun's possessive takes, the dictionary's only sign that the prefixed word is
  // a noun too: file's/KC and crease/ICMS spell profile's and decrease's; pose's/A not propose's.
  const nounPrefixes = new Map<string, string>();
  const possessed = (word: string, flags: string) => {
    possessive.add(word);
    nounPrefixes.set(word, (nounPrefixes.get(word) ?? "") + flags);
  };
  for (const line of dic.split("\n").slice(1)) {
    const [word, flags = ""] = line.trim().split("/");
    if (/^[a-z]+'s$/.test(word)) possessed(word.slice(0, -2), flags); // hand's: hand/UDGS
    if (!/^[a-z]+$/.test(word)) continue;
    lex.set(word, new Set([...flags].filter((flag) => keep.has(flag))));
    if (flags.includes("M")) possessed(word, flags);
  }
  const irregular = new Set(ENGLISH_VERB_FORMS.map((entry) => entry.lemma));
  // One- and two-letter entries are munching hubs (re/DGT spells red, ring, rest; t/S): known
  // words only.
  for (const [word, flags] of lex) if (word.length < 3 && !irregular.has(word)) flags.clear();
  const has = (word: string, flag: string) => lex.get(word)?.has(flag) ?? false;

  // Standalone entries that are a verb or plural form of another entry: stopped/stopping,
  // panicked, agreeing/dying, and regular spellings listed on their own (taking, concerning,
  // bused/busing, admissions). They become flags on the base and drop out when flagless.
  const absorbed = new Set<string>();
  const links = new Map<string, Map<string, string[]>>(); // base -> flag -> forms
  const link = (base: string, flag: string, form: string) => {
    const byFlag = links.get(base) ?? links.set(base, new Map()).get(base)!;
    (byFlag.get(flag) ?? byFlag.set(flag, []).get(flag)!).push(form);
  };
  for (const word of lex.keys()) {
    const regularForm = unsuffixed(word, suffixes, lex, "SDG").filter(([stem, f]) => has(stem, f));
    // A past that is a lemma itself (bed/SM, need/MDSG) is not be+d or nee+d.
    const lemmaLike = possessive.has(word) || has(word, "S");
    const doubled = /^([a-z]*?([b-df-hj-np-tv-z]))(?:\2|(?<=c)k)(ed|ing)$/.exec(word);
    const base = doubled?.[1] ?? "";
    // "called" is call's, not cal's; "putting" is putt's and irregular put's.
    if (
      lex.has(base) &&
      (!regularForm.length || irregular.has(base)) &&
      !(lemmaLike && doubled![3] === "ed")
    )
      link(base, doubled![3] === "ed" ? "qD" : "qG", word);
    if (word.endsWith("ing")) {
      const keepE = word.slice(0, -3);
      if (keepE.endsWith("e") && lex.has(keepE)) link(keepE, "w", word); // agreeing, eyeing
      const ie = `${word.slice(0, -4)}ie`;
      if (word.endsWith("ying") && lex.has(ie)) link(ie, "w", word); // dying, tying
    }
    // echos/echoes: two spellings of one -s form leave the choice to spelling.
    for (const [stem, flag] of unsuffixed(word, suffixes, lex, "SDG"))
      if (
        !has(stem, flag) &&
        !(lemmaLike && flag === "D") &&
        !(flag === "S" && lex.has(`${stem}es`))
      )
        link(stem, flag, word);
  }
  // The .aff munches by spelling, not morphology: hop/DG spells hope's "hoped" and "hoping",
  // passe/DGS spells pass's "passed", cut/T spells "cutest". Flags that spell the same words on
  // X and Xe belong to either: a base that doubles (hopped) hands them to Xe, otherwise both
  // get them and the spelling rules break the tie. A one-syllable base ending in one vowel and
  // one consonant would double its own -ed/-ing (carred, firring), so the undoubled forms on
  // car/D, fir/DG are care's and fire's even when no doubled form is listed.
  for (const [base, flags] of lex) {
    const twin = lex.get(`${base}e`);
    if (!twin) continue;
    const doubles =
      ["qD", "qG"].some((flag) => links.get(base)?.has(flag)) ||
      /^[^aeiouy]*[aeiou][b-df-hj-np-tv-z]$/.test(base);
    for (const flag of /[sxzh]$/.test(base) ? "DGRTZJBVS" : "DGRTZJBV") {
      if (!flags.has(flag) && !twin.has(flag)) continue;
      twin.add(flag);
      if (doubles) flags.delete(flag);
      else flags.add(flag);
    }
  }
  for (const [base, byFlag] of links) {
    const flags = lex.get(base)!;
    const regular = !irregular.has(base);
    // A doubled form counts with its pair (stopped + stopping), or -ing alone for an irregular
    // lemma (beginning); "earring" alone does not make "ear" a verb.
    const doubles = byFlag.has("qG") && (byFlag.has("qD") || !regular);
    const past = flags.has("D") || byFlag.has("D") || doubles || !regular;
    const ing = flags.has("G") || byFlag.has("G") || doubles || byFlag.has("w");
    const absorb = (flag: string, as: string) => {
      for (const form of byFlag.get(flag) ?? []) absorbed.add(form);
      if (byFlag.has(flag)) flags.add(as);
    };
    // Verb evidence is a past and an -ing form: an -ing alone is not (the/JG, morn/G).
    if (past && ing) {
      if (doubles) {
        absorb("qD", "q");
        absorb("qG", "q");
      }
      // Keeping the -e replaces the plain spelling: dyeing, not dye/G's "dying".
      if (byFlag.has("w")) flags.delete("G");
      absorb("w", "w");
      if (!flags.has("q") && !flags.has("w")) absorb("G", "G");
      if (!flags.has("q") && regular) absorb("D", "D"); // "seed" is not see+d
    }
    if ((past && ing) || possessive.has(base)) absorb("S", "S");
  }

  const isVerb = (word: string) => {
    const f = lex.get(word)!;
    return (
      irregular.has(word) ||
      ((f.has("G") || f.has("q") || f.has("w")) && (f.has("D") || f.has("q")))
    );
  };
  // An adjective base behind a listed -ly adverb: possibly -> possible, happily -> happy.
  // Only uninflected -ly entries that no Y flag spells (apply, belly and early inflect).
  const lyBase = new Map<string, string>();
  for (const [word, flags] of lex) {
    // -ness on the -ly word (sisterly/P) makes it an adjective built on a noun, not an adverb.
    if (!word.endsWith("ly") || /[DGSRTP]/.test([...flags].join("")) || possessive.has(word))
      continue;
    if (unsuffixed(word, suffixes, lex, "Y").some(([stem]) => has(stem, "Y"))) continue;
    const base = fromLy(word).find((candidate) => lex.has(candidate));
    if (base) lyBase.set(word, base);
  }
  const lyAdjectives = new Set(lyBase.values());
  // A superlative listed as a word of its own is another lexeme the .aff munched onto the
  // base: earn/T spells "earnest", hon/T "honest", dive/T "divest". Not gradable then.
  const gradable = (word: string) =>
    suffixes.some(
      (r) =>
        r.flag === "T" &&
        r.cond.test(word) &&
        word.endsWith(r.strip) &&
        !lex.has(word.slice(0, word.length - r.strip.length) + r.add),
    );

  const entries: [string, string][] = [];
  for (const [word, flags] of lex) {
    if (absorbed.has(word) && !flags.size) continue;
    const verb = isVerb(word);
    if (verb) flags.add("v");
    if (possessive.has(word) || (flags.has("S") && ![..."DGqw"].some((f) => flags.has(f))))
      flags.add("n");
    // A digit for each prefix the noun reading does not cross (see nounPrefixes).
    if (flags.has("n"))
      prefixFlags.forEach((flag, i) => {
        if (flags.has(flag) && !nounPrefixes.get(word)?.includes(flag)) flags.add(String(i));
      });
    // Gradable (T), -ness (P), behind a listed -ly adverb, or -ly (Y) from a word that is not a
    // noun (a noun's -ly is an adjective: monthly) unless shaped like an adjective (final/SMY).
    // un-/in- (U/I) on an adjective-shaped non-verb: available, accessible.
    const shaped = /(?:al|ic|ous|ive|ful|less|[ai]ble)$/.test(word);
    if (
      NOUN_ADJECTIVES.has(word) ||
      (flags.has("T") && gradable(word)) ||
      flags.has("P") ||
      lyAdjectives.has(word) ||
      (flags.has("Y") && (!possessive.has(word) || shaped)) ||
      ((flags.has("U") || flags.has("I")) && shaped && !verb)
    )
      flags.add("a");
    if (lyBase.has(word)) flags.add("r");
    // Nouns with nothing else to say are half the dictionary and left out, except short ones
    // (the frequent: day, way, child; each extra letter costs ~7 KB) and those spelled like an
    // -s, -ed or -ing form, which the spelling rules would misread (series, hotbed, ceiling).
    const pureNoun = /^S?n$/.test([...flags].sort().join(""));
    if (pureNoun && word.length > PURE_NOUN_LETTERS && !/(?:[^s]s|ed|ing)$/.test(word)) {
      // "!" marks a noun without a dictionary plural: "meatloaf" is listed, "meatloafs" is not.
      omitted.push(word, ...(flags.has("S") ? [] : [`!${word}`]));
      continue;
    }
    entries.push([word, [...flags].sort().join("")]);
  }
  return entries.sort(([a], [b]) => (a < b ? -1 : 1));
}

// Records are "<shared prefix length, at most 9><rest of word>", with the rest's most frequent
// letter runs replaced by one-character marks (TOKENS lists "<mark><run>"). Flag sets go in a parallel string, one code
// per word (two past FLAG_SINGLE), indexing a frequency-sorted table.
const CODE =
  "!#$%&()*+,-./:;<=>?@[]^_`{|}~ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'";
// Token marks: any code character but a letter or digit (records' own characters).
const MARKS = CODE.replace(/[a-z\d]/g, "");

/** Greedy: the run saving the most characters, once per mark; runs never contain a mark. */
function tokenize(rests: string[]): { rests: string[]; tokens: string[] } {
  const tokens: string[] = [];
  for (const mark of MARKS) {
    const counts = new Map<string, number>();
    for (const rest of rests)
      for (let i = 0; i < rest.length; i++)
        for (let n = 2; n <= 6 && i + n <= rest.length; n++) {
          const run = rest.slice(i, i + n);
          if (/[^a-z]/.test(run)) break;
          counts.set(run, (counts.get(run) ?? 0) + 1);
        }
    let best = "";
    let gain = 0;
    for (const [run, count] of counts)
      if (count * (run.length - 1) > gain || (count * (run.length - 1) === gain && run < best)) {
        best = run;
        gain = count * (run.length - 1);
      }
    tokens.push(mark + best);
    rests = rests.map((rest) => rest.replaceAll(best, mark));
  }
  return { rests, tokens };
}

/**
 * The Bloom filter of the left-out nouns, and the listed nouns whose "!noun" (no plural) mark
 * the filter claims falsely: dictionary nouns then read exactly.
 */
function nounBloom(words: string[]): { filter: string; pluralExceptions: string[] } {
  const filter = bloom(words, BLOOM_BITS_PER_WORD);
  const keys = new Set(words);
  const pluralExceptions = words.filter(
    (word) => !word.startsWith("!") && !keys.has(`!${word}`) && bloomHas(filter, `!${word}`),
  );
  return { filter, pluralExceptions };
}

function render(
  entries: [string, string][],
  suffixes: Rule[],
  prefixes: Rule[],
  omitted: string[],
): string {
  const counts = new Map<string, number>();
  for (const [, flags] of entries) counts.set(flags, (counts.get(flags) ?? 0) + 1);
  const table = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([f]) => f);
  const escapes = Math.ceil(Math.max(0, table.length - CODE.length) / (CODE.length - 1));
  const single = CODE.length - escapes;
  const code = (i: number) =>
    i < single
      ? CODE[i]
      : CODE[single + Math.floor((i - single) / CODE.length)] + CODE[(i - single) % CODE.length];
  const index = new Map(table.map((flags, i) => [flags, code(i)]));
  const shared: number[] = [];
  let previous = "";
  for (const [word] of entries) {
    let n = 0;
    while (n < 9 && previous[n] === word[n]) n++;
    shared.push(Math.min(n, word.length - 1));
    previous = word;
  }
  const { rests, tokens } = tokenize(entries.map(([word], i) => word.slice(shared[i])));
  const words = rests.map((rest, i) => shared[i] + rest).join("");
  const flags = entries.map(([, wordFlags]) => index.get(wordFlags)).join("");
  const nouns = nounBloom(omitted);
  const rules = (list: Rule[]) =>
    list
      .filter((r) => r.flag !== "M")
      .map((r) => [r.flag, r.strip, r.add, r.pattern].join(" "))
      .join(";");
  // Prettier's layout, so the committed file passes format:check as written.
  const line = (name: string, value: string | number) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-english-lexicon.ts from en_US.dic/.aff. Do not edit.",
    line("SUFFIX_RULES", rules(suffixes)),
    line("PREFIX_RULES", rules(prefixes)),
    line("TOKENS", tokens.join(" ")),
    line("FLAG_TABLE", table.join(" ")),
    line("FLAG_CODES", CODE),
    line("FLAG_SINGLE", single),
    line("WORDS", words),
    line("WORD_FLAGS", flags),
    line("NOUN_BLOOM", nouns.filter),
    line("NOUN_PLURAL_EXCEPTIONS", nouns.pluralExceptions.join(" ")),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [dic, aff] = await Promise.all([
    readFile(LEXICON_SOURCES.dic, "utf8"),
    readFile(LEXICON_SOURCES.aff, "utf8"),
  ]);
  const source = buildEnglishLexicon(dic, aff);
  await writeFile(LEXICON_SOURCES.out, source);
  console.log(`wrote ${LEXICON_SOURCES.out} (${source.length} bytes)`);
}
