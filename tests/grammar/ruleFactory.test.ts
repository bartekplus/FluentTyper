import { describe, expect, test } from "bun:test";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { GRAMMAR_RULE_CATALOG } from "../../src/core/domain/grammar/ruleCatalog";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

function context(beforeCursor: string): GrammarContext {
  return {
    beforeCursor,
    afterCursor: "",
  };
}

describe("ruleFactory", () => {
  test("creates runtime rules in explicit catalog priority order", () => {
    const runtimeRules = createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: [],
    });

    expect(runtimeRules.map((rule) => rule.id)).toEqual(
      GRAMMAR_RULE_CATALOG.slice()
        .sort((a, b) => a.priority - b.priority)
        .map((entry) => entry.id),
    );
  });

  test("passes insertSpaceAfterAutocomplete option into spacing-dependent rules", () => {
    const withInsert = createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: [],
    });
    const withoutInsert = createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: false,
      userDictionaryList: [],
    });

    const commaWithInsert = withInsert.find((rule) => rule.id === "commaPeriodSpacing");
    const commaWithoutInsert = withoutInsert.find((rule) => rule.id === "commaPeriodSpacing");

    expect(commaWithInsert).toBeDefined();
    expect(commaWithoutInsert).toBeDefined();

    expect(commaWithInsert?.apply(context("Hello."))).toEqual(
      expect.objectContaining({
        replacement: ". ",
      }),
    );
    expect(commaWithoutInsert?.apply(context("Hello."))).toBeNull();
  });
});
