import { describe, expect, test } from "bun:test";
import type { GrammarContext } from "../../src/core/domain/grammar/types";
import { CapitalizeSentenceStartRule } from "../../src/core/domain/grammar/implementations/CapitalizeSentenceStartRule";
import { CapitalizeAfterLineBreakRule } from "../../src/core/domain/grammar/implementations/CapitalizeAfterLineBreakRule";
import { CommaPeriodSpacingRule } from "../../src/core/domain/grammar/implementations/CommaPeriodSpacingRule";
import { OpeningBracketSpacingRule } from "../../src/core/domain/grammar/implementations/OpeningBracketSpacingRule";
import { ClosingBracketSpacingRule } from "../../src/core/domain/grammar/implementations/ClosingBracketSpacingRule";
import { SlashContextSpacingRule } from "../../src/core/domain/grammar/implementations/SlashContextSpacingRule";
import { MathOperatorSpacingRule } from "../../src/core/domain/grammar/implementations/MathOperatorSpacingRule";
import { TechnicalTokenCompactionRule } from "../../src/core/domain/grammar/implementations/TechnicalTokenCompactionRule";
import { CollapseRepeatedSpacesRule } from "../../src/core/domain/grammar/implementations/CollapseRepeatedSpacesRule";
import { TrimSpaceBeforeLineBreakRule } from "../../src/core/domain/grammar/implementations/TrimSpaceBeforeLineBreakRule";
import { NeutralPunctuationPolicyRule } from "../../src/core/domain/grammar/implementations/NeutralPunctuationPolicyRule";
import { ZERO_WIDTH_FILLER_CHARS } from "../../src/core/domain/spacingRules";

function context(beforeCursor: string, hints?: GrammarContext["hints"]): GrammarContext {
  return {
    beforeCursor,
    afterCursor: "",
    ...(hints ? { hints } : {}),
  };
}

