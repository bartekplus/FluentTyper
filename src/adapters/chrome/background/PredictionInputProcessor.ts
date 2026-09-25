import {
  DEFAULT_SEPARATOR_CHARS_REGEX,
  LANG_ADDITIONAL_SEPARATOR_REGEX,
  stripIgnoredWordChars,
} from "@core/domain/lang";
import { PUNCTUATION_EQUIVALENTS } from "@core/domain/spacingRules";
import {
  extractPredictionTokenSuffix,
  KEEP_PREDICTION_TOKEN_CHARS_REGEX,
} from "@core/domain/predictionToken";
import { checkAutoCapitalize, Capitalization } from "./CapitalizationHelper";
import { isNumber } from "@core/application/domain-utils";

const NEW_SENTENCE_CHARS = [".", "?", "!"];
// Equivalent punctuation tokenizes exactly like its ASCII counterpart, so
// "مرحبا،كي" is not one prefix and "؟" ends a sentence.
const EQUIVALENT_PUNCTUATION_REGEX = new RegExp(
  `[${Object.keys(PUNCTUATION_EQUIVALENTS).join("")}]`,
  "g",
);
const PAST_WORDS_COUNT = 5;
export const MIN_WORD_LENGTH_TO_PREDICT = 1;
// Only the last PAST_WORDS_COUNT words matter, but one word can be huge (a
// 200k-char run cost Presage ~1 s per keystroke), so bound the raw input too.
export const MAX_PREDICTION_INPUT_CHARS = 512;

export class PredictionInputProcessor {
  readonly separatorCharRegex: RegExp;
  readonly keepPredCharRegex: RegExp;
  readonly whiteSpaceRegex: RegExp;
  readonly minWordLengthToPredict: number;
  readonly autoCapitalize: boolean;

  constructor(minWordLengthToPredict = MIN_WORD_LENGTH_TO_PREDICT, autoCapitalize = true) {
    this.separatorCharRegex = RegExp(DEFAULT_SEPARATOR_CHARS_REGEX);
    this.keepPredCharRegex = KEEP_PREDICTION_TOKEN_CHARS_REGEX;
    this.whiteSpaceRegex = /\s+/;
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
    return value.replaceAll(additionalSeparatorRegex, " ");
  }

  private normalizeForTokenizing(value: string, language: string): string {
    return stripIgnoredWordChars(this.normalizeAdditionalSeparators(value, language)).replace(
      EQUIVALENT_PUNCTUATION_REGEX,
      (char) => PUNCTUATION_EQUIVALENTS[char],
    );
  }

  private resolveCurrentWordSuffix(
    afterCursorTokenSuffix: string | undefined,
    language: string,
  ): string {
    if (typeof afterCursorTokenSuffix !== "string" || afterCursorTokenSuffix.length === 0) {
      return "";
    }
    const normalizedAfterCursor = this.normalizeForTokenizing(
      afterCursorTokenSuffix.slice(0, MAX_PREDICTION_INPUT_CHARS),
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
    suppressAutoCapitalize = false,
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
    const normalizedInput = this.normalizeForTokenizing(
      predictionInput.slice(-MAX_PREDICTION_INPUT_CHARS),
      language,
    );
    const currentWordSuffix = this.resolveCurrentWordSuffix(afterCursorTokenSuffix, language);
    const predictionInputWithCurrentWord = `${normalizedInput}${currentWordSuffix}`.slice(
      -MAX_PREDICTION_INPUT_CHARS,
    );
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
      autoCapitalize: this.autoCapitalize && suppressAutoCapitalize !== true,
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
