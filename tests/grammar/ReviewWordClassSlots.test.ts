import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string, ruleId: string) {
  return detectReviewDiagnostics(
    { id: "word-class", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

test.each([
  ["This will user the new API.", "user"],
  ["She will manager the project.", "manager"],
  ["We should leadership for the team.", "leadership"],
  ["I would opportunity for me.", "opportunity"],
])("a noun after a modal is marked without a fix: %s", (text, word) => {
  const found = scan(text, "englishAuxiliaryBaseVerb");
  expect(found).toHaveLength(1);
  expect(found[0].original).toBe(word);
  expect(found[0].alternatives).toEqual([]);
});

test.each([
  "I can help you.",
  "We will see.",
  "You can tomorrow.",
  "I will, sir.",
  "Of course you can mom.",
  "You can conference in with Connie.",
  "They could lunch with us.",
])("modal frames stay silent: %s", (text) => {
  expect(scan(text, "englishAuxiliaryBaseVerb")).toEqual([]);
});

test.each([
  ["It origins date back to 1900.", "Its origins date back to 1900."],
  ["The city and it suburbs are busy.", "The city and its suburbs are busy."],
])("it before an owned noun is its: %s", (input, expected) => {
  const found = scan(input, "englishItsContext");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each([
  "We bought it and it works.",
  "Give it time.",
  "Call it luck.",
  "I saw it yesterday.",
  "IT infrastructure is costly.",
  "It nowhere states that.",
  "It auto plays.",
  "It errors out when I open it.",
])("it frames stay silent: %s", (text) => {
  expect(scan(text, "englishItsContext")).toEqual([]);
});

test.each([
  ["I couldn't checkout your website yet.", "I couldn't check out your website yet."],
  ["I did not followup with Sam.", "I did not follow up with Sam."],
  ["I hope you checkout my new shop.", "I hope you check out my new shop."],
  ["They playback old tapes.", "They play back old tapes."],
  ["Ask the clerk who setup the booth.", "Ask the clerk who set up the booth."],
])("a phrasal verb written as its noun: %s", (input, expected) => {
  const found = scan(input, "englishContextualCompounds");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test("a compound noun subject of a question stays", () => {
  expect(scan("Didn't checkout work the way you expected?", "englishContextualCompounds")).toEqual(
    [],
  );
});
