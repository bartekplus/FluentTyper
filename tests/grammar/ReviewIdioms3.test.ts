import { describe, expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { review } from "./grammarTestUtils";

const RULES = new Set([
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "englishFixedPrepositions",
  "stylePhrasing",
]);
const findings = (text: string) =>
  review(text, {}, { enabledRules: REVIEW_SUPPORTED_RULE_IDS }).diagnostics.filter((d) =>
    RULES.has(d.ruleId),
  );
const repairsOf = (text: string) =>
  findings(text).flatMap((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

// [typed, one repaired text the writer can pick]
const repairs: [string, string][] = [
  ["The cat sat with its paws a kimbo.", "The cat sat with its paws akimbo."],
  ["She posed arms-a-kimbo on the stage.", "She posed arms-akimbo on the stage."],
  ["The tests passed after a some retries.", "The tests passed after some retries."],
  ["The parser still has ways to go.", "The parser still has a ways to go."],
  ["We have ways to go with the docs.", "We have a long way to go with the docs."],
  ["I have not baked bread in awhile.", "I have not baked bread in a while."],
  ["They were accused for cheating at cards.", "They were accused of cheating at cards."],
  ["Nobody accused her for it.", "Nobody accused her of it."],
  ["That pond is too small of a home for ducks.", "That pond is too small a home for ducks."],
  ["The fix arrived after two weeks later.", "The fix arrived after two weeks."],
  ["It shipped after about a month later.", "It shipped about a month later."],
  ["Leave the door a jar tonight.", "Leave the door ajar tonight."],
  ["Leave the gate a-jar for the dog.", "Leave the gate ajar for the dog."],
  ["Once the fuse blew, all hell broke out.", "Once the fuse blew, all hell broke loose."],
  ["It works for all intense purposes.", "It works for all intents and purposes."],
  ["In all intents and purposes, it is done.", "For all intents and purposes, it is done."],
  ["It is, to all intents and purpose, finished.", "It is, to all intents and purposes, finished."],
  ["Together that amounts for half our budget.", "Together that amounts to half our budget."],
  ["This amounts for most of the load.", "This accounts for most of the load."],
  ["Bring cups, plates and the likes.", "Bring cups, plates and the like."],
  ["We sell yarn, buttons or alike.", "We sell yarn, buttons or the like."],
  ["Everyone you know has another thing coming.", "Everyone you know has another think coming."],
  ["My old mountain bike is an analog bike.", "My old mountain bike is a non-electric bike."],
  ["Keep the drafts apart form the final copies.", "Keep the drafts apart from the final copies."],
  ["The cake fell a part in the oven.", "The cake fell apart in the oven."],
  ["The seats were too far a part.", "The seats were too far apart."],
  ["She felt like apart of the family.", "She felt like a part of the family."],
  ["Everything is fine a part from the colors.", "Everything is fine apart from the colors."],
  ["The train will arrive to the coast at noon.", "The train will arrive at the coast at noon."],
  ["We arrived to Lisbon late.", "We arrived in Lisbon late."],
  ["I wonder as how to start.", "I wonder as to how to start."],
  ["She is curious to why it broke.", "She is curious as to why it broke."],
  ["The clerk asked to me for a receipt.", "The clerk asked me for a receipt."],
  ["Grandpa is telling to us a story.", "Grandpa is telling us a story."],
  ["He aspires for a quiet life.", "He aspires to a quiet life."],
  ["Back in the days, we rode bikes.", "Back in the day, we rode bikes."],
  ["The skeleton plan is bare bone for now.", "The skeleton plan is bare bones for now."],
  ["It is a bare-bone template.", "It is a bare-bones template."],
  ["Magic happens behind the scene.", "Magic happens behind the scenes."],
  ["That is the finest pie of all times.", "That is the finest pie of all time."],
  ["The lamp is better off served by a timer.", "The lamp is better served by a timer."],
  ["I broke the vase on accident.", "I broke the vase by accident."],
  ["We found it on pure accident, honestly.", "We found it by pure accident, honestly."],
  ["The kitten climbed the shelf by its own.", "The kitten climbed the shelf on its own."],
  ["We baked the cake by our own.", "We baked the cake by ourselves."],
  ["Let us play it by the books.", "Let us play it by the book."],
  ["We should call it quit for today.", "We should call it quits for today."],
  ["Locals call it as the old mill.", "Locals call it the old mill."],
  ["That is a cash 22 for new hires.", "That is a catch 22 for new hires."],
  ["It turned into a cache-22.", "It turned into a catch-22."],
  ["The film is a cautionary tail.", "The film is a cautionary tale."],
  ["The kettle seized to whistle.", "The kettle ceased to whistle."],
  ["The crew changed tact mid-race.", "The crew changed tack mid-race."],
  ["After a change of tacts, the team won.", "After a change of tack, the team won."],
  ["We tried a different tact.", "We tried a different tack."],
  ["It is a chicken an egg puzzle.", "It is a chicken and egg puzzle."],
  ["It became a chicken-egg problem.", "It became a chicken-and-egg problem."],
  ["The pantry is choke full of jars.", "The pantry is chock-full of jars."],
  ["The basket is chalk-full of plums.", "The basket is chock-full of plums."],
  ["Her only claim for fame is a song.", "Her only claim to fame is a song."],
  ["They are a tight-nit crew.", "They are a tight-knit crew."],
  ["We grew up in a close nit village.", "We grew up in a close knit village."],
  ["The game was coded on Python.", "The game was coded in Python."],
  ["This tool is written on Rust.", "This tool is written in Rust."],
  ["I filed a complain about the noise.", "I filed a complaint about the noise."],
  ["Many complains reached the desk.", "Many complaints reached the desk."],
  ["He sounded confidant on the call.", "He sounded confident on the call."],
  ["She has a confidant smile.", "She has a confident smile."],
  [
    "We stopped at a convenient store near the station.",
    "We stopped at a convenience store near the station.",
  ],
  ["Kids crave for candy.", "Kids crave candy."],
  ["I am craving for soup.", "I am craving soup."],
  ["This puzzle is so addicting.", "This puzzle is so addictive."],
  ["The trail was barely unknown to us.", "The trail was barely known to us."],
  ["After 2 years later, we met.", "2 years later, we met."],
];

// Correct forms and look-alikes.
const silent = [
  "Her hands rested on her hips, arms akimbo.",
  "Wait a while before you start.",
  "We rested awhile by the lake.",
  "The accused for the second case sat down.",
  "I was accused for the first time of my career.",
  "Is that true of a dog as well?",
  "Two weeks later, the fix arrived.",
  "She put the jam in a jar.",
  "Five years ago all hell broke loose here.",
  "For all intents and purposes, it is done.",
  "To all intents and purposes, it is done.",
  "The amounts for each item are listed.",
  "It amounts to nothing.",
  "We met the likes of him before.",
  "Young and old alike enjoyed it.",
  "She had another think coming.",
  "Apart from the colors, nothing changed.",
  "The pieces are a word apart form one sentence.",
  "I ordered a part from the dealer.",
  "Guests arrive to find the doors open.",
  "He asked as well as how to start.",
  "Tell it to me straight.",
  "The secret was told to them.",
  "She is unsure to what extent it helps.",
  "Developers use Aspire for cloud apps.",
  "Back in the days of steam, travel was slow.",
  "Dogs love a bare bones diet.",
  "The best years of all were spent here.",
  "Add the sum of all times recorded.",
  "Dinner is better off served cold.",
  "The report on accident rates is out.",
  "By their own admission, they were late.",
  "I was inspired by the books I read.",
  "Let's call it Quit in the menu.",
  "You can call it as a function.",
  "Call me as soon as you land.",
  "We caught the catch-22 early.",
  "The dog chased its tail.",
  "Police may seize the car.",
  "The sailor changed tack.",
  "Which came first, the chicken or the egg?",
  "He made big claims for fame and money.",
  "The note is written on paper.",
  "Notes and Programs on Java.",
  "The complain flag is set.",
  "Users complain about the fan.",
  "She is my closest confidant.",
  "A cloud bucket is a convenient store for logs.",
  "My craving for sweets is strong.",
  "The drug is addicting millions.",
  "She barely understood the joke.",
];

describe("Review idioms3: fixed expressions and their context", () => {
  test.each(repairs)("%s", (typed, repaired) => {
    expect(repairsOf(typed)).toContain(repaired);
  });

  test.each(silent)("stays silent: %s", (text) => {
    expect(findings(text).map((d) => d.ruleId)).toEqual([]);
  });

  test("choices are offered when the writer must pick", () => {
    const [finding] = findings("The seat belt is apart of the kit.");
    expect(finding.requiresChoice).toBe(true);
  });
});
