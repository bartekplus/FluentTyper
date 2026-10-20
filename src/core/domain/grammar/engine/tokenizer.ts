import type { Casing, Token, TokenType } from "./types";

/*
 * One pass from text to tokens. Whitespace is no token: each token keeps the whitespace
 * before it. URLs, e-mail addresses, paths, inline code, emoji shortcodes and masked text
 * (U+FFFC) become one "protected" token, so no rule matches inside them.
 */

// Protected kinds are tried only when the text holds their trigger character: a branch
// that cannot match still costs a scan of every word.
const PROTECTED: readonly { trigger: (text: string) => boolean; source: string }[] = [
  { trigger: (t) => t.includes("￼"), source: "\\uFFFC+" },
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
// Groups: 1 protected, 2 number, 3 word, 4 whitespace, 5 punctuation; else a symbol.
const PLAIN = [
  "(\\p{N}+(?:[.,]\\p{N}+)*)",
  "([\\p{L}\\p{M}][\\p{L}\\p{M}\\p{N}]*(?:['’][\\p{L}\\p{M}\\p{N}]+)*)",
  "(\\s+)",
  "(\\p{P})",
  "[\\s\\S]",
].join("|");
const REGEXES = new Map<number, RegExp>();

function tokenRegex(text: string): RegExp {
  let mask = 0;
  PROTECTED.forEach((kind, bit) => {
    if (kind.trigger(text)) mask |= 1 << bit;
  });
  let regex = REGEXES.get(mask);
  if (!regex) {
    const kinds = PROTECTED.filter((_, bit) => mask & (1 << bit)).map((kind) => kind.source);
    // An empty first group keeps the group numbers when no protected kind applies.
    regex = new RegExp(`(${kinds.length ? kinds.join("|") : "(?!)"})|${PLAIN}`, "gu");
    REGEXES.set(mask, regex);
  }
  return regex;
}

// U+037E is the Greek question mark.
const SENTENCE_END = new Set([".", "!", "?", "؟", "‼", "⁇", ";"]);
// Closing marks between a sentence end and the next sentence: 'Stop!" She'.
const CLOSERS = new Set(['"', "'", "”", "’", "»", "«", ")", "]", "}", "›"]);
// Opening marks at a sentence start pass the start on to the next word: "(Then", "¿Qué".
const OPENERS = new Set(["(", "[", "{", "“", "‘", "„", "‚", "‹", "¿", "¡"]);
const ARABIC_MARKS = /[ً-ٰٟـ]/g;

/** The token key: lowercase, without Arabic harakat and tatweel. */
export function tokenKey(text: string): string {
  const lower = text.toLowerCase();
  return /[؀-ۿ]/.test(lower) ? lower.replace(ARABIC_MARKS, "") : lower;
}

/** The casing of the letters of `text`. */
export function casingOf(text: string): Casing {
  let letters = 0;
  let upper = 0;
  let firstUpper = false;
  for (const char of text) {
    const lower = char.toLowerCase();
    const up = char.toUpperCase();
    if (lower === up) continue;
    letters += 1;
    if (char !== lower) {
      upper += 1;
      if (letters === 1) firstUpper = true;
    }
  }
  if (letters === 0) return "none";
  if (upper === 0) return "lower";
  if (upper === letters) return letters === 1 ? "title" : "upper";
  return firstUpper && upper === 1 ? "title" : "mixed";
}

/**
 * The tokens of text[start, end). A token is cut at `end`; the caller gives a window that
 * starts and ends at whitespace when the cut matters. Offsets are offsets into `text`.
 * Sentence starts are only known from the window start on.
 */
export function tokenize(text: string, start = 0, end = text.length): Token[] {
  const slice = start === 0 && end === text.length ? text : text.slice(start, end);
  const regex = tokenRegex(slice);
  const tokens: Token[] = [];
  let space = "";
  let sentenceStart = true;
  let pendingEnd = false;
  regex.lastIndex = 0;
  for (let m = regex.exec(slice); m; m = regex.exec(slice)) {
    const value = m[0];
    if (m[4] !== undefined) {
      space += value;
      if (/\n[^\S\n]*\n/.test(space)) pendingEnd = true;
      continue;
    }
    const type: TokenType =
      m[1] !== undefined
        ? "protected"
        : m[2] !== undefined
          ? "number"
          : m[3] !== undefined
            ? "word"
            : m[5] !== undefined
              ? "punct"
              : "symbol";
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
