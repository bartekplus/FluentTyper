import { wordKey as plainWordKey } from "../implementations/helpers/GenericRuleShared";
import { EDGE, SPACE, TOKEN_END } from "../review/phraseTemplates";
import type { PhraseRow } from "./rows";
import type { Token } from "./types";

/*
 * The phrase-table kind of the engine: rows of literal words ("typed = fix") indexed by their
 * first word. scanRows walks the engine tokens of a chunk; each word reads the rows that start
 * with it, and a row is confirmed by its literal matcher, compiled on the row's first lookup.
 */

/** A compiled phrase row: its literal matcher and its fix. */
export type PhraseEntry = {
  /** The typed words only: literals and spaces. Compiled on the row's first lookup, so the
   * first Review call does not build thousands of regexes it never reads. */
  source: string;
  body?: RegExp;
  /** Ends in a letter or digit: the next character must not continue the word. */
  bounded: boolean;
  replacements: readonly string[];
  ruleId: string;
  messageKey: string;
  length: number;
  /** The second word's key when it is a whole word after one space: other rows are skipped. */
  second: string | null;
};

// A word keeps its combining marks: Arabic harakat and shadda sit between its letters.
export const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
// Arabic harakat, shadda, sukun, the dagger alif and the tatweel: optional in writing.
const HARAKAT = "[\\u064B-\\u065F\\u0670\\u0640]";
const stripHarakat = (word: string) => word.replace(new RegExp(HARAKAT, "gu"), "");
export const wordKey = (word: string) => stripHarakat(plainWordKey(word));
/** A row's second word, when the text's next word must equal it for the row to match. */
function secondKey(form: string): string | null {
  const [first, second] = form.split(" ");
  if (second === undefined || first.match(WORD)?.[0] !== first) return null;
  const word = second.match(WORD)?.[0];
  // "years'" ends on its apostrophe, which the text's word may continue ("years's").
  if (!word || !second.startsWith(word) || /^['’]/.test(second.slice(word.length))) return null;
  return /^[\x20-\x7e]+$/.test(word) ? wordKey(word) : null;
}
// The word after one run of spaces. ASCII only: case-insensitive matching folds a few other
// letters onto ASCII ones (U+212A Kelvin sign ~ k), so those text words skip no row.
const NEXT_WORD = /[ \t\u00a0]{1,8}([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)/uy;
export function nextWordKey(text: string, end: number): string | null {
  NEXT_WORD.lastIndex = end;
  const word = NEXT_WORD.exec(text)?.[1];
  if (word === undefined) return "";
  return /^[\x20-\x7e’]+$/.test(word) ? wordKey(word) : null;
}

// French elided articles and pronouns stay attached: "l'addresse", "d'apeller".
const ELIDED = "(?:[cdjlmnst]|qu|jusqu|lorsqu|puisqu)['’]";
export const FRENCH_ELIDED = new RegExp(`^${ELIDED}(?=\\p{L})`, "iu");

// Word boundaries are checked once per position, not compiled into every row: a
// Unicode property class costs about a millisecond per regex to build in V8.
const WORD_STARTS = new Map(
  ["en", "fr"].map((lang) => [
    lang,
    new RegExp(
      `(?<![.])${lang === "fr" ? `(?:(?<=(?<!\\p{L})${ELIDED})|(?<!${EDGE}))` : `(?<!${EDGE})`}`,
      "iuy",
    ),
  ]),
);
const WORD_ENDS = new RegExp(TOKEN_END, "iuy");
// Arabic "و" (and) and "ف" (so) are written onto the next word: "وقال", "فإن".
WORD_STARTS.set(
  "ar",
  new RegExp(`(?<![.])(?:(?<=(?<![\\p{L}\\p{M}])[وف]\\p{M}*)|(?<!${EDGE}))`, "uy"),
);
/** "و" or "ف" with its harakat before a word of two letters or more: "وَقال". */
export const ARABIC_PREFIX = /^[وف]\p{M}*(?=\p{L}\p{M}*\p{L})/u;
export const startsWord = (text: string, at: number, lang: string) => {
  const regex = WORD_STARTS.get(lang === "fr" || lang === "ar" ? lang : "en")!;
  regex.lastIndex = at;
  return regex.test(text);
};

/** Phrase rows by the key of their first word, longest first: one map read per word. */
export type PhraseIndex = Map<string, PhraseEntry[]>;

/** Adds `rows` to `INDEX` for text in `lang`; rows of equal length keep table order. */
export function addRows(
  INDEX: PhraseIndex,
  lang: string,
  rows: readonly PhraseRow[] = [],
  ruleId: string,
  messageKey: string,
) {
  for (const [typed, replacement] of rows) {
    for (const row of [typed].flat()) {
      // Arabic rows match with or without harakat on either side.
      const form = lang === "ar" ? stripHarakat(row) : row;
      const body = form
        .split(" ")
        .map((word) => {
          const literal = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]");
          return lang === "ar" ? literal.replace(/\p{L}/gu, `$&${HARAKAT}*`) : literal;
        })
        .join(SPACE);
      const key = wordKey(form.match(WORD)![0]);
      const list = INDEX.get(key) ?? [];
      list.push({
        source: body,
        bounded: /[\p{L}\p{N}]$/u.test(form),
        replacements: [replacement].flat(),
        ruleId,
        messageKey,
        length: form.length,
        second: secondKey(form),
      });
      INDEX.set(key, list);
    }
  }
  // Stable: rows of equal length keep table order.
  for (const list of INDEX.values()) list.sort((a, b) => b.length - a.length);
}

/** A row typed at `at`: its words, then (for a bounded row) no word continuing them. */
export function matchPhrase(text: string, phrase: PhraseEntry, at: number): RegExpExecArray | null {
  const body = (phrase.body ??= new RegExp(phrase.source, "iuy"));
  body.lastIndex = at;
  const match = body.exec(text);
  if (!match || !phrase.bounded) return match;
  WORD_ENDS.lastIndex = at + match[0].length;
  return WORD_ENDS.test(text) ? match : null;
}

/**
 * The phrase rows of `INDEX` in the chunk [from, to) of `text`. Each word token looks up the
 * rows that start with it, longest first, and the first row that matches decides the word.
 * A French elided article or an Arabic "و"/"ف" glued to the word gives a second lookup after
 * it. `accept` turns a match into a finding and returns the end to resume at, or null.
 */
export function scanRows(
  tokens: readonly Token[],
  text: string,
  from: number,
  to: number,
  lang: string,
  INDEX: PhraseIndex,
  uses: (entry: PhraseEntry) => boolean,
  accept: (entry: PhraseEntry, typed: string, start: number) => number | null,
): void {
  const words = new RegExp(WORD.source, "uy");
  let cursor = from;
  for (const token of tokens) {
    if (token.start >= to) break;
    if (token.end <= cursor || (token.type !== "word" && token.type !== "number")) continue;
    let start = token.start;
    let word = token.text;
    if (start < cursor) {
      // The chunk or a finding starts inside this word: the word rule resumes there.
      let found: RegExpExecArray | null = null;
      for (let at = cursor; at < token.end && !found; at += 1) {
        words.lastIndex = at;
        found = words.exec(text);
      }
      if (!found) continue;
      [start, word] = [found.index, found[0]];
      if (start >= to) break;
    }
    cursor = start + word.length;
    const elided =
      lang === "fr"
        ? (FRENCH_ELIDED.exec(word)?.[0].length ?? 0)
        : lang === "ar"
          ? (ARABIC_PREFIX.exec(word)?.[0].length ?? 0)
          : 0;
    lookup: for (const at of elided ? [0, elided] : [0]) {
      const phrases = INDEX.get(wordKey(word.slice(at)));
      if (!phrases || !startsWord(text, start + at, lang)) continue;
      let next: string | null | undefined;
      for (const phrase of phrases) {
        if (!uses(phrase)) continue;
        if (phrase.second !== null) {
          next ??= nextWordKey(text, start + word.length);
          if (next !== null && next !== phrase.second) continue;
        }
        const match = matchPhrase(text, phrase, start + at);
        if (!match) continue;
        const end = accept(phrase, match[0], match.index);
        if (end !== null) cursor = end;
        break lookup;
      }
    }
  }
}
