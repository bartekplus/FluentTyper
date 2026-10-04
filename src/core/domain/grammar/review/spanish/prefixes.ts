import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { DETERMINER, readNoun } from "./agreement";
import {
  Around,
  attributeOf,
  carryCase,
  CLITICS,
  keepsTyped,
  PRENOMINAL,
  tokenize,
  words,
} from "./common";
import {
  attribute,
  finiteVerb,
  genderedForm,
  isGenderedEntry,
  isNoun,
  NOUN_ENDING,
  plain,
} from "./lexicon";
import { finding } from "../finding";
import { isLang } from "../phraseTemplates";

// Spanish prefixes join the word they modify: "anti ruso" -> "antirruso", "ex-colonias" ->
// "excolonias". Apart or hyphenated only before a capital, a number or a phrase.

const RULE = "spanishConfusions" as const;

// Prefixes that are no word of their own, so a space after them is always a split.
const BOUND =
  "anti|ciber|pre|re|vice|hiper|inter|neuro|geo|nano|agro|sub|semi|multi|pos|infra|intra|seudo|pseudo|archi|hemi|co|fito|meso|hidro|termo|electro|cardio|psico|sero";
// Prefixes that are also words ("ex", "pro", "tele", "foto", "euro"): joined when hyphenated,
// or apart when the joined form is a word the dictionary knows ("micro biología").
const FREE =
  "ex|pro|des|post|poli|tele|video|foto|euro|afro|micro|macro|mini|ultra|super|súper|auto|radio|bio|eco|socio|mega|giga|kilo|zoo|extra|astro|hispano|anglo|franco|luso|físico|químico|cuasi";
