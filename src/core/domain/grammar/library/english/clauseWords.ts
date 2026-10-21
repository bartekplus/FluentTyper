// The rule library (library/english.ts): the words around a position in its clause, and the
// clause bounds at a position.
import { wordKey } from "../../implementations/helpers/GenericRuleShared";

/** A word: its key (lowercase, ’ as '), its typed text and its range. */
export type ClauseWord = { w: string; raw: string; start: number; end: number };

/** The words before and after a match, read on the first access. */
export type WordsAround = { readonly P: ClauseWord[]; readonly N: ClauseWord[] };

const TOKEN = "[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*";
const WORD_BEFORE = new RegExp(`(?<![A-Za-z'’-])(${TOKEN})[ \\t\\u00a0]+$`);
const WORD_AFTER = new RegExp(
  `^[ \\t\\u00a0]+(${TOKEN})(?![\\p{L}\\p{N}_'’@/#\\\\-]|\\.[\\p{L}\\p{N}])`,
  "u",
);

/** Up to `max` words before `index` on the same clause, nearest first. */
export function clauseWordsBefore(text: string, index: number, max: number): ClauseWord[] {
  const found: ClauseWord[] = [];
  for (let at = index; found.length < max;) {
    const match = WORD_BEFORE.exec(text.slice(Math.max(0, at - 48), at));
    if (!match) break;
    const start = at - match[0].length;
    found.push({ w: wordKey(match[1]), raw: match[1], start, end: start + match[1].length });
    at = start;
  }
  return found;
}

/** Up to `max` words after `index` on the same clause. */
function clauseWordsAfter(text: string, index: number, max: number): ClauseWord[] {
  const found: ClauseWord[] = [];
  for (let at = index; found.length < max;) {
    const match = WORD_AFTER.exec(text.slice(at, at + 48));
    if (!match) break;
    const end = at + match[0].length;
    found.push({ w: wordKey(match[1]), raw: match[1], start: end - match[1].length, end });
    at = end;
  }
  return found;
}

/**
 * Up to `before` words before `start` and `after` words after `end`, each list read when it is
 * first used: most matches of a frequent word need neither.
 */
export function wordsAround(
  text: string,
  start: number,
  end: number,
  before: number,
  after: number,
): WordsAround {
  let P: ClauseWord[] | undefined;
  let N: ClauseWord[] | undefined;
  return {
    get P() {
      return (P ??= clauseWordsBefore(text, start, before));
    },
    get N() {
      return (N ??= clauseWordsAfter(text, end, after));
    },
  };
}

/** Nothing but spaces, quotes or brackets between a clause boundary and `index`. */
export function clauseOpensAt(text: string, index: number): boolean {
  let i = index;
  while (i > 0 && /[ \t\u00a0"“‘(]/.test(text[i - 1])) i -= 1;
  return i === 0 || /[.!?;:\n—–]/.test(text[i - 1]) || text.slice(i - 2, i) === "--";
}

/** Only spaces, then clause punctuation or the text end, after `index`. */
export const clauseClosesAt = (text: string, index: number) =>
  /^[ \t\u00a0]{0,8}(?:[.!?,;:)\]"”…]|--|[—–]|$)/.test(text.slice(index, index + 12));
