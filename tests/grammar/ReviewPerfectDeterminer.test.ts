import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

const RULES = new Set(["englishPerfectParticiples", "englishPhraseCorrections"]);

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "perfect", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["We have plan a short trip.", "We have planned a short trip."],
  ["She has watch every episode.", "She has watched every episode."],
  ["I've answer all the emails.", "I've answered all the emails."],
  ["They have paint the fence.", "They have painted the fence."],
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
])("have + noun stays silent: %s", (text) => expect(scan(text)).toEqual([]));
