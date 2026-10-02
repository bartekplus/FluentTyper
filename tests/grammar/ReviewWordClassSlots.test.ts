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
  "The council has taken its time to respond.",
  "There are ten seats on its A list.",
  "With this deal, its largest to date, they grew.",
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

test.each([
  ["When leave you for work?", "When do you leave for work?"],
  ["Where went they after lunch?", "Where did they go after lunch?"],
  ["How cooks she rice so fast?", "How does she cook rice so fast?"],
])("a fronted verb in a question takes do-support: %s", (input, expected) => {
  const found = scan(input, "englishAuxiliaryBaseVerb");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each(["How come you are late?", "How dare you say that?", "When go you home."])(
  "fixed inversions and statements stay silent: %s",
  (text) => expect(scan(text, "englishAuxiliaryBaseVerb")).toEqual([]),
);

test.each([
  ["I live here since 2010.", "I have lived here since 2010."],
  ["We were there since 9 am.", "We have been there since 9 am."],
  ["The kids play here since 3.", "The kids have played here since 3."],
])("since with a starting point takes the present perfect: %s", (input, expected) => {
  const found = scan(input, "englishTenseConsistency");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each([
  "He left since 10 people complained.",
  "This is the best season since 2002.",
  "I have lived here since 2010.",
])("since frames stay silent: %s", (text) =>
  expect(scan(text, "englishTenseConsistency")).toEqual([]),
);

test("of it before an owned plural is of its", () => {
  const input = "Most of it efforts were wasted.";
  const found = scan(input, "englishItsContext");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(
    "Most of its efforts were wasted.",
  );
});

test.each(["Because of it people left early.", "Most of it beta decays to lead."])(
  "of it before a new clause stays: %s",
  (text) => expect(scan(text, "englishItsContext")).toEqual([]),
);

test.each([
  ["Why you no speak English?", "Why don't you speak English?"],
  ["I no like eggs.", "I don't like eggs."],
  ["She no like spinach.", "She doesn't like spinach."],
  ["I no can find my keys!", "I cannot find my keys!"],
])("no for a missing do or not: %s", (input, expected) => {
  const found = scan(input, "englishConfusedWords");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each(["I no longer smoke.", "You no doubt know him."])("no before a non-verb: %s", (text) =>
  expect(scan(text, "englishConfusedWords")).toEqual([]),
);
