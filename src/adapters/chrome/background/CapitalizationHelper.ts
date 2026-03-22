import { isLetter } from "@core/application/domain-utils";

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
  if (!endsWithSpace && lastWord && lastWord.length > 1 && lastWord === lastWord.toUpperCase()) {
    return Capitalization.WholeWord;
  }

  const firstCharacterOfLastWord = lastWord.slice(0, 1);
  if (
    !endsWithSpace &&
    isLetter(firstCharacterOfLastWord) &&
    firstCharacterOfLastWord === firstCharacterOfLastWord.toUpperCase()
  ) {
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
