import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string, userDictionary: string[] = []) {
  return detectReviewDiagnostics(
    { id: "collocations", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary,
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishFixedPrepositions");
}

test.each([
  // Adjectives and participles.
  ["The puppy was afraid from thunder.", "The puppy was afraid of thunder."],
  ["Mia got interested for chess last year.", "Mia got interested in chess last year."],
  ["The drawer is full with old cables.", "The drawer is full of old cables."],
  ["Lyon is famous of its silk.", "Lyon is famous for its silk."],
  ["The startup is dependent from one client.", "The startup is dependent on one client."],
  ["Grandpa was proud on his garden.", "Grandpa was proud of his garden."],
  ["My cousin is allergic of peanuts.", "My cousin is allergic to peanuts."],
  ["The square was crowded of tourists.", "The square was crowded with tourists."],
  ["Our cabin is not far of the lake.", "Our cabin is not far from the lake."],
  ["Her sister was married with a pilot.", "Her sister was married to a pilot."],
  ["Be kind with them.", "Be kind to them."],
  // Verbs, in every inflection the lexicon gives.
  ["Every pupil participates to the contest.", "Every pupil participates in the contest."],
  ["The kit consisted from two boards.", "The kit consisted of two boards."],
  ["Our plans depend of the forecast.", "Our plans depend on the forecast."],
  ["Farmers are relying of the rain.", "Farmers are relying on the rain."],
  ["She recovered of her cold quickly.", "She recovered from her cold quickly."],
  ["The firm specializes on maritime law.", "The firm specializes in maritime law."],
  ["The baby resembles to her mother.", "The baby resembles her mother."],
  ["We discussed about the new menu.", "We discussed the new menu."],
  ["The old man was suffering of a fever.", "The old man was suffering from a fever."],
  ["The coach yelled on them.", "The coach yelled at them."],
  // Fixed frames.
  ["Let's meet in Monday.", "Let's meet on Monday."],
  ["My father was born on 1961.", "My father was born in 1961."],
  ["The bakery opens in 7 am.", "The bakery opens at 7 am."],
  ["I go jogging at the morning.", "I go jogging in the morning."],
  ["A lot students failed.", "A lot of students failed."],
  ["Kids between six to ten can join.", "Kids between six and ten can join."],
  ["After the party we walked to home.", "After the party we walked home."],
  [
    "The fence keeps nothing; it stopped the dog of escaping.",
    "The fence keeps nothing; it stopped the dog from escaping.",
  ],
  ["He insisted to drive us.", "He insisted on driving us."],
  ["She succeeded to fix the leak.", "She succeeded in fixing the leak."],
  ["Is he capable to lead the team?", "Is he capable of leading the team?"],
  ["We listened the radio all night.", "We listened to the radio all night."],
  ["They traveled with a train.", "They traveled by train."],
  ["Please take into account of the delay.", "Please take into account the delay."],
  ["Bread in exchange of eggs.", "Bread in exchange for eggs."],
])("preposition repaired: %s", (input, expected) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test("a choice between fixes preselects none", () => {
  const found = scan("The boss was angry on us.");
  expect(found).toHaveLength(1);
  expect(found[0].alternatives.map((a) => a.preview)).toEqual(["with", "at"]);
});

test.each([
  "The puppy was afraid for its owner.",
  "He felt guilty for skipping practice.",
  "She is married with three kids.",
  "Tom is married with a five-year-old son.",
  "The guide was satisfied of course.",
  "We were interested at first, then bored.",
  "The cat was scared from the start.",
  "He was proud on that day.",
  "The model is similar with respect to price.",
  "Make it as similar as possible.",
  "So far of the visitors, none complained.",
  "Be kind with your words.",
  "She invested on behalf of her aunt.",
  "The lack of sleep showed.",
  "The suffering of the villagers was terrible.",
  "Nobody suffered of course.",
  "They believe to be right.",
  "We met on the evening of the fifth.",
  "The morning news ran at the morning briefing.",
  "I will be in Monday through Friday.",
  "We slept in Sunday morning.",
  "In Friday night's game, he scored.",
  "Look at Monday's numbers.",
  "I liked it a lot people say.",
  "From six to ten, we rest.",
  "Go to home page and click.",
  "He succeeded to the throne.",
  "She insisted to me that she was fine.",
  "Listen, the bus is late.",
  "We traveled with a bus full of fans.",
  "It runs from the chin in front to the neck behind.",
  "He moved in front to see better.",
  'The phrase "afraid from" is a common slip.',
])("correct text stays silent: %s", (text) => {
  expect(scan(text)).toEqual([]);
});

test("a user-dictionary head word is left alone", () => {
  expect(scan("The puppy was afraid from thunder.", ["afraid"])).toEqual([]);
});
