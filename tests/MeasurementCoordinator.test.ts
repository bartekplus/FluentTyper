import { expect, test } from "bun:test";
import { SuggestionGrammarCoordinator } from "../src/adapters/chrome/content-script/suggestions/SuggestionGrammarCoordinator";

function coordinator(enabledGrammarRules: string[]) {
  return new SuggestionGrammarCoordinator({
    enabledGrammarRules,
    insertSpaceAfterAutocomplete: true,
    lang: "en_US",
    userDictionaryList: [],
  });
}
const input = {
  beforeCursor: "Mass: 10kg ",
  afterCursor: "",
  inputAction: "insert" as const,
  measurementContext: "prose" as const,
  triggers: ["wordBoundary" as const],
};

test("coordinator keeps paste and protected contexts outside measurement formatting", () => {
  const grammar = coordinator(["measurementUnitFormatting"]);
  expect(grammar.run(input)?.sourceRuleId).toBe("measurementUnitFormatting");
  expect(grammar.run({ ...input, triggers: ["paste", "wordBoundary"] })).toBeNull();
  expect(grammar.run({ ...input, measurementContext: "protected" })).toBeNull();
  expect(grammar.run({ ...input, triggers: ["idle"] })).toBeNull();
  grammar.updateLanguage("pl_PL");
  expect(grammar.run({ ...input, beforeCursor: "Masa: 1,50kg " })?.replacement).toBe(
    "1,50\u00a0kg ",
  );
  grammar.updateLanguage("pt-PT");
  expect(grammar.run(input)).toBeNull();
});

test("numeric punctuation stays protected regardless of the measurement toggle", () => {
  const comma = { ...input, beforeCursor: "List: 1,", triggers: ["insertChar" as const] };
  // The guard protects numeric text, so it must not depend on an unrelated rule
  // being enabled; otherwise "1,234" is mangled into "1, 234".
  expect(coordinator(["commaPeriodSpacing"]).run(comma)).toBeNull();
  expect(coordinator(["commaPeriodSpacing", "measurementUnitFormatting"]).run(comma)).toBeNull();
  expect(
    coordinator(["commaPeriodSpacing"]).run({ ...comma, beforeCursor: "List: 1,a" })?.replacement,
  ).toBe(", a");
  expect(coordinator([]).run(input)).toBeNull();
});
