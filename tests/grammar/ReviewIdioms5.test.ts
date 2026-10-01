import { describe, expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

const RULES = new Set([
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "englishContextualCompounds",
  "englishFixedPrepositions",
  "englishVerbComplements",
  "englishSentenceStructure",
  "stylePhrasing",
]);
function findings(text: string) {
  return detectReviewDiagnostics(
    { id: "idioms5", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}
const repairsOf = (text: string) =>
  findings(text).flatMap((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

// [typed, one repaired text the writer can pick]
const repairs: [string, string][] = [
  ["Your kind note meant a lot for me.", "Your kind note meant a lot to me."],
  ["This award means alot for us.", "This award means a lot to us."],
  ["The town is famous its pottery.", "The town is famous for its pottery."],
  ["She is interested learning Welsh.", "She is interested in learning Welsh."],
  ["He was angry them.", "He was angry with them."],
  ["We need talk about the budget.", "We need to talk about the budget."],
  ["He forgot send the invoice.", "He forgot to send the invoice."],
  ["I'm eager see the garden.", "I'm eager to see the garden."],
  ["They refused answer the letter.", "They refused to answer the letter."],
  ["The reviews are a mixed bad overall.", "The reviews are a mixed bag overall."],
  [
    "Pick the city with the most number of parks.",
    "Pick the city with the highest number of parks.",
  ],
  ["The bus is late most of the times.", "The bus is late most of the time."],
  ["I usually always walk to work.", "I usually walk to work."],
  ["That loss was the final nail on the coffin.", "That loss was the final nail in the coffin."],
  ["You hit the nail on the hat.", "You hit the nail on the head."],
  ["The comet was visible from the naked eye.", "The comet was visible to the naked eye."],
  ["He apologized, so no harm nor foul.", "He apologized, so no harm no foul."],
  ["The bridge is not longer safe.", "The bridge is no longer safe."],
  [
    "The update shipped, and no longer you need a password.",
    "The update shipped, and you no longer need a password.",
  ],
  ["The rookie was no match against the champion.", "The rookie was no match for the champion."],
  ["He wonts to bake bread.", "He wants to bake bread."],
  ["I never saw the memo, nor I could find it.", "I never saw the memo, nor could I find it."],
  ["Try not to obsess on small details.", "Try not to obsess over small details."],
  ["Yes, off course you can join.", "Yes, of course you can join."],
  ["The attic is off limit to guests.", "The attic is off limits to guests."],
  ["Those are off-limit rooms.", "Those are off-limits rooms."],
  ["Flattery is the oldest trick in the books.", "Flattery is the oldest trick in the book."],
  [
    "My aunt lives in the fourth floor of that tower.",
    "My aunt lives on the fourth floor of that tower.",
  ],
  ["I am still on a fence about the move.", "I am still on the fence about the move."],
  ["We met once a twice last year.", "We met once or twice last year."],
  ["Both labels were one in the same.", "Both labels were one and the same."],
  ["The cat left on its own accord.", "The cat left of its own accord."],
  ["You out to be proud of this.", "You ought to be proud of this."],
  ["The map is out-of date.", "The map is out of date."],
  ["My cooking is pale in comparison to hers.", "My cooking pales in comparison to hers."],
  ["She is passionate of gardening.", "She is passionate about gardening."],
  ["Who will pay for the bill tonight?", "Who will pay the bill tonight?"],
  ["Please make sure we backup the photos.", "Please make sure we back up the photos."],
  ["I will never breakup with coffee.", "I will never break up with coffee."],
  ["The trailer peeked my interest.", "The trailer piqued my interest."],
  ["Count the line of codes in the file.", "Count the lines of code in the file."],
  ["What is the reason of doing it twice?", "What is the reason for doing it twice?"],
  ["She rose the ranks in two years.", "She rose through the ranks in two years."],
  ["He raised through the ranks quickly.", "He rose through the ranks quickly."],
  ["They rose up the ranks.", "They rose through the ranks."],
  ["We ran into a trouble with the van.", "We ran into trouble with the van."],
  ["Ran into problem with the pump.", "Ran into a problem with the pump."],
  [
    "He shot himself into the foot with that remark.",
    "He shot himself in the foot with that remark.",
  ],
  ["The fair will show case local crafts.", "The fair will showcase local crafts."],
  [
    "I have lived here since a couple of years, sadly.",
    "I have lived here for a couple of years, sadly.",
  ],
  ["That was somewhat of a shock.", "That was something of a shock."],
  ["We met her soon to be husband.", "We met her soon-to-be husband."],
  ["These lamps are highly sort after.", "These lamps are highly sought after."],
  ["It's such shame that it rained.", "It's such a shame that it rained."],
  ["Please take a look to the draft.", "Please take a look at the draft."],
  ["She takes care about the garden.", "She takes care of the garden."],
  ["Eat the tablets after lunch.", "Take the tablets after lunch."],
  ["We take pride of our bread.", "We take pride in our bread."],
  ["Nobody takes the warning serious.", "Nobody takes the warning seriously."],
  ["That that is broken must be fixed.", "That which is broken must be fixed."],
  ["Tell me the why it failed.", "Tell me why it failed."],
  ["It rained during the last days.", "It rained during the last few days."],
  ["What is the point for this meeting?", "What is the point of this meeting?"],
  ["I enjoy this kind of things.", "I enjoy this kind of thing."],
  ["These sort of things happen.", "These sorts of things happen."],
  ["Ferns thrive off shade.", "Ferns thrive on shade."],
  ["Please through away the old bread.", "Please throw away the old bread."],
  ["Don't throw away the baby with the bathwater.", "Don't throw out the baby with the bathwater."],
  ["Kids should not throw trash.", "Kids should not throw away trash."],
  ["It is the best album till date.", "It is the best album to date."],
  ["I decided to never to smoke again.", "I decided to never smoke again."],
  ["I tried my hands at pottery.", "I tried my hand at pottery."],
  ["She tried out her luck at poker.", "She tried her luck at poker."],
  ["Cats chase dogs and vice-versa.", "Cats chase dogs and vice versa."],
  ["It became a viscous cycle of debt.", "It became a vicious cycle of debt."],
  ["Her parents are good-educated.", "Her parents are well-educated."],
  ["The method is wide accepted.", "The method is widely accepted."],
  ["I wish I can fly.", "I wish I could fly."],
  ["Guests are welcome with open arms.", "Guests are welcomed with open arms."],
  ["They greeted us with opened arms.", "They greeted us with open arms."],
  ["I would have never guessed.", "I never would have guessed."],
  ["The club has over 300 plus members.", "The club has over 300 members."],
];

// Correct forms and look-alikes that must stay clean.
const silent = [
  "It means a lot to me.",
  "The town is famous for its pottery.",
  "I agree with you on this.",
  "You can try out the new tool today.",
  "We need help with this.",
  "The failed test was fixed.",
  "They plan deploy",
  "The results were a mixed bag.",
  "Most of the times we met, it rained.",
  "The comet was hidden from the naked eye.",
  "No harm, no foul.",
  "This cable is not longer than that one.",
  "Neither my sister nor I can swim.",
  "Of course, the ship drifted off course.",
  "Turn off limit switches first.",
  "She looked up at the third floor.",
  "The fire started in the third floor kitchen.",
  "A bird sat on a fence.",
  "Once a month we meet.",
  "Put another one in the same box.",
  "He made it out to be simple.",
  "It turned out to be fine.",
  "Her face is pale.",
  "She is the most passionate of them all.",
  "We paid the bill.",
  "We switch to backup power at night.",
  "We need to setup",
  "He reached the peak of the hill.",
  "For reasons of security, the door stays locked.",
  "They raise the ranks of new players every year.",
  "He rose through the rank and file.",
  "Can you show case 3 again?",
  "Since two days were lost, we hurried.",
  "He was soon to be promoted.",
  "We sort after loading the data.",
  "What I would do is sort after the join.",
  "There was such shame in the room.",
  "Take a look to see what changed.",
  "The design has a look to it.",
  "The vase takes pride of place on the shelf.",
  "Take serious steps now.",
  "Explain the how and the why.",
  "Count the last minutes before launch.",
  "Tribes thrive off the land.",
  "Walk through the park.",
  "Throw junk bytes away.",
  "We throw garbage data at the parser.",
  "Good till date orders expire.",
  "I wish you could come.",
  "He would never have guessed.",
  "The shop sells over 50 plus size dresses.",
  "The pitcher went over five-plus innings.",
  "A vicious circle and a vicious cycle mean the same.",
  "I agree with your point of view.",
  "We are shooting ourselves in the feet.",
  'He wrote "once a twice" as a joke.',
];

describe("Review idioms5: fixed expressions and their context (M-Z)", () => {
  test.each(repairs)("%s", (typed, repaired) => {
    expect(repairsOf(typed)).toContain(repaired);
  });

  test.each(silent.map((text) => [text]))("stays silent: %s", (text) => {
    expect(findings(text).map((d) => d.ruleId)).toEqual([]);
  });

  test("ambiguous repairs ask the writer to choose", () => {
    const [finding] = findings("The comet was visible from the naked eye.");
    expect(finding.requiresChoice).toBe(true);
    expect(repairsOf("The comet was visible from the naked eye.")).toContain(
      "The comet was visible with the naked eye.",
    );
  });

  test("style variants are optional advice", () => {
    for (const text of ["They rose up the ranks.", "I usually always walk to work."])
      expect(findings(text).map((d) => d.ruleId)).toEqual(["stylePhrasing"]);
  });

  test("typed capitals carry over", () => {
    expect(repairsOf("DO IT ONCE A TWICE.")).toContain("DO IT ONCE OR TWICE.");
    expect(repairsOf("Vise-A-Versa works too.")).toContain("Vice versa works too.");
  });
});
