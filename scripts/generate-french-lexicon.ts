// Derives the French verb lexicon behind Review's French checks from the Hunspell dictionary the
// extension ships (fr_FR.dic/.aff, FLAG long). Writes
// src/core/domain/grammar/review/french/frenchLexicon.generated.ts.
// Usage: bun run generate:french-lexicon
//
// The .aff spells every verb's paradigm with one suffix flag per conjugation class. Each rule's
// continuation classes say which elided words may precede the form (j' only before a first person
// singular, s' before a third person, t' but not m' before "nous", ...); with the rule order inside
// a flag (a 1st/2nd person singular rule directly followed by a third person one spells both), that
// labels every rule with the persons it can agree with, so no morphology needs to be hand-written.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BLOOM_ALPHABET,
  bloomBits,
} from "../src/core/domain/grammar/implementations/helpers/EnglishLexicon";
import {
  type Gender,
  genderable,
  suffixGender,
  verbReadings,
} from "../src/core/domain/grammar/review/french/frenchLexicon";

const root = resolve(import.meta.dir, "..");
export const FRENCH_LEXICON_SOURCES = {
  dic: resolve(root, "resources_js/fr_FR/hunspell/fr_FR.dic"),
  aff: resolve(root, "resources_js/fr_FR/hunspell/fr_FR.aff"),
  out: resolve(root, "src/core/domain/grammar/review/french/frenchLexicon.generated.ts"),
  nouns: resolve(root, "src/core/domain/grammar/review/french/frenchNouns.generated.ts"),
  gender: resolve(root, "src/core/domain/grammar/review/french/frenchGender.generated.ts"),
  trie: resolve(root, "resources_js/fr_FR/ngrams_db/ngrams.trie"),
  counts: resolve(root, "resources_js/fr_FR/ngrams_db/ngrams.counts"),
};

/** Past participle flags, given to a verb next to its conjugation flag ("aimer/a0p+", "devoir/pCpD"). */
const PARTICIPLE_FLAGS = ["p+", "p.", "q+", "q.", "pD"];

type Rule = { flag: string; strip: string; add: string; cond: string; classes: string };
type Labeled = Rule & { slot: string };

// Slot codes: a person bitmask (1 je, 2 tu, 4 il, 8 nous, 16 vous, 32 ils) as a number for finite
// forms, I infinitive, G present participle, Q past participle, M imperative.
function label(rules: Rule[]): Labeled[] {
  const groups: Rule[][] = [];
  for (const rule of rules) {
    const last = groups.at(-1);
    if (last && last[0].classes === rule.classes) last.push(rule);
    else groups.push([rule]);
  }
  const has = (rule: Rule, cls: string) => rule.classes.includes(cls);
  const slots = groups.map(([rule]): string | number => {
    if (!has(rule, "n'")) return "Q";
    if (has(rule, "d'")) return "I";
    if (!has(rule, "q'")) return "M";
    let mask = 0;
    if (has(rule, "j'")) mask |= 1;
    if (has(rule, "s'") || has(rule, "c'")) mask |= 4;
    if (!mask) {
      if (has(rule, "m'") && has(rule, "t'")) mask = 2;
      else if (has(rule, "t'")) mask = 8;
      else if (has(rule, "m'")) mask = 16;
    }
    return mask;
  });
  // A rule right after a "vous" rule is the third person plural ("vont" takes no s'); a "je" rule right before a third
  // person one also spells "tu" ("je/tu mangeais", then "il mangeait").
  const masks = slots.map((slot, i) => {
    if (typeof slot !== "number") return slot;
    let mask = slot;
    if (!(mask & 1) && slots[i - 1] === 16) mask = 32;
    const next = slots[i + 1];
    if (mask === 1 && typeof next === "number" && next & 4) mask |= 2;
    return mask;
  });
  // Infinitive and present participle share their classes: "-ant" tells them apart.
  return groups.flatMap((group, i) =>
    group.map((rule) => {
      const participle = masks[i] === "I" && rule.add !== rule.strip && /ant$/.test(rule.add);
      return { ...rule, slot: participle ? "G" : String(masks[i]) };
    }),
  );
}

