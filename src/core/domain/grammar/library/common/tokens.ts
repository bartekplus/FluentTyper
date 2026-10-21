// The rule library (library.ts): tokens around an index of the text, and the windows of the
// end-anchored phrase patterns of the typing rules.
import type { FrameRef } from "../../engine/reviewRules";
import type { DetectContext } from "../../review/reviewDetectors";
import { MASK_CHAR, type TextRange } from "../../review/types";

const WORD_CHAR = /[\p{L}\p{N}_'’]/u;

/**
 * /[\p{L}\p{N}_'’]/u.test(text[index] ?? ""): an ASCII character is read by its code, without
 * the regex. Outside the text, charCodeAt gives NaN and the result is false.
 */
export function isWordCharAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  if (!(code >= 128)) {
    if (code >= 97) return code <= 122;
    if (code >= 65) return code <= 90 || code === 95;
    return code >= 48 ? code <= 57 : code === 39;
  }
  return WORD_CHAR.test(text[index]);
}

// Characters that glue a word into a mention, path, file or dotted name: /[@#/\\_=$]/ by code.
const isTechnicalGlueAt = (text: string, index: number) => {
  const code = text.charCodeAt(index);
  return (
    code === 64 ||
    code === 35 ||
    code === 47 ||
    code === 92 ||
    code === 95 ||
    code === 61 ||
    code === 36
  );
};

/** True when [start, end) is glued to a technical token in `text` ("@i", "src/dont", "teh.com"). */
export function isGluedToTechnical(text: string, start: number, end: number): boolean {
  if (isTechnicalGlueAt(text, start - 1) || isTechnicalGlueAt(text, end)) return true;
  const before = text[start - 1] ?? "";
  const after = text[end] ?? "";
  if (before === MASK_CHAR || after === MASK_CHAR) return true;
  // A period is a sentence end unless a word character continues the token.
  if (before === "." && isWordCharAt(text, start - 2)) return true;
  return after === "." && isWordCharAt(text, end + 1);
}

/** True when `start` is in the chunk of `ctx`: a finding there belongs to this chunk. */
export const ownedByChunk = (ctx: DetectContext, start: number) =>
  start >= ctx.from && start < ctx.to;

/**
 * `text.lastIndexOf(needle, position)` for non-decreasing positions, reading each character
 * once: per-match line or paragraph lookups on a long line would otherwise rescan it for every
 * match.
 */
function lastIndexFinder(text: string, needle: string): (position: number) => number {
  let searched = 0;
  let last = -1;
  return (position) => {
    if (position < searched) return text.lastIndexOf(needle, position);
    const found = text.slice(searched, position + needle.length).lastIndexOf(needle);
    if (found >= 0) last = searched + found;
    searched = position + 1;
    return last;
  };
}

// Per chunk: the frames of a chunk share their finders.
const FINDERS = new WeakMap<DetectContext, Map<string, (position: number) => number>>();

/** `ctx.text.lastIndexOf(needle, position)`, read once per chunk for rising positions. */
export function lastIndexInChunk(ctx: DetectContext, needle: string, position: number): number {
  let finders = FINDERS.get(ctx);
  if (!finders) FINDERS.set(ctx, (finders = new Map<string, (position: number) => number>()));
  let finder = finders.get(needle);
  if (!finder) finders.set(needle, (finder = lastIndexFinder(ctx.text, needle)));
  return finder(position);
}

/**
 * Start of the `count` whitespace-separated tokens before `index` (at most 64 characters back):
 * the evidence a sentence-start decision reads.
 */
export function previousTokensStart(text: string, index: number, count: number): number {
  const limit = Math.max(0, index - 64);
  let position = index;
  for (let token = 0; token < count && position > limit; token += 1) {
    while (position > limit && /\s/.test(text[position - 1])) position -= 1;
    while (position > limit && !/\s/.test(text[position - 1])) position -= 1;
  }
  return position;
}

/** JavaScript's \s by code unit: phrase windows test it once per character they widen over. */
export function isWhitespaceAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(text[index]));
}

/** The lowercase code of text[index] for an ASCII letter: "| 32" maps only "A"-"Z" to "a"-"z". */
export const lowerCodeAt = (text: string, index: number) => text.charCodeAt(index) | 32;

/**
 * The end of the token before the whitespace run that ends at `at`. -1 when the character
 * before `at` is not whitespace.
 */
