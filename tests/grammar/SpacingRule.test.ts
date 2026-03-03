import { expect, test, describe, beforeEach } from "bun:test";
import { SpacingRule } from "../../src/core/domain/grammar/implementations/SpacingRule";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

describe("SpacingRule", () => {
  let ruleA: SpacingRule; // insertSpaceAfterAutocomplete = true
  let ruleB: SpacingRule; // insertSpaceAfterAutocomplete = false

  beforeEach(() => {
    ruleA = new SpacingRule(true);
    ruleB = new SpacingRule(false);
  });

  const getContext = (before: string): GrammarContext => ({
    beforeCursor: before,
    afterCursor: "",
  });

  test("returns null for empty input", () => {
    expect(ruleA.apply(getContext(""))).toBeNull();
  });

  test("returns null if less than 2 characters", () => {
    expect(ruleA.apply(getContext("."))).toBeNull();
  });

  test.each([".", ",", "!", "?", ":", ";"])(
    "keeps punctuation rule baseline for '%s'",
    (punctuation) => {
      expect(ruleA.apply(getContext(`Hello${punctuation}`))).toEqual({
        replacement: `${punctuation}\xA0`,
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied standard spacing rules for punctuation",
      });

      expect(ruleA.apply(getContext(`Hello ${punctuation}`))).toEqual({
        replacement: `${punctuation}\xA0`,
        deleteBackwards: 2,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied standard spacing rules for punctuation",
      });
    },
  );

  test("handles spacing around sentence-ending punctuation (.)", () => {
    expect(ruleA.apply(getContext("Hello."))).toEqual({
      replacement: ".\xA0",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied standard spacing rules for punctuation",
    });

    expect(ruleA.apply(getContext("Hello ."))).toEqual({
      replacement: ".\xA0",
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied standard spacing rules for punctuation",
    });
  });

  test("handles spacing around punctuation with insertSpaceAfterAutocomplete false", () => {
    expect(ruleB.apply(getContext("Hello."))).toBeNull();
    expect(ruleB.apply(getContext("Hello ."))).toEqual({
      replacement: ".",
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied standard spacing rules for punctuation",
    });
  });

  test("handles spacing for brackets (requires space before, no space after)", () => {
    expect(ruleA.apply(getContext("Hello["))).toEqual({
      replacement: "\xA0[",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied standard spacing rules for punctuation",
    });

    expect(ruleA.apply(getContext("Hello ["))).toBeNull();
  });

  test("handles unicode characters natively", () => {
    expect(ruleA.apply(getContext("Zażółć gęślą jaźń."))).toEqual({
      replacement: ".\xA0",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied standard spacing rules for punctuation",
    });

    expect(ruleA.apply(getContext("Привет ."))).toEqual({
      replacement: ".\xA0",
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied standard spacing rules for punctuation",
    });
  });

  test("returns null if last char minus 2 is a space", () => {
    expect(ruleA.apply(getContext("  ."))).toBeNull();
  });

  test("keeps decimal punctuation behavior and compacts technical decimal spacing", () => {
    expect(ruleA.apply(getContext("3."))).toEqual({
      replacement: ".\xA0",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied standard spacing rules for punctuation",
    });

    expect(ruleA.apply(getContext("3.\xA01"))).toEqual({
      replacement: ".1",
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "high",
      description: "Compacted technical punctuation spacing for decimal notation",
    });
  });

  test("compacts technical time and ratio notation spacing", () => {
    expect(ruleA.apply(getContext("12:\xA03"))).toEqual({
      replacement: ":3",
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "high",
      description: "Compacted technical punctuation spacing for time or ratio notation",
    });

    expect(ruleA.apply(getContext("16:\xA09"))).toEqual({
      replacement: ":9",
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "high",
      description: "Compacted technical punctuation spacing for time or ratio notation",
    });
  });

  test("compacts conservative accessor contexts with code cues", () => {
    expect(ruleA.apply(getContext("cfg_1.\xA0x"))).toEqual({
      replacement: ".x",
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "high",
      description: "Compacted technical punctuation spacing for code accessor",
    });

    expect(ruleA.apply(getContext("obj.user.\xA0n"))).toEqual({
      replacement: ".n",
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "high",
      description: "Compacted technical punctuation spacing for code accessor",
    });
  });

  test("does not compact prose continuation without code cues", () => {
    expect(ruleA.apply(getContext("Hello.\xA0w"))).toBeNull();
  });
});
