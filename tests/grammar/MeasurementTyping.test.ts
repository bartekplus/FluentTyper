import { describe, expect, test } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

function type(input: string, lang: string, insertSpaceAfterAutocomplete = true): string {
  const engine = new GrammarRuleEngine();
  for (const rule of createGrammarRuleCatalogRuntime({
    insertSpaceAfterAutocomplete,
    userDictionaryList: [],
  }))
    engine.registerRule(rule);
  let context: GrammarContext = {
    beforeCursor: "",
    afterCursor: "",
    hints: { lang, inputAction: "insert", measurementContext: "prose" },
  };
  for (const char of input) {
    context.beforeCursor += char;
    const edits = engine.process(
      char === " " || char === "\n" ? "wordBoundary" : "insertChar",
      context,
      DEFAULT_CURRENT_GRAMMAR_RULES,
    );
    for (const edit of edits) context = applyGrammarEditToContext(context, edit);
  }
  return context.beforeCursor;
}

describe("measurement formatting during typing", () => {
  for (const [input, lang, expected] of [
    ["Mass: 1.50kg ", "en_US", "Mass: 1.50\u00a0kg "],
    ["Masa: 1,50kg ", "pl_PL", "Masa: 1,50\u00a0kg "],
    ["Speed: 5m/s ", "en_US", "Speed: 5\u00a0m/s "],
    ["Flux: 2W/(m·K) ", "en_US", "Flux: 2\u00a0W/(m·K) "],
    ["Area: 3m² ", "en_US", "Area: 3\u00a0m² "],
    ["Scientific: 1.e3 and 1.e+3kg ", "en_US", "Scientific: 1.e3 and 1.e+3kg "],
  ])
    test(input, () => expect(type(input, lang)).toBe(expected));

  test("defers numeric punctuation until prose continuation is known", () => {
    expect(type("There were 2,and", "en_US")).toBe("There were 2, and");
    // A period after a number is left alone: "v2.next" and "1.x" are tokens.
    expect(type("It ended in 2026.next", "en_US")).toBe("It ended in 2026.next");
    expect(type("It ended in 2026. next ", "en_US")).toBe("It ended in 2026. Next ");
    expect(type("It cost 1.50,and", "en_US")).toBe("It cost 1.50, and");
    expect(type("It cost 1.50.next", "en_US")).toBe("It cost 1.50.next");
    expect(type("There were 1,234,and", "en_US")).toBe("There were 1,234, and");
    expect(type("Values: 1.50 and 1,234", "en_US")).toBe("Values: 1.50 and 1,234");
  });

  test("leaves deferred punctuation alone when automatic spacing is disabled", () => {
    expect(type("There were 2,and", "en_US", false)).toBe("There were 2,and");
  });
});
