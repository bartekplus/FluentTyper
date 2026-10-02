import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { readNoun } from "./agreement";
import { Around, carryCase, CLITICS, keepsTyped, tokenize, words } from "./common";
import {
  attribute,
  finiteVerb,
  genderedForm,
  isGenderedEntry,
  isNoun,
  plain,
} from "./lexicon";

// Spanish prefixes join the word they modify: "anti ruso" -> "antirruso", "ex-colonias" ->
// "excolonias". Apart or hyphenated only before a capital, a number or a phrase.

const RULE = "spanishConfusions" as const;

// Prefixes that are no word of their own, so a space after them is always a split.
const BOUND =
  "anti|ciber|pre|re|vice|hiper|inter|neuro|geo|nano|agro|sub|semi|multi|pos|infra|intra|seudo|pseudo|archi|hemi|co|fito|meso|hidro|termo|electro|cardio|psico|sero";
// Prefixes that are also words ("ex", "pro", "tele", "foto", "euro"): joined when hyphenated,
// or apart when the joined form is a word the dictionary knows ("micro biología").
const FREE =
  "ex|pro|des|post|poli|tele|video|foto|euro|afro|micro|macro|mini|ultra|super|súper|auto|radio|bio|eco|socio|mega|giga|kilo|zoo|extra|astro|hispano|anglo|franco|luso|físico|químico";
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}\\-'’@/#.])(${BOUND}|${FREE})(?:(-)|[ \\t]+)(\\p{Ll}[\\p{Ll}\\p{M}]{2,})(?![\\p{L}\\p{N}\\-'’@/])`,
  "giu",
);
const FREE_SET = new Set(FREE.split("|"));

/** A noun or adjective the dictionary lists: "microbiología", "hispanohablantes". */
const knownWord = (word: string) => isNoun(word) || isGenderedEntry(word) || !!genderedForm(word);

/** "pre" + "rebajas" -> "prerrebajas": a word-initial r doubles after a vowel. */
function join(prefix: string, word: string): string {
  // "súper", "físico": the first element loses its accent inside the compound.
  const base = plain(prefix);
  return /[aeiou]$/iu.test(base) && word.startsWith("r") && !word.startsWith("rr")
    ? `${base}r${word}`
    : `${base}${word}`;
}

function prefixes(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const findings: RawFinding[] = [];
  const regex = new RegExp(PATTERN);
  regex.lastIndex = Math.max(0, ctx.from - 16);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index < ctx.from) continue;
    const [typed, prefix, hyphen, word] = m;
    if (!hyphen && FREE_SET.has(prefix.toLowerCase()) && !knownWord(join(prefix.toLowerCase(), word)))
      continue;
    // "vice primer ministro", "ex alto cargo": the prefix takes a whole phrase.
    const after = /^[ \t]+(\p{L}+)/u.exec(ctx.text.slice(m.index + typed.length))?.[1] ?? "";
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
    findings.push({
      ruleId: RULE,
      messageKey: "review_msg_closed_compound",
      range: { start: m.index, end: m.index + typed.length },
      alternatives: [joined],
      bulkBlock: "context-dependent",
    });
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
    const second = tokens[i + 1];
    if (!first.word || !second.word || second.broken || first.start < ctx.from) continue;
    if (first.start >= ctx.to) break;
    if (ctx.text.slice(first.end, second.start) !== " ") continue;
    if (!/^\p{Ll}+$/u.test(second.text) || !/^\p{Ll}+$/u.test(first.text)) continue;
    const at = new Around(tokens, i);
    const head = first.lower;
    const tail = second.lower;
    let joined: string | null = null;
    if (MASCULINE.has(at.prev()) && /[^aeiou][ae]$/u.test(head) && finiteVerb(head)) {
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
      (head === "sobre" || (head === "mal" && MAL_VERBS.test(tail))) &&
      !isNoun(tail) &&
      !attribute(tail)
    ) {
      const compound = join(head, tail);
      if (finiteVerb(tail) && finiteVerb(compound) && !CLITICS.has(tail)) joined = compound;
    }
    if (!joined || keepsTyped(ctx, head) || ctx.dictionary.has(tail)) continue;
    if (namedExampleBefore(ctx.text, first.start)) continue;
    findings.push({
      ruleId: RULE,
      messageKey: "review_msg_closed_compound",
      range: { start: first.start, end: second.end },
      alternatives: [joined],
      bulkBlock: "context-dependent",
    });
    i++;
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [RULE],
    detect: (ctx) => (ctx.lang.slice(0, 2) === "es" ? [...prefixes(ctx), ...splitCompounds(ctx)] : []),
  },
];
