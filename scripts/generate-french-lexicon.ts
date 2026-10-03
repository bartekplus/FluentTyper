// Derives the French verb lexicon behind Review's French checks from the Hunspell dictionary the
// extension ships (fr_FR.dic/.aff, FLAG long). Writes
// src/core/domain/grammar/review/french/frenchLexicon.generated.ts.
// Usage: bun run generate:lexicons french
//
// The .aff spells every verb's paradigm with one suffix flag per conjugation class. Each rule's
// continuation classes say which elided words may precede the form (j' only before a first person
// singular, s' before a third person, t' but not m' before "nous", ...); with the rule order inside
// a flag (a 1st/2nd person singular rule directly followed by a third person one spells both), that
// labels every rule with the persons it can agree with, so no morphology needs to be hand-written.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type Gender,
  authoredGenderable,
  endingGender,
  verbReadings,
} from "../src/core/domain/grammar/review/french/frenchLexicon";
import { encodeWordGraph } from "../src/core/domain/grammar/review/wordGraph";
import {
  type AffixRule,
  applyAffix,
  frontCode,
  ngramRows,
  parseAffixRules,
  rulesByFlag,
} from "./lexiconTools";

const root = resolve(import.meta.dir, "..");
export const FRENCH_LEXICON_SOURCES = {
  dic: resolve(root, "resources_js/fr_FR/hunspell/fr_FR.dic"),
  aff: resolve(root, "resources_js/fr_FR/hunspell/fr_FR.aff"),
  out: resolve(root, "src/core/domain/grammar/review/french/frenchLexicon.generated.ts"),
  nouns: resolve(root, "src/core/domain/grammar/review/french/frenchNouns.generated.ts"),
  gender: resolve(root, "src/core/domain/grammar/review/french/frenchGender.generated.ts"),
  adjectives: resolve(root, "src/core/domain/grammar/review/french/frenchAdjectives.generated.ts"),
  compounds: resolve(root, "src/core/domain/grammar/review/french/frenchCompounds.generated.ts"),
  trie: resolve(root, "resources_js/fr_FR/ngrams_db/ngrams.trie"),
  counts: resolve(root, "resources_js/fr_FR/ngrams_db/ngrams.counts"),
};

/** Past participle flags, given to a verb next to its conjugation flag ("aimer/a0p+", "devoir/pCpD"). */
const PARTICIPLE_FLAGS = ["p+", "p.", "q+", "q.", "pD"];

type Rule = AffixRule;
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

/** The suffix rules by flag (the prefix rules spell no form the checks read). */
const parseAff = (aff: string) =>
  rulesByFlag(parseAffixRules(aff).filter((rule) => rule.kind === "SFX"));

const flagList = (flags: string) => flags.match(/../g) ?? [];

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
          const form = applyAffix(word, rule);
          if (form) verbForms.add(form);
        }
      continue;
    }
    // Everything else is a non-verb entry: its own spelling (unless it needs an affix) and its
    // inflections.
    if (!all.includes("()")) otherForms.add(word);
    for (const flag of all)
      for (const rule of flags.get(flag) ?? []) {
        const form = applyAffix(word, rule);
        if (form) otherForms.add(form);
      }
  }

  // Rules by flag: an "@flag strip condition" line with the flag's most common pair, then "add slot"
  // per rule, followed by the rule's own strip (and condition, unless it is the strip) when they
  // differ. Imperatives have no subject to agree with: left out.
  const ruleText = [...labeled]
    .map(([flag, all]) => {
      const rules = all.filter((r) => r.slot !== "M");
      const pairs = rules.map((r) => `${r.strip} ${r.pattern}`);
      const common = pairs.sort(
        (a, b) => pairs.filter((p) => p === b).length - pairs.filter((p) => p === a).length,
      )[0];
      return [
        `@${flag} ${common}`,
        ...rules.map((r) => {
          const own = `${r.strip} ${r.pattern}` === common ? [] : [r.strip];
          if (own.length && r.pattern !== r.strip) own.push(r.pattern);
          return [r.add, r.slot, ...own].join(" ");
        }),
      ].join("\n");
    })
    .join("\n");
  // Lemmas with their verb flags: "aimer|a0p+".
  const lemmaText = encodeWordGraph([...verbs].map(([lemma, own]) => `${lemma}|${own}`));
  const homographs = encodeWordGraph([...verbForms].filter((form) => otherForms.has(form)));
  return [
    "// Generated by bun scripts/generate-french-lexicon.ts from fr_FR.dic/.aff. Do not edit.",
    `export const VERB_RULES =\n  ${JSON.stringify(ruleText)};`,
    `export const VERB_LEMMAS =\n  ${JSON.stringify(lemmaText)};`,
    "/** Verb forms that are also spelled by a non-verb entry (nouns, adjectives, ...). */",
    `export const VERB_HOMOGRAPHS =\n  ${JSON.stringify(homographs)};`,
    "",
  ].join("\n");
}

