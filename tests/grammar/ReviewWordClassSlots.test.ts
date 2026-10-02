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

test.each([
  ["Data is not saved, so it not possible to sort it (see below).", "so it is not possible"],
  ["It more reliable than the old one.", "It is more reliable"],
  ["It possible the cache holds an old copy.", "It is possible"],
  ["This not public information.", "This is not public"],
  ["Sure, but it worth reading twice.", "it is worth reading"],
])("a subject with no verb gets be: %s", (input, expected) => {
  const found = scan(input, "englishSentenceStructure");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toContain(expected);
});

test.each([
  "I think it possible the cache holds an old copy.",
  "I like this not that.",
  "This not only helps but also saves time.",
])("be frames stay silent: %s", (text) => {
  expect(scan(text, "englishSentenceStructure")).toEqual([]);
});

test.each([
  ["There are a theory about it.", "There is a theory about it."],
  ["There exist a school for kids.", "There exists a school for kids."],
  ["There are a wooden bench outside.", "There is a wooden bench outside."],
  ["There are argument whether he is right.", "There is an argument whether he is right."],
])("existential there with one singular noun: %s", (input, expected) => {
  const found = scan(input, "englishExistentialAgreement");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each([
  "There are a cat and a dog.",
  "There are a lot of cats.",
  "There are a few people.",
  "There are a number of issues.",
  "There were a school, a church and a shop.",
  "There are key differences.",
  "There are research papers on it.",
  "And there are two inside.",
])("existential frames stay silent: %s", (text) => {
  expect(scan(text, "englishExistentialAgreement")).toEqual([]);
});

test.each([
  ["I fear that the script it not visible.", "I fear that the script is not visible."],
  ["This morning nothing it working.", "This morning nothing is working."],
  ["It says an update it available.", "It says an update is available."],
  ["Update: this it the same issue.", "Update: this is the same issue."],
])("it typed for is: %s", (input, expected) => {
  const found = scan(input, "englishConfusedWords");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each([
  "I made the script it uses faster.",
  "Show me the report it generated.",
  "They use it the way it currently works.",
  "Nothing it says is true.",
])("it frames before a relative clause stay silent: %s", (text) => {
  expect(scan(text, "englishConfusedWords")).toEqual([]);
});
