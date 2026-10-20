import type { Casing, Token, TokenType } from "./types";

/*
 * One pass from text to tokens. Whitespace is no token: each token keeps the whitespace
 * before it. Masked text (U+FFFC) is one "protected" token. The tokens of URLs, e-mail
 * addresses, paths, inline code and emoji shortcodes carry `protected`: patterns skip them,
 * and the phrase checks still see their words, as their own guards decide.
 */

// Protected kinds are searched only when the text holds their trigger character.
const PROTECTED: readonly { trigger: (text: string) => boolean; source: string }[] = [
  {
    trigger: (t) => t.includes("://") || t.includes("www."),
    source: "(?:https?:\\/\\/|www\\.)[^\\s<>\"'`]*[^\\s<>\"'`.,;:!?)\\]}]",
  },
  {
    trigger: (t) => t.includes("@"),
    source: "[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)+",
  },
  { trigger: (t) => t.includes("`"), source: "`[^`\\n]+`" },
  { trigger: (t) => t.includes(":"), source: ":[a-z0-9_+-]*[a-z][a-z0-9_+-]*:" },
  {
    trigger: (t) => t.includes("/") || t.includes("\\"),
    source: "(?:~|\\.{1,2})?\\/[\\w.-]+(?:\\/[\\w.-]+)+\\/?|[A-Za-z]:\\\\[^\\s]+",
  },
];
const SPAN_REGEXES = new Map<number, RegExp | null>();

/** The protected spans of `text` ([start, end) pairs, in order). */
function protectedSpans(text: string): number[] {
  let mask = 0;
  PROTECTED.forEach((kind, bit) => {
    if (kind.trigger(text)) mask |= 1 << bit;
  });
  let regex = SPAN_REGEXES.get(mask);
  if (regex === undefined) {
    const kinds = PROTECTED.filter((_, bit) => mask & (1 << bit)).map((kind) => kind.source);
    regex = kinds.length ? new RegExp(kinds.join("|"), "gu") : null;
    SPAN_REGEXES.set(mask, regex);
  }
  const spans: number[] = [];
  if (!regex) return spans;
  regex.lastIndex = 0;
  for (let m = regex.exec(text); m; m = regex.exec(text))
    spans.push(m.index, m.index + m[0].length);
  return spans;
}

// Groups: 1 masked text, 2 word or number, 3 whitespace, 4 punctuation; else a symbol. A word is
// the word of the phrase tables: letters and digits, with combining marks after the first one,
// joined by an apostrophe before a letter or digit ("don't", "l'eau", "2nd"). A word of digits
// only is a number.
const TOKEN =
  /(\uFFFC+)|([\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*)|(\s+)|(\p{P})|[\s\S]/gu;
const DIGITS = /^\p{N}+$/u;
// The same token rule for forEachWord, which must not move TOKEN's lastIndex.
const WORDS = new RegExp(TOKEN.source, "gu");

// U+037E is the Greek question mark.
const SENTENCE_END = new Set([".", "!", "?", "\u061F", "\u203C", "\u2047", "\u037E"]);
// Closing marks between a sentence end and the next sentence: 'Stop!" She'.
const CLOSERS = new Set(['"', "'", "”", "’", "»", "«", ")", "]", "}", "›"]);
// Opening marks at a sentence start pass the start on to the next word: "(Then", "¿Qué".
const OPENERS = new Set(["(", "[", "{", "“", "‘", "„", "‚", "‹", "¿", "¡"]);
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640]/g;

/** The token key: lowercase, without Arabic harakat and tatweel. */
export function tokenKey(text: string): string {
  const lower = text.toLowerCase();
  return /[\u0600-\u06FF]/.test(lower) ? lower.replace(ARABIC_MARKS, "") : lower;
}

/** The casing from letter counts: all lower, all upper, a capital first letter, or mixed. */
function casingFrom(letters: number, upper: number, firstUpper: boolean): Casing {
  if (letters === 0) return "none";
  if (upper === 0) return "lower";
  if (upper === letters) return letters === 1 ? "title" : "upper";
  return firstUpper && upper === 1 ? "title" : "mixed";
}

