import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "relatives", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishSubjectVerbAgreement");
}

test.each([
  ["We added a button that open the menu.", "We added a button that opens the menu."],
  ["The clerk who prepare the forms is out.", "The clerk who prepares the forms is out."],
  ["Find something that remind you of home.", "Find something that reminds you of home."],
  ["We keep jars that contains spices.", "We keep jars that contain spices."],
  ["Owners who wants a refund should call.", "Owners who want a refund should call."],
  ["The pumps which is broken stay off.", "The pumps which are broken stay off."],
  ["Those who knows the trail lead the way.", "Those who know the trail lead the way."],
  ["She hired a tutor who explain things slowly.", "She hired a tutor who explains things slowly."],
  ["Ingrid and Rafael is cousins.", "Ingrid and Rafael are cousins."],
  ["I hope Ingrid and Rafael attends.", "I hope Ingrid and Rafael attend."],
  ["Rafael keep his bike inside.", "Rafael keeps his bike inside."],
  ["Gardening are good for you.", "Gardening is good for you."],
])("relative verb agrees: %s", (input, expected) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

const pronouns = (text: string) =>
  detectReviewDiagnostics(
    { id: "pronouns", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishPronounVerbWhitelistAgreement");

test.each([
  ["I think they is late.", "I think they are late."],
  ["We seldom does that. I always has tea.", "We seldom does that. I always have tea."],
  ["Once you finds it, call me.", "Once you find it, call me."],
  ["Was you there?", "Were you there?"],
  ["Where is they now?", "Where are they now?"],
])("pronoun verb form repaired: %s", (input, expected) => {
  const found = pronouns(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each([
  "The coat I lent you is warm.",
  "Everyone but you has signed.",
  "Phase I covers setup.",
  "Mom and I is a film title I like.",
  "Here, i is the index.",
  "Is you book on the shelf?",
  "Is that you?",
])("pronoun verb forms stay silent: %s", (text) => expect(pronouns(text)).toEqual([]));

test.each([
  ["I guess it get cold at night.", "I guess it gets cold at night."],
  ["The fog lifted and it turn bright.", "The fog lifted and it turns bright."],
])("he/she/it + linking verb agrees: %s", (input, expected) => {
  const found = detectReviewDiagnostics(
    { id: "linking", text: input, scope: { start: 0, end: input.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishPronounVerbWhitelistAgreement");
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each([
  "The list of files that need review is long.",
  "It's the small details that make it work.",
  "He told the users that changes were coming.",
  "Two that remain are blue.",
  "These days that is rare.",
  "The rumor that spreads fastest wins.",
  "Please note that merge requests wait.",
  "We sell tools for gardeners that last for years.",
  "The cups and the plate that sit there are clean.",
  "The board that meet on Mondays agreed.",
  "Ask the clerk which form to sign.",
  "The record that will stand is hers.",
  "In that case each team plays twice.",
  "Martin Enterprises which holds the rights agreed.",
  "The lights in the hall that flicker need repair.",
  "Trade between Lisbon and Porto was slow.",
  "Following are the minutes.",
  "Remaining were two seats.",
  "Living with him isn't easy.",
  "Helping out is fun.",
  "Simon and Simon is a show.",
  "Ingrid and Rafael is a duo name I like.",
  "Ask Rafael give his notes back.",
  "Rafael, keep your bike inside.",
])("relative agreement stays silent: %s", (text) => expect(scan(text)).toEqual([]));
