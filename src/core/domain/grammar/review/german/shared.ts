import { wordSet, isLang } from "../phraseTemplates";
import type { DetectContext } from "../reviewDetectors";

export const isGerman = (ctx: DetectContext) => isLang(ctx, "de");

export { wordSet };

/**
 * A gate to put first in a frame that starts with a word: it fails at once on whitespace, where
 * the lookbehinds after it would otherwise be tried at every position of a long run of spaces
 * (slow without the regex JIT). A match at the text's start is still allowed.
 */
export const NOT_BLANK = "(?:^|(?=\\S))";

/**
 * NOT_BLANK and a word start in two cheap tests: not after a letter, digit, mark, "_", "'", "@",
 * "/", "#", "\\", "-" or ".". (The shared WORD_START also lets a frame start at an English
 * clitic such as "'m"; no German frame starts there.)
 */
export const WORD_GATE = `${NOT_BLANK}(?<![.\\p{L}\\p{M}\\p{N}_'’@/#\\\\-])`;

/** A token that ends a clause, or no token at all. */
export const BOUNDARY = /^(?:[.!?:;,()"“”„«»–—\n-]|$)/;

// A word of letters, not glued into a number, path, mention or dotted token.
const WORD =
  /(?<![\p{L}\p{M}\p{N}_@/#\\.-])\p{L}[\p{L}\p{M}]*(?![\p{L}\p{M}\p{N}_@/#\\]|\.\p{L})/gu;

/** The words whose start the chunk owns. */
export function* words(ctx: DetectContext): Generator<RegExpExecArray> {
  WORD.lastIndex = ctx.from;
  for (let m = WORD.exec(ctx.scanText); m && m.index < ctx.to; m = WORD.exec(ctx.scanText)) {
    yield m;
  }
}

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
 * The tokens of text[start, end) as `match(TOKEN)` gives them, from the shared pass. Null when
 * an edge cuts a token: the cut token reads otherwise in the window.
 */
function windowTokens(
  text: string,
  start: number,
  end: number,
): [TokenIndex, number, number] | null {
  const index = tokenIndex(text);
  const a = firstFrom(index.starts, start);
  const b = firstFrom(index.starts, end);
  if ((a > 0 && index.ends[a - 1] > start) || (b > 0 && index.ends[b - 1] > end)) return null;
  return [index, a, b];
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
  const shared = windowTokens(text, start, index);
  if (shared) {
    const [tokens, a, b] = shared;
    return read(tokens, text, Math.max(a + skip, b - n), b);
  }
  const tokens = text.slice(start, index).match(TOKEN) ?? [];
  return tokens.slice(Math.max(skip, tokens.length - n));
}

/** Up to `n` tokens right after `index`. */
export function tokensAfter(text: string, index: number, n: number): string[] {
  const shared = windowTokens(text, index, Math.min(text.length, index + 16 * n));
  if (shared) {
    const [tokens, a, b] = shared;
    return read(tokens, text, a, Math.min(b, a + n));
  }
  return (text.slice(index, index + 16 * n).match(TOKEN) ?? []).slice(0, n);
}

// "darüber", "hierunter", "worüber": a preposition joined to da-, hier- or wo-.
export const PRONOMINAL_ADVERB =
  /^(?:da|dar|hier|wo|wor)(?:an|auf|aus|bei|durch|für|gegen|hinter|in|mit|nach|neben|über|um|unter|von|vor|zu|zwischen)$/u;

export const PRONOUNS = wordSet("ich du er sie es wir ihr man sich mich dich uns euch mir dir");
// Verbs that close a clause with a bare infinitive or a participle ("kannst du das ändern",
// "diese habe ergeben").
export const VERB_GOVERNORS = wordSet(
  "kann kannst können könnt konnte konnten könnte könnten muss musst müssen müsst musste " +
    "mussten müsste müssten soll sollst sollen sollt sollte sollten will willst wollen " +
    "wollt wollte wollten darf darfst dürfen dürft durfte durften dürfte dürften mag " +
    "möchte möchtest möchten werde wirst wird werden werdet würde würdest würden wurde " +
    "wurden worden lass lasse lässt lassen ließ tu tue tut tun brauchst braucht brauchen " +
    "habe hast hat haben habt hatte hatten hätte hätten bin bist ist sind seid war waren " +
    "wäre wären sei konntest könntest könntet solltest solltet müsstest müsstet musstest " +
    "wolltest wolltet dürftest dürftet durftest magst mögt mögen mochte mochten möchtet " +
    "würdet wurdest",
);

/** Whether the clause has a verb that the word at its end can complete. */
export function governedBefore(before: string[], at: number): boolean {
  for (let i = at - 1; i >= 0 && !BOUNDARY.test(before[i]); i--) {
    if (VERB_GOVERNORS.has(before[i].toLowerCase())) return true;
  }
  return false;
}

// English function words that are no German words in lowercase.
const ENGLISH_LIST =
  "the and of with you your is are this that it to for be have has from but not they we my I people our";
const ENGLISH = new RegExp(
  `(?<![\\p{L}'’])(?:${ENGLISH_LIST.replaceAll(" ", "|")})(?![\\p{L}'’])`,
  "gu",
);
const ENGLISH_WORDS = wordSet(ENGLISH_LIST);
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
