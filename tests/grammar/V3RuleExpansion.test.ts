import { describe, expect, test } from "bun:test";
import type { GrammarContext } from "../../src/core/domain/grammar/types";
import { DoubleSpaceToPeriodRule } from "../../src/core/domain/grammar/implementations/DoubleSpaceToPeriodRule";
import { EllipsisShortcutRule } from "../../src/core/domain/grammar/implementations/EllipsisShortcutRule";
import { EmdashShortcutRule } from "../../src/core/domain/grammar/implementations/EmdashShortcutRule";
import { SmartQuoteNormalizationRule } from "../../src/core/domain/grammar/implementations/SmartQuoteNormalizationRule";
import { DuplicatePunctuationCollapseRule } from "../../src/core/domain/grammar/implementations/DuplicatePunctuationCollapseRule";
import { EnglishModalOfCorrectionRule } from "../../src/core/domain/grammar/implementations/EnglishModalOfCorrectionRule";
import { EnglishYourWelcomeCorrectionRule } from "../../src/core/domain/grammar/implementations/EnglishYourWelcomeCorrectionRule";
import { EnglishTheirThereBeVerbRule } from "../../src/core/domain/grammar/implementations/EnglishTheirThereBeVerbRule";
import { EnglishAlotCorrectionRule } from "../../src/core/domain/grammar/implementations/EnglishAlotCorrectionRule";
import { EnglishPronounVerbWhitelistAgreementRule } from "../../src/core/domain/grammar/implementations/EnglishPronounVerbWhitelistAgreementRule";

function context(beforeCursor: string, hints?: GrammarContext["hints"]): GrammarContext {
  return {
    beforeCursor,
    afterCursor: "",
    ...(hints ? { hints } : {}),
  };
}

describe("V3 rule expansion", () => {
  test("DoubleSpaceToPeriodRule applies conservatively", () => {
    const rule = new DoubleSpaceToPeriodRule();
    expect(rule.apply(context("Hello  ", { inputAction: "insert" }))).toEqual({
      replacement: ". ",
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Replaced double-space with sentence period",
    });

    expect(rule.apply(context("Hello.  ", { inputAction: "insert" }))).toBeNull();
    expect(rule.apply(context("12  ", { inputAction: "insert" }))).toBeNull();
    expect(rule.apply(context("https://example.com  ", { inputAction: "insert" }))).toBeNull();
    expect(rule.apply(context("Hello  ", { inputAction: "delete" }))).toBeNull();
  });

  test("EllipsisShortcutRule replaces triple dot and skips URL-like text", () => {
    const rule = new EllipsisShortcutRule();
    expect(rule.apply(context("Wait...", { inputAction: "insert" }))).toEqual({
      replacement: "…",
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Replaced three dots with ellipsis",
    });

    expect(rule.apply(context("https://example.com...", { inputAction: "insert" }))).toBeNull();
  });

  test("EmdashShortcutRule replaces trailing double hyphen with guardrails", () => {
    const rule = new EmdashShortcutRule();
    expect(rule.apply(context("word--", { inputAction: "insert" }))).toEqual({
      replacement: "—",
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Replaced double hyphen with em dash",
    });

    expect(rule.apply(context(" --", { inputAction: "insert" }))).toBeNull();
    expect(rule.apply(context("https://example.com--", { inputAction: "insert" }))).toBeNull();
  });

  test("SmartQuoteNormalizationRule converts straight quotes in prose contexts", () => {
    const rule = new SmartQuoteNormalizationRule();

    expect(rule.apply(context('"', { inputAction: "insert" }))).toEqual({
      replacement: "“",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Normalized straight quote",
    });

    expect(rule.apply(context('hello"', { inputAction: "insert" }))).toEqual({
      replacement: "”",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Normalized straight quote",
    });

    expect(rule.apply(context('This is “awesome "', { inputAction: "insert" }))).toEqual({
      replacement: "”",
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Normalized straight quote",
    });

    expect(rule.apply(context('”"', { inputAction: "insert" }))).toBeNull();
    expect(rule.apply(context("’'", { inputAction: "insert" }))).toBeNull();

    expect(rule.apply(context("it's", { inputAction: "insert" }))).toBeNull();
  });

  test("DuplicatePunctuationCollapseRule collapses accidental duplicates", () => {
    const rule = new DuplicatePunctuationCollapseRule();

    expect(rule.apply(context("Hello,,", { inputAction: "insert" }))).toEqual({
      replacement: ",",
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Collapsed duplicate punctuation",
    });

    expect(rule.apply(context("Oops.. ", { inputAction: "insert" }))).toEqual({
      replacement: ". ",
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Collapsed accidental double period",
    });

    expect(rule.apply(context("Wait... ", { inputAction: "insert" }))).toBeNull();
    expect(rule.apply(context("Nice!!", { inputAction: "insert" }))).toBeNull();
  });

  test("EnglishModalOfCorrectionRule normalizes could of style phrases", () => {
    const rule = new EnglishModalOfCorrectionRule();

    expect(rule.apply(context("could of ", { lang: "en_US", inputAction: "insert" }))).toEqual({
      replacement: "could have ",
      deleteBackwards: "could of ".length,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected modal phrase typo",
    });

    expect(rule.apply(context("COULD OF ", { lang: "en_US", inputAction: "insert" }))).toEqual({
      replacement: "COULD HAVE ",
      deleteBackwards: "COULD OF ".length,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected modal phrase typo",
    });
  });

  test("EnglishYourWelcomeCorrectionRule normalizes phrase", () => {
    const rule = new EnglishYourWelcomeCorrectionRule();

    expect(rule.apply(context("your welcome!", { lang: "en_US", inputAction: "insert" }))).toEqual({
      replacement: "you're welcome!",
      deleteBackwards: "your welcome!".length,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected your welcome phrase",
    });
  });

  test("EnglishTheirThereBeVerbRule normalizes there/their mismatch", () => {
    const rule = new EnglishTheirThereBeVerbRule();

    expect(rule.apply(context("their is ", { lang: "en_US", inputAction: "insert" }))).toEqual({
      replacement: "there is ",
      deleteBackwards: "their is ".length,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected their/there phrase",
    });

    expect(rule.apply(context("their is ", { lang: "pl_PL", inputAction: "insert" }))).toBeNull();
  });

  test("EnglishAlotCorrectionRule corrects typo and respects user dictionary", () => {
    const rule = new EnglishAlotCorrectionRule(["alot"]);

    expect(rule.apply(context("alot ", { lang: "en_US", inputAction: "insert" }))).toBeNull();
    expect(
      rule.apply(context("alot ", { lang: "en_US", inputAction: "insert", userDictionary: [] })),
    ).toEqual({
      replacement: "a lot ",
      deleteBackwards: "alot ".length,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected alot typo",
    });
  });

  test("EnglishPronounVerbWhitelistAgreementRule applies strict whitelist", () => {
    const rule = new EnglishPronounVerbWhitelistAgreementRule();

    expect(rule.apply(context("I is ", { lang: "en_US", inputAction: "insert" }))).toEqual({
      replacement: "I am ",
      deleteBackwards: "I is ".length,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected whitelisted pronoun-verb mismatch",
    });

    expect(rule.apply(context("YOU WAS ", { lang: "en_US", inputAction: "insert" }))).toEqual({
      replacement: "YOU WERE ",
      deleteBackwards: "YOU WAS ".length,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected whitelisted pronoun-verb mismatch",
    });

    expect(rule.apply(context("they is ", { lang: "en_US", inputAction: "insert" }))).toBeNull();
  });
});
