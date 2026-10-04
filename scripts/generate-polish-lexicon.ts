// Derives the Polish noun, adjective and finite verb forms behind Review's case, agreement and
// clause checks from the Hunspell dictionary the extension ships (pl_PL.dic/.aff), keeping the
// forms the bundled Presage n-gram model counts as common (ngrams.trie/.counts), so the tables
// stay small.
// Writes src/core/domain/grammar/review/polish/lexicon.generated.ts and words.generated.ts.
// Usage: bun run generate:lexicons polish
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import { encodeWordGraph } from "../src/core/domain/grammar/review/wordGraph";
import { type AffixRule, parseAffixRules, rulesByFlag, unigrams } from "./lexiconTools";
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
  words: resolve(root, "src/core/domain/grammar/review/polish/words.generated.ts"),
};

/* ------------------------------------------------------------- affix rules */

type Rule = AffixRule;

/** The SFX and PFX rules of the .aff, by flag. */
const parseAffixes = (aff: string) => rulesByFlag(parseAffixRules(aff));

// pl_PL.aff groups endings by paradigm, not by case, so each noun flag is read with the case
// its endings spell. These flags inflect nouns; X/x/Y/K adjectives; the rest verbs.
const NOUN_FLAGS = "NMTsUOVQnAmoqZzPSDCwRLrutWlp";
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
// A masculine noun's genitive plural is also its accusative when it names men ("studentów");
// `spell` adds that, as the flags do not tell persons apart reliably.
const GEN_PLURAL = c("Gp");

/**
 * The cases a form spelled by `flag` can carry, by its ending and (for M) by what else the
 * entry spells: `flags` are the entry's flags, `siblings` the other forms of the same flag.
 * Unknown: every case.
 */
function flagCases(
  flag: string,
  form: string,
  lemma: string,
  flags = "",
  siblings: readonly string[] = [],
): number {
  for (const [ending, mask] of PLURAL_OBLIQUE)
    if (ending.test(form) && /[NZWVrij]/.test(flag)) return mask;
  switch (flag) {
    // q spells virile plurals ("doktorzy") and others ("komentarze") alike.
    case "s":
    case "z":
    case "A":
    case "q":
      return NOM_PLURAL;
    // Virile plurals ("Rosjanie", "panowie"): the accusative is the genitive form.
    case "t":
    case "o":
    case "w":
      return c("Np Vp");
    // "miesięcy", "pieniędzy", "tygodni" (C; "dni" is also the nominative: EXTRA).
    case "T":
    case "S":
    case "l":
    case "D":
    case "m":
    case "n":
    case "C":
      return GEN_PLURAL;
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
      // "imienia", "zwierzęcia": an -ę noun's plural is spelled apart ("imiona").
      if (/a$/.test(form)) return c("Gs") | (lemma.endsWith("ę") ? 0 : NOM_PLURAL);
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
      if (/[iy]$/.test(form)) {
        if (flag !== "M") return c("Gs Ds Ls Vs") | NOM_PLURAL | c("Gp Ap");
        // The genitive singular ("osoby", "ulicy", "kości") is also each cell the entry
        // spells no other way: the dative and locative ("osobie"), the vocative ("osobo"),
        // the nominative plural ("ulice", flag A) and the genitive plural ("osób", m/n; a
        // -ja/-ia noun's "lekcji" stands beside the rare "lekcyj").
        let mask = c("Gs");
        if (!siblings.some((other) => other.endsWith("e"))) mask |= c("Ds Ls");
        if (!siblings.some((other) => /[ou]$/.test(other))) mask |= c("Vs");
        if (!flags.includes("A") || /[qoT]/.test(flags)) mask |= NOM_PLURAL;
        if (!/[mnT]/.test(flags) || /(?:[^aeiouy]j|i)a$/.test(lemma)) mask |= GEN_PLURAL;
        return mask;
      }
      if (/e$/.test(form)) return c("Ds Ls");
      return c("Gs Ds Ls Vs");
    default:
      return ALL_CASES;
  }
}

