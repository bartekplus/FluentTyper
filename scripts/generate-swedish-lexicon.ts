// Derives Swedish noun genders and adjective -t forms for Review's en/ett agreement check from
// the Hunspell dictionary the extension ships (sv_SE.dic/.aff).
// Writes src/core/domain/grammar/review/swedish/lexicon.generated.ts.
// Usage: bun run generate:swedish-lexicon
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { predict, predictGender, T_FORMS } from "../src/core/domain/grammar/review/swedish/lexicon";
import { encodeWordGraph } from "../src/core/domain/grammar/review/wordGraph";
import { applyAffix, parseAffixRules, rulesByFlag } from "./lexiconTools";

const root = resolve(import.meta.dir, "..");
export const SWEDISH_LEXICON_SOURCES = {
  dic: resolve(root, "resources_js/sv_SE/hunspell/sv_SE.dic"),
  aff: resolve(root, "resources_js/sv_SE/hunspell/sv_SE.aff"),
  out: resolve(root, "src/core/domain/grammar/review/swedish/lexicon.generated.ts"),
};

// sv_SE.aff suffix classes: B, C spell a neuter definite form (-et, -t: huset, äpplet);
// D, E a common-gender one (-en, -n: kvällen, myran), though D also spells the plural
// definite of a neuter (husen); G spells -ar/-or plurals, which neuters never take.
// Words that also inflect as adjectives or verbs (O, P, K, N) are not read as nouns.
const NEUTER_FLAGS = /[BC]/;
const COMMON_PLURALS = /G/;
const NOT_NOUN_FLAGS = /[OPKN]/;
// Rare long words the compound rule cannot reach are left unknown, which only costs recall.
const MAX_UNPREDICTED = 8;
const VOWEL = "[aeiouyåäöé]";

/** "mörk" -> "mörka", "öppen" -> "öppna", "enkel" -> "enkla". */
const inflected = (word: string) =>
  /[^aeiouyåäö]e[nlr]$/.test(word) ? word.slice(0, -2) + word.at(-1) + "a" : word + "a";
/** Common adjectives whose comparative changes the stem ("större", "bättre"). */
const IRREGULAR_COMPARISON = new Set(
  "stor liten gammal god dålig lång ung hög låg tung trång grov få nära".split(" "),
);
// Adverbs and invariable words Hunspell gives noun flags.
const NOT_NOUNS = new Set("bra fel rätt slut kul synd nog fri gratis extra".split(" "));

/**
 * Whether `word` inflects as an adjective: a regular comparison ("mörkare",
 * "mörkast"), or an -ad participle with its plural ("förvånad", "förvånade").
 * A verb's own forms ("laga", "lagt"; "bord" beside "borde") are not enough,
 * so other participles ("byggd") stay unknown.
 */
function isAdjective(word: string, known: ReadonlySet<string>): boolean {
  if (word.endsWith("ad") && known.has(word + "e")) return true;
  const plural = inflected(word);
  // "-are" alone is also an agent noun ("byggare"): the superlative confirms it.
  const stem = plural.slice(0, -1);
  return (
    known.has(plural) &&
    (IRREGULAR_COMPARISON.has(word) || (known.has(stem + "are") && known.has(stem + "ast")))
  );
}

/** Which T_FORMS entry spells `word`'s -t form, among the forms the dictionary knows. */
function tFormCode(word: string, known: ReadonlySet<string>): number | undefined {
  if (!isAdjective(word, known)) return;
  const order = new RegExp(`${VOWEL}t$`).test(word)
    ? [0, 6]
    : word.endsWith("t")
      ? [6]
      : word.endsWith("dd")
        ? [5]
        : new RegExp(`${VOWEL}$`).test(word)
          ? [3]
          : word.endsWith("d")
            ? [2, 1]
            : /[^aeiouyåäö]en$|nn$/.test(word)
              ? [4]
              : [0];
  for (const code of order) {
    const [strip, add] = T_FORMS[code];
    if (!add || known.has(word.slice(0, word.length - strip.length) + add)) return code;
  }
}