describe("V1 grammar rules", () => {
  describe("CapitalizeSentenceStartRule", () => {
    test("capitalizes sequence start and sentence start after punctuation", () => {
      const rule = new CapitalizeSentenceStartRule();

      expect(rule.apply(context("h"))).toEqual({
        replacement: "H",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "medium",
        description: "Capitalized sequence start",
      });

      expect(rule.apply(context("Hello. w"))).toEqual({
        replacement: "W",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized sentence start",
      });
    });

    test("supports optional closing quotes/brackets after sentence punctuation", () => {
      const rule = new CapitalizeSentenceStartRule();
      expect(rule.apply(context('Hello." w'))).toEqual({
        replacement: "W",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized sentence start",
      });
    });

    test("does not capitalize without sentence boundary gap", () => {
      const rule = new CapitalizeSentenceStartRule();
      expect(rule.apply(context("Hello.w"))).toBeNull();
      expect(rule.apply(context("Hello, w"))).toBeNull();
    });
  });

  describe("CapitalizeAfterLineBreakRule", () => {
    test("capitalizes after one or more line breaks", () => {
      const rule = new CapitalizeAfterLineBreakRule();

      expect(rule.apply(context("Hello\nw"))).toEqual({
        replacement: "W",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized after line break",
      });

      expect(rule.apply(context("Hello\n\n   w"))).toEqual({
        replacement: "W",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized after line break",
      });
    });

    test("does not capitalize without line break context", () => {
      const rule = new CapitalizeAfterLineBreakRule();
      expect(rule.apply(context("Hello w"))).toBeNull();
      expect(rule.apply(context("Hello\nW"))).toBeNull();
    });
  });

  describe("CommaPeriodSpacingRule", () => {
    test("normalizes comma/period spacing with regular spaces", () => {
      const rule = new CommaPeriodSpacingRule(true);
      expect(rule.apply(context("Hello."))).toEqual({
        replacement: ". ",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied comma/period spacing",
      });
      expect(rule.apply(context("Hello ."))).toEqual({
        replacement: ". ",
        deleteBackwards: 2,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied comma/period spacing",
      });
      expect(rule.apply(context("Hello  ."))).toEqual({
        replacement: ". ",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied comma/period spacing",
      });
      expect(rule.apply(context("Hello   ,"))).toEqual({
        replacement: ", ",
        deleteBackwards: 4,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied comma/period spacing",
      });
    });

    test("respects delete-intent suppression and insertSpaceAfterAutocomplete=false", () => {
      const insertRule = new CommaPeriodSpacingRule(true);
      const noInsertRule = new CommaPeriodSpacingRule(false);

      expect(insertRule.apply(context("Hello.", { inputAction: "delete" }))).toBeNull();
      expect(noInsertRule.apply(context("Hello."))).toBeNull();
      expect(noInsertRule.apply(context("Hello ."))).toEqual({
        replacement: ".",
        deleteBackwards: 2,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied comma/period spacing",
      });
      expect(noInsertRule.apply(context("Hello  ."))).toEqual({
        replacement: ".",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied comma/period spacing",
      });
      expect(noInsertRule.apply(context("Hello   ,"))).toEqual({
        replacement: ",",
        deleteBackwards: 4,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied comma/period spacing",
      });
    });

    test("treats zero-width fillers as ignorable separators for duplicate commas", () => {
      const rule = new CommaPeriodSpacingRule(true);

      for (const filler of ZERO_WIDTH_FILLER_CHARS) {
        expect(rule.apply(context(`Hello,${filler},`))).toBeNull();
        expect(rule.apply(context(`Hello,\u00A0${filler},`))).toBeNull();
      }
    });
  });

  describe("OpeningBracketSpacingRule", () => {
    test("adds space before prose/control openers and preserves code-like attachment", () => {
      const rule = new OpeningBracketSpacingRule(true);

      expect(rule.apply(context("if("))).toEqual({
        replacement: " (",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied opening bracket spacing",
      });

      expect(rule.apply(context("if (x){"))).toEqual({
        replacement: " {",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied opening bracket spacing",
      });

      expect(rule.apply(context("console.log("))).toBeNull();
      expect(rule.apply(context("myArray["))).toBeNull();
    });
  });

  describe("ClosingBracketSpacingRule", () => {
    test("removes inner pre-close spaces and adds prose trailing space", () => {
      const rule = new ClosingBracketSpacingRule(true);

      expect(rule.apply(context("foo(bar() )"))).toEqual({
        replacement: ")",
        deleteBackwards: 2,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied closing bracket spacing",
      });

      expect(rule.apply(context("Hello (world)"))).toEqual({
        replacement: ") ",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied closing bracket spacing",
      });

      expect(rule.apply(context("foo(bar())"))).toBeNull();
    });

    test("supports delete-intent suppression and no trailing-space mode", () => {
      const withInsert = new ClosingBracketSpacingRule(true);
      const noInsert = new ClosingBracketSpacingRule(false);

      expect(withInsert.apply(context("Hello (world)", { inputAction: "delete" }))).toBeNull();
      expect(noInsert.apply(context("Hello (world)"))).toBeNull();
    });
  });

  describe("SlashContextSpacingRule", () => {
    test("compacts protocol spacing and applies operator spacing only in operator context", () => {
      const rule = new SlashContextSpacingRule(true);

      expect(rule.apply(context("https: /"))).toEqual({
        replacement: "/",
        deleteBackwards: 2,
        deleteForwards: 0,
        confidence: "high",
        description: "Compacted protocol slash spacing",
      });

      expect(rule.apply(context("x /"))).toEqual({
        replacement: "/ ",
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied slash operator spacing",
      });

      expect(rule.apply(context("src/"))).toBeNull();
      expect(rule.apply(context("</"))).toBeNull();
    });
  });

  describe("MathOperatorSpacingRule", () => {
    test("normalizes compact math/operator forms in safe contexts", () => {
      const rule = new MathOperatorSpacingRule(true);

      expect(rule.apply(context("x=y"))).toEqual({
        replacement: "x = y",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied context-aware math operator spacing",
      });

      expect(rule.apply(context("y+1"))).toEqual({
        replacement: "y + 1",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied context-aware math operator spacing",
      });

      expect(rule.apply(context("x*y"))).toEqual({
        replacement: "x * y",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied context-aware math operator spacing",
      });
    });

    test("does not alter comparator chains or prose-like compact tokens", () => {
      const rule = new MathOperatorSpacingRule(true);
      expect(rule.apply(context("x==y"))).toBeNull();
      expect(rule.apply(context("foo+b"))).toBeNull();
    });
  });

  describe("TechnicalTokenCompactionRule", () => {
    test("compacts decimal, time/ratio, and accessor spacing conservatively", () => {
      const rule = new TechnicalTokenCompactionRule(true);

      expect(rule.apply(context("3. 1"))).toEqual({
        replacement: ".1",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Compacted technical decimal notation",
      });

      expect(rule.apply(context("12: 3"))).toEqual({
        replacement: ":3",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Compacted technical time or ratio notation",
      });

      expect(rule.apply(context("obj.cfg_1. x"))).toEqual({
        replacement: ".x",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Compacted technical accessor spacing",
      });
    });

    test("does not compact prose continuation", () => {
      const rule = new TechnicalTokenCompactionRule(true);
      expect(rule.apply(context("Hello. w"))).toBeNull();
      expect(rule.apply(context("old_word. X"))).toBeNull();
      expect(rule.apply(context("Read on. Duplicate. W"))).toBeNull();
    });
  });

  describe("CollapseRepeatedSpacesRule", () => {
    test("collapses repeated trailing spaces outside indentation context", () => {
      const rule = new CollapseRepeatedSpacesRule();

      expect(rule.apply(context("hello  "))).toEqual({
        replacement: " ",
        deleteBackwards: 2,
        deleteForwards: 0,
        confidence: "high",
        description: "Collapsed repeated spaces",
      });

      expect(rule.apply(context("hello   "))).toEqual({
        replacement: " ",
        deleteBackwards: 3,
        deleteForwards: 0,
        confidence: "high",
        description: "Collapsed repeated spaces",
      });
    });

    test("preserves indentation-like leading spaces", () => {
      const rule = new CollapseRepeatedSpacesRule();
      expect(rule.apply(context("\n  "))).toBeNull();
      expect(rule.apply(context(" "))).toBeNull();
    });
  });

  describe("TrimSpaceBeforeLineBreakRule", () => {
    test("trims spaces before newline", () => {
      const rule = new TrimSpaceBeforeLineBreakRule();

      expect(rule.apply(context("Hello \n"))).toEqual({
        replacement: "\n",
        deleteBackwards: 2,
        deleteForwards: 0,
        confidence: "high",
        description: "Trimmed spaces before line break",
      });

      expect(rule.apply(context("Hello   \n"))).toEqual({
        replacement: "\n",
        deleteBackwards: 4,
        deleteForwards: 0,
        confidence: "high",
        description: "Trimmed spaces before line break",
      });
    });

    test("does not edit when no trailing spaces precede newline", () => {
      const rule = new TrimSpaceBeforeLineBreakRule();
      expect(rule.apply(context("Hello\n"))).toBeNull();
      expect(rule.apply(context("Hello"))).toBeNull();
    });
  });

  describe("NeutralPunctuationPolicyRule", () => {
    test("is a no-op for neutral punctuation policy", () => {
      const rule = new NeutralPunctuationPolicyRule();
      expect(rule.apply(context("Hello!"))).toBeNull();
      expect(rule.apply(context("Hello :"))).toBeNull();
    });
  });
});
