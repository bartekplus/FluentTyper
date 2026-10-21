// The rule library (library.ts): clause and sentence bounds of the text.

const isBlank = (code: number) => code === 32 || code === 9 || code === 0xa0;

/**
 * The subject opens its clause, so no noun-clause opener owns it ("What it was took…"): only
 * spaces from the text start (in 96 characters), or a clause mark and at most 8 spaces before it.
 * A backward read: a regex anchored at the end of the slice tries each start in it.
 */
export function atClauseStart(text: string, index: number): boolean {
  const low = Math.max(0, index - 96);
  let i = index;
  while (i > low && isBlank(text.charCodeAt(i - 1))) i--;
  if (i === low) return index <= 96;
  return index - i <= 8 && '.!?;:\n"“'.includes(text[i - 1]);
}

const isLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
// A character that continues a token: no word starts right after it.
const GLUED_END = /[\p{L}\p{N}_'’@/#\\.-]$/u;

/**
 * The word right before `start` (spaces only between) and where it starts; "" for none. The word
 * is ASCII letters, maybe with an apostrophe and up to two lowercase letters ("don't", "we'd");
 * 1 to 8 spaces follow it, and it starts in the 48 characters before `start`. A backward read: a
 * regex anchored at the end of the slice tries each start in it.
 */
export function previousWord(text: string, start: number): [string, number] {
  const from = Math.max(0, start - 48);
  let end = start;
  while (end > from && isBlank(text.charCodeAt(end - 1))) end--;
  if (end === start || start - end > 8) return ["", start];
  // The start of the letters that end at `at`, when no token character stands before them.
  const wordStart = (at: number) => {
    let s = at;
    while (s > from && isLetter(text.charCodeAt(s - 1))) s--;
    return s < at && (s === from || !GLUED_END.test(text.slice(Math.max(from, s - 2), s))) ? s : -1;
  };
  let found = wordStart(end);
  // An apostrophe and 0 to 2 lowercase letters before the spaces; the leftmost start wins.
  for (let tail = 0; tail <= 2 && end - tail - 1 > from; tail++) {
    if (tail > 0) {
      const code = text.charCodeAt(end - tail);
      if (code < 97 || code > 122) break;
    }
    const mark = text.charCodeAt(end - tail - 1);
    if (mark !== 39 && mark !== 0x2019) continue;
    const s = wordStart(end - tail - 1);
    if (s >= 0 && (found < 0 || s < found)) found = s;
  }
  return found < 0 ? ["", start] : [text.slice(found, end), found];
}
