import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan } from "./reviewHarness";

// english/typoSlots.ts: real words typed for a neighbour. All sentences are our own.
const RULES = new Set([
  "englishPhraseCorrections",
  "englishConfusedWords",
  "englishToToo",
  "englishContextualCompounds",
  "englishClosedCompounds",
]);
function scan(text: string) {
  return reviewScan(text).filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["Let me know id the bus is late.", "Let me know if the bus is late."],
  ["Wed rather stay home.", "We'd rather stay home."],
  ["Whose ready for lunch?", "Who's ready for lunch?"],
  ["Hell be back at six.", "He'll be back at six."],
  ["Th door was open.", "The door was open."],
  ["Her car as taken a beating.", "Her car has taken a beating."],
  ["It was a vary quiet night.", "It was a very quiet night."],
  ["We are sill waiting.", "We are still waiting."],
  ["The count rose too 300 visits.", "The count rose to 300 visits."],
  ["Ur so kind.", "You're so kind."],
  ["We mus leave now.", "We must leave now."],
  ["Please look the gate tonight.", "Please lock the gate tonight."],
  ["How was the trip like?", "What was the trip like?"],
  ["That cold be a problem.", "That could be a problem."],
  ["What ca we do?", "What can we do?"],
  ["It is no necessary.", "It is not necessary."],
  ["He is one the best cooks here.", "He is one of the best cooks here."],
  ["Them we left the hall.", "Then we left the hall."],
  ["I hope is should be easy.", "I hope it should be easy."],
  ["The final seen was long.", "The final scene was long."],
  ["The app is fully complaint with the law.", "The app is fully compliant with the law."],
  ["Come withe us.", "Come with us."],
  ["We could hangout on Friday.", "We could hang out on Friday."],
  ["Please contract us today.", "Please contact us today."],
  ["The dog ran in to the lake.", "The dog ran into the lake."],
  ["She took the reigns quickly.", "She took the reins quickly."],
  ["I am fair sure it works.", "I am fairly sure it works."],
  ["Kids out grow shoes fast.", "Kids outgrow shoes fast."],
])("repairs %s", (input, expected) => {
  const found = scan(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "My id is on the card.",
  "They wed in June.",
  "Whose bag is this?",
  "Go to hell before noon.",
  "Th is the symbol for thorium.",
  "Use it as given.",
  "Prices vary widely.",
  "The window sill looked old.",
  "Me too 2 times.",
  "Look the other way.",
  "How is it going?",
  "The cold made us shiver.",
  "It was ca. 1900.",
  "It is no good.",
  "This is no different.",
  "Them apples are ripe.",
  "We have seen it.",
  "She filed a complaint with the police.",
  "Turn yourself in to the police.",
  "Feel free to contract out the work.",
  "The rain fell in to the night and kept falling.",
  "Look the door is open!",
  "Study the reigns of these kings.",
  "Do it as given my notes, please.",
])("leaves %s", (text) => {
  expect(scan(text).map((d) => d.original)).toEqual([]);
});
