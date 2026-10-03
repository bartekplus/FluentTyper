import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

// english/clauseSlots.ts: one-word slots only one word fits. All sentences are our own.
const RULES = new Set([
  "englishConfusedWords",
  "englishAuxiliaryBaseVerb",
  "englishFixedPrepositions",
  "englishTheirThereTheyAre",
  "englishSubjectVerbAgreement",
  "englishNounNumber",
  "englishSentenceStructure",
  "englishPhraseCorrections",
]);
function scan(text: string, lang = "en_US") {
  return detectReviewDiagnostics(
    { id: "clause", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang,
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["We should hear form the bank soon.", "We should hear from the bank soon."],
  ["Where does that noise come form?", "Where does that noise come from?"],
  ["She bought it form a neighbor.", "She bought it from a neighbor."],
  ["I wanted to apologies for the delay.", "I wanted to apologize for the delay."],
  ["We need to summaries the meeting.", "We need to summarize the meeting."],
  ["According Mia, the shop is closed.", "According to Mia, the shop is closed."],
  ["Prices rose, according the report.", "Prices rose, according to the report."],
  ["According about the forecast, it will snow.", "According to the forecast, it will snow."],
  ["The kids waved at there grandmother.", "The kids waved at their grandmother."],
  ["We drove to there new apartment.", "We drove to their new apartment."],
  ["Lena though it was a joke.", "Lena thought it was a joke."],
  ["Omar though that you left.", "Omar thought that you left."],
  ["That sound fine to me.", "That sounds fine to me."],
  ["It look strange now.", "It looks strange now."],
  ["All window are open.", "All windows are open."],
  ["Please sent me the invoice.", "Please send me the invoice."],
  ["Please attached the receipt.", "Please attach the receipt."],
  ["I no good at drawing.", "I am not good at drawing."],
  ["He no happy about it.", "He is not happy about it."],
  ["They wold like a refund.", "They would like a refund."],
])("repairs %s", (input, expected) => {
  const found = scan(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "The cells form the outer wall.",
  "Fill in the form at the desk.",
  "It took form slowly.",
  "Thanks to apologies from both sides, we moved on.",
  "Accordingly, we left.",
  "According to Mia, it rained.",
  "We stayed over there today.",
  "Is anyone in there right now?",
  "We sat in there for hours.",
  "Even though it rained, we went.",
  "The food, though it was cold, tasted fine.",
  "Does that sound good?",
  "Make it look nice.",
  "I like that sound quality.",
  "All work is done.",
  "All the files are open.",
  "Please find attached the file.",
  "Please, sent items are listed below.",
  "She said no good deed goes unpunished.",
  "The wold stretched to the horizon.",
  "All three were tired.",
  "Lena, please did you call?",
  "Stubborn though he was, we liked him.",
  "Annoyed though she was, she stayed.",
  "According however to the old story, it was a king.",
])("leaves %s", (text) => {
  expect(scan(text).map((d) => d.original)).toEqual([]);
});

test("other languages are left alone", () => {
  expect(scan("Please sent the file.", "de_DE")).toEqual([]);
  expect(scan("According Mia, it rained.", "fr_FR")).toEqual([]);
});
