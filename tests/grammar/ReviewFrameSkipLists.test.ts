import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FUNCTION_WORDS } from "../../src/core/domain/grammar/review/english/slotWords";

const yaml = readFileSync(
  new URL("../../src/core/domain/grammar/rules/en.yaml", import.meta.url),
  "utf8",
);

/** The words of a fragment: "a(?:b|c)|d" gives ab, ac and d. */
function fragmentWords(name: string): string[] {
  const value = new RegExp(`^  ${name}: "([^"]*)"$`, "m").exec(yaml)![1];
  return value.split(/\|(?![^(]*\))/).flatMap((part) => {
    const grouped = /^([a-z]+)\(\?:([a-z|]+)\)$/.exec(part);
    if (grouped) return grouped[2].split("|").map((rest) => grouped[1] + rest);
    expect(part).toMatch(/^[a-z]+$/);
    return [part];
  });
}

// A frame skips these words because its fixer rejects them: a word the fixer accepts must not
// be in the list, or the frame loses findings.
test("CLAUSE_GAPS_FUNCTION holds only FUNCTION_WORDS (the clauseGapsA fixer rejects them)", () => {
  const words = fragmentWords("CLAUSE_GAPS_FUNCTION");
  expect(words).toContain("the");
  expect(words).toContain("would");
  expect(words.filter((word) => !FUNCTION_WORDS.has(word))).toEqual([]);
});
