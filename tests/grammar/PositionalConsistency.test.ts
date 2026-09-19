import { describe, expect, test } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

/**
 * Every hand-written grammar case in this suite was authored with a prefix
 * ("Mass: 10kg "), so none of them ever sat first in the field. That is how
 * "2Mbit 2Mbit " shipped as "2Mbit 2 Mbit ": the same text, spaced only where
 * a word happened to precede it. These tests vary the POSITION of a fragment
 * instead of inventing more fragments, because position is the axis the
 * hand-written cases hold constant.
 */
function type(input: string, lang = "en_US"): string {
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
      [...DEFAULT_CURRENT_GRAMMAR_RULES],
    );
    for (const edit of edits) context = applyGrammarEditToContext(context, edit);
  }
  return context.beforeCursor;
}

// Prose positions a fragment can occupy. Capitalization legitimately differs
// between them, so fragments below start with a digit or an already-capital
// word and the comparison is on the rest of the edit.
const PROSE_POSITIONS: ReadonlyArray<readonly [string, string]> = [
  ["field start", ""],
  ["after a word", "Note "],
  ["after a newline", "Note\n"],
  ["after indentation", "  "],
  ["inside brackets", "Note ("],
  ["after a colon", "Note: "],
];

describe("a fragment formats the same wherever it sits in prose", () => {
  for (const fragment of ["10kg ", "1.50kg ", "2Mbit ", "5m/s ", "10MB "]) {
    test(fragment, () => {
      const outcomes = PROSE_POSITIONS.map(([, prefix]) => {
        const typed = type(prefix + fragment);
        return typed.slice(type(prefix).length);
      });
      const [first] = outcomes;
      for (const [index, outcome] of outcomes.entries()) {
        expect(`${PROSE_POSITIONS[index]?.[0]}: ${outcome}`).toBe(
          `${PROSE_POSITIONS[index]?.[0]}: ${first}`,
        );
      }
    });
  }

  test("repeating a fragment formats both occurrences alike", () => {
    expect(type("2Mbit 2Mbit ")).toBe("2 Mbit 2 Mbit ");
    expect(type("2kg 2kg ")).toBe("2 kg 2 kg ");
    expect(type("Note 10kg and 10kg ")).toBe("Note 10 kg and 10 kg ");
  });
});

describe("prose in brackets is still prose", () => {
  for (const [input, expected] of [
    ["I said (dont do it) ok ", "I said (don't do it) ok "],
    ["See (teh cat) here ", "See (the cat) here "],
    ["Note (alot) here ", "Note (a lot) here "],
    ["Mass (10kg ", "Mass (10 kg "],
  ])
    test(input, () => expect(type(input)).toBe(expected));

  // An identifier hard against the bracket is a call, not a parenthetical.
  for (const input of ["call foo(dont) here ", "call f(10kg now "])
    test(input, () => expect(type(input)).toBe(input.charAt(0).toUpperCase() + input.slice(1)));
});

describe("a line break does not change what a word is", () => {
  for (const [input, expected] of [
    ["Note\ndont do it ", "Note\nDon't do it "],
    ["Bob\ndont go ", "Bob\nDon't go "],
    ["Note\nteh cat ", "Note\nThe cat "],
  ])
    test(JSON.stringify(input), () => expect(type(input)).toBe(expected));
});