/** Keeps the entries the compound rule does not already predict, shortest first. */
function compress<T>(
  entries: ReadonlyMap<string, T>,
  guess: (kept: ReadonlyMap<string, T>, word: string) => T | undefined,
): Map<string, T> {
  const kept = new Map<string, T>();
  for (const word of [...entries.keys()].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))) {
    const value = entries.get(word)!;
    const predicted = guess(kept, word);
    if (predicted === value) continue;
    if (predicted === undefined && word.length > MAX_UNPREDICTED) continue;
    kept.set(word, value);
  }
  return kept;
}

export function buildSwedishLexicon(dic: string, aff: string): string {
  const suffixes = rulesByFlag(parseAffixRules(aff).filter((rule) => rule.kind === "SFX"));
  const entries: Array<[string, string]> = [];
  for (const line of dic.split(/\r?\n/).slice(1)) {
    const [word, flags = ""] = line.trim().split("/");
    if (/^[a-zåäöé]+$/.test(word)) entries.push([word, flags.replace(/^>/, "")]);
  }
  const known = new Set<string>();
  for (const [word, flags] of entries) {
    known.add(word);
    for (const flag of flags)
      for (const rule of suffixes.get(flag) ?? []) {
        const form = applyAffix(word, rule);
        if (form !== null) known.add(form);
      }
  }

  const adjectives = new Map<string, number>();
  for (const word of known) {
    const code = word.length > 1 ? tFormCode(word, known) : undefined;
    if (code !== undefined) adjectives.set(word, code);
  }
  const adjectiveForms = new Set(adjectives.keys());
  for (const [word, code] of adjectives) {
    const [strip, add] = T_FORMS[code];
    adjectiveForms.add(word.slice(0, word.length - strip.length) + add);
  }

  const genders = new Map<string, "en" | "ett">();
  const seen = new Map<string, Set<string>>();
  for (const [word, flags] of entries) {
    const set = seen.get(word) ?? new Set<string>();
    for (const flag of flags) set.add(flag);
    seen.set(word, set);
  }
  for (const [word, flagSet] of seen) {
    const flags = [...flagSet].join("");
    if (NOT_NOUN_FLAGS.test(flags) || adjectiveForms.has(word) || NOT_NOUNS.has(word)) continue;
    if (word.length < 2) continue;
    // B on a word in -a spells a verb's -ande noun; D and E there spell participles.
    const neuter = /[C]/.test(flags) || (flags.includes("B") && !word.endsWith("a"));
    // D on a word in -a spells a verb's -nde form; E there is the noun's -n ("stugan").
    const common =
      (flags.includes("D") && !word.endsWith("a")) || (flags.includes("E") && !word.endsWith("um"));
    if (neuter && !COMMON_PLURALS.test(flags)) genders.set(word, "ett");
    else if (common && !NEUTER_FLAGS.test(flags)) genders.set(word, "en");
  }

  const nouns = compress(genders, predictGender);
  const adjectivesKept = compress(adjectives, predict);
  const pick = <T>(map: Map<string, T>, value: T) =>
    [...map].filter(([, v]) => v === value).map(([word]) => word);
  const quote = (text: string) => JSON.stringify(text);
  return [
    "// Generated by bun scripts/generate-swedish-lexicon.ts from sv_SE.dic/.aff. Do not edit.",
    `export const NEUTER =\n  ${quote(encodeWordGraph(pick(nouns, "ett")))};`,
    `export const COMMON =\n  ${quote(encodeWordGraph(pick(nouns, "en")))};`,
    '/** Adjectives as "word|T_FORMS index" (lexicon.ts). */',
    `export const ADJECTIVES =\n  ${quote(encodeWordGraph([...adjectivesKept].map(([word, code]) => `${word}|${code}`)))};`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [dic, aff] = await Promise.all(
    [SWEDISH_LEXICON_SOURCES.dic, SWEDISH_LEXICON_SOURCES.aff].map((path) =>
      readFile(path, "utf8"),
    ),
  );
  await writeFile(SWEDISH_LEXICON_SOURCES.out, buildSwedishLexicon(dic, aff));
}
