import { expect, test, describe, beforeEach } from "bun:test";
import { CapitalizeFirstLetterRule } from "../../src/core/domain/grammar/implementations/CapitalizeFirstLetterRule";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

describe("CapitalizeFirstLetterRule", () => {
  let rule: CapitalizeFirstLetterRule;

  beforeEach(() => {
    rule = new CapitalizeFirstLetterRule();
  });

  const getContext = (before: string): GrammarContext => ({
    beforeCursor: before,
    afterCursor: "",
  });

  test("returns null for empty input", () => {
    expect(rule.apply(getContext(""))).toBeNull();
  });

  test("capitalizes first letter of sequence", () => {
    expect(rule.apply(getContext("h"))).toEqual({
      replacement: "H",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "medium",
      description: "Capitalized sequence start",
    });

    expect(rule.apply(getContext("   w"))).toEqual({
      replacement: "W",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "medium",
      description: "Capitalized sequence start",
    });
  });

  test("capitalizes after sentence-ending characters (. ! ?)", () => {
    expect(rule.apply(getContext("Hello. w"))).toEqual({
      replacement: "W",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Capitalized sentence start",
    });

    expect(rule.apply(getContext("Hi!   t"))).toEqual({
      replacement: "T",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Capitalized sentence start",
    });

    expect(rule.apply(getContext("How are you? i"))).toEqual({
      replacement: "I",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Capitalized sentence start",
    });
  });

  test("does not capitalize after sentence-ending char without space", () => {
    expect(rule.apply(getContext("Hello.w"))).toBeNull();
  });

  test("does not capitalize if not a valid lowercase alphabetic letter", () => {
    expect(rule.apply(getContext("Hello. 1"))).toBeNull();
    expect(rule.apply(getContext("Hello. -"))).toBeNull();
    expect(rule.apply(getContext("Hello. W"))).toBeNull();
  });

  test("does not capitalize after non-sentence-ending characters", () => {
    expect(rule.apply(getContext("Hello, w"))).toBeNull();
    expect(rule.apply(getContext("Hello-w"))).toBeNull();
  });

  test("handles unicode characters", () => {
    expect(rule.apply(getContext("ż"))).toEqual({
      replacement: "Ż",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "medium",
      description: "Capitalized sequence start",
    });

    expect(rule.apply(getContext("Cześć. ć"))).toEqual({
      replacement: "Ć",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Capitalized sentence start",
    });

    expect(rule.apply(getContext("Привет. п"))).toEqual({
      replacement: "П",
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Capitalized sentence start",
    });
  });
});