function parseAff(aff: string): Map<string, Rule[]> {
  const flags = new Map<string, Rule[]>();
  for (const line of aff.split("\n")) {
    const [kind, flag, strip, addField, cond] = line.trim().split(/\s+/);
    if (kind !== "SFX" || cond === undefined) continue;
    const [add, classes = ""] = addField.split("/");
    const list = flags.get(flag) ?? [];
    list.push({
      flag,
      strip: strip === "0" ? "" : strip,
      add: add === "0" ? "" : add,
      cond: cond === "." ? "" : cond,
      classes,
    });
    flags.set(flag, list);
  }
  return flags;
}

/** Sorted words, each as the count of leading characters it shares with the previous one (one
 * base-36 digit) and the rest. */
function frontCode(words: string[]): string {
  let previous = "";
  return words
    .sort()
    .map((word) => {
      let shared = 0;
      while (shared < 35 && shared < word.length && word[shared] === previous[shared]) shared++;
      previous = word;
      return shared.toString(36) + word.slice(shared);
    })
    .join(" ");
}

const flagList = (flags: string) => flags.match(/../g) ?? [];

/** The forms one suffix rule spells from a stem, if its condition holds. */
function apply(stem: string, rule: Rule): string | null {
  if (!new RegExp(`${rule.cond}$`).test(stem) || !stem.endsWith(rule.strip)) return null;
  return stem.slice(0, stem.length - rule.strip.length) + rule.add;
}

export function buildFrenchLexicon(dic: string, aff: string): string {
  const flags = parseAff(aff);
  // A conjugation flag spells finite forms (n' before them, as in "il n'aime"); participle
  // flags only Q forms.
  const verbFlags = new Set(
    [...flags]
      .filter(([, rules]) => rules.some((r) => r.classes.includes("n'")))
      .map(([flag]) => flag),
  );
  for (const flag of PARTICIPLE_FLAGS) verbFlags.add(flag);
  const labeled = new Map([...verbFlags].map((flag) => [flag, label(flags.get(flag)!)]));

  const verbs = new Map<string, string>();
  const verbForms = new Set<string>();
  const otherForms = new Set<string>();
  for (const line of dic.split("\n").slice(1)) {
    const [word, rawFlags = ""] = line.trim().split("/");
    if (!word) continue;
    const all = flagList(rawFlags.split(/\s/)[0]);
    const own = all.filter((flag) => verbFlags.has(flag));
    if (own.some((flag) => !PARTICIPLE_FLAGS.includes(flag))) {
      verbs.set(
        word,
        [...new Set([...((verbs.get(word) ?? "").match(/../g) ?? []), ...own])].join(""),
      );
      for (const flag of own)
        for (const rule of labeled.get(flag)!) {
          const form = apply(word, rule);
          if (form) verbForms.add(form);
        }
      continue;
    }
    // Everything else is a non-verb entry: its own spelling (unless it needs an affix) and its
    // inflections.
    if (!all.includes("()")) otherForms.add(word);
    for (const flag of all)
      for (const rule of flags.get(flag) ?? []) {
        const form = apply(word, rule);
        if (form) otherForms.add(form);
      }
  }

  // Rules by flag: an "@flag strip condition" line with the flag's most common pair, then "add slot"
  // per rule, followed by the rule's own strip (and condition, unless it is the strip) when they
  // differ. Imperatives have no subject to agree with: left out.
  const ruleText = [...labeled]
    .map(([flag, all]) => {
      const rules = all.filter((r) => r.slot !== "M");
      const pairs = rules.map((r) => `${r.strip} ${r.cond}`);
      const common = pairs.sort(
        (a, b) => pairs.filter((p) => p === b).length - pairs.filter((p) => p === a).length,
      )[0];
      return [
        `@${flag} ${common}`,
        ...rules.map((r) => {
          const own = `${r.strip} ${r.cond}` === common ? [] : [r.strip];
          if (own.length && r.cond !== r.strip) own.push(r.cond);
          return [r.add, r.slot, ...own].join(" ");
        }),
      ].join("\n");
    })
    .join("\n");
  // Lemmas grouped by their verb flags; a group's common ending is written once after its flags
  // ("a0p+ er" and then the stems).
  const byFlags = new Map<string, string[]>();
  for (const [lemma, own] of verbs) byFlags.set(own, [...(byFlags.get(own) ?? []), lemma]);
  const lemmaText = [...byFlags]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([own, lemmas]) => {
      let ending = lemmas[0];
      for (const lemma of lemmas) while (!lemma.endsWith(ending)) ending = ending.slice(1);
      const stems = lemmas.map((lemma) => lemma.slice(0, lemma.length - ending.length));
      return `${own} ${ending} ${frontCode(stems)}`;
    })
    .join("\n");
  const homographs = frontCode([...verbForms].filter((form) => otherForms.has(form)));
  return [
    "// Generated by bun scripts/generate-french-lexicon.ts from fr_FR.dic/.aff. Do not edit.",
    `export const VERB_RULES =\n  ${JSON.stringify(ruleText)};`,
    `export const VERB_LEMMAS =\n  ${JSON.stringify(lemmaText)};`,
    "/** Verb forms that are also spelled by a non-verb entry (nouns, adjectives, ...). */",
    `export const VERB_HOMOGRAPHS =\n  ${JSON.stringify(homographs)};`,
    "",
  ].join("\n");
}