/** The casing of the letters of `text`. */
export function casingOf(text: string): Casing {
  // ASCII words (most words) need no case mapping per character.
  let letters = 0;
  let upper = 0;
  let firstUpper = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 127) return unicodeCasing(text);
    if (code >= 65 && code <= 90) {
      letters += 1;
      upper += 1;
      if (letters === 1) firstUpper = true;
    } else if (code >= 97 && code <= 122) letters += 1;
  }
  return casingFrom(letters, upper, firstUpper);
}

function unicodeCasing(text: string): Casing {
  let letters = 0;
  let upper = 0;
  let firstUpper = false;
  for (const char of text) {
    const lower = char.toLowerCase();
    if (lower === char.toUpperCase()) continue;
    letters += 1;
    if (char !== lower) {
      upper += 1;
      if (letters === 1) firstUpper = true;
    }
  }
  return casingFrom(letters, upper, firstUpper);
}

/**
 * The tokens of text[start, end), in one pass. A token is cut at `end`; the caller gives a window that
 * starts and ends at whitespace when the cut matters. Offsets are offsets into `text`.
 * Sentence starts are only known from the window start on.
 */
export function tokenize(text: string, start = 0, end = text.length): Token[] {
  const slice = start === 0 && end === text.length ? text : text.slice(start, end);
  const spans = protectedSpans(slice);
  let span = 0;
  const regex = TOKEN;
  const tokens: Token[] = [];
  let space = "";
  let sentenceStart = true;
  let pendingEnd = false;
  regex.lastIndex = 0;
  for (let m = regex.exec(slice); m; m = regex.exec(slice)) {
    const value = m[0];
    if (m[3] !== undefined) {
      space += value;
      if (/\n[^\S\n]*\n/.test(space)) pendingEnd = true;
      continue;
    }
    const type: TokenType =
      m[1] !== undefined
        ? "protected"
        : m[2] !== undefined
          ? DIGITS.test(value)
            ? "number"
            : "word"
          : m[4] !== undefined
            ? "punct"
            : "symbol";
    while (span < spans.length && spans[span + 1] <= m.index) span += 2;
    const inSpan = span < spans.length && spans[span] <= m.index;
    const startsSentence: boolean = sentenceStart || pendingEnd;
    // A closer after a sentence end keeps the next token a sentence start.
    const keepsEnd: boolean = pendingEnd && type === "punct" && CLOSERS.has(value);
    const opens: boolean = startsSentence && !keepsEnd && type === "punct" && OPENERS.has(value);
    tokens.push({
      type,
      text: value,
      key: type === "word" ? tokenKey(value) : value.toLowerCase(),
      start: start + m.index,
      end: start + m.index + value.length,
      space,
      casing: type === "word" ? casingOf(value) : "none",
      sentenceStart: startsSentence && !keepsEnd,
      ...(inSpan ? { protected: true as const } : {}),
    });
    space = "";
    sentenceStart = false;
    pendingEnd = keepsEnd || opens || (type === "punct" && SENTENCE_END.has(value));
  }
  return tokens;
}

/** True when sentence-final punctuation or the text end follows `tokens[index]`. */
export function endsSentence(tokens: readonly Token[], index: number): boolean {
  let next = index + 1;
  while (next < tokens.length && CLOSERS.has(tokens[next].text) && tokens[next].space === "")
    next += 1;
  const token = tokens[next];
  return token === undefined || (token.type === "punct" && SENTENCE_END.has(token.text));
}

/**
 * The word and number tokens of `text` from `start` (a token boundary) on, as tokenize gives
 * them, without token objects: the phrase tables read only words. `visit` returns false to
 * stop.
 */
export function forEachWord(
  text: string,
  start: number,
  visit: (start: number, word: string) => boolean,
): void {
  WORDS.lastIndex = start;
  for (let m = WORDS.exec(text); m; m = WORDS.exec(text))
    if (m[2] !== undefined && !visit(m.index, m[2])) return;
}
