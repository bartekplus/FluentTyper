import { DEFAULT_SEPARATOR_CHARS_REGEX, LANG_ADDITIONAL_SEPARATOR_REGEX } from "@core/domain/lang";
import {
  extractPredictionTokenSuffix,
  KEEP_PREDICTION_TOKEN_CHARS_REGEX,
} from "@core/domain/predictionToken";
import { checkAutoCapitalize, Capitalization } from "./CapitalizationHelper";
import { isNumber } from "@core/application/domain-utils";

export const NEW_SENTENCE_CHARS = [".", "?", "!"];
export const PAST_WORDS_COUNT = 5;
export const MIN_WORD_LENGTH_TO_PREDICT = 1;

export class PredictionInputProcessor {
  readonly separatorCharRegex: RegExp;
  readonly keepPredCharRegex: RegExp;
  readonly whiteSpaceRegex: RegExp;
  readonly letterRegex: RegExp;
  readonly minWordLengthToPredict: number;
  readonly autoCapitalize: boolean;

  constructor(minWordLengthToPredict = MIN_WORD_LENGTH_TO_PREDICT, autoCapitalize = true) {
    this.separatorCharRegex = RegExp(DEFAULT_SEPARATOR_CHARS_REGEX);
    this.keepPredCharRegex = KEEP_PREDICTION_TOKEN_CHARS_REGEX;
    this.whiteSpaceRegex = /\s+/;
    this.letterRegex = /^\p{L}/u;
    this.minWordLengthToPredict = minWordLengthToPredict;
    this.autoCapitalize = autoCapitalize;
  }

  removePrevSentence(wordArrayOrig: string[]): {
    wordArray: string[];
    newSentence: boolean;
  } {
    const wordArray = wordArrayOrig.slice();
    for (let index = wordArray.length - 1; index >= 0; index--) {
      const element = wordArray[index];
      if (NEW_SENTENCE_CHARS.includes(element) || NEW_SENTENCE_CHARS.includes(element.slice(-1))) {
        return {
          wordArray: wordArray.slice(index + 1),
          newSentence: true,
        };
      }
    }
    return { wordArray, newSentence: false };
  }

  checkDoPrediction(
    lastWord: string,
    endsWithSpace: boolean,
    numSuggestions: number,
    predictNextWordAfterSeparatorChar: boolean,
  ): boolean {
    if (numSuggestions <= 0) {
      return false;
    }
    if (endsWithSpace) {
      return predictNextWordAfterSeparatorChar;
    }
    if (isNumber(lastWord) || lastWord.length < this.minWordLengthToPredict) {
      return false;
    }
    const separatorMatches = lastWord.match(this.separatorCharRegex) || [];
    const keepMatches = lastWord.match(this.keepPredCharRegex) || [];
    return separatorMatches.length === keepMatches.length;
  }

  private normalizeAdditionalSeparators(value: string, language: string): string {
    const additionalSeparatorRegex = LANG_ADDITIONAL_SEPARATOR_REGEX[language];
    if (!additionalSeparatorRegex) {
      return value;
    }
    return value.replaceAll(RegExp(additionalSeparatorRegex, "g"), " ");
  }

  private resolveCurrentWordSuffix(
    afterCursorTokenSuffix: string | undefined,
    language: string,
  ): string {
    if (typeof afterCursorTokenSuffix !== "string" || afterCursorTokenSuffix.length === 0) {
      return "";
    }
    const normalizedAfterCursor = this.normalizeAdditionalSeparators(
      afterCursorTokenSuffix,
      language,
    );
    return extractPredictionTokenSuffix(normalizedAfterCursor, (char) =>
      this.separatorCharRegex.test(char),
    );
  }

  processInput(
    predictionInput: string,
    language: string,
    numSuggestions: number,
    predictNextWordAfterSeparatorChar: boolean,
    afterCursorTokenSuffix?: string,
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
    const normalizedInput = this.normalizeAdditionalSeparators(predictionInput, language);
    const currentWordSuffix = this.resolveCurrentWordSuffix(afterCursorTokenSuffix, language);
    const predictionInputWithCurrentWord = `${normalizedInput}${currentWordSuffix}`;
    const lastWordsArray = predictionInputWithCurrentWord
      .split(this.whiteSpaceRegex)
      .filter((e) => e.trim())
      .slice(-PAST_WORDS_COUNT);
    const { wordArray, newSentence } = this.removePrevSentence(lastWordsArray);
    const trimmedPredictionInput = wordArray.join(" ") + (endsWithSpace ? " " : "");
    const lastWordRaw = lastWordsArray.length ? lastWordsArray[lastWordsArray.length - 1] : "";
    const lastWord =
      lastWordRaw
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
    return {
      predictionInput: trimmedPredictionInput.toLowerCase(),
      lastWord,
      doPrediction,
      doCapitalize,
    };
  }
}
