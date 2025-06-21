import {
  PredictionInputProcessor,
  MIN_WORD_LENGTH_TO_PREDICT,
} from "../src/background/PredictionInputProcessor";
import { Capitalization } from "../src/background/CapitalizationHelper";

describe("PredictionInputProcessor", () => {
  let processor: PredictionInputProcessor;

  beforeEach(() => {
    processor = new PredictionInputProcessor();
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(processor.minWordLengthToPredict).toBe(MIN_WORD_LENGTH_TO_PREDICT);
      expect(processor.autoCapitalize).toBe(true);
      expect(processor.separatorCharRegEx).toBeInstanceOf(RegExp);
      expect(processor.keepPredCharRegEx).toBeInstanceOf(RegExp);
      expect(processor.whiteSpaceRegEx).toBeInstanceOf(RegExp);
      expect(processor.letterRegEx).toBeInstanceOf(RegExp);
    });
  });

  describe("removePrevSentence", () => {
    it("should remove words before the last sentence-ending character", () => {
      const input = ["Hello", ".", "World"];
      const { wordArray, newSentence } = processor.removePrevSentence(input);
      expect(wordArray).toEqual(["World"]);
      expect(newSentence).toBe(true);
    });
    it("should return original array if no sentence-ending char", () => {
      const input = ["Hello", "world"];
      const { wordArray, newSentence } = processor.removePrevSentence(input);
      expect(wordArray).toEqual(["Hello", "world"]);
      expect(newSentence).toBe(false);
    });
  });

  describe("checkDoPrediction", () => {
    it("should return false if numSuggestions is 0", () => {
      expect(processor.checkDoPrediction("word", false, 0, true)).toBe(false);
    });
    it("should return false if lastWord is a number and endsWithSpace is false", () => {
      expect(processor.checkDoPrediction("123", false, 1, true)).toBe(false);
    });
    it("should return false if endsWithSpace and predictNextWordAfterSeparatorChar is false", () => {
      expect(processor.checkDoPrediction("word", true, 1, false)).toBe(false);
    });
    it("should return false if lastWord is too short", () => {
      expect(processor.checkDoPrediction("", false, 1, true)).toBe(false);
    });
    it("should return true for valid input", () => {
      expect(processor.checkDoPrediction("word", false, 1, true)).toBe(true);
    });
  });

  describe("processInput", () => {
    it("should handle non-string input", () => {
      // @ts-expect-error // Testing non-string input
      const result = processor.processInput(123, "en_US", 1, true);
      expect(result.doPrediction).toBe(false);
      expect(result.doCapitalize).toBe(Capitalization.None);
      expect(result.lastWord).toBe("");
    });
    it("should process a simple input and lowercase it", () => {
      const result = processor.processInput("Hello world", "en_US", 1, true);
      expect(result.predictionInput).toBe("hello world");
      expect(result.lastWord).toBe("world");
      expect(result.doPrediction).toBe(true);
      expect(Object.values(Capitalization)).toContain(result.doCapitalize);
    });
    it("should not predict if numSuggestions is 0", () => {
      const result = processor.processInput("Hello world", "en_US", 0, true);
      expect(result.doPrediction).toBe(false);
    });
    it("should handle additional separator regex for language", () => {
      const proc = new PredictionInputProcessor();
      const result = proc.processInput("foo'bar", "fr_FR", 1, true);
      expect(result.predictionInput).toContain(" ");
    });
  });
});
