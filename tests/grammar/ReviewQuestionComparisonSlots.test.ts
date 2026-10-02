import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

const RULES = new Set([
  "englishAuxiliaryBaseVerb",
  "englishSentenceStructure",
  "englishDoubledDegree",
  "englishThenThan",
  "englishPhraseCorrections",
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
  "He is best known for his songs.",
  "These are nearest neighbor methods.",
  "It is at least harder than the old one.",
  "The least number wins.",
  "Do more, then rest.",
  "We can talk later.",
  "I have already had lunch.",
  "She was a best friend to me.",
  "He bought a latest model phone.",
])("question and comparison forms stay silent: %s", (text) => expect(scan(text)).toEqual([]));

const complements = (text: string) =>
  detectReviewDiagnostics(
    { id: "causative", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishVerbComplements");

test.each([
  ["The new cable made it charges faster.", "The new cable made it charge faster."],
  ["Please let me knows the time.", "Please let me know the time."],
  ["That song makes her sings along.", "That song makes her sing along."],
])("causative verb stays bare: %s", (input, expected) => {
  const found = complements(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each([
  "Years of work made us friends.",
  "It makes them objects of study.",
  "The help it needs is small.",
  "The cake you made me has gone.",
  "Their jokes make me nuts.",
])("causative frame stays silent: %s", (text) => expect(complements(text)).toEqual([]));
