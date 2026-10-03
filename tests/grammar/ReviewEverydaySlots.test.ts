import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

// english/everydaySlots.ts and the adverb gap in noun agreement. All sentences are our own.
const RULES = new Set([
  "englishVerbComplements",
  "englishExistentialAgreement",
  "englishConfusedWords",
  "englishIrregularForms",
  "englishPhraseCorrections",
  "englishContextualCompounds",
  "englishNounNumber",
  "englishSubjectVerbAgreement",
]);
function scan(text: string, lang = "en_US") {
  return detectReviewDiagnostics(
    { id: "everyday", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang,
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["The window keeps disappear on restart.", "The window keeps disappearing on restart."],
  ["We kept ask them the same thing.", "We kept asking them the same thing."],
  ["It's going explode soon.", "It's going to explode soon."],
  ["They were going explain it later.", "They were going to explain it later."],
  ["The noise made me jumping out of bed.", "The noise made me jump out of bed."],
  ["Was there many guests at the party?", "Were there many guests at the party?"],
  ["Is there several ways to do it?", "Are there several ways to do it?"],
  ["She is going though a hard year.", "She is going through a hard year."],
  ["Look though the list first.", "Look through the list first."],
  ["We need farther details before we sign.", "We need further details before we sign."],
  ["Can you give us advise on the lease?", "Can you give us advice on the lease?"],
  ["A trip abroad would we nice.", "A trip abroad would be nice."],
  ["Please don't us that exit.", "Please don't use that exit."],
  ["The keys are int he drawer.", "The keys are in the drawer."],
  ["Doe she know about it?", "Does she know about it?"],
  ["Mia wold have called.", "Mia would have called."],
  ["Please see attache file.", "Please see attached file."],
  ["We got the shed did before dark.", "We got the shed done before dark."],
  ["Best regard,\nNoor", "Best regards,\nNoor"],
  ["I want to thank everyone of you.", "I want to thank every one of you."],
  ["Is there anyway to undo this?", "Is there any way to undo this?"],
  ["Let's take sometime to rest.", "Let's take some time to rest."],
  ["We don't need anymore chairs.", "We don't need any more chairs."],
  ["The interview went good overall.", "The interview went well overall."],
  ["More ticket were sold today.", "More tickets were sold today."],
  ["Do anyone know the password?", "Does anyone know the password?"],
  ["Do that mean we can leave?", "Does that mean we can leave?"],
  ["She doesn't drive, do she?", "She doesn't drive, does she?"],
  [
    "Of the two plans, the later of the two is cheaper.",
    "Of the two plans, the latter of the two is cheaper.",
  ],
  ["The cat always scratch the sofa.", "The cat always scratches the sofa."],
  ["We can discuss it latter on.", "We can discuss it later on."],
])("repairs %s", (input, expected) => {
  const found = scan(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "Keep track of your receipts.",
  "We keep watch over the camp.",
  "Keep calm and carry on.",
  "He is going home now.",
  "They are going places.",
  "Have them working on it.",
  "Is there a lot of water left?",
  "It worked though the results were bad.",
  "I read it, though the ending was weak.",
  "The farther shore is rocky.",
  "We advise on tax matters.",
  "Would we be welcome there?",
  "She told us the truth.",
  "Explain to us the plan.",
  "The wold was green.",
  "I'll see you sometime.",
  "I don't live there anymore.",
  "This one is good for us.",
  "Everything is good until noon.",
  "More time was needed.",
  "Do you know the password?",
  "Do they know?",
  "The later of the two trains left first.",
  "The dogs always bark at night.",
  "The boss always answers quickly.",
  "Everyone of note was there.",
  "The cold lake made me shivering.",
  "They made us matching shirts.",
  "We warned everyone of the storm.",
  "I will fill you in sometime.",
  "Book it for sometime next week.",
  "It is not safe anymore due to the ice.",
])("leaves %s", (text) => {
  expect(scan(text).map((d) => d.original)).toEqual([]);
});
