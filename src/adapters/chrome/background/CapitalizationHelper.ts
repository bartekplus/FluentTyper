const UPPERCASE_LETTER_REGEX = /\p{Lu}/u;
const LOWERCASE_LETTER_REGEX = /\p{Ll}/u;

export enum Capitalization {
  FirstLetter = "letter",
  WholeWord = "word",
  None = "none",
}

export interface CheckAutoCapitalizeParams {
  lastWord: string;
  wordCount: number;
  newSentence: boolean;
  endsWithSpace: boolean;
  autoCapitalize: boolean;
}

export function checkAutoCapitalize({
  lastWord,
  wordCount,
  newSentence,
  endsWithSpace,
  autoCapitalize,
}: CheckAutoCapitalizeParams): Capitalization {
  if (
    !endsWithSpace &&
    lastWord.length > 1 &&
    UPPERCASE_LETTER_REGEX.test(lastWord) &&
    !LOWERCASE_LETTER_REGEX.test(lastWord)
  ) {
    return Capitalization.WholeWord;
  }

  // Caseless scripts (Arabic) have no \p{Lu}, so they never force capitalization.
  if (!endsWithSpace && UPPERCASE_LETTER_REGEX.test(lastWord.slice(0, 1))) {
    return Capitalization.FirstLetter;
  }

  if (
    autoCapitalize &&
    newSentence &&
    ((!endsWithSpace && wordCount === 1) || (endsWithSpace && wordCount === 0))
  ) {
    return Capitalization.FirstLetter;
  }

  return Capitalization.None;
}
