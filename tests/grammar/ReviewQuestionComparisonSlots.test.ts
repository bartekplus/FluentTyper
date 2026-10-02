import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

const RULES = new Set([
  "englishAuxiliaryBaseVerb",
  "englishSentenceStructure",
  "englishDoubledDegree",
  "englishThenThan",
]);

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "questions", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["Where did she parked the van?", "Where did she park the van?"],
  ["Ask him how does it works.", "Ask him how does it work."],
  ["What time did they arrived?", "What time did they arrive?"],
  ["Does anybody can open this jar?", "Can anybody open this jar?"],
  ["Did the courier has delivered it?", "Has the courier delivered it?"],
  ["Did you have tried the soup?", "Have you tried the soup?"],
  ["Could you could pass the salt?", "Could you pass the salt?"],
  ["She has already has a ticket.", "She already has a ticket."],
  ["It is an easiest route.", "It is the easiest route."],
  ["Our team is strongest side in the league.", "Our team is the strongest side in the league."],
  ["This path is less steeper.", "This path is less steep."],
  ["It costs less then five dollars.", "It costs less than five dollars."],
  ["We ordered more then enough food.", "We ordered more than enough food."],
])("question and comparison forms repaired: %s", (input, expected) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "Did you have lunch already?",
  "Who does it help most?",
  "What do you guys think?",
  "How do you do?",
  "Why did they leave so early?",
  "They are best friends.",
  "It is best practice to test first.",
  "He is best known for his songs.",
  "These are nearest neighbor methods.",
  "It is at least harder than the old one.",
  "The least number wins.",
  "Do more, then rest.",
  "We can talk later.",
  "I have already had lunch.",
  "He was best man at the wedding.",
])("question and comparison forms stay silent: %s", (text) => expect(scan(text)).toEqual([]));
