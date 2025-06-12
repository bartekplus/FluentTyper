import { isLetter } from "../shared/utils";

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

/**
 * Checks if auto capitalization should be applied based on the input tokens and punctuation marks.
 * @param params - Parameters for capitalization check
 * @returns {Capitalization} The type of capitalization to be applied.
 */
export function checkAutoCapitalize({
  lastWord,
  wordCount,
  newSentence,
  endsWithSpace,
  autoCapitalize,
}: CheckAutoCapitalizeParams): Capitalization {
  const firstCharacterOfLastWord = lastWord.slice(0, 1);

  // Whole word capitalization: " XYZ"
  if (
    !endsWithSpace &&
    lastWord &&
    lastWord.length > 1 &&
    lastWord === lastWord.toUpperCase()
  )
    return Capitalization.WholeWord;

  // First letter capitalization: " Xyz"
  if (
    !endsWithSpace &&
    isLetter(firstCharacterOfLastWord) &&
    firstCharacterOfLastWord === firstCharacterOfLastWord.toUpperCase()
  )
    return Capitalization.FirstLetter;

  // Auto capitalization after sentence-ending punctuation
  if (
    autoCapitalize &&
    newSentence &&
    ((!endsWithSpace && wordCount === 1) || (endsWithSpace && wordCount === 0))
  )
    return Capitalization.FirstLetter;

  return Capitalization.None;
}