const adjectiveSlot = (rule: Rule) =>
  `${/[eë]s?$/.test(rule.add) ? "f" : "m"}${rule.classes.includes("L'") ? "s" : "p"}`;

/** Flags that inflect for gender: verb flags (conjugations and participles, "aimer/a0p+") and
 * foreign plurals ("-a", "-i") have no feminine singular and are left out. */
function genderedFlags(flags: Map<string, Rule[]>): Map<string, Rule[]> {
  return new Map(
    [...flags].filter(
      ([flag, rules]) =>
        !PARTICIPLE_FLAGS.includes(flag) &&
        !rules.some((r) => r.classes.includes("n'")) &&
        rules.some((r) => adjectiveSlot(r) === "fs") &&
        rules.some((r) => adjectiveSlot(r) === "ms"),
    ),
  );
}

// Invariable function words in s, x or z (prepositions, adverbs, conjunctions, determiners,
// and pronouns) that the dictionary lists bare or with elision flags only. They are no
// nouns: "dans", "depuis", "les" must not read as one. Words that are also nouns ("pas", "plus",
// "vers", "envers", "dessous") stay.
const CLOSED_CLASS = new Set(
  (
    "dans depuis désormais dès lès lez chez sans sous très après auprès près exprès assez aux " +
    "auxquels auxquelles auxdits auxdites jamais toujours parfois quelquefois autrefois longtemps " +
    "alors puis lors mais tandis jadis néanmoins toutefois ailleurs volontiers certes hors dehors " +
    "dedans hormis céans endéans ès jusques oncques onques adoncques ores souventefois mieux " +
    "moult guère les des ces mes tes ses nos vos leurs leur lesquels lesquelles desquels " +
    "desquelles lesdits lesdites desdits desdites tous toutes plusieurs divers diverses nous vous " +
    "eux ceux elles iceux icelles hélas ouais mouais oups patatras tss kss zzzz"
  ).split(" "),
);

/**
 * The nouns and adjectives the dictionary inflects (a lowercase entry with a suffix flag and no
 * conjugation) and every entry ending in s, x or z: "fils", "temps", "très" are no plurals of
 * "fil" or "temp". Gender-inflecting entries are left out: adjectiveEntries lists them.
 */
function nounEntries(dic: string, flags: Map<string, Rule[]>): Set<string> {
  const verbal = new Set(
    [...flags].filter(([, rules]) => rules.some((r) => r.classes.includes("n'"))).map(([f]) => f),
  );
  for (const flag of PARTICIPLE_FLAGS) verbal.add(flag);
  const gendered = genderedFlags(flags);
  const words = new Set<string>();
  for (const line of dic.split("\n").slice(1)) {
    const [word, rawFlags = ""] = line.trim().split("/");
    if (!word || !/^\p{Ll}/u.test(word) || CLOSED_CLASS.has(word)) continue;
    const all = flagList(rawFlags.split(/\s/)[0]);
    if (all.some((flag) => verbal.has(flag))) continue;
    if (!all.some((flag) => flags.has(flag)) && !/[sxz]$/.test(word)) continue;
    if (!/^\p{Ll}+$/u.test(word) || !all.some((flag) => gendered.has(flag))) words.add(word);
  }
  return words;
}

