import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { carryCase, keepsTyped } from "./common";
import { attribute, isGenderedEntry, isNoun } from "./lexicon";

// Spanish prefixes join the word they modify: "anti ruso" -> "antirruso", "ex-colonias" ->
// "excolonias". Apart or hyphenated only before a capital, a number or a phrase.

const RULE = "spanishConfusions" as const;

// Prefixes that are no word of their own, so a space after them is always a split.
const BOUND =
  "anti|ciber|pre|re|vice|hiper|inter|neuro|geo|nano|agro|sub|semi|multi|pos|infra|intra|seudo|pseudo|archi|hemi";
// Prefixes that are also words ("ex", "pro", "tele", "foto", "euro"): joined only when hyphenated.
const FREE =
  "ex|pro|des|post|poli|tele|video|foto|euro|afro|micro|macro|mini|ultra|super|súper|auto|radio|bio|eco|socio";
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}\\-'’@/#.])(${BOUND}|${FREE})(?:(-)|[ \\t]+)(\\p{Ll}[\\p{Ll}\\p{M}]{2,})(?![\\p{L}\\p{N}\\-'’@/])`,
  "giu",
);
const FREE_SET = new Set(FREE.split("|"));

/** "pre" + "rebajas" -> "prerrebajas": a word-initial r doubles after a vowel. */
function join(prefix: string, word: string): string {
  const base = prefix.toLowerCase() === "súper" ? "super" : prefix;
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
    if (!hyphen && FREE_SET.has(prefix.toLowerCase())) continue;
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

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: prefixes }];