// Free prefixes that join any adjective they grade: "pro democrático", "ultra conservador",
// "cuasi perfecto"; the words themselves stand before nouns ("los pro y los contra").
const GRADING = new Set(["pro", "ultra", "cuasi", "super", "súper"]);
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}\\-'’@/#.])(${BOUND}|${FREE})(?:(-)|[ \\t]+)(\\p{L}[\\p{L}\\p{M}]{2,})(?![\\p{L}\\p{N}\\-'’@/])`,
  "giu",
);
const FREE_SET = new Set(FREE.split("|"));
// Adjective forms that open a compound of two related adjectives.
const RELATIONAL = new Set(["hispano", "anglo", "franco", "luso", "físico", "químico"]);
const SIZE = new Set(["macro", "micro", "mini", "mega", "maxi"]);

/**
 * A noun or adjective the dictionary lists: "microbiología", "hispanohablantes". A noun ending
 * alone ("-sión") says nothing after "des", which is also a misspelled "de" ("des discusión").
 */
const knownWord = (word: string) =>
  !(word.startsWith("des") && NOUN_ENDING.test(word)) &&
  (isNoun(word) || isGenderedEntry(word) || !!genderedForm(word));

/** "pre" + "rebajas" -> "prerrebajas": a word-initial r doubles after a vowel. */
function join(prefix: string, word: string): string {
  // "súper", "físico": the first element loses its accent inside the compound.
  const base = plain(prefix);
  return /[aeiou]$/iu.test(base) && word.startsWith("r") && !word.startsWith("rr")
    ? `${base}r${word}`
    : `${base}${word}`;
}

function prefixes(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "es")) return [];
  const findings: RawFinding[] = [];
  const regex = new RegExp(PATTERN);
  regex.lastIndex = Math.max(0, ctx.from - 16);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index < ctx.from) continue;
    const [typed, prefix, hyphen, word] = m;
    const lower = word.toLowerCase();
    // "un súper cercano": after a determiner the word is the noun (the supermarket).
    const before = /(\p{L}+)[ \t]+$/u.exec(ctx.text.slice(Math.max(0, m.index - 24), m.index));
    const graded =
      GRADING.has(prefix.toLowerCase()) &&
      !!genderedForm(lower) &&
      !isNoun(lower) &&
      !DETERMINER.has(before?.[1].toLowerCase() ?? "");
    // "ex presidente" was the rule until 2010 and is still everywhere: only "ex-" is joined.
    if (!hyphen && prefix.toLowerCase() === "ex") continue;
    // "relaciones hispano-estadounidenses", "un análisis físico-químico": two adjectives that
    // each keep their meaning keep the hyphen ("hispanohablante" fuses into one).
    if (hyphen && RELATIONAL.has(prefix.toLowerCase()) && !isNoun(lower)) continue;
    if (
      hyphen &&
      RELATIONAL.has(prefix.toLowerCase()) &&
      /(?:ense|és|ano|ana|ino|ina)s?$|eses$/u.test(lower)
    )
      continue;
    // "un macro análisis", "una mini falda": between a determiner and a noun of its number,
    // a size prefix can only be part of the noun.
    const det = DETERMINER.get(before?.[1].toLowerCase() ?? "");
    const noun = readNoun(lower);
    const sized =
      SIZE.has(prefix.toLowerCase()) &&
      !!det &&
      !!noun &&
      !noun.paired &&
      !attributeOf(lower) &&
      !PRENOMINAL.has(lower) &&
      (noun.invariant || noun.plural === det.slot >= 2);
    if (
      !hyphen &&
      FREE_SET.has(prefix.toLowerCase()) &&
      !graded &&
      !sized &&
      !knownWord(join(prefix.toLowerCase(), word))
    )
      continue;
    // "vice primer ministro", "ex alto cargo": the prefix takes a whole phrase.
    const after = /^[ \t]{1,8}(\p{L}+)/u.exec(ctx.text.slice(m.index + typed.length))?.[1] ?? "";
    if (/^\p{Lu}/u.test(word)) continue;
    const apocope = /^(?:primer|tercer|gran|buen|mal|algún|ningún|alto|alta)$/u.test(word);
    if (
      !hyphen &&
      (apocope || attribute(word)) &&
      (isNoun(after.toLowerCase()) || isGenderedEntry(after.toLowerCase()))
    )
      continue;
    // "re menor" is the note.
    if (prefix.toLowerCase() === "re" && /^(?:mayor|menor|bemol|sostenido)$/u.test(word)) continue;
    if (
      keepsTyped(ctx, prefix) ||
      ctx.dictionary.has(word) ||
      namedExampleBefore(ctx.text, m.index)
    )
      continue;
    const joined = carryCase(prefix, join(prefix.toLowerCase(), word));
    findings.push(
      finding(RULE, "review_msg_closed_compound", m.index, m.index + typed.length, [joined], {
        bulkBlock: "context-dependent",
      }),
    );
    regex.lastIndex = m.index + typed.length;
  }
  return findings;
}

// Masculine determiners: "un saca corchos" can only be a compound noun, since "saca" (the verb)
// takes no article and "la saca" (the sack) no masculine one.
const MASCULINE = words("el un del al este ese aquel los unos estos esos aquellos");

// Verbs "mal" fuses with into a new meaning; "mal vive" (lives badly) stays apart.
const MAL_VERBS = /^(?:interpret|gast|trat|cri|vend|her|entend|entiend|acostumbr)\p{L}+$/u;

/**
 * Compounds written apart: a verb and its object after a masculine determiner ("un lanza
 * misiles" -> "lanzamisiles") and "sobre"/"mal" before a verb ("sobre protegen",
 * "mal interprete").
 */
function splitCompounds(ctx: DetectContext): RawFinding[] {
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 1; i + 1 < tokens.length; i++) {
    const first = tokens[i];
    // "un lanza-misiles": a hyphen between the two halves.
    const hyphen =
      tokens[i + 1].text === "-" && first.end === tokens[i + 1].start && !!tokens[i + 2];
    const second = hyphen ? tokens[i + 2] : tokens[i + 1];
    // The tokenizer marks a word after a hyphen as glued; its letters still count here.
    if (!first.word || (!second.word && !hyphen) || second.broken || first.start < ctx.from)
      continue;
    if (first.start >= ctx.to) break;
    if (hyphen && (ctx.text[second.end] === "-" || ctx.text[first.start - 1] === "-")) continue;
    const gap = ctx.text.slice(first.end, second.start);
    if (gap !== " " && !(hyphen && gap === "-")) continue;
    if (!/^\p{Ll}+$/u.test(second.text) || !/^\p{Ll}+$/u.test(first.text)) continue;
    const at = new Around(tokens, i);
    const head = first.lower;
    const tail = second.lower;
    // "un «apaga fuegos»": the determiner before an opening quote.
    const quoted = /^[«“"]$/u.test(tokens[i - 1].text) && !tokens[i].broken;
    const det = quoted ? new Around(tokens, i - 1).prev() : at.prev();
    let joined: string | null = null;
    if (MASCULINE.has(det) && /[^aeiou][ae]$/u.test(head) && finiteVerb(head)) {
      // The noun after is the object: plural, or a mass noun the compound keeps singular.
      const noun = readNoun(tail);
      const nounHead = readNoun(head);
      if (
        noun &&
        !noun.paired &&
        // "al guarda", "el lanza": only a feminine noun reading, which "el" cannot take.
        (!nounHead || nounHead.gender === "f") &&
        (noun.plural || isNoun(join(head, tail)))
      )
        joined = join(head, tail);
    } else if (
      !hyphen &&
      (head === "sobre" || (head === "mal" && MAL_VERBS.test(tail))) &&
      !isNoun(tail) &&
      !attribute(tail)
    ) {
      const compound = join(head, tail);
      if (finiteVerb(tail) && finiteVerb(compound) && !CLITICS.has(tail)) joined = compound;
      // "la sobre protegen": a clitic before "sobre" makes the whole a verb.
      else if (
        head === "sobre" &&
        CLITICS.has(at.prev()) &&
        finiteVerb(tail) &&
        !isNoun(tail) &&
        !CLITICS.has(tail)
      )
        joined = compound;
    }
    if (!joined || keepsTyped(ctx, head) || ctx.dictionary.has(tail)) continue;
    if (namedExampleBefore(ctx.text, first.start)) continue;
    findings.push(
      finding(RULE, "review_msg_closed_compound", first.start, second.end, [joined], {
        bulkBlock: "context-dependent",
      }),
    );
    i += hyphen ? 2 : 1;
  }
  return findings;
}

// "pilla-pilla", "taca-taca": a doubled word is one compound.
const DOUBLED = /(?<![\p{L}\p{N}\-'’@/#.])([a-zñ]{2,5})-([a-zñ]{2,5})(?![\p{L}\p{N}\-'’@/])/gu;

function doubled(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const regex = new RegExp(DOUBLED);
  regex.lastIndex = Math.max(0, ctx.from - 16);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index < ctx.from || m[1] !== m[2] || ctx.dictionary.has(m[0].toLowerCase())) continue;
    if (namedExampleBefore(ctx.text, m.index)) continue;
    findings.push({
      ruleId: RULE,
      messageKey: "review_msg_closed_compound",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [`${m[1]}${m[2]}`],
      bulkBlock: "context-dependent",
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [RULE],
    detect: (ctx) =>
      isLang(ctx, "es") ? [...prefixes(ctx), ...splitCompounds(ctx), ...doubled(ctx)] : [],
  },
];
