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
    });

    expect(rule.apply(context("https://example.com...", { inputAction: "insert" }))).toBeNull();
  });

  test("EmdashShortcutRule replaces trailing double hyphen with guardrails", () => {
    const rule = new EmdashShortcutRule();
    expect(rule.apply(context("word--", { inputAction: "insert" }))).toEqual({
      replacement: "—",
      deleteBackwards: 2,
      deleteForwards: 0,
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
    });

    expect(rule.apply(context('hello"', { inputAction: "insert" }))).toEqual({
      replacement: "”",
      deleteBackwards: 1,
      deleteForwards: 0,
    });

    expect(rule.apply(context('This is “awesome "', { inputAction: "insert" }))).toEqual({
      replacement: "”",
      deleteBackwards: 2,
      deleteForwards: 0,
    });

    expect(rule.apply(context('This is “awesome   "', { inputAction: "insert" }))).toEqual({
      replacement: "”",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(rule.apply(context('This is “awesome\u00A0"', { inputAction: "insert" }))).toEqual({
      replacement: "”",
      deleteBackwards: 2,
      deleteForwards: 0,
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
    });

    expect(rule.apply(context("Hello,,,,", { inputAction: "insert" }))).toEqual({
      replacement: ",",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(rule.apply(context("Oops.. ", { inputAction: "insert" }))).toEqual({
      replacement: ". ",
      deleteBackwards: 3,
      deleteForwards: 0,
    });

    expect(rule.apply(context("Hello,, ", { inputAction: "insert" }))).toEqual({
      replacement: ", ",
      deleteBackwards: 3,
      deleteForwards: 0,
    });

    expect(rule.apply(context("Hello,,\u00A0", { inputAction: "insert" }))).toEqual({
      replacement: ",\u00A0",
      deleteBackwards: 3,
      deleteForwards: 0,
    });

    expect(rule.apply(context("Hello,, ,", { inputAction: "insert" }))).toEqual({
      replacement: ", ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(rule.apply(context("Hello,,\u00A0,", { inputAction: "insert" }))).toEqual({
      replacement: ",\u00A0",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(rule.apply(context("Hello,,\u00A0\u00A0,", { inputAction: "insert" }))).toEqual({
      replacement: ",\u00A0",
      deleteBackwards: 5,
      deleteForwards: 0,
    });

    expect(rule.apply(context("Hello,,\u200B ", { inputAction: "insert" }))).toEqual({
      replacement: ",\u200B ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(rule.apply(context("Hello,,\u200B,", { inputAction: "insert" }))).toEqual({
      replacement: ",\u200B",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(rule.apply(context("This is,,,,,,,,,,,, ", { inputAction: "insert" }))).toEqual({
      replacement: ", ",
      deleteBackwards: 13,
      deleteForwards: 0,
    });

    expect(rule.apply(context("What the fewer ,,,,,,,,,, ", { inputAction: "insert" }))).toEqual({
      replacement: ", ",
      deleteBackwards: 12,
      deleteForwards: 0,
    });

    expect(rule.apply(context("What the fewer , ,", { inputAction: "insert" }))).toEqual({
      replacement: ", ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(rule.apply(context("Wait... ", { inputAction: "insert" }))).toBeNull();
    expect(rule.apply(context("Nice!!", { inputAction: "insert" }))).toBeNull();
  });

  test("EnglishModalOfCorrectionRule normalizes could of style phrases", () => {
    const rule = new EnglishModalOfCorrectionRule();

    // The following word disambiguates: "must of course" is valid English.
    expect(rule.apply(context("could of ", { lang: "en_US", inputAction: "insert" }))).toBeNull();
    expect(
      rule.apply(context("must of course ", { lang: "en_US", inputAction: "insert" })),
    ).toBeNull();

    expect(rule.apply(context("could of gone ", { lang: "en_US", inputAction: "insert" }))).toEqual(
      {
        replacement: "could have gone ",
        deleteBackwards: "could of gone ".length,
        deleteForwards: 0,
      },
    );

    expect(rule.apply(context("COULD OF GONE ", { lang: "en_US", inputAction: "insert" }))).toEqual(
      {
        replacement: "COULD HAVE GONE ",
        deleteBackwards: "COULD OF GONE ".length,
        deleteForwards: 0,
      },
    );
  });

  test("EnglishYourWelcomeCorrectionRule normalizes phrase", () => {
    const rule = new EnglishYourWelcomeCorrectionRule();

    expect(rule.apply(context("your welcome!", { lang: "en_US", inputAction: "insert" }))).toEqual({
      replacement: "you're welcome!",
      deleteBackwards: "your welcome!".length,
      deleteForwards: 0,
    });
  });

  test("EnglishTheirThereBeVerbRule normalizes there/their mismatch", () => {
    const rule = new EnglishTheirThereBeVerbRule();

    expect(rule.apply(context("their is ", { lang: "en_US", inputAction: "insert" }))).toEqual({
      replacement: "there is ",
      deleteBackwards: "their is ".length,
      deleteForwards: 0,
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
    });
  });

  test("EnglishPronounVerbWhitelistAgreementRule applies strict whitelist", () => {
    const rule = new EnglishPronounVerbWhitelistAgreementRule();

    // "i is None" is Python; the word after the verb decides.
    expect(rule.apply(context("I is ", { lang: "en_US", inputAction: "insert" }))).toBeNull();
    expect(rule.apply(context("i is None ", { lang: "en_US", inputAction: "insert" }))).toBeNull();
    expect(rule.apply(context("I is wrong ", { lang: "en_US", inputAction: "insert" }))).toEqual({
      replacement: "I am wrong ",
      deleteBackwards: "I is wrong ".length,
      deleteForwards: 0,
    });

    expect(rule.apply(context("YOU WAS THERE ", { lang: "en_US", inputAction: "insert" }))).toEqual(
      {
        replacement: "YOU WERE THERE ",
        deleteBackwards: "YOU WAS THERE ".length,
        deleteForwards: 0,
      },
    );

    expect(rule.apply(context("they is ", { lang: "en_US", inputAction: "insert" }))).toBeNull();
  });
});
