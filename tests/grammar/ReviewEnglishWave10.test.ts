import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { ALL_RULES, scan } from "./reviewHarness";

// English fixes of the tenth LanguageTool parity wave. All sentences are our own. Every
// supported rule runs.
const review = (text: string) =>
  scan(text, { enabledRules: ALL_RULES }).filter(
    (d) => d.category !== "style" && d.ruleId !== "typographicQuotes",
  );

const REPAIRS: [string, string][] = [
  // Cue words with an apostrophe never matched: these frames did not run.
  ["She doesn't always remembers the code.", "She doesn't always remember the code."],
  ["We'll based the plan on it.", "We'll base the plan on it."],
  ["They haven't went home yet.", "They haven't gone home yet."],
  // One finding with the right fix, and nothing on the words around it.
  ["She seemed to forgot the date.", "She seemed to forget the date."],
  ["It will he finished soon.", "It will be finished soon."],
  ["The report will he done by noon.", "The report will be done by noon."],
  ["I wan this one.", "I want this one."],
  ["We really wan to stay.", "We really want to stay."],
];

test.each(REPAIRS)("repairs %s", (input, expected) => {
  const found = review(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(review(expected)).toEqual([]);
});

test("one finding for a modal question with an -ing verb", () => {
  const found = review("How can I tracking it");
  expect(found).toHaveLength(1);
  expect(found[0].alternatives.map((a) => applyEdits("How can I tracking it", a.edits))).toContain(
    "How can I track it",
  );
});

test.each([
  "An are is a hundred square meters of land.",
  "The are was once a common unit.",
  "It seemed too crowded to enter.",
  "It works, or doesn't, depending on the day.",
  "The plan works (or doesn't depending on luck).",
  "Her face looked wan and tired.",
  "She filled the watering can he had left by the door.",
])("leaves %s", (text) => {
  expect(review(text).map((d) => d.original)).toEqual([]);
});