// 10 bits per key keeps the filter's false positives near 1%.
const BLOOM_BITS_PER_WORD = 10;

/**
 * The nouns and adjectives the dictionary inflects (a lowercase entry with a suffix flag and no
 * conjugation) and every entry ending in s, x or z, as a Bloom filter: six bits per character of BLOOM_ALPHABET, lowest bit first.
 */
export function buildFrenchNouns(dic: string, aff: string): string {
  const flags = parseAff(aff);
  const verbal = new Set(
    [...flags].filter(([, rules]) => rules.some((r) => r.classes.includes("n'"))).map(([f]) => f),
  );
  for (const flag of PARTICIPLE_FLAGS) verbal.add(flag);
  const words = new Set<string>();
  for (const line of dic.split("\n").slice(1)) {
    const [word, rawFlags = ""] = line.trim().split("/");
    if (!word || !/^\p{Ll}/u.test(word)) continue;
    const all = flagList(rawFlags.split(/\s/)[0]);
    if (all.some((flag) => verbal.has(flag))) continue;
    // Words ending in s, x or z are listed whatever their flags: "fils", "temps", "très" are
    // no plurals of "fil" or "temp".
    if (!all.some((flag) => flags.has(flag)) && !/[sxz]$/.test(word)) continue;
    words.add(word);
  }
  const size = Math.ceil((words.size * BLOOM_BITS_PER_WORD) / 6) * 6;
  const bits = new Uint8Array(size);
  for (const word of words) for (const bit of bloomBits(word, size)) bits[bit] = 1;
  let filter = "";
  for (let i = 0; i < size; i += 6) {
    let value = 0;
    for (let b = 0; b < 6; b++) value |= bits[i + b] << b;
    filter += BLOOM_ALPHABET[value];
  }
  return [
    "// Generated by bun scripts/generate-french-lexicon.ts from fr_FR.dic/.aff. Do not edit.",
    "/** Bloom filter of the nouns and adjectives fr_FR.dic inflects (singular entries). */",
    `export const NOUN_BLOOM =\n  ${JSON.stringify(filter)};`,
    "",
  ].join("\n");
}

const MASCULINE_DETERMINERS = ["un", "le", "ce", "cet", "du", "au"];
const FEMININE_DETERMINERS = ["une", "la", "cette", "ma", "ta", "sa"];
// "le"/"la" are also object pronouns before a verb: they count only for words no verb spells.
const PRONOUN_DETERMINERS = new Set(["le", "la"]);

/**
 * "det word count" lines for every determiner + word bigram of the n-gram database the extension
 * ships (resources_js/fr_FR/ngrams_db), read with the marisa-trie Python package the n-gram
 * scripts already use (scripts/requirements.txt). Null when Python or the package is missing.
 */