/** Lowercase entries with gender-inflecting flags ("grand/F.", "acteur/Fc") and those flags. */
function adjectiveEntries(dic: string, flags: Map<string, Rule[]>): Map<string, string> {
  const gendered = genderedFlags(flags);
  const out = new Map<string, string>();
  for (const line of dic.split("\n").slice(1)) {
    const [word, rawFlags = ""] = line.trim().split("/");
    if (!word || !/^\p{Ll}+$/u.test(word)) continue;
    const own = flagList(rawFlags.split(/\s/)[0]).filter((flag) => gendered.has(flag));
    if (own.length) out.set(word, own.join(""));
  }
  return out;
}

/**
 * The noun entries, and the gender-inflecting ones as "lemma|flags" ("grand|F."), as an exact
 * word graph. Function words in s or x whose stem is an entry ("dans", "dan") are listed apart:
 * they are no plurals.
 */
export function buildFrenchNouns(dic: string, aff: string): string {
  const flags = parseAff(aff);
  const words = nounEntries(dic, flags);
  const adjectives = adjectiveEntries(dic, flags);
  const known = (word: string) => words.has(word) || adjectives.has(word);
  const notPlurals = [...CLOSED_CLASS].filter((word) => {
    const singular = word.replace(/aux$/, "al").replace(/[sx]$/, "");
    return singular !== word && (known(singular) || known(word.slice(0, -1)));
  });
  const entries = [...words, ...[...adjectives].map(([word, own]) => `${word}|${own}`)];
  return [
    "// Generated by bun scripts/generate-french-lexicon.ts from fr_FR.dic/.aff. Do not edit.",
    '/** Noun entries, and gender-inflecting entries as "lemma|flags", as a word graph. */',
    `export const NOUN_GRAPH =\n  ${JSON.stringify(encodeWordGraph(entries))};`,
    '/** Function words in s or x whose stem is an entry ("dans", "dan"): no plurals. */',
    `export const NOT_PLURALS = ${JSON.stringify(frontCode(notPlurals.sort(), 36, " "))};`,
    "",
  ].join("\n");
}

// Words before a singular noun that show its gender: determiners and the adjectives that most
// often go before the noun.
const MASCULINE_CUES = (
  "un le ce cet du au mon ton son quel aucun nouveau nouvel premier dernier petit grand bon beau " +
  "bel vieil seul gros long joli certain"
).split(" ");
const FEMININE_CUES = (
  "une la cette ma ta sa quelle aucune nouvelle première dernière petite grande bonne belle " +
  "vieille seule grosse longue jolie certaine"
).split(" ");
// "le"/"la" are also object pronouns before a verb: they count only for words no verb spells, or
// after a preposition ("de la porte"). "mon amie": the masculine possessive before a vowel is no
// cue.
const PRONOUN_DETERMINERS = new Set(["le", "la"]);
const VOWEL_POSSESSIVES = new Set(["mon", "ton", "son"]);
const CUE_PREPOSITIONS =
  "de à dans sur pour par avec sans sous vers entre contre chez selon après avant depuis pendant".split(
    " ",
  );

/**
 * "cue word count" lines for every bigram of the n-gram database the extension ships
 * (resources_js/fr_FR/ngrams_db) that starts with a gender cue, and "preposition le|la word
 * count" lines for the trigrams.
 */
export function readGenderNgrams(): string {
  const cues = new Set([...MASCULINE_CUES, ...FEMININE_CUES]);
  const prepositions = new Set(CUE_PREPOSITIONS);
  return ngramRows(FRENCH_LEXICON_SOURCES.trie, FRENCH_LEXICON_SOURCES.counts, (key) => {
    const [order, first, second] = key.split(" ");
    if (order === "2") return cues.has(first!);
    return order === "3" && prepositions.has(first!) && (second === "le" || second === "la");
  });
}

