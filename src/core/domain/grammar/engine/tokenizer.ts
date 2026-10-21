// Groups: 1 masked text, 2 word or number, 3 whitespace, 4 punctuation; else a symbol. A word is
// the word of the phrase tables: letters and digits, with combining marks after the first one,
// joined by an apostrophe before a letter or digit ("don't", "l'eau", "2nd").
const WORDS =
  /(￼+)|([\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*)|(\s+)|(\p{P})|[\s\S]/gu;

/**
 * The word and number tokens of `text` from `start` (a token boundary) on. The phrase tables
 * read only words. `visit` returns false to stop.
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
