import { expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { review as runReview } from "./grammarTestUtils";

// Grammar, style and format checks of english/grammarStyle2.ts. All sentences are our own.
const RULES = new Set([
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "englishCanonicalCasing",
  "englishSentenceStructure",
  "englishUsagePhrases",
  "englishItsContext",
  "englishYourYouAre",
  "englishRepeatedWords",
  "englishExistentialAgreement",
  "measurementUnitFormatting",
  "stylePhrasing",
]);
const review = (text: string) =>
  runReview(text, {}, { enabledRules: REVIEW_SUPPORTED_RULE_IDS }).diagnostics.filter((d) =>
    RULES.has(d.ruleId),
  );

const positives = [
  // Phrase rows.
  ["The new build uses very less memory.", "The new build uses much less memory."],
  ["We had too less room for the boxes.", "We had too little room for the boxes."],
  ["The kitchen is been painted twice.", "The kitchen has been painted twice."],
  ["The cousins visited each others homes.", "The cousins visited each other's homes."],
  ["Plain HTTP is unsecure for logins.", "Plain HTTP is insecure for logins."],
  ["That puzzle looked unpossible at first.", "That puzzle looked impossible at first."],
  ["She drew the childrens favorite hero.", "She drew the children's favorite hero."],
  ["The novel is set in the guilded age.", "The novel is set in the Gilded Age."],
  ["Put it on my to to list.", "Put it on my to-do list."],
  ["We webscrapped the weather tables.", "We webscraped the weather tables."],
  ["Her web scrapper broke overnight.", "Her web scraper broke overnight."],
  // Compound rows.
  ["We watched it on Blu ray last night.", "We watched it on Blu-ray last night."],
  ["Stick a post it note on the fridge.", "Stick a post-it note on the fridge."],
  ["We picked a cross platform toolkit.", "We picked a cross-platform toolkit."],
  ["Please double check the totals.", "Please double-check the totals."],
  ["The firewall will white list our office.", "The firewall will whitelist our office."],
  ["Our click through rate doubled.", "Our click-through rate doubled."],
  ["The fans felt a ok after the match.", "The fans felt a-ok after the match."],
  ["Treat your self to a long walk.", "Treat yourself to a long walk."],
  ["I was kindof tired.", "I was kind of tired."],
  // Style rows.
  ["The soup was pretty decent.", "The soup was decent."],
  ["I think that that idea works.", "I think that idea works."],
  ["The village is rather unique.", "The village is rather unusual."],
  ["Our cybersec budget grew.", "Our cybersecurity budget grew."],
  ["The trip was fun, tho short.", "The trip was fun, though short."],
  ["Walk thru the gate.", "Walk through the gate."],
  ["The oven has in-built storage.", "The oven has built-in storage."],
  ["We stayed in a touristic hotel.", "We stayed in a tourist hotel."],
  ["My uncle grew up in Bombay.", "My uncle grew up in Mumbai."],
  ["No thanks, I just ate.", "No, thanks, I just ate."],
  [
    "We sell fruit including but not limited to apples and pears.",
    "We sell fruit, including, but not limited to, apples and pears.",
  ],
  // Names.
  ["She won the Noble Peace Prize.", "She won the Nobel Peace Prize."],
  ["Check the goggle maps link.", "Check the Google maps link."],
  ["He drives a Mercedes Benz.", "He drives a Mercedes-Benz."],
  // Context detectors.
  ["Call me if there a problem.", "Call me if there is a problem."],
  ["We are not be late today.", "We are not late today."],
  ["The cake looks likes a castle.", "The cake looks like a castle."],
  ["They no nothing about it.", "They know nothing about it."],
  ["She hasn't sent no reply.", "She hasn't sent any reply."],
  ["The coach didn't take no excuses.", "The coach didn't take any excuses."],
  ["Do I ready for the exam?", "Am I ready for the exam?"],
  ["Do I interested in chess?", "Am I interested in chess?"],
  ["I guess it time to go.", "I guess it's time to go."],
  ["Ur totally right.", "You're totally right."],
  ["We missed a chance to to speak.", "We missed a chance to speak."],
  ["The fix was applied to to tables.", "The fix was applied to tables."],
  ["I noticed there is bugs in the parser.", "I noticed there are bugs in the parser."],
  ["There after followed a long pause.", "Thereafter followed a long pause."],
  ["My aunt is an easy going host.", "My aunt is an easy-going host."],
  ["A one handed grip is enough.", "A one-handed grip is enough."],
  ["It reads like a first person diary.", "It reads like a first-person diary."],
  ["Tomorrows forecast looks sunny.", "Tomorrow's forecast looks sunny."],
  ["The nurses logged over time hours.", "The nurses logged overtime hours."],
  ["Her make up bag is red.", "Her makeup bag is red."],
  ["The phone has built in storage.", "The phone has built-in storage."],
  ["Some birds fly south, where as others stay.", "Some birds fly south, whereas others stay."],
  ["We bought rainbow colored candles.", "We bought rainbow-colored candles."],
  ["Use a password protected folder.", "Use a password-protected folder."],
  ["Please attach detailed screenshot.", "Please attach a detailed screenshot."],
  ["°K", "K"],
  // "a"/"an" follows the sound of the next word.
  ["Please provide updated screenshot.", "Please provide an updated screenshot."],
  ["Please give honest answer.", "Please give an honest answer."],
] as const;

test.each(positives)("repairs %s", (source, expected) => {
  const findings = review(source);
  expect(findings.length).toBeGreaterThan(0);
  const exact = findings.some((finding) =>
    finding.alternatives.some((alternative) => applyEdits(source, alternative.edits) === expected),
  );
  expect(exact).toBe(true);
});

test("a hyphenated compound keeps every typed letter's case", () => {
  const source = "I lost the BLU ray remote.";
  const [finding] = review(source);
  expect(applyEdits(source, finding.alternatives[0].edits)).toBe("I lost the BLU-ray remote.");
});

const negatives = [
  // Correct forms and look-alikes.
  "The tea had much less sugar.",
  "It has been a long week.",
  "They helped each other.",
  "Unsecured loans cost more.",
  "The children's choir sang.",
  "The gilded frame cost a lot.",
  "The ray of light hit the wall.",
  "Post it to me by Friday.",
  "She double-checked the totals.",
  "The blacklist is long.",
  "Click through the slides first.",
  "Is plan A ok?",
  "Know your self-worth.",
  "Keep your self - worth.",
  "The soup was pretty good.",
  "I said that to her.",
  "Every snowflake is unique.",
  "The config file is missing.",
  "OK, let's go.",
  "He got no thanks for his work.",
  "No thanks to you, we won.",
  "We sell fruit, including, but not limited to, apples.",
  "The noble knight kept the peace.",
  "Wear goggles in the lab.",
  "She asked if there was a problem.",
  "To be or not be?",
  "She likes the look.",
  "Say no to nothing.",
  "I haven't said no yet.",
  "We didn't take no for an answer.",
  "Do I need a ticket?",
  "Do I clean the room first?",
  "Give it time to heal.",
  "See ya soon.",
  "I wrote to to complain.",
  "Do what you need to to win.",
  "There is news from home.",
  "We got there after lunch.",
  "There after the war, life changed.",
  "Take it easy going forward.",
  "No one handed in the forms.",
  "The two handed over the keys.",
  "The first person reports to the desk.",
  "For all our tomorrows are bright.",
  "Prices rose over time.",
  "Over time wages rose.",
  "Let her make up her mind.",
  "Cells make up the body.",
  "It was built in Rust.",
  "Rome wasn't built in a day.",
  "This is the town where, as a child, I lived.",
  "The artist cream colored the wall.",
  "The file is password protected.",
  "We need help.",
  "Please provide feedback.",
  "It is 300 K outside.",
];

test.each(negatives)("leaves %s", (source) => {
  expect(review(source)).toEqual([]);
});

test("the English checks stay off in other languages", () => {
  const text = "Myślę, że to to samo zadanie.";
  expect(
    runReview(text, {}, { lang: "pl_PL", enabledRules: REVIEW_SUPPORTED_RULE_IDS }).diagnostics,
  ).toEqual([]);
});