/**
 * Noun genders the n-gram counts show: a lowercase entry that inflects for number only (a
 * gender-inflecting adjective or noun, "grand/F.", is left to its forms), or an invariable one in
 * s, x or z ("voix"), seen at least three times after gender cues with nine in ten of one gender.
 * Words the endings in frenchLexicon.ts already gender right, and the words it lists as of either
 * gender or of none, are left out.
 */
export function buildFrenchGender(dic: string, aff: string, ngrams: string): string {
  const flags = parseAff(aff);
  const numberOnly = new Set<string>();
  const gendered = new Set<string>();
  for (const line of dic.split("\n").slice(1)) {
    const [word, rawFlags = ""] = line.trim().split("/");
    if (!word || !/^\p{Ll}+$/u.test(word)) continue;
    const all = flagList(rawFlags.split(/\s/)[0]).filter((flag) => flags.has(flag));
    if (!all.length) {
      if (/[sxz]$/.test(word) && !CLOSED_CLASS.has(word)) numberOnly.add(word);
      continue;
    }
    const forms = new Set(all.flatMap((flag) => flags.get(flag)!.map((r) => applyAffix(word, r))));
    forms.delete(null);
    if ([...forms].every((form) => form === word || form === `${word}s` || form!.endsWith("x")))
      numberOnly.add(word);
    else gendered.add(word);
  }
  for (const word of gendered) numberOnly.delete(word);
  const counts = new Map<string, [number, number]>();
  const finite = (word: string) => verbReadings(word).some((r) => typeof r.slot === "number");
  for (const line of ngrams.split("\n")) {
    const parts = line.split(" ");
    const count = Number(parts.pop());
    const word = parts.at(-1)!;
    const cue = parts.at(-2)!;
    if (!numberOnly.has(word)) continue;
    if (parts.length === 2) {
      if (PRONOUN_DETERMINERS.has(cue) && finite(word)) continue;
      if (VOWEL_POSSESSIVES.has(cue) && /^[aeiouyâàéèêëîïôûœh]/.test(word)) continue;
    }
    const pair = counts.get(word) ?? [0, 0];
    pair[FEMININE_CUES.includes(cue) ? 1 : 0] += count;
    counts.set(word, pair);
  }
  const lists: Record<Gender, string[]> = { m: [], f: [] };
  for (const [word, [m, f]] of counts) {
    if (!authoredGenderable(word)) continue;
    const gender: Gender | null = m >= 3 && f * 10 <= m ? "m" : f >= 3 && m * 10 <= f ? "f" : null;
    if (gender && endingGender(word) !== gender) lists[gender].push(word);
  }
  return [
    "// Generated by bun scripts/generate-french-lexicon.ts from fr_FR.dic/.aff and the fr_FR",
    "// n-gram database. Do not edit.",
    "/** Nouns the gender cue counts show masculine or feminine, past what endings tell. */",
    `export const MASCULINE =\n  ${JSON.stringify(encodeWordGraph(lists.m))};`,
    `export const FEMININE =\n  ${JSON.stringify(encodeWordGraph(lists.f))};`,
    "",
  ].join("\n");
}

/**
 * Adjectives and nouns that inflect for gender ("grand/F.", "beau/W.", "acteur/Fc"): each
 * gender-inflecting flag's rules labeled ms/mp/fs/fp (singular forms take an elided l', a
 * feminine adds an -e). The entries and their flags are in the noun graph (buildFrenchNouns).
 */
