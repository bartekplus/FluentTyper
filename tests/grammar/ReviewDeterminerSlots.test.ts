import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { englishVerbNouns } from "../../src/core/domain/grammar/implementations/helpers/EnglishLexicon";
import { scan as reviewScan } from "./reviewHarness";

function scan(text: string) {
  return reviewScan(text).filter((d) => d.ruleId === "englishConfusedWords");
}

test("the lexicon derives -ion and -ment nouns from flagged verbs", () => {
  expect(englishVerbNouns("translate")).toEqual(["translation"]);
  expect(englishVerbNouns("improve")).toEqual(["improvement"]);
  expect(englishVerbNouns("table")).toEqual([]);
});

test("a determiner before a bare verb or a verb phrase is repaired", () => {
  for (const [input, expected] of [
    ["The translate into French took a week.", "The translation into French took a week."],
    ["The blast was a loud explode.", "The blast was a loud explosion."],
    ["The vet gave us the diagnose.", "The vet gave us the diagnosis."],
    ["We admired the protect of the old forest.", "We admired the protection of the old forest."],
    ["The cannot attend tomorrow.", "They cannot attend tomorrow."],
    ["The will bring snacks.", "They will bring snacks."],
    ["If the hired a guide, they would know.", "If they hired a guide, they would know."],
    ["The also sell bread.", "They also sell bread."],
    ["The have booked the hall.", "They have booked the hall."],
    ["When the were leaving, it rained.", "When they were leaving, it rained."],
    ["The had been warned twice.", "They had been warned twice."],
    ["We waited a week for their respond.", "We waited a week for their response."],
    ["His withdraw surprised the team.", "His withdrawal surprised the team."],
    [
      "She twisted her ankle and the injure healed slowly.",
      "She twisted her ankle and the injury healed slowly.",
    ],
    ["Check the expire date first.", "Check the expiry date first."],
    ["Our arrive was late because of fog.", "Our arrival was late because of fog."],
    // re- verbs whose stem is a noun still have an authored noun; a name's possessive.
    ["The landlord sent a remind about rent.", "The landlord sent a reminder about rent."],
    ["He handed in his resign on Friday.", "He handed in his resignation on Friday."],
    ["Last night's deploy broke the login.", "Last night's deployment broke the login."],
    ["Their only invent was a folding ladder.", "Their only invention was a folding ladder."],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("nouns, compounds and participle adjectives stay silent", () => {
  for (const text of [
    "The will states that the house goes to her.",
    "The can opener is broken.",
    "The must have gadget sold out.",
    "The seriously injured man recovered.",
    "The widely praised film won.",
    "He is in the know.",
    "The install script failed.",
    "Let her decide.",
    "The allowed amount is small.",
    "The suspect is on the lose again.",
    "Fuel with an oxygenate added burns cleaner.",
    "Help her respond to the letter.",
    "The have-nots marched.",
    "The were-tiger is a legend.",
    "The are used to be a land unit.",
    // Jargon nouns no authored row covers stay silent after a possessive or as re- words.
    "We cut the company's spend on travel.",
    "Most co's continue to report losses.",
    "Check the restock date.",
    "It's sign of a problem.",
    "Let's deploy tonight.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
