import {
  PredictionInputProcessor,
  MIN_WORD_LENGTH_TO_PREDICT,
} from "../src/adapters/chrome/background/PredictionInputProcessor";
import { Capitalization } from "../src/adapters/chrome/background/CapitalizationHelper";

describe("PredictionInputProcessor", () => {
  let processor: PredictionInputProcessor;

  beforeEach(() => {
    processor = new PredictionInputProcessor();
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(processor.minWordLengthToPredict).toBe(MIN_WORD_LENGTH_TO_PREDICT);
      expect(processor.autoCapitalize).toBe(true);
      expect(processor.separatorCharRegex).toBeInstanceOf(RegExp);
      expect(processor.keepPredCharRegex).toBeInstanceOf(RegExp);
      expect(processor.whiteSpaceRegex).toBeInstanceOf(RegExp);
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
    it("should extend the active word with the bounded token suffix after the cursor", () => {
      const result = processor.processInput("I like Whb", "en_US", 1, true, "tsoever");
      expect(result.predictionInput).toBe("i like whbtsoever");
      expect(result.lastWord).toBe("Whbtsoever");
      expect(result.doPrediction).toBe(true);
    });
    it("should retain keep-pred punctuation while trimming the rest of the trailing token", () => {
      const hyphenResult = processor.processInput("co", "en_US", 1, true, "-op later");
      expect(hyphenResult.predictionInput).toBe("co-op");
      expect(hyphenResult.lastWord).toBe("op");

      const slashResult = processor.processInput("use", "en_US", 1, true, "/case next");
      expect(slashResult.predictionInput).toBe("use/case");
      expect(slashResult.lastWord).toBe("case");
    });
    it("should not predict if numSuggestions is 0", () => {
      const result = processor.processInput("Hello world", "en_US", 0, true);
      expect(result.doPrediction).toBe(false);
    });
    it("should handle additional separator regex for language", () => {
      const proc = new PredictionInputProcessor();
      const straightResult = proc.processInput("foo'bar", "fr_FR", 1, true);
      expect(straightResult.predictionInput).toContain(" ");

      const typographicResult = proc.processInput("l\u2019amour", "fr_FR", 1, true);
      expect(typographicResult.predictionInput).toContain(" ");
    });

    it("should treat Arabic comma/semicolon like their ASCII counterparts", () => {
      // "مرحبا،كي" must not reach Presage as one prefix token.
      expect(processor.processInput("مرحبا،كي", "ar_SA", 1, true).doPrediction).toBe(false);
      expect(processor.processInput("hello,wo", "en_US", 1, true).doPrediction).toBe(false);
      expect(processor.processInput("مرحبا؛كي", "ar_SA", 1, true).doPrediction).toBe(false);
      expect(processor.processInput("مرحبا،", "ar_SA", 1, true).doPrediction).toBe(false);
      const spaced = processor.processInput("مرحبا، كي", "ar_SA", 1, true);
      expect(spaced.lastWord).toBe("كي");
      expect(spaced.doPrediction).toBe(true);
      // Language-independent: the same holds under any language profile.
      expect(processor.processInput("مرحبا،كي", "en_US", 1, true).doPrediction).toBe(false);
    });

    it("should start a new sentence after the Arabic question mark", () => {
      const result = processor.processInput("ما اسمك؟ أنا ذا", "ar_SA", 1, true);
      expect(result.predictionInput).toBe("أنا ذا");
      expect(result.lastWord).toBe("ذا");
    });

    it("should not predict for Arabic-Indic and Persian digit runs", () => {
      expect(processor.processInput("رقم ١٢٣", "ar_SA", 1, true).doPrediction).toBe(false);
      expect(processor.processInput("رقم ۱۲", "ar_SA", 1, true).doPrediction).toBe(false);
    });

    it("should not force WholeWord capitalization for caseless Arabic words", () => {
      const result = processor.processInput("مرحبا كت", "ar_SA", 1, true);
      expect(result.doCapitalize).toBe(Capitalization.None);
    });

    it("should strip tatweel from the active word and the suffix after the cursor", () => {
      const before = processor.processInput("كتـــاب", "ar_SA", 1, true);
      expect(before.lastWord).toBe("كتاب");
      expect(processor.processInput("كتـــاب", "en_US", 1, true).lastWord).toBe("كتاب");
      expect(before.predictionInput).toBe("كتاب");

      const withSuffix = processor.processInput("كتـ", "ar_SA", 1, true, "ـــاب ثم");
      expect(withSuffix.lastWord).toBe("كتاب");
      expect(withSuffix.predictionInput).toBe("كتاب");
    });

    it("should treat typographic punctuation as separators via shared defaults", () => {
      const proc = new PredictionInputProcessor();
      const result = proc.processInput("alpha\u2014beta", "en_US", 1, true);
      expect(result.doPrediction).toBe(false);
    });
  });
});
