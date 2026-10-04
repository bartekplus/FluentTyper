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
  // A negated or contracted modal before an adjective lacks "be".
  ["It wouldn't fair to them.", "It wouldn't be fair to them."],
  ["We'll happy to help.", "We'll be happy to help."],
  ["I'll afraid of the dark.", "I'll be afraid of the dark."],
  // "you" for "your" before a noun subject.
  ["If you laptop is slow, restart it.", "If your laptop is slow, restart it."],
  ["You salary is too low.", "Your salary is too low."],
  ["Thanks to you and you family!", "Thanks to you and your family!"],
  // A verb-only base after be and before its object.
  ["They are not invite us.", "They are not inviting us."],
  ["She was deny that it happened.", "She was denying that it happened."],
  // Number agreement with a bare plural or "this".
  ["Visitors sees the gate first.", "Visitors see the gate first."],
  ["This reports shows clearly the trend.", "This report shows clearly the trend."],
  ["This allow us to finish early.", "This allows us to finish early."],
];

test.each(REPAIRS)("repairs %s", (input, expected) => {
  const found = review(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(review(expected)).toEqual([]);
});

test.each(["I slowly the door.", "We gently a hand."])(
  "warns about a missing verb in %s",
  (text) => {
    const found = review(text);
    expect(found).toHaveLength(1);
    expect(found[0].ruleId).toBe("englishSentenceStructure");
    expect(found[0].alternatives).toEqual([]);
  },
);

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
  "I told you dinner was ready.",
  "His task is protect them.",
  "Asteroids was a hit game.",
  "This accept button is too small.",
  "This reopen request was closed.",
  "When was it delivered to them?",
  "Without you life is dull.",
  "You two should come along.",
  "All you need is time.",
  "You idiots are late again.",
  "I'll awake early tomorrow.",
  "We only the best hire.",
  "They early the next day left.",
  "She filled the watering can he had left by the door.",
])("leaves %s", (text) => {
  expect(review(text).map((d) => d.original)).toEqual([]);
});
