import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan } from "./reviewHarness";

// english/prepositionSlots.ts: the preposition a word takes. All sentences are our own.
const RULES = new Set([
  "englishFixedPrepositions",
  "englishContextualCompounds",
  "englishPhraseCorrections",
]);
function scan(text: string) {
  return reviewScan(text).filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["Many kids are suffering of hunger.", "Many kids are suffering from hunger."],
  ["We felt anxious of the outcome.", "We felt anxious about the outcome."],
  ["They accused Omar for cheating.", "They accused Omar of cheating."],
  ["Few clinics treat addiction of alcohol.", "Few clinics treat addiction to alcohol."],
  ["Students participate to the fair.", "Students participate in the fair."],
  ["Floods caused damage of roads.", "Floods caused damage to roads."],
  ["The shop is near from the station.", "The shop is near to the station."],
  ["She complained for the delay.", "She complained about the delay."],
  ["Divide the dough in four parts.", "Divide the dough into four parts."],
  ["Ask to the admin for access.", "Ask the admin for access."],
  ["By example, this one fails.", "For example, this one fails."],
  ["Their departure of Rome was delayed.", "Their departure from Rome was delayed."],
  ["She was entering in the kitchen.", "She was entering the kitchen."],
  ["The cat ran in the house.", "The cat ran into the house."],
  ["We arrived on the airport late.", "We arrived at the airport late."],
  ["We arrived at the city at dawn.", "We arrived in the city at dawn."],
  ["Math is hard to me.", "Math is hard for me."],
  ["I am waiting after him.", "I am waiting for him."],
  ["Thanks for your contribution on the wiki.", "Thanks for your contribution to the wiki."],
  ["Prior joining us, she taught.", "Prior to joining us, she taught."],
  ["Someone knocked the window.", "Someone knocked on the window."],
  ["I read it in the internet.", "I read it on the internet."],
  ["The shop is located on 22 Elm Road.", "The shop is located at 22 Elm Road."],
  ["We went in train.", "We went by train."],
  ["She is on a meeting now.", "She is in a meeting now."],
  ["I met him in a party.", "I met him at a party."],
  ["They like to do tennis.", "They like to play tennis."],
  ["We plan to make a party.", "We plan to throw a party."],
  ["Bring Lena at the wedding.", "Bring Lena to the wedding."],
  ["My keys are at the kitchen.", "My keys are in the kitchen."],
  ["You can apply to a loan.", "You can apply for a loan."],
  ["Who is in charge for this team?", "Who is in charge of this team?"],
  ["She eats in her desk.", "She eats at her desk."],
  ["They live in a remote island.", "They live on a remote island."],
  ["Open your books on page ten.", "Open your books to page ten."],
  ["We are planning a trip in Lisbon.", "We are planning a trip to Lisbon."],
  ["I have 30 years old.", "I am 30 years old."],
  ["It was a non standard plug.", "It was a non-standard plug."],
  ["It is sure that we win.", "It is certain that we win."],
  ["Tap on the middle of the screen.", "Tap in the middle of the screen."],
  ["Please consider about it.", "Please consider it."],
  ["We all go to vacation in May.", "We all go on vacation in May."],
])("repairs %s", (input, expected) => {
  const found = scan(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "The suffering of the people was great.",
  "We are near the end.",
  "He complained for hours.",
  "Divide it in half.",
  "Ask to be excused.",
  "Lead by example, always.",
  "The departure of May was cold.",
  "Enter in the details below.",
  "He came in the morning.",
  "They arrived on the scene quickly.",
  "It is important to me.",
  "Wait after class.",
  "She is waiting tables.",
  "He gave a donation on behalf of us.",
  "They knocked the door down.",
  "In the internet age, it changed.",
  "It sits on the kitchen table.",
  "We met in a party of five.",
  "They make a party list.",
  "We returned in time.",
  "We returned in March.",
  "A trip in May was fun.",
  "With the exception of the rule, it works.",
  "It is a sine qua non condition.",
  "Its staff are located in 60 offices.",
  "You can apply to the job online.",
  "Can I share something important with you?",
  "It runs from the chest in front to the spine behind.",
  "Players complained for a year.",
  "Who should I ask to the dance?",
  "He was in charge for only three days.",
  "We used a non new relic source.",
])("leaves %s", (text) => {
  expect(scan(text).map((d) => d.original)).toEqual([]);
});
