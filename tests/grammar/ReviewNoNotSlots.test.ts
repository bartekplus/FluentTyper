import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "nonot", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishConfusedWords");
}

test.each([
  ["There is not room for a piano.", "There is no room for a piano."],
  ["There were not tickets left.", "There were no tickets left."],
  ["We have not complaints so far.", "We have no complaints so far."],
  ["You would no believe it.", "You would not believe it."],
  ["She is no coming back.", "She is not coming back."],
  ["They have no eaten yet.", "They have not eaten yet."],
  ["There is not data on that region.", "There is no data on that region."],
  ["There was not easy fix for it.", "There was no easy fix for it."],
  ["We've not tickets left.", "We've no tickets left."],
])("no and not swapped: %s", (input, expected) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "There was not enough salt.",
  "There were not ten people there.",
  "The cooks there are not chefs.",
  "There is not a cloud in the sky.",
  "I have not seen it.",
  "He would no doubt agree.",
  "It is no laughing matter.",
  "He is no good at chess.",
  "There is not much left.",
  "We do no harm.",
  "There is not really time.",
  "There is not quite enough water.",
  "I've not seen them.",
  "There is not only one answer.",
])("correct negation stays silent: %s", (text) => {
  expect(scan(text)).toEqual([]);
});
