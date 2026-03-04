import { describe, expect, test } from "bun:test";
import type { GrammarContext } from "../../src/core/domain/grammar/types";
import { EnglishPronounICapitalizationRule } from "../../src/core/domain/grammar/implementations/EnglishPronounICapitalizationRule";
import { EnglishContractionNormalizationRule } from "../../src/core/domain/grammar/implementations/EnglishContractionNormalizationRule";
import { EnglishTypoWhitelistCorrectionRule } from "../../src/core/domain/grammar/implementations/EnglishTypoWhitelistCorrectionRule";

function context(beforeCursor: string, hints?: GrammarContext["hints"]): GrammarContext {
  return {
    beforeCursor,
    afterCursor: "",
    ...(hints ? { hints } : {}),
  };
}

describe("V2 english grammar rules", () => {
  describe("EnglishPronounICapitalizationRule", () => {
    test("capitalizes standalone i and apostrophe contractions in English context", () => {
      const rule = new EnglishPronounICapitalizationRule();

      expect(rule.apply(context("i ", { lang: "en_US" }))).toEqual({
        replacement: "I ",
        deleteBackwards: 2,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized English pronoun I",
      });

      expect(rule.apply(context("i'm ", { lang: "en_US" }))).toEqual({
        replacement: "I'm ",
        deleteBackwards: 4,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized English pronoun in contraction",
      });
    });

    test("skips non-English and code-like contexts", () => {
      const rule = new EnglishPronounICapitalizationRule();

      expect(rule.apply(context("i ", { lang: "pl_PL" }))).toBeNull();
      expect(rule.apply(context("foo@i ", { lang: "en_US" }))).toBeNull();
    });

    test("applies only after a token boundary delimiter", () => {
      const rule = new EnglishPronounICapitalizationRule();
      expect(rule.apply(context("i", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("i.", { lang: "en_US", inputAction: "insert" }))).toEqual({
        replacement: "I.",
        deleteBackwards: 2,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized English pronoun I",
      });
    });
  });

  describe("EnglishContractionNormalizationRule", () => {
    test("normalizes contraction forms and preserves case", () => {
      const rule = new EnglishContractionNormalizationRule();

      expect(rule.apply(context("im ", { lang: "en_US", inputAction: "insert" }))).toEqual({
        replacement: "I'm ",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Normalized English contraction",
      });

      expect(rule.apply(context("DONT ", { lang: "en_US", inputAction: "insert" }))).toEqual({
        replacement: "DON'T ",
        deleteBackwards: 5,
        deleteForwards: 0,
        confidence: "high",
        description: "Normalized English contraction",
      });
    });

    test("does not normalize on delete action or non-English context", () => {
      const rule = new EnglishContractionNormalizationRule();
      expect(rule.apply(context("im ", { lang: "en_US", inputAction: "delete" }))).toBeNull();
      expect(rule.apply(context("im ", { lang: "fr_FR" }))).toBeNull();
    });

    test("applies only after a token boundary delimiter", () => {
      const rule = new EnglishContractionNormalizationRule();
      expect(rule.apply(context("im", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("im.", { lang: "en_US", inputAction: "insert" }))).toEqual({
        replacement: "I'm.",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Normalized English contraction",
      });
    });
  });

  describe("EnglishTypoWhitelistCorrectionRule", () => {
    test("corrects known typos and preserves case", () => {
      const rule = new EnglishTypoWhitelistCorrectionRule();

      expect(rule.apply(context("teh ", { lang: "en_US", inputAction: "insert" }))).toEqual({
        replacement: "the ",
        deleteBackwards: 4,
        deleteForwards: 0,
        confidence: "high",
        description: "Corrected common English typo",
      });

      expect(rule.apply(context("Teh ", { lang: "en_US", inputAction: "insert" }))).toEqual({
        replacement: "The ",
        deleteBackwards: 4,
        deleteForwards: 0,
        confidence: "high",
        description: "Corrected common English typo",
      });
    });

    test("skips words in user dictionary and code-like contexts", () => {
      const rule = new EnglishTypoWhitelistCorrectionRule(["teh"]);
      expect(rule.apply(context("teh ", { lang: "en_US", userDictionary: ["teh"] }))).toBeNull();
      expect(rule.apply(context("obj.teh ", { lang: "en_US" }))).toBeNull();
      expect(rule.apply(context("teh ", { lang: "pl_PL" }))).toBeNull();
    });

    test("applies only after a token boundary delimiter", () => {
      const rule = new EnglishTypoWhitelistCorrectionRule();
      expect(rule.apply(context("teh", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("teh.", { lang: "en_US", inputAction: "insert" }))).toEqual({
        replacement: "the.",
        deleteBackwards: 4,
        deleteForwards: 0,
        confidence: "high",
        description: "Corrected common English typo",
      });
    });
  });
});
