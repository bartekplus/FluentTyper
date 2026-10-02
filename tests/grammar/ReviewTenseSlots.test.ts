import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "tense", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishTenseConsistency");
}

test.each([
  ["Tomorrow we cleaned the garage.", "Tomorrow we will clean the garage."],
  ["Next Friday, she baked a cake for us.", "Next Friday, she will bake a cake for us."],
  ["They repaired the bridge next summer.", "They will repair the bridge next summer."],
  ["I phoned my aunt tomorrow.", "I will phone my aunt tomorrow."],
  ["Yesterday we will paint the shed.", "Yesterday we painted the shed."],
  ["Last Sunday, I will write to her.", "Last Sunday, I wrote to her."],
  ["Three weeks ago they'll sell the van.", "Three weeks ago they sold the van."],
  ["She will email him last night.", "She emailed him last night."],
])("tense fitted to the time word: %s", (input, expected) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  // The time word may be the slip instead: nothing is preselected.
  expect(found[0].bulk.eligible).toBe(false);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "We repaired the roof on 3/14/2091.",
  "On 12 March 2093, they have opened the new wing.",
  "He had already paid the invoice on January 9, 2095.",
])("a past verb on a date still to come is marked: %s", (text) => {
  const found = scan(text);
  expect(found).toHaveLength(1);
  expect(found[0].alternatives).toEqual([]);
  expect(text.slice(found[0].range.start, found[0].range.end)).toMatch(/209\d/);
});

test.each([
  "I thought we cleaned the garage tomorrow.",
  "If we left tomorrow, we would miss the parade.",
  "We packed everything for tomorrow.",
  "The next week we painted the shed.",
  "Tomorrow was going to be a long day.",
  "Tomorrow's match was cancelled.",
  "She said yesterday that she will come.",
  "I will never forget yesterday.",
  "We will talk about last week.",
  "We will review the results of last year.",
  "We repaired the roof on 3/14/1991.",
  "We will repair the roof on 3/14/2091.",
  "By then we will have repaired the roof on 3/14/2091.",
  "We booked a cabin on 5 June 2094.",
  "The launch was planned for May 5, 2094.",
  "He promised to visit on 3/14/2091.",
])("correct tense stays silent: %s", (text) => {
  expect(scan(text)).toEqual([]);
});