/** The cases and gender of a noun lemma's own form, or 0 when it is not read as a noun. */
function lemmaTags(word: string, flags: string): number {
  const consonant = /[^aeiouyąęó]$/.test(word);
  if (/[OQPRu]/.test(flags) || (consonant && /[NTsSZzDC]/.test(flags) && !/M/.test(flags)))
    return c("Ns As") | MASCULINE | (/[owt]/.test(flags) ? VIRILE : 0);
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
// abbreviations written without their dot, and "zamian", "przemian" read as the adverbs "w
// zamian", "na przemian".
const NOT_NOUNS = (
  "jak bez niż tam ktoś coś kilka tysiąc lada sam warta gratis zbyt prawo lewo brutto netto " +
  "poza koło dzięki ul nr art akt pkt ust lit zamian przemian"
).split(" ");
/** Irregular plurals the paradigm flags do not spell. */
const EXTRA: Record<string, string> = {
  ręce: "Np Ap Vp",
  razy: "Gp",
  procent: "Gp",
  dni: "Np Ap Vp",
};
/**
 * Plural paradigms the dictionary lists as flagless words or plural-only entries, with their
 * lemma's gender: "dzieci" (neuter), "ludzie", "bracia", "księża", "rodzice" (men).
 */
const IRREGULAR_PLURALS: Array<[gender: number, forms: Record<string, string>]> = [
  [NEUTER, { dzieci: "Np Gp Ap Vp", dzieciom: "Dp", dziećmi: "Ip", dzieciach: "Lp" }],
  [
    MASCULINE | VIRILE,
    { ludzie: "Np Vp", ludzi: "Gp Ap", ludziom: "Dp", ludźmi: "Ip", ludziach: "Lp" },
  ],
  [MASCULINE | VIRILE, { bracia: "Np Vp", braci: "Gp Ap", braciom: "Dp", braćmi: "Ip" }],
  [MASCULINE | VIRILE, { księża: "Np Vp", księży: "Gp Ap", księżom: "Dp", księżmi: "Ip" }],
  [
    MASCULINE | VIRILE,
    { rodzice: "Np Vp", rodziców: "Gp Ap", rodzicom: "Dp", rodzicami: "Ip", rodzicach: "Lp" },
  ],
  [
    MASCULINE | VIRILE,
    { przyjaciele: "Np Vp", przyjaciół: "Gp Ap", przyjaciołom: "Dp", przyjaciółmi: "Ip" },
  ],
];
/** Common nouns naming men whose plural in "-e" the flags share with things ("lekarze"). */
const VIRILE_LEMMAS = new Set(
  (
    "rodzic gość obywatel kibic widz gracz badacz słuchacz lekarz żołnierz dziennikarz piłkarz " +
    "gospodarz kucharz malarz pisarz rycerz tancerz pasterz harcerz marynarz"
  ).split(" "),
);
/**
 * Masculine nouns naming animals: the flags do not tell them from things ("kot/NOsT" beside
 * "chleb/NOsT"), and their accusative singular is the genitive form ("mam psa", not "mam pies").
 */
const ANIMALS = new Set(
  (
    "pies kot koń wilk lis niedźwiedź zając królik ptak orzeł sokół kogut indyk byk wół osioł " +
    "baran kozioł jeleń dzik słoń lew tygrys wąż smok motyl robak ślimak pająk komar chomik " +
    "szczur żółw delfin rekin wieloryb łabędź gołąb wróbel bocian kruk struś pingwin krokodyl " +
    "zwierz potwór owad karp pstrąg śledź łosoś szczupak dinozaur jastrząb kangur wielbłąd " +
    "bóbr jeż kret borsuk ogier źrebak cielak prosiak knur nosorożec hipopotam goryl"
  ).split(" "),
);
const IRREGULAR_FORMS = new Set(IRREGULAR_PLURALS.flatMap(([, forms]) => Object.keys(forms)));
/** How common (summed over its forms) a noun must be to be listed. */
const MIN_COUNT = 200;
/** A homograph whose own forms are rarer than this beside a common word is not read. */
const RARE_COUNT = 20;
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
  let own = lemmaTags(word, flags);
  // A man's noun: flag q spells its plural without "-e" ("studenci", "biolodzy", "mnisi"; q
  // also spells "komentarze"), it names a doer in "-ciel" ("nauczyciel"), or it is listed.
  const man = /ciel$/.test(word) || VIRILE_LEMMAS.has(word) || spellsVirile(affixes, word, flags);
  if (own & MASCULINE && man) own |= VIRILE;
  const gender = own & (MASCULINE | FEMININE | NEUTER | VIRILE);
  // A man's or an animal's accusative singular is the genitive form ("widzę psa", "aktora"),
  // never the nominative.
  if (own & MASCULINE && (own & VIRILE || ANIMALS.has(word))) own &= ~c("As");
  if (own) yield [word, own, "noun"];
  if (/[XxY]/.test(flags)) yield [word, ADJECTIVE, null];
  const verb = /[HIBdkeJFhEvgGij]/.test(flags);
  if (own ? verb : !/[XxY]/.test(flags)) yield [word, verb ? VERB : NOT_NOUN, null];
  const spelled: string[] = [];
  for (const flag of flags) {
    if (flag === "b" || flag === "Y") continue;
    const forms = (affixes.get(flag) ?? [])
      .filter((rule) => word.endsWith(rule.strip) && rule.cond.test(word))
      .map((rule) => word.slice(0, word.length - rule.strip.length) + rule.add);
    for (const form of forms) {
      spelled.push(form);
      const siblings = forms.filter((other) => other !== form);
      if (flag === "i" || flag === "j")
        yield [form, flagCases(flag, form, word) | NEUTER, "gerund"];
      else if (NOUN_FLAGS.includes(flag) && own) {
        let mask = flagCases(flag, form, word, flags, siblings);
        // A man's accusative plural is the genitive ("studentów"), never the nominative.
        if (gender & VIRILE && !(mask & c("Gp"))) mask &= ~c("Ap");
        yield [form, mask | (gender & MASCULINE && mask & c("Gp") ? c("Ap") : 0) | gender, "noun"];
      } else if (NOUN_FLAGS.includes(flag)) yield [form, NOT_NOUN, null];
      else if (ADJECTIVE_FLAGS.includes(flag) || PARTICIPLE_FLAGS.includes(flag))
        yield [form, ADJECTIVE, null];
      else yield [form, VERB_FLAGS.includes(flag) ? VERB : NOT_NOUN, null];
    }
  }
  // "nie-" (flag b) joins adjectives, adverbs and verbal nouns; none of them is read as a noun.
  if (flags.includes("b"))
    for (const form of [word, ...spelled]) yield [`nie${form}`, NOT_NOUN, null];
}

