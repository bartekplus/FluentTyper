import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CURRENT_GRAMMAR_RULES,
  EXCLUSIVE_RULE_GROUPS,
  DEFAULT_V3_GRAMMAR_RULES,
  GRAMMAR_RULE_CATALOG,
  GRAMMAR_RULE_IDS,
  RECOMMENDED_V1_GRAMMAR_RULES,
  RECOMMENDED_V2_GRAMMAR_RULES,
  isCatalogRuleId,
  isCodeSafeGrammarRule,
  normalizeGrammarRuleSelection,
} from "../../src/core/domain/grammar/ruleCatalog";
import { isReviewSupportedRule } from "../../src/core/domain/grammar/review/reviewCatalog";

describe("ruleCatalog", () => {
  test("code mode keeps only code-safe rules", () => {
    expect(
      [
        "capitalizeSentenceStart",
        "commaPeriodSpacing",
        "trimSpaceBeforeLineBreak",
        "autoBracketClose",
        "unknownRule",
      ].filter(isCodeSafeGrammarRule),
    ).toEqual(["autoBracketClose"]);
  });

  test("each exclusive group has two or more Review rules, and a rule is in one group only", () => {
    const seen = new Set<string>();
    for (const group of EXCLUSIVE_RULE_GROUPS) {
      expect(group.length).toBeGreaterThanOrEqual(2);
      for (const id of group) {
        expect(isReviewSupportedRule(id)).toBe(true);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

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
    ]);
  });

  test("returns empty selection for non-array values", () => {
    expect(normalizeGrammarRuleSelection(undefined)).toEqual([]);
    expect(normalizeGrammarRuleSelection("spacingRule")).toEqual([]);
    expect(normalizeGrammarRuleSelection({ value: ["spacingRule"] })).toEqual([]);
  });

  test("has valid default/recommended subsets", () => {
    expect(RECOMMENDED_V1_GRAMMAR_RULES.length).toBeGreaterThan(0);
    expect(RECOMMENDED_V2_GRAMMAR_RULES.length).toBeGreaterThanOrEqual(
      RECOMMENDED_V1_GRAMMAR_RULES.length,
    );
    expect(DEFAULT_CURRENT_GRAMMAR_RULES.every((id) => isCatalogRuleId(id))).toBe(true);
    // Historical snapshots are frozen stored values: every entry is a live rule
    // except the retired no-op "neutralPunctuationPolicy".
    for (const snapshot of [
      RECOMMENDED_V1_GRAMMAR_RULES,
      RECOMMENDED_V2_GRAMMAR_RULES,
      DEFAULT_V3_GRAMMAR_RULES,
    ]) {
      expect(snapshot.filter((id) => !isCatalogRuleId(id))).toEqual(["neutralPunctuationPolicy"]);
    }
  });

  test("keeps v3 snapshots frozen while current defaults follow the catalog", () => {
    const defaultRolloutOnIds = GRAMMAR_RULE_CATALOG.filter(
      (entry) => entry.typing !== false && entry.defaultRollout === "on",
    ).map((entry) => entry.id);

    expect(DEFAULT_V3_GRAMMAR_RULES).not.toContain("measurementUnitFormatting");
    expect(DEFAULT_CURRENT_GRAMMAR_RULES).toEqual(defaultRolloutOnIds);
    expect(DEFAULT_CURRENT_GRAMMAR_RULES).toContain("measurementUnitFormatting");
  });

  test("validates catalog ids", () => {
    expect(isCatalogRuleId("capitalizeSentenceStart")).toBe(true);
    expect(isCatalogRuleId("spacingRule")).toBe(false);
    expect(isCatalogRuleId("not_a_rule")).toBe(false);
  });
});
