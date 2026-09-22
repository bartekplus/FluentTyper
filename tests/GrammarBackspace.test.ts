import { describe, expect, test } from "bun:test";
import { SuggestionGrammarCoordinator } from "../src/adapters/chrome/content-script/suggestions/SuggestionGrammarCoordinator";
import { GRAMMAR_RULE_CATALOG } from "../src/core/domain/grammar/ruleCatalog";
import type { GrammarEventType } from "../src/core/domain/grammar/types";

const grammar = new SuggestionGrammarCoordinator({
  enabledGrammarRules: GRAMMAR_RULE_CATALOG.map((rule) => rule.id),
  insertSpaceAfterAutocomplete: true,
  lang: "en_US",
  userDictionaryList: [],
});

// Text a Backspace can leave behind that some rule would rewrite if it were typed.
const afterBackspace: [string, string][] = [
  ["A /", ""], // slashContextSpacing re-adds the deleted space
  ["x ,", "y"], // commaPeriodSpacing
  ["x )", "y"], // closingBracketSpacing
  ["a,,", ""], // duplicatePunctuationCollapse
  ["a  ", ""], // collapseRepeatedSpaces
  ["a \n", "b"], // trimSpaceBeforeLineBreak
  ["x\na", "b"], // capitalizeAfterLineBreak
  ["x=$", ""], // mathOperatorSpacing
];

describe("Backspace stays native", () => {
  for (const [beforeCursor, afterCursor] of afterBackspace) {
    test(`no rule rewrites ${JSON.stringify(beforeCursor)} after a delete`, () => {
      for (const triggers of [["insertChar"], ["wordBoundary"]] as GrammarEventType[][]) {
        expect(
          grammar.run({
            beforeCursor,
            afterCursor,
            inputAction: "delete",
            triggers,
            measurementContext: "prose",
          }),
        ).toBeNull();
      }
    });
  }

  test("the same text still gets fixed while typing", () => {
    expect(
      grammar.run({
        beforeCursor: "A /",
        afterCursor: "",
        inputAction: "insert",
        triggers: ["insertChar"],
      }),
    ).not.toBeNull();
  });
});
