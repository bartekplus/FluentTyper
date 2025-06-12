// Utility for processing prediction input for PresageHandler
import { LANG_ADDITIONAL_SEPERATOR_REGEX } from "../shared/lang";
import { checkAutoCapitalize, Capitalization } from "./CapitalizationHelper";
import { isNumber } from "../shared/utils";

export const NEW_SENTENCE_CHARS = [".", "?", "!"];
export const PAST_WORDS_COUNT = 5;
export const MIN_WORD_LENGTH_TO_PREDICT = 1;

export class PredictionInputProcessor {
  separatorCharRegEx: RegExp;
  keepPredCharRegEx: RegExp;
  whiteSpaceRegEx: RegExp;
  letterRegEx: RegExp;
  minWordLengthToPredict: number;
  autoCapitalize: boolean;

  constructor(
    minWordLengthToPredict = MIN_WORD_LENGTH_TO_PREDICT,
    autoCapitalize = true,
  ) {
    this.separatorCharRegEx =
      /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/;
    this.keepPredCharRegEx = /\[|\(|{|<|\/|-|\*|\+|=|"/;
    this.whiteSpaceRegEx = /\s+/;
    this.letterRegEx = /^\p{L}/u;
    this.minWordLengthToPredict = minWordLengthToPredict;
    this.autoCapitalize = autoCapitalize;
  }

  removePrevSentence(wordArrayOrig: string[]): {
    wordArray: string[];
    newSentence: boolean;
  } {
    let newSentence = false;
    let wordArray = wordArrayOrig.slice();
    for (let index = wordArray.length - 1; index >= 0; index--) {
      const element = wordArray[index];
      if (
        NEW_SENTENCE_CHARS.includes(element) ||
        NEW_SENTENCE_CHARS.includes(element.slice(-1))
      ) {
        wordArray = wordArray.splice(index + 1);
        newSentence = true;
        break;
      }
    }
    return { wordArray, newSentence };
  }

  checkDoPrediction(
    lastWord: string,
    endsWithSpace: boolean,
    numSuggestions: number,
    predictNextWordAfterSeparatorChar: boolean,
  ): boolean {
    if (numSuggestions <= 0) return false;
    if (!endsWithSpace && isNumber(lastWord)) return false;
    if (endsWithSpace && !predictNextWordAfterSeparatorChar) return false;
    if (!endsWithSpace && lastWord.length < this.minWordLengthToPredict)
      return false;
    if (
      !endsWithSpace &&
      (lastWord.match(this.separatorCharRegEx) || []).length !==
        (lastWord.match(this.keepPredCharRegEx) || []).length
    )
      return false;
    return true;
  }

  processInput(
    predictionInput: string,
    language: string,
    numSuggestions: number,
    predictNextWordAfterSeparatorChar: boolean,
  ): {
    predictionInput: string;
    lastWord: string;
    doPrediction: boolean;
    doCapitalize: Capitalization;
  } {
    if (typeof predictionInput !== "string") {
      return {
        predictionInput,
        doPrediction: false,
        doCapitalize: Capitalization.None,
        lastWord: "",
      };
    }
    const endsWithSpace = predictionInput !== predictionInput.trimEnd();
    const additionalSeparatorRegex = LANG_ADDITIONAL_SEPERATOR_REGEX[language];
    if (additionalSeparatorRegex) {
      predictionInput = predictionInput.replaceAll(
        RegExp(additionalSeparatorRegex, "g"),
        " ",
      );
    }
    const lastWordsArray = predictionInput
      .split(this.whiteSpaceRegEx)
      .filter((e) => e.trim())
      .splice(-PAST_WORDS_COUNT);
    const { wordArray, newSentence } = this.removePrevSentence(lastWordsArray);
    predictionInput = wordArray.join(" ") + (endsWithSpace ? " " : "");
    let lastWord = lastWordsArray.length
      ? lastWordsArray[lastWordsArray.length - 1]
      : "";
    lastWord =
      lastWord
        .split(this.keepPredCharRegEx)
        .filter((e) => e.trim())
        .pop() || "";
    const doCapitalize = checkAutoCapitalize({
      lastWord,
      wordCount: wordArray.length,
      newSentence,
      endsWithSpace,
      autoCapitalize: this.autoCapitalize,
    });
    const doPrediction = this.checkDoPrediction(
      lastWord,
      endsWithSpace,
      numSuggestions,
      predictNextWordAfterSeparatorChar,
    );
    predictionInput = predictionInput.toLowerCase();
    return { predictionInput, lastWord, doPrediction, doCapitalize };
  }
}
