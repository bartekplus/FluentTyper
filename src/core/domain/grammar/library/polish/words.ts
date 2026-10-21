// The rule library (library.ts): the words of a text with their offsets, and the readings that a
// rule gives each word.

/** A word of a text: as typed, in lowercase, and its offsets in the text. */
export interface PlWord {
  readonly text: string;
  readonly lower: string;
  readonly start: number;
  readonly end: number;
}

/** A word and its readings: the finite verb of a clause, an adverbial participle. */
export interface PlReadWord extends PlWord {
  readonly verb: boolean;
  readonly participle: boolean;
}

/** The letter runs of `text`; `offset` is where `text` starts in the full text. */
export function plWords(text: string, offset: number): PlWord[] {
  return [...text.matchAll(/\p{L}+/gu)].map((m) => ({
    text: m[0],
    lower: m[0].toLowerCase(),
    start: offset + m.index,
    end: offset + m.index + m[0].length,
  }));
}
