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
// About 0.3% false positives, each then listed as an exception; a verb read falsely only
// costs a finding, so its filter is looser.
const NOUN_BITS_PER_WORD = 12;
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

/**
 * Six bits per character of BLOOM_ALPHABET, lowest bit first, plus the lowercase dictionary
 * words the filter claims falsely: those then read exactly.
 */
function bloom(words: string[], bitsPerWord: number, lowercaseWords: string[] = []) {
  const size = Math.ceil((words.length * bitsPerWord) / 6) * 6;
  const bits = new Uint8Array(size);
  for (const word of words) for (const bit of bloomBits(word, size)) bits[bit] = 1;
  let filter = "";
  for (let i = 0; i < size; i += 6) {
    let value = 0;
    for (let b = 0; b < 6; b++) value |= bits[i + b] << b;
    filter += BLOOM_ALPHABET[value];
  }
  const exceptions = lowercaseWords.filter((word) =>
    bloomBits(word, size).every((bit) => bits[bit]),
  );
  return { filter, exceptions };
}

export function buildGermanLexicon(dic: string, aff: string): string {
  const { nounOnly, finite, infinitive, verbs, adjectives, lowercaseWords } = deriveGermanLexicon(
    dic,
    aff,
  );
  const nouns = bloom(nounOnly, NOUN_BITS_PER_WORD, lowercaseWords);
  // Prettier's layout, so the committed file passes format:check as written.
  const line = (name: string, value: string) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-german-lexicon.ts from de_DE.dic/.aff. Do not edit.",
    "// Lowercased noun forms with no lowercase reading (Bloom filter), the dictionary words the",
    "// filter accepts falsely, and the noun forms that are also only a finite verb form or an",
    "// infinitive when lowercase; then every infinitive and every adjective lemma (Bloom filters).",
    line("NOUN_BLOOM", nouns.filter),
    line("NOUN_BLOOM_EXCEPTIONS", nouns.exceptions.join(" ")),
    line("FINITE_NOUNS", finite.join(" ")),
    line("INFINITIVE_NOUNS", infinitive.join(" ")),
    line("VERB_BLOOM", bloom(verbs, VERB_BITS_PER_WORD).filter),
    line("ADJECTIVE_BLOOM", bloom(adjectives, ADJECTIVE_BITS_PER_WORD).filter),
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
