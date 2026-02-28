// Utility for processing prediction input for PresageHandler
import { LANG_ADDITIONAL_SEPARATOR_REGEX } from "@core/domain/lang";
import { checkAutoCapitalize, Capitalization } from "./CapitalizationHelper";
import { isNumber } from "@core/application/domain-utils";

export const NEW_SENTENCE_CHARS = [".", "?", "!"];
export const PAST_WORDS_COUNT = 5;
export const MIN_WORD_LENGTH_TO_PREDICT = 1;

export class PredictionInputProcessor {
  separatorCharRegex: RegExp;
  keepPredCharRegex: RegExp;
  whiteSpaceRegex: RegExp;
  letterRegex: RegExp;
  minWordLengthToPredict: number;
  autoCapitalize: boolean;

  constructor(
    minWordLengthToPredict = MIN_WORD_LENGTH_TO_PREDICT,
    autoCapitalize = true,
  ) {
    this.separatorCharRegex =
      /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/;
    this.keepPredCharRegex = /\[|\(|{|<|\/|-|\*|\+|=|"/;
    this.whiteSpaceRegex = /\s+/;
    this.letterRegex = /^\p{L}/u;
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
      (lastWord.match(this.separatorCharRegex) || []).length !==
        (lastWord.match(this.keepPredCharRegex) || []).length
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
    const additionalSeparatorRegex = LANG_ADDITIONAL_SEPARATOR_REGEX[language];
    if (additionalSeparatorRegex) {
      predictionInput = predictionInput.replaceAll(
        RegExp(additionalSeparatorRegex, "g"),
        " ",
      );
    }
    const lastWordsArray = predictionInput
      .split(this.whiteSpaceRegex)
      .filter((e) => e.trim())
      .splice(-PAST_WORDS_COUNT);
    const { wordArray, newSentence } = this.removePrevSentence(lastWordsArray);
    predictionInput = wordArray.join(" ") + (endsWithSpace ? " " : "");
    let lastWord = lastWordsArray.length
      ? lastWordsArray[lastWordsArray.length - 1]
      : "";
    lastWord =
      lastWord
        .split(this.keepPredCharRegex)
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