export function tokenEndBefore(text: string, at: number): number {
  if (at < 1 || !isWhitespaceAt(text, at - 1)) return -1;
  let i = at - 1;
  while (i > 0 && isWhitespaceAt(text, i - 1)) i -= 1;
  return i;
}

/** The start of the non-whitespace token that ends at `end`. */
export function tokenStartBefore(text: string, end: number): number {
  let i = end;
  while (i > 0 && !isWhitespaceAt(text, i - 1)) i -= 1;
  return i;
}

/** The end of the non-whitespace token that starts at `start`. */
export function tokenEndAfter(text: string, start: number): number {
  let i = start;
  while (i < text.length && !isWhitespaceAt(text, i)) i += 1;
  return i;
}

/** The index before the run of characters that match `char` (one character) and end at `index`. */
export function skipBackWhile(text: string, index: number, char: RegExp): number {
  let i = index;
  while (i > 0 && char.test(text[i - 1])) i -= 1;
  return i;
}

/** The index after the run of characters that match `char` (one character) from `index`. */
export function skipForwardWhile(text: string, index: number, char: RegExp): number {
  let i = index;
  while (i < text.length && char.test(text[i])) i += 1;
  return i;
}

/**
 * An owned or text scan reads its next match from `index` (for a frame whose match must start
 * at a token start). True, so that a condition can call it.
 */
export function resumeScan(frame: FrameRef, index: number): boolean {
  frame.resume!(index);
  return true;
}

// Stateless (no g or y flag) copies of the typing rules' patterns, compiled once each.
const PHRASE_REGEX = new WeakMap<RegExp, RegExp>();
// Enough context for every phrase pattern; the patterns themselves are shorter.
const PHRASE_WINDOW = 96;

/**
 * Runs an end-anchored pattern at the end of `word` (a frame match of an ASCII-letter word,
 * [A-Za-z]+) when `lastWord` (a quick test of the word) is true. The window holds the last
 * `tokens` whitespace-separated tokens up to the word: all the pattern can span, and it starts on
 * a token boundary so "^" in a pattern never lands mid-text. The match has absolute group
 * indices; null when the pattern does not match, the match starts outside the chunk or it is
 * glued to a technical token.
 */
export function phraseMatch(
  ctx: DetectContext,
  word: RegExpExecArray,
  pattern: RegExp,
  tokens: number,
  lastWord: (text: string, start: number, end: number) => boolean,
): { match: RegExpExecArray; start: number; end: number } | null {
  const wordStart = word.index;
  const wordEnd = wordStart + word[0].length;
  // Letters glued to other word characters are part of a longer token ("teh2").
  if (isWordCharAt(ctx.text, wordStart - 1) || isWordCharAt(ctx.text, wordEnd)) return null;
  if (!lastWord(ctx.text, wordStart, wordEnd)) return null;
  let regex = PHRASE_REGEX.get(pattern);
  if (!regex)
    PHRASE_REGEX.set(
      pattern,
      (regex = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}d`)),
    );
  const limit = Math.max(0, wordEnd - PHRASE_WINDOW);
  let windowStart = wordStart;
  while (windowStart > limit && !isWhitespaceAt(ctx.text, windowStart - 1)) windowStart -= 1;
  if (windowStart > 0 && !isWhitespaceAt(ctx.text, windowStart - 1)) return null;
  for (let count = 1; count < tokens; count += 1) {
    let i = windowStart;
    while (i > limit && isWhitespaceAt(ctx.text, i - 1)) i -= 1;
    while (i > limit && !isWhitespaceAt(ctx.text, i - 1)) i -= 1;
    if (i > 0 && !isWhitespaceAt(ctx.text, i - 1)) break;
    windowStart = i;
  }
  const match = regex.exec(ctx.text.slice(windowStart, wordEnd));
  if (!match) return null;
  const start = windowStart + match.index;
  if (!ownedByChunk(ctx, start) || isGluedToTechnical(ctx.text, start, wordEnd)) return null;
  // Absolute group indices.
  match.indices = match.indices?.map((pair) =>
    pair ? [pair[0] + windowStart, pair[1] + windowStart] : pair,
  ) as RegExpIndicesArray;
  return { match, start, end: wordEnd };
}

/** The range of group `group` of a match with indices. */
export function groupRange(match: RegExpExecArray, group: number): TextRange {
  const [start, end] = match.indices![group]!;
  return { start, end };
}