/** Flag q spells the entry a plural without "-e": a man's ("studenci", "biolodzy"). */
function spellsVirile(affixes: Map<string, Rule[]>, word: string, flags: string): boolean {
  return (
    flags.includes("q") &&
    (affixes.get("q") ?? []).some(
      (rule) => word.endsWith(rule.strip) && rule.cond.test(word) && !rule.add.endsWith("e"),
    )
  );
}

// Flagless entries that look like a noun's case form but are other words: adverbs ("potem",
// "razem", "czasem", "raptem", "ogółem", "luzem", "zrazu", "pokotem"), "paru" (a few), "memu"
// (my), and indeclinable nouns ("menu", "haiku", "kuku").
const OTHER_WORDS = new Set(
  "potem razem czasem raptem ogółem luzem zrazu pokotem paru memu menu haiku kuku".split(" "),
);

/**
 * The singular case forms pl_PL.dic lists as entries of their own, without flags, beside a
 * masculine noun ("domu", "domem", "domowi" beside "dom/NsT") or an "-ia" noun declined like an
 * adjective ("hrabiego", "hrabiemu"). "-a" and "-e" stay out: "akta", "karate", "kocie" are
 * other words.
 */
function flaglessCases(lemma: string, own: number): Array<[form: string, mask: number]> {
  if (!(own & MASCULINE)) return [];
  if (/[^aeiouyąęó]$/u.test(lemma))
    return [
      [`${lemma}u`, c("Gs Ds Ls Vs")],
      [`${lemma}owi`, c("Ds")],
      [`${lemma}${/[kg]$/.test(lemma) ? "iem" : "em"}`, c("Is")],
    ];
  if (lemma.endsWith("ia"))
    return [
      [`${lemma.slice(0, -1)}ego`, c("Gs As")],
      [`${lemma.slice(0, -1)}emu`, c("Ds")],
    ];
  return [];
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

  // 1. The paradigms of common nouns (and of verbal nouns): form -> tags. A homograph whose own
  // forms (those no other lemma spells) are rare beside another's ("plika" beside "plik",
  // "kota" beside "kot") is neither listed nor read into the common word's forms.
  const flagless = new Set(entries.filter(([, flags]) => !flags).map(([word]) => word));
  const attached = new Set<string>();
  const tables = entries.map(([word, flags = ""]) => {
    if (IRREGULAR_FORMS.has(word))
      return [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
    const tables = entryTables(affixes, word, flags);
    const own = tables[0].get(word) ?? 0;
    for (const [form, mask] of flaglessCases(word, own))
      if (flagless.has(form) && !OTHER_WORDS.has(form)) {
        tables[0].set(form, mask | (own & (MASCULINE | FEMININE | NEUTER)));
        attached.add(form);
      }
    return tables;
  });
  // A flagless entry read as a noun's case form is no other word.
  entries.forEach(([word, flags], i) => {
    if (!flags && attached.has(word)) tables[i][2].clear();
  });
  const lemmas = new Map<string, Set<string>>();
  entries.forEach(([word], i) => {
    for (const table of tables[i].slice(0, 2))
      for (const form of table.keys())
        (lemmas.get(form) ?? lemmas.set(form, new Set()).get(form)!).add(word);
  });
  const ownCount = new Map<string, number>();
  for (const [form, owners] of lemmas)
    if (owners.size === 1) {
      const [word] = owners;
      ownCount.set(word, (ownCount.get(word) ?? 0) + (frequency.get(form) ?? 0));
    }
  const paradigms: Array<Map<string, number>> = [];
  const rare = new Set<Map<string, number>>();
  entries.forEach(([word], i) => {
    for (const table of tables[i].slice(0, 2)) {
      let total = 0;
      const rivals = new Set<string>();
      for (const form of table.keys()) {
        total += frequency.get(form) ?? 0;
        for (const other of lemmas.get(form)!) if (other !== word) rivals.add(other);
      }
      // What tells this paradigm apart from a rival: its forms the rival does not spell.
      const homograph = [...rivals].some((rival) => {
        const strong = ownCount.get(rival) ?? 0;
        if (strong < MIN_COUNT) return false;
        let apart = 0;
        for (const form of table.keys())
          if (!lemmas.get(form)!.has(rival)) apart += frequency.get(form) ?? 0;
        return apart < RARE_COUNT && strong > 10 * apart;
      });
      if (homograph) rare.add(table);
      else if (total >= MIN_COUNT) paradigms.push(table);
    }
  });

  for (const [gender, forms] of IRREGULAR_PLURALS)
    paradigms.push(new Map(Object.entries(forms).map(([form, spec]) => [form, c(spec) | gender])));

  // 2. What every entry says about those forms; what the paradigms miss is an exception.
  const listed = new Map<string, number>();
  for (const table of paradigms)
    for (const [form, mask] of table) listed.set(form, (listed.get(form) ?? 0) | mask);
  const full = new Map(listed);
  for (const table of tables.flat())
    if (!rare.has(table))
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
  const source = `// Generated by bun scripts/generate-polish-lexicon.ts from pl_PL.dic/.aff and the n-gram counts. Do not edit.
// Word sets are word graphs (review/wordGraph.ts).
/** The tag masks the classes use, in base 36. */
${constant("TAGS", [...palette.keys()].map((mask) => mask.toString(36)).join(" "))}
/** Paradigm classes: "class|ending:tags" entries (tags: an index into TAGS). */
${constant("CLASSES", encodeWordGraph([...classes.keys()].flatMap((key, id) => key.split(" ").map((pair) => `${id}|${pair}`))))}
/** Each class's stems: "stem|class" entries. */
${constant("STEMS", encodeWordGraph(byClass.flatMap((stems, id) => stems.map((stem) => `${stem}|${id}`))))}
/** Adjectives and passive participles, by their masculine form. */
${constant("ADJECTIVES", encodeWordGraph(adjectives))}
/** Adjective forms that are also another word ("przeszły", "dobra"). */
${constant("AMBIGUOUS_ADJECTIVES", encodeWordGraph(ambiguous))}
/** Tags a form has beyond its paradigms (another entry spells it too): "form|tags" entries. */
${constant("EXCEPTIONS", encodeWordGraph([...exceptions].flatMap(([mask, forms]) => forms.map((form) => `${form}|${mask.toString(36)}`))))}
`;
  // Printed as the format check expects (printWidth 100, quoted keys only where needed).
  return format(source, {
    ...(await resolveConfig(POLISH_LEXICON_SOURCES.out)),
    parser: "typescript",
  });
}

/* ------------------------------------------------------------------ places */

// Common place names whose case forms Review capitalizes after a preposition ("w gdańsku"):
// Polish cities and towns, regions and mountains, countries and continents. A form that is
// also a common word in lowercase ("łódź", a boat; "piła", a saw) is left out.
const PLACES = (
  "Warszawa Kraków Gdańsk Gdynia Sopot Poznań Wrocław Szczecin Bydgoszcz Toruń Lublin " +
  "Katowice Białystok Rzeszów Kielce Olsztyn Opole Gorzów Częstochowa Radom Sosnowiec Gliwice " +
  "Zabrze Bytom Rybnik Tychy Elbląg Płock Wałbrzych Włocławek Tarnów Chorzów Koszalin Kalisz " +
  "Legnica Grudziądz Słupsk Jaworzno Siedlce Mysłowice Konin Piotrków Inowrocław Lubin " +
  "Suwałki Stargard Gniezno Głogów Pabianice Leszno Zamość Łomża Żory Pruszków Przemyśl Tczew " +
  "Ełk Świdnica Będzin Zgierz Racibórz Legionowo Ostrołęka Wejherowo Zakopane Kołobrzeg " +
  "Malbork Sandomierz Wieliczka Oświęcim Augustów Giżycko Mikołajki Ustka Międzyzdroje " +
  "Świnoujście Szczyrk Karpacz Krynica Łeba Kazimierz Chełm Biłgoraj Puławy Mielec Krosno " +
  "Sanok Jasło Nysa Kłodzko Bolesławiec Zgorzelec Cieszyn Wadowice Bochnia Gorlice " +
  "Mazury Tatry Bieszczady Karkonosze Beskidy Pieniny Sudety Śląsk Pomorze Kaszuby Podhale " +
  "Mazowsze Małopolska Wielkopolska Kujawy Podlasie Warmia Żuławy Suwalszczyzna Roztocze " +
  "Polska Niemcy Francja Anglia Hiszpania Włochy Czechy Słowacja Ukraina Rosja Litwa Łotwa " +
  "Estonia Białoruś Węgry Austria Szwajcaria Holandia Belgia Dania Szwecja Norwegia Finlandia " +
  "Irlandia Szkocja Portugalia Grecja Turcja Rumunia Bułgaria Chorwacja Serbia Słowenia " +
  "Albania Japonia Chiny Indie Kanada Meksyk Brazylia Argentyna Australia Egipt Izrael Wietnam " +
  "Tajlandia Korea Islandia Gruzja Ameryka Afryka Azja Europa Londyn Paryż Berlin Rzym Praga " +
  "Wiedeń Madryt Lizbona Budapeszt Wilno Kijów Lwów Moskwa Amsterdam Bruksela Sztokholm Oslo"
).split(" ");
/** What a flagless entry adds to a place name when it is one of its case forms ("Wrocławiu"). */
const CASE_ENDING = /^(?:a|e|u|y|i|o|ą|ę|em|ie|owi|iem|iu|ia|iowi|ach|ami|om|ów|ego|emu|m)$/u;
// Places whose lowercase twin is a rare word or a brand ("warszawa" the car, "lublin" the van,
// "szczecina" bristle), so the place is meant; "łódź" (a boat), "dania" (dishes), "kijów"
// (sticks), "mikołajki" (St Nicholas' Day), "tych" (Tychy, the pronoun) and the like stay out.
const PLACE_FIRST = (
  "Warszawa Lublin Berlin Mazury Tatry Szczecin Kanada Afryka Chiny Gdańsk Włochy Sosnowiec " +
  "Włocławek Opole Konin Meksyk Radom Śląsk Wrocław Słupsk Płock Kłodzko Giżycko Europa Bytom " +
  "Malbork Legionowo Kaszuby Ameryka Mielec Bolesławiec Szczyrk Nysa"
).split(" ");

/* ------------------------------------------------------------------- words */

// The flags spelling finite forms: the past and conditional (H, F) and the present or
// perfective future (I, J, h). Imperatives (B, k) and impersonals (d, e) are left out.
const FINITE_FLAGS = "HFIJh";
/** How common (summed over its finite forms) a verb must be to be listed. */
const MIN_VERB_COUNT = 20;
/** The imperative flags, and how common a verb's imperatives must be to be listed. */
const IMPERATIVE_FLAGS = "Bk";
const MIN_IMPERATIVE_COUNT = 20;
/** The prefixes that make a perfective, and how common its forms must be to be listed. */
const ASPECT_PREFIXES = "przy prze pod nad roz wy za na po do od ob ode roze ze u w s z".split(" ");
const MIN_PERFECTIVE_COUNT = 50;
/** A past form's endings after its "-ł" stem ("rzek-ł", "rzek-ła", "rzek-li"). */
const PAST_ENDINGS =
  "ł ła ło li ły łem łam łeś łaś liśmy łyśmy liście łyście łby łaby łoby liby łyby".split(" ");
/** The past endings no adverb, particle or noun spells: "-ło" is checked apart. */
const PAST_PERSON = /(?:ł|ła|li|ły|łem|łam|łeś|łaś|śmy|ście|by)$/u;
/** A "-nąć" verb's forms after "zabrak-", "ucich-" ("zabraknie", "zabrakło"). */
const NAC_ENDINGS = "nie ną nę niesz niemy niecie nął nęła nęło nęli nęły ł ła ło li ły".split(" ");

/**
 * The finite forms of common verbs, as paradigm classes of endings with their stems, and those
 * forms another dictionary entry spells as something else ("stanie" is also a noun's locative);
 * and the lowercased case forms of common place names.
 */
export async function buildPolishWords(
  dic: string,
  aff: string,
  trie: ArrayBuffer,
  counts: ArrayBuffer,
): Promise<string> {
  const frequency = unigrams(trie, counts);
  const affixes = parseAffixes(aff);
  const spelled = (word: string, flags: string) =>
    [...flags].flatMap((flag) =>
      (affixes.get(flag) ?? [])
        .filter((rule) => word.endsWith(rule.strip) && rule.cond.test(word))
        .map((rule) => [flag, word.slice(0, word.length - rule.strip.length) + rule.add]),
    );
  const other = new Set<string>();
  // Imperatives: "przeczytaj" (from "przeczytajmy") with its forms' counts, and every form
  // another flag or entry spells, so homographs ("kup", "lej") stay out.
  const imperatives = new Map<string, number>();
  const notImperative = new Set<string>();
  const lowercase = new Set<string>();
  const flagless = new Set<string>();
  const spelledFinite = new Set<string>();
  const nac: string[] = [];
  const tables: string[][] = [];
  const capitalized: Array<[string, string]> = [];
  for (const line of dic.split("\n").slice(1)) {
    const [word, flags = ""] = line.trim().split("/");
    if (!word) continue;
    if (/\p{Lu}/u.test(word)) {
      capitalized.push([word, flags]);
      continue;
    }
    if (flags) other.add(word);
    else flagless.add(word);
    lowercase.add(word);
    if (word.endsWith("nąć")) nac.push(word.slice(0, -3));
    const finite: string[] = [];
    notImperative.add(word);
    let imperative = "";
    let imperativeCount = 0;
    for (const [flag, form] of spelled(word, flags)) {
      if (IMPERATIVE_FLAGS.includes(flag)) {
        if (form.endsWith("my")) imperative = form.slice(0, -2);
        imperativeCount += frequency.get(form) ?? 0;
      } else notImperative.add(flag === "b" ? `nie${form}` : form);
      lowercase.add(form);
      if (FINITE_FLAGS.includes(flag)) finite.push(form);
      else other.add(flag === "b" ? `nie${form}` : form);
    }
    if (imperative && imperativeCount >= MIN_IMPERATIVE_COUNT)
      imperatives.set(imperative, imperativeCount);
    finite.forEach((form) => spelledFinite.add(form));
    const total = finite.reduce((sum, form) => sum + (frequency.get(form) ?? 0), 0);
    if (total >= MIN_VERB_COUNT) tables.push(finite);
  }
  // pl_PL.dic also lists finite forms as entries without flags: beside a verb whose flags
  // spell them too ("czekał", "mogli"), irregular pasts ("rzekł", "rzekła", "biegł") and a
  // "-nąć" verb's forms ("zabraknie", "zabrakło" beside "zabraknąć/j").
  const verbForms = new Set<string>();
  const group = (forms: string[]) => {
    const found = forms.filter((form) => flagless.has(form));
    found.forEach((form) => verbForms.add(form));
    const total = found.reduce((sum, form) => sum + (frequency.get(form) ?? 0), 0);
    if (total >= MIN_VERB_COUNT) tables.push(found);
  };
  // The pasts without "-ną-" ("zabrakło", "ucichł") follow a consonant: "minąć" spells no "miło",
  // "musnąć" no "musli".
  for (const stem of nac)
    group(
      NAC_ENDINGS.filter(
        (ending) => ending.startsWith("n") || (stem.length > 3 && /[^aeiouyąęó]$/u.test(stem)),
      ).map((ending) => stem + ending),
    );
  for (const word of flagless)
    if (
      word.length > 4 &&
      word.endsWith("ł") &&
      flagless.has(`${word}a`) &&
      !spelledFinite.has(word)
    )
      group(PAST_ENDINGS.map((ending) => word.slice(0, -1) + ending));
  const spelledOther = new Set(other);
  for (const word of flagless) {
    // "-ło" beside an adjective in "-ły" is (also) its adverb: "mało", "śmiało", "nikło".
    const adverb = word.endsWith("ło") && spelledOther.has(`${word.slice(0, -1)}y`);
    const past = PAST_PERSON.test(word) || (word.endsWith("ło") && word.length > 4);
    if (adverb || !(verbForms.has(word) || (past && spelledFinite.has(word)))) other.add(word);
  }
  const classes = new Map<string, string[]>();
  for (const forms of tables) {
    const stem = stemOf(forms);
    const key = [...new Set(forms.map((form) => form.slice(stem.length)))].sort().join(" ");
    (classes.get(key) ?? classes.set(key, []).get(key)!).push(stem);
  }
  const ambiguous = tables.flat().filter((form) => other.has(form));

  // Perfective infinitives: no present participle ("robiący", flags v/G), and a prefix away
  // from a verb that has one ("zrobić" beside "robić", "napisać" beside "pisać"). Unprefixed
  // perfectives ("dać", "kupić") and imperfectives without the flag ("spać") stay out.
  const infinitiveFlags = new Map<string, string>();
  for (const line of dic.split("\n").slice(1)) {
    const [word, flags = ""] = line.trim().split("/");
    if (/(?:ć|c)$/u.test(word) && !/\p{Lu}/u.test(word))
      infinitiveFlags.set(word, (infinitiveFlags.get(word) ?? "") + flags);
  }
  const imperfective = (word: string) => /[vG]/u.test(infinitiveFlags.get(word) ?? "");
  const perfectives = [...infinitiveFlags].flatMap(([word, flags]) => {
    if (imperfective(word) || !/[HIJ]/u.test(flags)) return [];
    const prefix = ASPECT_PREFIXES.find(
      (p) => word.startsWith(p) && word.length - p.length > 2 && imperfective(word.slice(p.length)),
    );
    if (!prefix) return [];
    const count = spelled(word, flags).reduce(
      (sum, [, form]) => sum + (frequency.get(form) ?? 0),
      frequency.get(word) ?? 0,
    );
    return count >= MIN_PERFECTIVE_COUNT ? [word] : [];
  });

  // A place's forms: those its flags spell, or (a name listed without flags, "Wrocław") the
  // flagless entries that extend it ("Wrocławia", "Wrocławiu").
  const places = new Set<string>();
  const names = new Set(PLACES);
  const wins = new Set(PLACE_FIRST);
  for (const [word, flags] of capitalized) {
    if (!names.has(word)) continue;
    const forms = [word, ...spelled(word, flags).map(([, form]) => form)];
    if (!flags) {
      const prefix = /[aeiouy]$/u.test(word) ? word.slice(0, -1) : word;
      for (const [other, otherFlags] of capitalized)
        if (!otherFlags && other.startsWith(prefix) && CASE_ENDING.test(other.slice(prefix.length)))
          forms.push(other);
    }
    for (const form of forms) {
      if (!lowercase.has(form.toLowerCase()) || wins.has(word)) places.add(form.toLowerCase());
    }
  }

  const constant = (name: string, value: string) =>
    `export const ${name} = ${JSON.stringify(value)};`;
  const source = `// Generated by bun scripts/generate-polish-lexicon.ts from pl_PL.dic/.aff and the n-gram counts. Do not edit.
// Word sets are word graphs (review/wordGraph.ts).
/** Finite verb paradigm classes: "class|ending" entries. */
${constant("VERB_CLASSES", encodeWordGraph([...classes.keys()].flatMap((key, id) => key.split(" ").map((ending) => `${id}|${ending}`))))}
/** Each class's stems: "stem|class" entries. */
${constant("VERB_STEMS", encodeWordGraph([...classes.values()].flatMap((stems, id) => stems.map((stem) => `${stem}|${id}`))))}
/** Finite forms that another entry spells as another word ("stanie", "je"). */
${constant("AMBIGUOUS_VERBS", encodeWordGraph(ambiguous))}
/** Perfective infinitives of common verbs ("zrobić", "przeczytać"). */
${constant("PERFECTIVES", encodeWordGraph(perfectives))}
/** Second-person imperatives no other entry spells ("przeczytaj", "zrób"). */
${constant("IMPERATIVES", encodeWordGraph([...imperatives.keys()].filter((form) => !notImperative.has(form))))}
/** Lowercased case forms of common place names ("gdańsku", "niemczech"). */
${constant("PLACES", encodeWordGraph(places))}
`;
  return format(source, {
    ...(await resolveConfig(POLISH_LEXICON_SOURCES.words)),
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
  const words = await buildPolishWords(dic, aff, trie, counts);
  await writeFile(S.words, words);
  console.log(`wrote ${S.words} (${Buffer.byteLength(words)} bytes)`);
}
