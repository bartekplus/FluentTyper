import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fixRounds, scan } from "./reviewHarness";

// The native review corpus's text with many errors at once.
const SAMPLE = readFileSync(
  new URL("../fixtures/native-review-corpus/broken.txt", import.meta.url),
  "utf8",
);

const describeFixes = (round: ReturnType<typeof fixRounds>["rounds"][number] | undefined) =>
  round?.applied.map((d) => `${d.ruleId}: ${d.original} -> ${d.alternatives[0].preview}`) ?? [];

test("the sample text needs one round of fixes", () => {
  const { rounds } = fixRounds(SAMPLE);
  // Before the repair pass, round 2 had three fixes, each hidden by a contraction typo.
  expect(describeFixes(rounds[1])).toEqual([]);
  expect(rounds).toHaveLength(1);
});

test("the sample's contraction chains are fixed in the first round", () => {
  const found = scan(SAMPLE).map((d) => [d.original, d.alternatives[0]?.preview]);
  expect(found).toContainEqual(["cant", "can"]);
  expect(found).toContainEqual(["dont", "doesn't"]);
  expect(found).toContainEqual(["no", "any"]);
  expect(found).not.toContainEqual(["cant", "can't"]);
});

// One sentence per rule that a missing apostrophe used to hide (13 rules were measured).
const CLEAN = [
  "I didn't depending on it.",
  "It doesn't necessarily means that.",
  "We don't now and never will sell data.",
  "It doesn't see to be broken.",
  "We didn't break nothing in the kitchen.",
  "There wasn't nobody at the front desk.",
  "I wouldn't by that blender.",
  "I don't now what to say.",
  "I isn't sure about the plan.",
  "I know they isn't coming.",
  "They don't like paint the fence.",
  "My neighbor don't mow the lawn.",
  "Some of them isn't detected.",
  "Me and Tom hasn't eaten.",
  "They shouldn't of left early.",
  "We haven't decide yet.",
  "He isn't write the docs.",
  "Their hasn't been any news.",
  "I couldn't checkout your website yet.",
  "I can't hardly understand it.",
  "We couldn't hardly hear the speaker.",
  "She wouldn't barely notice the change.",
];

test.each(CLEAN)("a missing apostrophe reaches the same text in one round: %s", (clean) => {
  const typo = clean.replace(/([a-z])n't\b/gi, "$1nt");
  const typoRounds = fixRounds(typo);
  expect(typoRounds.text).toBe(fixRounds(clean).text);
  expect(describeFixes(typoRounds.rounds[1])).toEqual([]);
});
