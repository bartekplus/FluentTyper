import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FUNCTION_WORDS } from "../../src/core/domain/grammar/review/english/slotWords";

const yaml = readFileSync(
  new URL("../../src/core/domain/grammar/rules/en.yaml", import.meta.url),
  "utf8",
);
const fragment = (name: string) =>
  new RegExp(`^  ${name}: "([^"]*)"$`, "m").exec(yaml)![1].split("|");

// A frame skips these words because its fixer rejects them: a word the fixer accepts must not
// be in the list, or the frame loses findings.
test("CLAUSE_GAPS_FUNCTION holds only FUNCTION_WORDS (the clauseGapsA fixer rejects them)", () => {
  const words = fragment("CLAUSE_GAPS_FUNCTION");
  expect(words.length).toBeGreaterThan(0);
  expect(words.filter((word) => !FUNCTION_WORDS.has(word))).toEqual([]);
});
