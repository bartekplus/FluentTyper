import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan } from "./reviewHarness";

const RULES = new Set(["englishPerfectParticiples", "englishPhraseCorrections"]);

function scan(text: string) {
  return reviewScan(text).filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["We have plan a short trip.", "We have planned a short trip."],
  ["She has watch every episode.", "She has watched every episode."],
  ["I've answer all the emails.", "I've answered all the emails."],
  ["They have paint the fence.", "They have painted the fence."],
  ["We are please to welcome you.", "We are pleased to welcome you."],
  ["The bridge was completely repair.", "The bridge was completely repaired."],
  [
    "If we would not have left early, we would have won.",
    "If we had not left early, we would have won.",
  ],
  ["If he wouldn't have called, I would have slept.", "If he hadn't called, I would have slept."],
])("perfect with a noun-or-verb base repaired: %s", (input, expected) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "I have work the next day.",
  "We have class this afternoon.",
  "You have proof the clerk lied.",
  "They have practice all week.",
  "Which form do I have sign the clerk?",
  "We have dinner the same time every day.",
  "I have time this week.",
  "She was previously director of sales.",
  "It is just magic.",
  "Please be quiet.",
])("have + noun stays silent: %s", (text) => expect(scan(text)).toEqual([]));
