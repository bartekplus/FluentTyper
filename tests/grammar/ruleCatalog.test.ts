import { describe, expect, test } from "bun:test";
import {
  DEFAULT_V1_GRAMMAR_RULES,
  DEFAULT_V2_GRAMMAR_RULES,
  GRAMMAR_RULE_CATALOG,
  GRAMMAR_RULE_IDS,
  RECOMMENDED_V1_GRAMMAR_RULES,
  RECOMMENDED_V2_GRAMMAR_RULES,
  isCatalogRuleId,
  normalizeGrammarRuleSelection,
} from "../../src/core/domain/grammar/ruleCatalog";

describe("ruleCatalog", () => {
  test("exposes stable ordered catalog ids", () => {
    expect(GRAMMAR_RULE_CATALOG.length).toBeGreaterThan(0);
    expect(GRAMMAR_RULE_IDS).toEqual(GRAMMAR_RULE_CATALOG.map((entry) => entry.id));
  });

  test("maps legacy rule ids to new granular ids in catalog order", () => {
    expect(normalizeGrammarRuleSelection(["spacingRule"])).toEqual([
      "technicalTokenCompaction",
      "mathOperatorSpacing",
      "slashContextSpacing",
      "openingBracketSpacing",
      "closingBracketSpacing",
      "commaPeriodSpacing",
      "neutralPunctuationPolicy",
    ]);

    expect(
      normalizeGrammarRuleSelection([
        "capitalizeFirstLetter",
        "commaPeriodSpacing",
        "spacingRule",
        "unknownRule",
      ]),
    ).toEqual([
      "capitalizeSentenceStart",
      "capitalizeAfterLineBreak",
      "technicalTokenCompaction",
      "mathOperatorSpacing",
      "slashContextSpacing",
      "openingBracketSpacing",
      "closingBracketSpacing",
      "commaPeriodSpacing",
      "neutralPunctuationPolicy",
    ]);
  });

  test("returns empty selection for non-array values", () => {
    expect(normalizeGrammarRuleSelection(undefined)).toEqual([]);
    expect(normalizeGrammarRuleSelection("spacingRule")).toEqual([]);
    expect(normalizeGrammarRuleSelection({ value: ["spacingRule"] })).toEqual([]);
  });

  test("has valid default/recommended subsets", () => {
    expect(DEFAULT_V1_GRAMMAR_RULES.length).toBeGreaterThan(0);
    expect(DEFAULT_V2_GRAMMAR_RULES.length).toBeGreaterThanOrEqual(DEFAULT_V1_GRAMMAR_RULES.length);
    expect(RECOMMENDED_V1_GRAMMAR_RULES.length).toBeGreaterThan(0);
    expect(RECOMMENDED_V2_GRAMMAR_RULES.length).toBeGreaterThanOrEqual(
      RECOMMENDED_V1_GRAMMAR_RULES.length,
    );
    expect(DEFAULT_V1_GRAMMAR_RULES.every((id) => isCatalogRuleId(id))).toBe(true);
    expect(DEFAULT_V2_GRAMMAR_RULES.every((id) => isCatalogRuleId(id))).toBe(true);
    expect(RECOMMENDED_V1_GRAMMAR_RULES.every((id) => isCatalogRuleId(id))).toBe(true);
    expect(RECOMMENDED_V2_GRAMMAR_RULES.every((id) => isCatalogRuleId(id))).toBe(true);
  });

  test("validates catalog ids", () => {
    expect(isCatalogRuleId("capitalizeSentenceStart")).toBe(true);
    expect(isCatalogRuleId("spacingRule")).toBe(false);
    expect(isCatalogRuleId("not_a_rule")).toBe(false);
  });
});
