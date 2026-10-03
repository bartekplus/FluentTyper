import {
  applyWordCase,
  detectWordCase,
  carryCase,
} from "../../implementations/helpers/GenericRuleShared";
import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { finding } from "../finding";

/** Text before a sentence start: the text start or sentence punctuation, then spaces. */
export const SENTENCE_START = /(?:^|[.!?…\n])[\s\u00a0]*$/u;

/** A word of the clause before a target, nearest first. */
export interface Token {
  /** Lowercase, straight apostrophe kept on an elided word: "n'", "qu'". */
  w: string;
  start: number;
  end: number;
  /** Joined to the next word by a hyphen: "avez" in "avez-vous". */
  hyphen: boolean;
}

// The clause ends at punctuation, a digit or a masked span; letters, spaces, apostrophes and
// hyphens continue it.
const CLAUSE_BREAK = /[^\p{L}\p{M} \t  '’-]/gu;
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’](?=\p{L}|[ \t]|$))?/gu;

// The French checks read the same windows many times per chunk: each window is split once per
// text. Callers get a fresh array; the tokens themselves are shared and read-only.
let cachedText: string | null = null;
const beforeCache = new Map<number, Token[]>();
const afterCache = new Map<number, Token[]>();

function cacheFor(text: string): void {
  if (text === cachedText && beforeCache.size + afterCache.size < 50_000) return;
  cachedText = text;
  beforeCache.clear();
  afterCache.clear();
}

/** Up to `limit` words of the same clause before `index`, nearest first. */
export function tokensBefore(text: string, index: number, limit = 8): Token[] {
  cacheFor(text);
  let all = beforeCache.get(index);
  if (!all) {
    all = splitBefore(text, index);
    beforeCache.set(index, all);
  }
  return all.slice(0, limit);
}

function splitBefore(text: string, index: number): Token[] {
  const from = Math.max(0, index - 140);
  const slice = text.slice(from, index);
  let cut = 0;
  for (const m of slice.matchAll(CLAUSE_BREAK)) cut = m.index + 1;
  const tokens: Token[] = [];
  for (const m of slice.slice(cut).matchAll(WORD)) {
    const start = from + cut + m.index;
    const end = start + m[0].length;
    tokens.push({
      w: m[0].toLowerCase().replaceAll("’", "'"),
      start,
      end,
      hyphen: text[end] === "-",
    });
  }
  // "a-t-il": the euphonic t is no word.
  return tokens
    .filter((t, i) => !(t.w === "t" && t.hyphen && text[t.start - 1] === "-" && i > 0))
    .reverse();
}

/** Up to `limit` words of the same clause after `index`, in order. */
export function tokensAfter(text: string, index: number, limit = 4): Token[] {
  cacheFor(text);
  let all = afterCache.get(index);
  if (!all) {
    all = splitAfter(text, index);
    afterCache.set(index, all);
  }
  return all.slice(0, limit);
}

function splitAfter(text: string, index: number): Token[] {
  const slice = text.slice(index, index + 100);
  const stop = slice.search(/[^\p{L}\p{M} \t  '’-]/u);
  const tokens: Token[] = [];
  for (const m of slice.slice(0, stop < 0 ? undefined : stop).matchAll(WORD)) {
    const start = index + m.index;
    const end = start + m[0].length;
    tokens.push({
      w: m[0].toLowerCase().replaceAll("’", "'"),
      start,
      end,
      hyphen: text[end] === "-",
    });
  }
  return tokens;
}

export const SUBJECT_PRONOUNS = new Set([
  "je",
  "j'",
  "tu",
  "il",
  "elle",
  "on",
  "nous",
  "vous",
  "ils",
  "elles",
]);
/** Object and reflexive pronouns that sit between a subject and its verb. */
export const CLITICS = new Set([
  "me",
  "m'",
  "te",
  "t'",
  "se",
  "s'",
  "nous",
  "vous",
  "le",
  "la",
  "les",
  "l'",
  "lui",
  "leur",
  "y",
  "en",
]);

/** Owned French words in the chunk: a letter run (no digits or underscores glued on). */
export function* ownedFrenchWords(ctx: DetectContext, pattern: RegExp) {
  const regex = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  regex.lastIndex = Math.max(0, ctx.from - 1);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index < ctx.from) continue;
    yield m;
  }
}

/**
 * A finding on one word unless the user's dictionary holds it, its casing is unusual (a name,
 * an acronym) or it sits inside a named example.
 */
export function wordFinding(
  ctx: DetectContext,
  start: number,
  typed: string,
  alternatives: string[],
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  context?: { start: number; end: number },
): RawFinding | null {
  if (ctx.dictionary.has(typed.toLowerCase())) return null;
  if (applyWordCase(typed, detectWordCase(typed)) !== typed) return null;
  if (namedExampleBefore(ctx.text, start)) return null;
  const cased = [...new Set(alternatives.map((alt) => carryCase(typed, alt)))];
  if (cased.includes(typed) || !cased.length) return null;
  return finding(ruleId, messageKey, start, start + typed.length, cased, {
    ...(context ? { context } : {}),
    ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
  });
}

/** A capitalized word inside a sentence: a name ("Vitré", "Rodez"), not a verb. */
export function capitalizedName(text: string, index: number, word: string): boolean {
  if (!/^\p{Lu}/u.test(word)) return false;
  return !/(?:^|[.!?…:;«»"“”—–-]|\n)[\s  ]*$/u.test(text.slice(Math.max(0, index - 6), index));
}
