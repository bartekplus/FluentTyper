import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";
import { ALL_RULES, scan as reviewScan } from "./reviewHarness";

// english/articles.ts: "the" with place names and superlatives, "a" in quantity phrases.
// All sentences are our own.
function scan(text: string): ReviewDiagnostic[] {
  return reviewScan(text, { enabledRules: ALL_RULES }).filter(
    (d) => d.ruleId === "englishPhraseCorrections",
  );
}
const fixAll = (text: string, ds: ReviewDiagnostic[]) =>
  applyEdits(
    text,
    ds.flatMap((d) => d.alternatives[0].edits),
  );

test.each([
  ["She grew up in Philippines.", "She grew up in the Philippines."],
  ["We sailed across Baltic Sea.", "We sailed across the Baltic Sea."],
  ["They hiked in Rocky Mountains.", "They hiked in the Rocky Mountains."],
  ["Oil spilled into Gulf of Mexico.", "Oil spilled into the Gulf of Mexico."],
  ["He moved to United Kingdom.", "He moved to the United Kingdom."],
  ["Lisbon is oldest city here.", "Lisbon is the oldest city here."],
  ["That was worst idea ever.", "That was the worst idea ever."],
  ["In lot of cases it works.", "In a lot of cases it works."],
  ["We have bunch of ideas.", "We have a bunch of ideas."],
])("fixes %p", (text, expected) => {
  expect(fixAll(text, scan(text))).toBe(expected);
});

test.each([
  "She grew up in the Philippines.",
  "He went to Atlantic City.",
  "It aired on United States television.",
  "The case United States v. Smith ended.",
  "He is an honest man.",
  "She is best friends with Kim.",
  "It is best known for tea.",
  "It might be easiest if we wait.",
  "These are nearest neighbor methods.",
  "It is best practice to log errors.",
  "He was best man at the wedding.",
  "That is worst case for us.",
  // "you're biggest fan" lost "your", not "the".
  "Who's you're biggest rival?",
])("keeps %p", (text) => {
  expect(scan(text)).toEqual([]);
});