export function buildFrenchAdjectives(dic: string, aff: string): string {
  const flags = parseAff(aff);
  const gendered = genderedFlags(flags);
  const used = new Set([...adjectiveEntries(dic, flags).values()].flatMap(flagList));
  const ruleText = [...gendered]
    .filter(([flag]) => used.has(flag))
    .map(([flag, rules]) =>
      [
        `@${flag}`,
        ...rules.map((r) =>
          [r.add || "0", adjectiveSlot(r), r.strip || "0", r.pattern || "0"].join(" "),
        ),
      ].join("\n"),
    )
    .join("\n");
  return [
    "// Generated by bun scripts/generate-french-lexicon.ts from fr_FR.dic/.aff. Do not edit.",
    '/** Gender-inflecting suffix rules: "@flag", then "add slot strip condition" (0: empty). */',
    `export const ADJECTIVE_RULES =\n  ${JSON.stringify(ruleText)};`,
    "",
  ].join("\n");
}

// First parts that also make a free phrase ("une petite fille", "une belle maison", "à côté"),
// and second parts whose spaced spelling is the usual one ("compte rendu", "mot clé").
const FREE_FIRST = new Set(
  (
    "petit petite petits petites beau beaux bel belle belles bon bonne bons bonnes nouveau " +
    "nouvel nouvelle nouveaux nouvelles jeune jeunes vieux vieil vieille vieilles à au aux en " +
    "ci là par de un une deux trois quatre cinq six sept huit neuf dix vingt trente quarante " +
    "cinquante soixante cent mille"
  ).split(" "),
);
const FREE_SECOND = new Set("clé clés rendu rendus".split(" "));

/** Two-part lowercase compounds the dictionary hyphenates ("coffre-fort", "hors-jeu"). */
export function buildFrenchCompounds(dic: string): string {
  const compounds = new Set<string>();
  for (const line of dic.split("\n").slice(1)) {
    const word = line.trim().split("/")[0];
    const parts = word.split("-");
    if (parts.length !== 2 || !parts.every((p) => /^\p{Ll}{2,}$/u.test(p))) continue;
    if (FREE_FIRST.has(parts[0]) || FREE_SECOND.has(parts[1])) continue;
    compounds.add(word);
  }
  // Names ("Aix-en-Provence", "Jean-Marc") and longer compounds ("rez-de-chaussée"): a part may
  // carry an elided article ("tout-à-l'égout").
  const long = new Set<string>();
  for (const line of dic.split("\n").slice(1)) {
    const word = line.trim().split("/")[0];
    const parts = word.split("-");
    if (parts.length < 2 || !parts.every((p) => /^\p{L}(?:\p{L}|')*$/u.test(p))) continue;
    const proper = /^\p{Lu}\p{Ll}/u.test(word);
    if (
      proper ||
      (parts.length > 2 && /^\p{Ll}/u.test(word) && !/^\p{Ll}+-(?:vingt|et)-/u.test(word))
    )
      long.add(word);
  }
  return [
    "// Generated by bun scripts/generate-french-lexicon.ts from fr_FR.dic. Do not edit.",
    "/** Two-part compounds the dictionary hyphenates, as a word graph (review/wordGraph.ts). */",
    `export const COMPOUNDS =\n  ${JSON.stringify(encodeWordGraph(compounds))};`,
    "/** Hyphenated names and compounds of three parts or more, as a word graph. */",
    `export const LONG_COMPOUNDS =\n  ${JSON.stringify(encodeWordGraph(long))};`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [dic, aff] = await Promise.all(
    [FRENCH_LEXICON_SOURCES.dic, FRENCH_LEXICON_SOURCES.aff].map((path) => readFile(path, "utf8")),
  );
  const ngrams = readGenderNgrams();
  for (const [path, out] of [
    [FRENCH_LEXICON_SOURCES.out, buildFrenchLexicon(dic, aff)],
    [FRENCH_LEXICON_SOURCES.nouns, buildFrenchNouns(dic, aff)],
    [FRENCH_LEXICON_SOURCES.gender, buildFrenchGender(dic, aff, ngrams)],
    [FRENCH_LEXICON_SOURCES.adjectives, buildFrenchAdjectives(dic, aff)],
    [FRENCH_LEXICON_SOURCES.compounds, buildFrenchCompounds(dic)],
  ]) {
    await writeFile(path, out);
    console.log(`${path}: ${(out.length / 1024).toFixed(1)} KB`);
  }
}
