import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "negation", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishUsagePhrases");
}

test.each([
  ["We didn't break nothing in the kitchen.", "We didn't break anything in the kitchen."],
  ["There wasn't nobody at the front desk.", "There wasn't anybody at the front desk."],
  ["He never mentioned nothing about the fee.", "He never mentioned anything about the fee."],
  ["I couldn't find the cat nowhere.", "I couldn't find the cat anywhere."],
  ["She doesn't like neither flavor.", "She doesn't like either flavor."],
  ["Please don't bring me no flowers.", "Please don't bring me any flowers."],
  ["They have not paid nothing yet.", "They have not paid anything yet."],
  ["We could not hardly hear the speaker.", "We could hardly hear the speaker."],
  ["I can't barely lift this box.", "I can barely lift this box."],
  ["She wouldn't hardly notice the change.", "She would hardly notice the change."],
])("double negative repaired: %s", (input, expected) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "We can't just do nothing while they wait.",
  "It isn't nothing, it took a week.",
  "I didn't know nobody had replied.",
  "She wasn't upset nobody else came.",
  "He didn't drive all that way for nothing.",
  "I won't take no for an answer.",
  "You can't say no to her.",
  "I don't want neither tea nor coffee.",
  "Don't worry, nothing broke.",
  "They don't care, no matter the cost.",
  "It doesn't matter that no one called.",
  "You ain't heard nothing yet.",
  "Don't tell me no fan ever cried.",
  "We did not go anywhere.",
  "He didn't scarcely sleep at all.",
])("double negatives stay silent: %s", (text) => expect(scan(text)).toEqual([]));
