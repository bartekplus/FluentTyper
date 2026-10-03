import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan } from "./reviewHarness";

// english/wordFormSlots.ts and nearby slot fixes. All sentences are our own.
const RULES = new Set([
  "englishSubjectVerbAgreement",
  "englishPronounVerbWhitelistAgreement",
  "englishNounNumber",
  "englishConfusedWords",
  "englishContextualCompounds",
  "englishApostrophes",
  "englishToToo",
  "englishSentenceStructure",
  "englishPerfectParticiples",
  "englishYourYouAre",
  "englishContractionNormalization",
]);
function scan(text: string) {
  return reviewScan(text).filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["There were problem with the draft.", "There were problems with the draft."],
  ["We found a number of bug today.", "We found a number of bugs today."],
  ["The forms are know being sorted.", "The forms are now being sorted."],
  ["Lena and several other arrived.", "Lena and several others arrived."],
  ["It is a must read book.", "It is a must-read book."],
  ["The are many options here.", "There are many options here."],
  ["I would make sense to wait.", "It would make sense to wait."],
  ["She is the worlds fastest runner.", "She is the world's fastest runner."],
  ["My aunt was 90 years-old.", "My aunt was 90 years old."],
  ["Always brush ones teeth.", "Always brush one's teeth."],
  ["We sent invites too all the members.", "We sent invites to all the members."],
  ["It maybe useful later.", "It may be useful later."],
  ["Has she figure out the code?", "Has she figured out the code?"],
  ["Thanks for you quick note.", "Thanks for your quick note."],
  ["It was an a flower.", "It was a flower."],
  ["Please read this rules of play.", "Please read these rules of play."],
  ["IM not sure about it.", "I'm not sure about it."],
  ["The book your using is mine.", "The book you're using is mine."],
  ["I think your all set now.", "I think you're all set now."],
  ["Have Omar booked the room?", "Has Omar booked the room?"],
  ["I hope she go home early.", "I hope she goes home early."],
])("repairs %s", (input, expected) => {
  const found = scan(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "There are many reasons.",
  "There were apples on the table.",
  "A number of people came.",
  "Some other time, then.",
  "Many others came.",
  "I make sense of it slowly.",
  "The old ones look nice.",
  "I like the ones you chose.",
  "Me too all day long.",
  "We maybe go tomorrow.",
  "Have Tom figure out the bug.",
  "It is kind of you.",
  "Send me an IM later.",
  "This means of transport is old.",
  "I liked your writing.",
  "Have Omar call me later.",
  "I heard it rain all night.",
  "I suggest he go now.",
  "Stop your whining now.",
  "It is no use your pretending.",
  "If your testing of it is done, tell me.",
  "I wonder if your thinking habits changed.",
  "Thanks for your helping hand.",
  "The plan your team wrote is fine.",
])("leaves %s", (text) => {
  expect(scan(text).map((d) => d.original)).toEqual([]);
});
