// German text helpers of the rule library (library/german.ts): the tokens around a position,
// English lines, and the casing of a typed word.

/** `word` with a capital first letter when `typed` starts with one ("Wegen" → "Weil"). */
export const likeTyped = (typed: string, word: string) =>
  /^\p{Lu}/u.test(typed) ? word[0].toUpperCase() + word.slice(1) : word;

// Words (with "_", "/" or "-" joins: "Pädagog_in", "Partner/in", "Grammatik-Regeln"), line
// breaks and single marks; a hyphen at a word edge ("Vor- und") stays a mark.
const TOKEN = /\n|[\p{L}\p{M}\p{N}_]+(?:[-/][\p{L}\p{M}\p{N}_]+)*|[^\s\p{L}\p{M}\p{N}_]/gu;

// One token pass for each text: the German checks ask for the tokens around many positions.
type TokenIndex = { starts: number[]; ends: number[] };
const TOKEN_INDEXES = new Map<string, TokenIndex>();

function tokenIndex(text: string): TokenIndex {
  let index = TOKEN_INDEXES.get(text);
  if (index) return index;
  index = { starts: [], ends: [] };
  for (const m of text.matchAll(TOKEN)) {
    index.starts.push(m.index);
    index.ends.push(m.index + m[0].length);
  }
  if (TOKEN_INDEXES.size >= 4) TOKEN_INDEXES.delete(TOKEN_INDEXES.keys().next().value!);
  TOKEN_INDEXES.set(text, index);
  return index;
}

/** The first token that starts at or after `at`. */
function firstFrom(starts: number[], at: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The tokens of text[start, end) as `match(TOKEN)` gives them, from the shared pass: the index
 * range [a, b) of the whole tokens, and whether an edge cuts a token (`cutStart`, `cutEnd`). A
 * cut token reads otherwise in the window; the tokens between the cuts read the same.
 */
function windowTokens(text: string, start: number, end: number) {
  const index = tokenIndex(text);
  const a = firstFrom(index.starts, start);
  const b = firstFrom(index.starts, end);
  const cutStart = a > 0 && index.ends[a - 1] > start;
  const cutEnd = b > 0 && index.ends[b - 1] > end;
  // A cut token at the end is not whole in the window.
  return { index, a, b: cutEnd ? b - 1 : b, cutStart, cutEnd };
}

const read = ({ starts, ends }: TokenIndex, text: string, from: number, to: number) => {
  const out: string[] = [];
  for (let i = from; i < to; i++) out.push(text.slice(starts[i], ends[i]));
  return out;
};

/** Up to `n` tokens right before `index`, nearest last; a line break is a token. */
export function tokensBefore(text: string, index: number, n: number): string[] {
  const start = Math.max(0, index - 16 * n);
  // The first token may be cut by the window.
  const skip = start > 0 ? 1 : 0;
  const { index: tokens, a, b, cutStart, cutEnd } = windowTokens(text, start, index);
  // A cut first token is the one skipped; with n whole tokens after it, only those are read.
  if (!cutEnd && (!cutStart || b - a >= n)) {
    return read(tokens, text, Math.max(cutStart ? a : a + skip, b - n), b);
  }
  const found = text.slice(start, index).match(TOKEN) ?? [];
  return found.slice(Math.max(skip, found.length - n));
}

/** Up to `n` tokens right after `index`. */
export function tokensAfter(text: string, index: number, n: number): string[] {
  const {
    index: tokens,
    a,
    b,
    cutStart,
    cutEnd,
  } = windowTokens(text, index, Math.min(text.length, index + 16 * n));
  // A cut last token comes after the whole ones: n whole tokens before it are the first n.
  if (!cutStart && (!cutEnd || b - a >= n)) return read(tokens, text, a, Math.min(b, a + n));
  return (text.slice(index, index + 16 * n).match(TOKEN) ?? []).slice(0, n);
}

// English function words that are no German words in lowercase.
const ENGLISH_LIST =
  "the and of with you your is are this that it to for be have has from but not they we my I people our";
const ENGLISH = new RegExp(
  `(?<![\\p{L}'’])(?:${ENGLISH_LIST.replaceAll(" ", "|")})(?![\\p{L}'’])`,
  "gu",
);
const ENGLISH_WORDS = new Set(ENGLISH_LIST.split(" "));
const LETTER_OR_APOSTROPHE = /[\p{L}'’]/u;

/** How many English function words a span holds: quoted or embedded English material. */
export const englishWords = (span: string) => span.match(ENGLISH)?.length ?? 0;

// The English function words of each text, found in one pass: the checks ask about many lines.
const ENGLISH_INDEXES = new Map<string, TokenIndex>();

/** Whether the line around `index` reads as English ("With 15 million people …"). */
export function englishLine(text: string, index: number): boolean {
  const start = Math.max(text.lastIndexOf("\n", index - 1) + 1, index - 120);
  const lineEnd = text.indexOf("\n", index);
  const end = Math.min(lineEnd < 0 ? text.length : lineEnd, index + 120);
  let found = ENGLISH_INDEXES.get(text);
  if (!found) {
    found = { starts: [], ends: [] };
    for (const m of text.matchAll(ENGLISH)) {
      found.starts.push(m.index);
      found.ends.push(m.index + m[0].length);
    }
    if (ENGLISH_INDEXES.size >= 4) ENGLISH_INDEXES.delete(ENGLISH_INDEXES.keys().next().value!);
    ENGLISH_INDEXES.set(text, found);
  }
  // As englishWords counts text[start, end): the words wholly inside it, plus a word that only
  // the cut makes whole, at either edge.
  let count = 0;
  for (let i = firstFrom(found.starts, start); i < found.starts.length; i++) {
    if (found.starts[i] >= end) break;
    if (found.ends[i] <= end) count++;
  }
  const letter = (at: number) => LETTER_OR_APOSTROPHE.test(text[at] ?? "");
  let head = start;
  if (start > 0 && letter(start - 1)) {
    while (head < end && letter(head)) head++;
    if (ENGLISH_WORDS.has(text.slice(start, head))) count++;
  }
  if (end < text.length && letter(end) && head < end) {
    let tail = end;
    while (tail > head && letter(tail - 1)) tail--;
    if (ENGLISH_WORDS.has(text.slice(tail, end))) count++;
  }
  return count >= 2;
}
