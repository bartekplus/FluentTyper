import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan } from "./reviewHarness";

function scan(text: string) {
  return reviewScan(text).filter((d) => d.ruleId === "englishCountability");
}

test.each([
  ["We hired less engineers this spring.", "We hired fewer engineers this spring."],
  ["The new layout has less buttons.", "The new layout has fewer buttons."],
  ["Less students signed up after the fee rose.", "Fewer students signed up after the fee rose."],
  ["The town lost far less trees in the storm.", "The town lost far fewer trees in the storm."],
  ["My uncle never had many money.", "My uncle never had much money."],
  ["They did few homework over the break.", "They did little homework over the break."],
  ["He gave us a sound advice.", "He gave us sound advice."],
  ["She shared a very practical knowledge.", "She shared very practical knowledge."],
  ["A wisdom like hers is rare.", "Wisdom like hers is rare."],
  ["We need a research before we decide.", "We need research before we decide."],
  ["The trip took this much pupils.", "The trip took this many pupils."],
])("count word repaired: %s", (input, expected) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "Profit is revenue less costs.",
  "No less people than last year came.",
  "It took much less steps than planned.",
  "We pay less dollars for the same box.",
  "There is less sales tax in that state.",
  "She has a good knowledge of Greek.",
  "We applied for a research grant.",
  "I poured a fine wine for the guests.",
  "He drank a little wine with dinner.",
  "How much cats sleep depends on age.",
  "Not much changes from one week to the next.",
  "Thank you so much guys!",
  "There is much news from home.",
  "The class covered less physics this term.",
  "A little less points are needed to pass.",
])("count words stay silent: %s", (text) => expect(scan(text)).toEqual([]));
