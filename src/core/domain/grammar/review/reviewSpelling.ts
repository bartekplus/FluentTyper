import { startsSentence } from "../implementations/CapitalizeSentenceStartRule";
import { MASK_CHAR } from "./reviewDetectors";
import type { PreparedReview } from "./reviewDiagnostics";
import type { TextRange } from "./types";

/**
 * Review spelling: words the language's dictionary does not know, offered with
 * a short list of replacements to choose from. The lookup itself is the same
 * local Presage engine (Hunspell and Aspell predictors) that suggests words
 * while typing; this module only decides which words to ask about and which
 * of Presage's candidates are close enough to offer. Nothing is ever applied
 * without the user picking a word.
 */

/** One word to look up. `before` is up to two preceding words, for ranking. */
export interface SpellingCandidate {
  range: TextRange;
  /** The word as written. */
  word: string;
  /** The word as looked up: typographic apostrophes made plain. */
  lookup: string;
  before: string;
}

export const MAX_SPELLING_SUGGESTIONS = 5;
const MIN_WORD_CHARS = 2;
const MAX_WORD_CHARS = 40;

// Letters with their combining marks ("e\u0301"), joined by inner apostrophes.
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;
// Separate from WORD: String#match resets a shared regex's lastIndex.
const CONTEXT_WORD = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;
const SUGGESTION = /^\p{L}+(?:['’]\p{L}+)*$/u;
// A word glued to these is part of a number, path, handle, identifier or compound.
const GLUE = /[\p{N}_@#$%&/\\=+*<>~^`|-]/u;
const SENTENCE_BREAK = /[.!?\n￼]/u;

/**
 * Words worth a dictionary lookup, in document order: prose words inside the
 * scope that no other finding already covers. Left out, because a dictionary
 * miss there is usually deliberate or not a word: anything touching protected
 * text, glued to digits, symbols or hyphens, mixed case ("iPhone", "NASA"),
 * a capitalized word inside a sentence (a name), and the user's own words.
 */
export function spellingCandidates(
  prepared: PreparedReview,
  covered: readonly TextRange[],
): SpellingCandidate[] {
  const { text } = prepared;
  const { scope } = prepared.snapshot;
  const protectedRanges = prepared.protectedRanges;
  const taken = [...covered].sort((a, b) => a.start - b.start);
  let nextProtected = 0;
  let nextTaken = 0;
  const candidates: SpellingCandidate[] = [];
  WORD.lastIndex = scope.start;
  for (let match = WORD.exec(text); match && match.index < scope.end; match = WORD.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    const word = match[0];
    if (end > scope.end) break;
    while (nextProtected < protectedRanges.length && protectedRanges[nextProtected].end <= start) {
      nextProtected += 1;
    }
    while (nextTaken < taken.length && taken[nextTaken].end <= start) nextTaken += 1;
    if (
      (nextProtected < protectedRanges.length && protectedRanges[nextProtected].start < end) ||
      (nextTaken < taken.length && taken[nextTaken].start < end)
    ) {
      continue;
    }
    if (word.length < MIN_WORD_CHARS || word.length > MAX_WORD_CHARS) continue;
    const previous = text[start - 1] ?? "";
    const next = text[end] ?? "";
    // A selection that starts inside a word ("c|arefully") holds only part of it:
    // the part is not a word to look up. (A word running past the end is cut above.)
    if (/[\p{L}\p{M}\p{N}]/u.test(previous)) continue;
    if (/['’]/u.test(previous) && /[\p{L}\p{M}\p{N}]/u.test(text[start - 2] ?? "")) continue;
    if (GLUE.test(previous) || GLUE.test(next) || previous === MASK_CHAR || next === MASK_CHAR) {
      continue;
    }
    // "example.com", "e.g": a dot joining letters is not a sentence end.
    if (next === "." && /\p{L}/u.test(text[end + 1] ?? "")) continue;
    if (previous === "." && start >= 2 && /\p{L}/u.test(text[start - 2])) continue;
    const rest = word.slice(1);
    if (/\p{Lu}/u.test(rest)) continue;
    if (/\p{Lu}/u.test(word[0]) && !opensSentence(prepared, start)) continue;
    const lookup = word.replace(/’/g, "'");
    if (
      prepared.dictionary.has(lookup.toLowerCase()) ||
      prepared.dictionary.has(word.toLowerCase())
    )
      continue;
    candidates.push({ range: { start, end }, word, lookup, before: wordsBefore(text, start) });
  }
  return candidates;
}

function opensSentence(prepared: PreparedReview, start: number): boolean {
  const { text } = prepared;
  let i = start - 1;
  while (i >= 0 && (text[i] === " " || text[i] === "\t" || text[i] === " ")) i -= 1;
  if (i < 0 || text[i] === "\n") return true;
  // An opening quote or bracket before the word: look past it.
  if (/[("'“‘«¿¡[]/u.test(text[i])) return opensSentence(prepared, i);
  return startsSentence(text, start, prepared.options.lang);
}

/** Up to two words before `start` in the same sentence, for ranking candidates in context. */
function wordsBefore(text: string, start: number): string {
  const window = text.slice(Math.max(0, start - 48), start);
  let cut = 0;
  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (SENTENCE_BREAK.test(window[i])) {
      cut = i + 1;
      break;
    }
  }
  const words = window.slice(cut).match(CONTEXT_WORD) ?? [];
  // The first word of a cut-off window may be partial.
  const complete = cut === 0 && start > 48 ? words.slice(1) : words;
  const last = complete.slice(-2);
  return last.length > 0 ? `${last.join(" ")} ` : "";
}

/** Edit distance with adjacent transpositions ("recieve" is one step from "receive"). */
export function spellingDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const rows: number[][] = [];
  for (let i = 0; i <= x.length; i += 1) rows.push([i, ...new Array<number>(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        best = Math.min(best, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = best;
    }
  }
  return rows[x.length][y.length];
}

/**
 * How far a suggestion may be from the word. Real typos are one or two edits
 * away ("wich", "recieve", "definately", "irregardless"); a word only reachable
 * by more ("changelog" -> "changeling") is more likely correct and unlisted.
 */
function maxDistance(word: string): number {
  return [...word].length <= 5 ? 1 : 2;
}

/**
 * The replacements to offer for an unknown `word`, best first, from Presage's
 * candidates (already ranked for the preceding words). Only single words close
 * to what was written are kept, closest first; Presage's order breaks ties.
 * Completions ("wa" -> "water") are not corrections and fall out here, and a
 * word the dictionary can split into two words gets no suggestions at all.
 */
export function rankSpellingSuggestions(word: string, candidates: readonly string[]): string[] {
  const lower = word.replace(/’/g, "'").toLowerCase();
  if (isCompound(lower, candidates)) return [];
  const limit = maxDistance(lower);
  const seen = new Set<string>([lower]);
  const lowercase = !/\p{Lu}/u.test(word);
  const ranked: Array<{ text: string; distance: number; order: number }> = [];
  candidates.forEach((candidate, order) => {
    const text = candidate.trim();
    if (!SUGGESTION.test(text)) return;
    const key = text.replace(/’/g, "'").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const distance = spellingDistance(lower, key);
    if (distance > limit) return;
    // A lowercase word is rarely a misspelled name: names rank after words.
    const name = lowercase && /\p{Lu}/u.test(text[0]);
    ranked.push({ text, distance: distance + (name ? 1 : 0), order });
  });
  ranked.sort((a, b) => a.distance - b.distance || a.order - b.order);
  return ranked.slice(0, MAX_SPELLING_SUGGESTIONS).map(({ text }) => matchStyle(word, text));
}

/**
 * True when the dictionary offers the word split into two words of three or
 * more letters ("changelog" -> "change log", "webhook" -> "web hook"): a
 * compound the dictionary lacks, usually deliberate, not a typo. Real typos
 * split only into fragments ("occured" -> "occur ed").
 */
function isCompound(lower: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => {
    const parts = /^(\p{L}{3,})[ -](\p{L}{3,})$/u.exec(candidate.trim());
    return !!parts && (parts[1] + parts[2]).toLowerCase() === lower;
  });
}

/** A capitalized word gets capitalized suggestions; its apostrophe style is kept. */
function matchStyle(word: string, suggestion: string): string {
  let styled = word.includes("’") ? suggestion.replace(/'/g, "’") : suggestion;
  if (/\p{Lu}/u.test(word[0]) && !/\p{Lu}/u.test(styled[0])) {
    styled = styled[0].toUpperCase() + styled.slice(1);
  }
  return styled;
}

/** Words per lookup request; the session sends larger documents in several. */
export const MAX_SPELLING_BATCH = 100;
const LOOKUP_WORD = /^\p{L}+(?:'\p{L}+)*$/u;
const MAX_BEFORE_CHARS = 100;

/**
 * Validates a lookup request from a content script: a language and a bounded
 * list of plain words, each with a short context. Anything else is refused.
 */
export function parseSpellingRequest(
  value: unknown,
): { lang: string; words: Array<{ word: string; before: string }> } | null {
  if (typeof value !== "object" || value === null) return null;
  const { lang, words } = value as { lang?: unknown; words?: unknown };
  if (typeof lang !== "string" || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(lang)) return null;
  if (!Array.isArray(words) || words.length === 0 || words.length > MAX_SPELLING_BATCH) {
    return null;
  }
  const parsed: Array<{ word: string; before: string }> = [];
  for (const item of words as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { word, before } = item as { word?: unknown; before?: unknown };
    if (
      typeof word !== "string" ||
      word.length > MAX_WORD_CHARS ||
      !LOOKUP_WORD.test(word) ||
      typeof before !== "string" ||
      before.length > MAX_BEFORE_CHARS
    ) {
      return null;
    }
    parsed.push({ word, before });
  }
  return { lang, words: parsed };
}
