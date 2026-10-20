import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { ALL_RULES, scan } from "./reviewHarness";

// English fixes of the twelfth parity wave (Harper demo gaps). All sentences are our own.
// Every supported rule runs.
const review = (text: string) =>
  scan(text, { enabledRules: ALL_RULES }).filter(
    (d) => d.category !== "style" && d.ruleId !== "typographicQuotes",
  );

const REPAIRS: [string, string][] = [
  ["We don't ned more time.", "We don't need more time."],
  ["You ned to sign in first.", "You need to sign in first."],
  ["They really ned your help.", "They really need your help."],
  ["You need too restart the app.", "You need to restart the app."],
  ["We didn't want too wait.", "We didn't want to wait."],
];

test.each(REPAIRS)("repairs %s", (input, expected) => {
  const found = review(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(review(expected)).toEqual([]);
});

test("a misspelled verb before too still gets both fixes", () => {
  const input = "You don't ned too worry about the cost.";
  const found = review(input);
  expect(found.map((d) => d.original)).toEqual(["ned", "too"]);
  expect(
    applyEdits(
      input,
      found.flatMap((d) => d.alternatives[0].edits),
    ),
  ).toBe("You don't need to worry about the cost.");
});

test.each([
  "Will Ned help us?",
  "I asked Ned to help.",
  "Don't we too need help?",
  "I too worry about the deadline.",
  "Don't drive too slow.",
  "You don't need too many tabs.",
  "They don't work too hard.",
])("leaves %s", (text) => {
  expect(review(text).map((d) => d.original)).toEqual([]);
});
