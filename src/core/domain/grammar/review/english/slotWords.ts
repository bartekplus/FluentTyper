import {
  englishListedNoun,
  englishWordInfo,
  type EnglishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { detectAll } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { quotedMention } from "./grammarStyle1";

// Shared word-slot helpers for the lexicon-driven grammar frames: a small tokenizer over the
// masked text and closed word classes the generated lexicon has no part of speech for.

export type Token = {
  text: string;
  lower: string;
  start: number;
  end: number;
  /** word: letters (with an inner apostrophe); end: closing punctuation, a line break or the text end. */
  kind: "word" | "number" | "comma" | "end" | "other";
};

const TOKEN =
  /[ \t\u00a0]*(?:(?<word>[A-Za-z]+(?:['’][A-Za-z]+)?)(?![\p{L}\p{M}\p{N}_@/#\\-]|\.[\p{L}\p{N}])|(?<number>\d+(?:[:.,]\d+)*)(?![\p{L}\p{N}_@/#\\-])|(?<comma>,)|(?<end>[.!?;:)\]"”—–…\n]|$))/uy;

/** Up to `count` tokens from `index`; stops after the first end or unreadable token. */
export function tokensAfter(ctx: DetectContext, index: number, count: number): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = index;
  while (tokens.length < count) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(ctx.text);
    const g = m?.groups;
    if (!m || !g) {
      tokens.push({ text: "", lower: "", start: at, end: at, kind: "other" });
      break;
    }
    const text = g.word ?? g.number ?? g.comma ?? g.end ?? "";
    const kind = g.word ? "word" : g.number ? "number" : g.comma ? "comma" : "end";
    const end = m.index + m[0].length;
    tokens.push({ text, lower: text.toLowerCase(), start: end - text.length, end, kind });
    if (kind === "end") break;
    if (end === at) break;
  }
  return tokens;
}

/** The word right before `index` (spaces only between), lowercased; "" after punctuation or at the start. */
export function wordBefore(ctx: DetectContext, index: number): string {
  const m = /(?<![\p{L}\p{N}_'’@/#\\.-])([A-Za-z]+(?:['’][A-Za-z]+)?)[ \t\u00a0]{1,8}$/u.exec(
    ctx.text.slice(Math.max(0, index - 40), index),
  );
  return m ? m[1].toLowerCase() : "";
}

/** Only spaces (and opening quotes) since the previous sentence or clause break, or the text start. */
export function afterBreak(ctx: DetectContext, index: number): boolean {
  return /(?:^|[.!?;:\n"“(—–]|\.\.\.)[ \t\u00a0"“‘']*$/.test(
    ctx.text.slice(Math.max(0, index - 12), index),
  );
}

export const DETERMINERS = new Set(
  "a an the my your our his her their this that these those some any no every each another".split(
    " ",
  ),
);
export const OBJECT_PRONOUNS = new Set("me him us them you her it".split(" "));
export const SUBJECT_PRONOUNS = new Set("i you he she it we they".split(" "));
export const WH_WORDS = new Set("what where when why how who which whatever".split(" "));
export const PREPOSITIONS = new Set(
  (
    "of in on at by for from with without about into onto upon between among through during " +
    "until against near under over toward towards within across along around behind beyond " +
    "inside outside off out up down past via per like despite throughout"
  ).split(" "),
);
// Adverbs the lexicon leaves without a class, plus degree words that also modify adjectives.
export const ADVERBS = new Set(
  (
    "not never always also just still really so too already probably definitely certainly " +
    "actually basically finally simply totally completely absolutely pretty quite rather almost " +
    "nearly sometimes usually often now then here there way far much even only very literally " +
    "seriously truly obviously clearly apparently surely hardly barely maybe perhaps again " +
    "soon once ever all"
  ).split(" "),
);
/** Function words that the lexicon also lists as nouns or verbs ("in", "it", "up", "now"). */
export const FUNCTION_WORDS = new Set([
  ...DETERMINERS,
  ...OBJECT_PRONOUNS,
  ...SUBJECT_PRONOUNS,
  ...WH_WORDS,
  ...PREPOSITIONS,
  ...ADVERBS,
  ..."and or but nor yet so as than if whether because since though although while unless to is are was were be been being am have has had do does did can could will would shall should may might must own other others such same both either neither more most less least few many several".split(
    " ",
  ),
]);
export const BE_FINITE = new Set("is are was were am".split(" "));
export const AUXILIARIES = new Set(
  "is are was were am has have had does do did will would can could shall should may might must".split(
    " ",
  ),
);

/** Lexicon reading, or null for unknown and function words. */
export function info(word: string): EnglishWordInfo | null {
  return FUNCTION_WORDS.has(word) ? null : englishWordInfo(word);
}

/** A word the lexicon (or its long-noun filter) reads only as a noun. */
export function nounOnly(word: string): "singular" | "plural" | null {
  if (FUNCTION_WORDS.has(word)) return null;
  const read = englishWordInfo(word);
  if (!read) return englishListedNoun(word);
  if (!read.noun || read.adjective || read.adverb || read.verbs.length) return null;
  return read.plural ? "plural" : "singular";
}

/** An -ly adverb the lexicon reads as nothing else, or a listed degree/stance adverb. */
export function adverb(word: string): boolean {
  if (ADVERBS.has(word)) return true;
  const read = englishWordInfo(word);
  return (
    !!read && read.adverb && !read.adjective && !read.noun && !read.verbs.length && /ly$/.test(word)
  );
}

/** Lowercase, or all caps in an all-caps stretch; never a user-dictionary word. */
export function plain(ctx: DetectContext, token: string): boolean {
  return token === token.toLowerCase() && !ctx.dictionary.has(token.toLowerCase());
}

/** `replacement` with the first letter of `typed` capitalized when it is. */
export const caseLike = (typed: string, replacement: string) =>
  /^[A-Z]/.test(typed) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;

export const evidence = (ctx: DetectContext, start: number, end: number) => ({
  start: Math.max(0, start - 96),
  end: Math.min(ctx.text.length, end + 40),
});

/**
 * English only; findings inside a quoted or parenthesized example are dropped, and only
 * findings that start in the chunk are kept.
 */
export const english =
  (...detectors: ((ctx: DetectContext) => RawFinding[])[]) =>
  (ctx: DetectContext): RawFinding[] =>
    ctx.lang !== "en_US"
      ? []
      : detectAll(ctx, detectors).filter(
          (f) => f.range.start >= ctx.from && f.range.start < ctx.to && !quotedMention(ctx, f),
        );