export function readDeterminerBigrams(): string | null {
  const program = [
    "import sys, marisa_trie, numpy",
    "t = marisa_trie.Trie(); t.load(sys.argv[1])",
    "c = numpy.fromfile(sys.argv[2], dtype=numpy.int32)",
    "d = set(sys.argv[3].split())",
    "rows = sorted(f'{k[2:]} {c[i + 1]}' for k, i in t.items('2 ') if k.split()[1] in d)",
    "print('\\n'.join(rows))",
  ].join("\n");
  try {
    const run = Bun.spawnSync([
      "python3",
      "-c",
      program,
      FRENCH_LEXICON_SOURCES.trie,
      FRENCH_LEXICON_SOURCES.counts,
      [...MASCULINE_DETERMINERS, ...FEMININE_DETERMINERS].join(" "),
    ]);
    return run.exitCode === 0 ? run.stdout.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Noun genders the n-gram counts show: a lowercase entry that inflects for number only (a
 * gender-inflecting adjective or noun, "grand/F.", is left to its forms), seen at least three times
 * after singular determiners with nine in ten of one gender. Words the suffix rules in
 * frenchLexicon.ts already gender right, and words of either gender, are left out.
 */
export function buildFrenchGender(dic: string, aff: string, bigrams: string): string {
  const flags = parseAff(aff);
  const numberOnly = new Set<string>();
  const gendered = new Set<string>();
  for (const line of dic.split("\n").slice(1)) {
    const [word, rawFlags = ""] = line.trim().split("/");
    if (!word || !/^\p{Ll}+$/u.test(word)) continue;
    const all = flagList(rawFlags.split(/\s/)[0]).filter((flag) => flags.has(flag));
    if (!all.length) continue;
    const forms = new Set(all.flatMap((flag) => flags.get(flag)!.map((r) => apply(word, r))));
    forms.delete(null);
    if ([...forms].every((form) => form === word || form === `${word}s` || form!.endsWith("x")))
      numberOnly.add(word);
    else gendered.add(word);
  }
  for (const word of gendered) numberOnly.delete(word);
  const counts = new Map<string, [number, number]>();
  for (const line of bigrams.split("\n")) {
    const [det, word, count] = line.split(" ");
    if (!numberOnly.has(word)) continue;
    if (PRONOUN_DETERMINERS.has(det) && verbReadings(word).length) continue;
    const pair = counts.get(word) ?? [0, 0];
    pair[FEMININE_DETERMINERS.includes(det) ? 1 : 0] += Number(count);
    counts.set(word, pair);
  }
  const lists: Record<Gender, string[]> = { m: [], f: [] };
  for (const [word, [m, f]] of counts) {
    if (!genderable(word)) continue;
    const gender: Gender | null = m >= 3 && f * 10 <= m ? "m" : f >= 3 && m * 10 <= f ? "f" : null;
    if (gender && suffixGender(word) !== gender) lists[gender].push(word);
  }
  return [
    "// Generated by bun scripts/generate-french-lexicon.ts from fr_FR.dic/.aff and the fr_FR",
    "// n-gram database. Do not edit.",
    "/** Nouns the determiner counts show masculine or feminine, past what suffixes tell. */",
    `export const MASCULINE =\n  ${JSON.stringify(frontCode(lists.m))};`,
    `export const FEMININE =\n  ${JSON.stringify(frontCode(lists.f))};`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [dic, aff] = await Promise.all(
    [FRENCH_LEXICON_SOURCES.dic, FRENCH_LEXICON_SOURCES.aff].map((path) => readFile(path, "utf8")),
  );
  const bigrams = readDeterminerBigrams();
  if (bigrams === null) throw new Error("python3 with marisa-trie and numpy is required");
  for (const [path, out] of [
    [FRENCH_LEXICON_SOURCES.out, buildFrenchLexicon(dic, aff)],
    [FRENCH_LEXICON_SOURCES.nouns, buildFrenchNouns(dic, aff)],
    [FRENCH_LEXICON_SOURCES.gender, buildFrenchGender(dic, aff, bigrams)],
  ]) {
    await writeFile(path, out);
    console.log(`${path}: ${(out.length / 1024).toFixed(1)} KB`);
  }
}
