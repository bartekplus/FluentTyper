import { describe, expect, test } from "bun:test";
import type { SuggestionGrammarCoordinator } from "../src/adapters/chrome/content-script/suggestions/SuggestionGrammarCoordinator";
import { grammarCoordinator as coordinator } from "./suggestionTestUtils";

const virtualBoundary = (grammar: SuggestionGrammarCoordinator, beforeCursor: string) =>
  grammar.runVirtualWordBoundary({ beforeCursor, afterCursor: "", measurementContext: "prose" });

describe("Enter as a virtual word boundary", () => {
  const rules = [
    "capitalizeSentenceStart",
    "trimSpaceBeforeLineBreak",
    "collapseRepeatedSpaces",
    "commaPeriodSpacing",
  ];

  test("capitalizes a final word the host is about to submit", () => {
    expect(virtualBoundary(coordinator(rules), "hello")).toEqual({
      replacement: "Hello",
      deleteBackwards: 5,
      deleteForwards: 0,
      sourceRuleId: "capitalizeSentenceStart",
    });
  });

  test("never deletes a space before a line break that will not exist", () => {
    // Enter may submit rather than insert a newline, so trimming here would
    // silently drop text the user typed. The real space already triggered
    // capitalization when it was typed.
    const grammar = coordinator(rules);
    expect(virtualBoundary(grammar, "hello ")).toBeNull();
    expect(virtualBoundary(grammar, "hello  ")).toBeNull();
    expect(virtualBoundary(grammar, " ")).toBeNull();
  });

  test("leaves technical tokens and finished sentences alone", () => {
    const grammar = coordinator(rules);
    expect(virtualBoundary(grammar, "user.save()")).toBeNull();
    expect(virtualBoundary(grammar, "node.js")).toBeNull();
    expect(virtualBoundary(grammar, "Hi there")).toBeNull();
    expect(virtualBoundary(grammar, "")).toBeNull();
  });
});
