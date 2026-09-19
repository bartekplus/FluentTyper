import { describe, expect, test } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

function type(input: string, lang: string): string {
  const engine = new GrammarRuleEngine();
  for (const rule of createGrammarRuleCatalogRuntime({
    insertSpaceAfterAutocomplete: true,
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
  ])
    test(input, () => expect(type(input, lang)).toBe(expected));
});
