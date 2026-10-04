import { describe, expect, test } from "bun:test";
import { context, edit } from "./grammarTestUtils";
import { EnglishPronounICapitalizationRule } from "../../src/core/domain/grammar/implementations/EnglishPronounICapitalizationRule";
import { EnglishContractionNormalizationRule } from "../../src/core/domain/grammar/implementations/EnglishContractionNormalizationRule";
import { EnglishTypoWhitelistCorrectionRule } from "../../src/core/domain/grammar/implementations/EnglishTypoWhitelistCorrectionRule";

describe("V2 english grammar rules", () => {
  describe("EnglishPronounICapitalizationRule", () => {
    test("capitalizes standalone i and apostrophe contractions in English context", () => {
      const rule = new EnglishPronounICapitalizationRule();

      // A lone "i " could still be a loop variable; the following word decides.
      expect(rule.apply(context("i ", { lang: "en_US" }))).toBeNull();
      expect(rule.apply(context("for i in", { lang: "en_US" }))).toBeNull();
      expect(rule.apply(context("i think ", { lang: "en_US" }))).toEqual(edit("I think ", 8));

      expect(rule.apply(context("i'm ", { lang: "en_US" }))).toEqual(edit("I'm ", 4));

      expect(rule.apply(context("i've ", { lang: "en_US" }))).toEqual(edit("I've ", 5));

      expect(rule.apply(context("i'll ", { lang: "en_US" }))).toEqual(edit("I'll ", 5));

      expect(rule.apply(context("i'd ", { lang: "en_US" }))).toEqual(edit("I'd ", 4));
    });

    test("skips non-English and code-like contexts", () => {
      const rule = new EnglishPronounICapitalizationRule();

      expect(rule.apply(context("i ", { lang: "pl_PL" }))).toBeNull();
      expect(rule.apply(context("i ", { lang: "fr_FR" }))).toBeNull();
      expect(rule.apply(context("foo@i ", { lang: "en_US" }))).toBeNull();
      expect(rule.apply(context("i's ", { lang: "en_US" }))).toBeNull();
      expect(rule.apply(context("i're ", { lang: "en_US" }))).toBeNull();
    });

    test("applies only after a token boundary delimiter", () => {
      const rule = new EnglishPronounICapitalizationRule();
      expect(rule.apply(context("i", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      // A bare "i." could still become "i.e."; the decision waits one character.
      expect(rule.apply(context("i.", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("i.e", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("i. ", { lang: "en_US", inputAction: "insert" }))).toEqual(
        edit("I. ", 3),
      );
    });
  });

  describe("EnglishContractionNormalizationRule", () => {
    test("normalizes contraction forms and preserves case", () => {
      const rule = new EnglishContractionNormalizationRule();

      expect(rule.apply(context("im ", { lang: "en_US", inputAction: "insert" }))).toEqual(
        edit("I'm ", 3),
      );

      expect(rule.apply(context("DONT ", { lang: "en_US", inputAction: "insert" }))).toEqual(
        edit("DON'T ", 5),
      );
    });

    test("preserves ambiguous id forms", () => {
      const rule = new EnglishContractionNormalizationRule();

      expect(rule.apply(context("ID ", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("Id ", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("id ", { lang: "en_US", inputAction: "insert" }))).toBeNull();
    });

    test("does not normalize in a non-English context", () => {
      const rule = new EnglishContractionNormalizationRule();
      expect(rule.apply(context("im ", { lang: "pl_PL" }))).toBeNull();
      expect(rule.apply(context("im ", { lang: "fr_FR" }))).toBeNull();
    });

    test("applies only after a token boundary delimiter", () => {
      const rule = new EnglishContractionNormalizationRule();
      expect(rule.apply(context("im", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("im.", { lang: "en_US", inputAction: "insert" }))).toEqual(
        edit("I'm.", 3),
      );
    });
  });

  describe("EnglishTypoWhitelistCorrectionRule", () => {
    test("corrects known typos and preserves case", () => {
      const rule = new EnglishTypoWhitelistCorrectionRule();

      expect(rule.apply(context("teh ", { lang: "en_US", inputAction: "insert" }))).toEqual(
        edit("the ", 4),
      );

      expect(rule.apply(context("Teh ", { lang: "en_US", inputAction: "insert" }))).toEqual(
        edit("The ", 4),
      );
    });

    test("skips words in user dictionary and code-like contexts", () => {
      const rule = new EnglishTypoWhitelistCorrectionRule();
      expect(rule.apply(context("teh ", { lang: "en_US", userDictionary: ["teh"] }))).toBeNull();
      expect(rule.apply(context("obj.teh ", { lang: "en_US" }))).toBeNull();
      expect(rule.apply(context("teh ", { lang: "pl_PL" }))).toBeNull();
      expect(rule.apply(context("teh ", { lang: "fr_FR" }))).toBeNull();
    });

    test("applies only after a token boundary delimiter", () => {
      const rule = new EnglishTypoWhitelistCorrectionRule();
      expect(rule.apply(context("teh", { lang: "en_US", inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("teh.", { lang: "en_US", inputAction: "insert" }))).toEqual(
        edit("the.", 4),
      );
    });
  });

  test("Object.prototype names are ordinary words, not lookup hits", () => {
    const rules = [
      new EnglishContractionNormalizationRule(),
      new EnglishTypoWhitelistCorrectionRule(),
    ];
    for (const rule of rules) {
      for (const word of ["constructor ", "toString ", "__proto__ ", "hasOwnProperty "]) {
        expect(rule.apply(context(word, { lang: "en_US", inputAction: "insert" }))).toBeNull();
      }
    }
  });
});
