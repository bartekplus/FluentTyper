import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan } from "./reviewHarness";

// Typo-like confusions resolved by their context (english/confusions2.ts and the
// their/there/they're, to/too and were/where frames). All sentences are our own.
const RULES = new Set([
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "englishUsagePhrases",
  "englishContextualCompounds",
  "englishPronounCase",
  "englishTheirThereTheyAre",
  "englishWereWhere",
  "englishToToo",
]);
function review(text: string) {
  return scan(text).filter((d) => RULES.has(d.ruleId));
}

const positives = [
  // Phrase rows.
  ["Setup was a real hazzle for us.", "Setup was a real hassle for us."],
  ["It was a hazzle-free move.", "It was a hassle-free move."],
  ["We tried at leas twice.", "We tried at least twice."],
  ["The nurse checked the umbilical chord.", "The nurse checked the umbilical cord."],
  ["Her speech struck a cord with us.", "Her speech struck a chord with us."],
  ["We watched the whether all week.", "We watched the weather all week."],
  ["The likely hood is small.", "The likelihood is small."],
  ["The tool is widely toted as fast.", "The tool is widely touted as fast."],
  ["Guests were not aloud to smoke.", "Guests were not allowed to smoke."],
  ["We can't way for the weekend.", "We can't wait for the weekend."],
  ["This lamp is tuff enough for camping.", "This lamp is tough enough for camping."],
  // Context detectors.
  ["We cold try again later.", "We could try again later."],
  ["She dos her homework early.", "She does her homework early."],
  ["They usually wok on Sundays.", "They usually work on Sundays."],
  ["Our plan is rally working.", "Our plan is really working."],
  ["Pleas close the door.", "Please close the door."],
  ["Paint a boarder around the frame.", "Paint a border around the frame."],
  ["Trucks cross the boarders slowly.", "Trucks cross the borders slowly."],
  ["The clever thieve hid the jewels.", "The clever thief hid the jewels."],
  ["Our principle goal is speed.", "Our principal goal is speed."],
  ["You should shutdown the laptop first.", "You should shut down the laptop first."],
  ["We though the shop was open.", "We thought the shop was open."],
  ["Have you ever herd of this café?", "Have you ever heard of this café?"],
  ["Ask how mach it costs.", "Ask how much it costs."],
  ["Tell me how match flour you need.", "Tell me how much flour you need."],
  ["The kids are so exited for summer.", "The kids are so excited for summer."],
  ["The report is all ready available.", "The report is already available."],
  ["There is now way to undo it.", "There is no way to undo it."],
  ["The game stopped do to rain.", "The game stopped due to rain."],
  ["Meetings are a waist of time.", "Meetings are a waste of time."],
  ["We relay on volunteers.", "We rely on volunteers."],
  ["Do you know off a good dentist?", "Do you know of a good dentist?"],
  ["She looked tuff like a boxer.", "She looked tough like a boxer."],
  ["Well yeh, that works.", "Well yeah, that works."],
  ["Our class won a price yesterday.", "Our class won a prize yesterday."],
  ["It hurts to loose them.", "It hurts to lose them."],
  ["The screws were too lose and rattled.", "The screws were too loose and rattled."],
  ["Wave to they from the boat.", "Wave to them from the boat."],
  ["Invite they to the party.", "Invite them to the party."],
  // their / there / they're.
  ["The twins packed there suitcases.", "The twins packed their suitcases."],
  ["There cat climbed the fence.", "Their cat climbed the fence."],
  ["We heard there selling the house.", "We heard they're selling the house."],
  ["We read stories about there childhood.", "We read stories about their childhood."],
  ["We repaired they're fence.", "We repaired their fence."],
  ["They're kitten scratched the sofa.", "Their kitten scratched the sofa."],
  ["Leave the boxes their, by the door.", "Leave the boxes there, by the door."],
  ["Their offline right now.", "They're offline right now."],
  // to / too and were / where.
  ["He wants cake, to.", "He wants cake, too."],
  ["They sang to loud.", "They sang too loud."],
  ["That's to hard.", "That's too hard."],
  ["Where you able to sleep?", "Were you able to sleep?"],
  ["Go were they sent you.", "Go where they sent you."],
] as const;

test.each(positives)("repairs %s", (source, expected) => {
  const findings = review(source);
  expect(findings.length).toBeGreaterThan(0);
  const exact = findings.some((finding) =>
    finding.alternatives.some((alternative) => applyEdits(source, alternative.edits) === expected),
  );
  expect(exact).toBe(true);
  expect(review(expected)).toEqual([]);
});

test("threat offers threaten or treat", () => {
  const [finding] = review("We must threat the wound.");
  expect(finding.alternatives.map((a) => applyEdits("We must threat the wound.", a.edits))).toEqual(
    ["We must threaten the wound.", "We must treat the wound."],
  );
});

const negatives = [
  // Correct forms and look-alikes.
  "The cold wind made it cold all night.",
  "We cold call new clients on Mondays.",
  "Old DOS games still run.",
  "Heat the wok before adding oil.",
  "The protest became a rally for change.",
  "Their pleas fell on deaf ears.",
  "The boarders of the school eat at six.",
  "The children learned to thieve from the rich.",
  "The principle of least privilege applies.",
  "The principle states that energy is conserved.",
  "The shutdown lasted a week.",
  "I liked it, though I left early.",
  "She has a heart of gold.",
  "A herd of goats crossed the road.",
  "Explain how match statements work.",
  "The aircraft reached Mach 2.",
  "The loop was exited early.",
  "We are all ready to go.",
  "It is now way more stable.",
  "What did you do to the printer?",
  "She has a waist of 28 inches.",
  "The waist of the dress is narrow.",
  "The relay on the board clicked.",
  "I know it off the top of my head.",
  "Volcanic tuff like this is soft.",
  "The motion passed, yea and nay alike.",
  "Shops won the price war.",
  "Prices moved from tight to loose.",
  "The answer is too lose-lose for anyone.",
  "The house I moved to they sold last year.",
  "I think they are right.",
  "There goes the bus.",
  "There remain three issues.",
  "I lived there years ago.",
  "From there we walked home.",
  "Go back there after lunch.",
  "I bet they're tired.",
  "They're students funded by grants.",
  "They're family owned and run.",
  "Put the keys in their bag.",
  "She read the poem aloud to us.",
  "I can't wait to see it.",
  "I wanted to go too.",
  "Where you going?",
  "Show me where they went.",
] as const;

test.each(negatives)("leaves %s", (source) => {
  expect(review(source)).toEqual([]);
});
