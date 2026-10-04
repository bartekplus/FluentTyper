import { describe, expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { review } from "./grammarTestUtils";

// "go ahead an book" is also a confused word; either rule may explain the same repair.
const RULES = new Set([
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "stylePhrasing",
  "englishConfusedWords",
]);
const findings = (text: string) =>
  review(text, {}, { enabledRules: REVIEW_SUPPORTED_RULE_IDS }).diagnostics.filter((d) =>
    RULES.has(d.ruleId),
  );
const repairsOf = (text: string) =>
  findings(text).flatMap((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

// [typed, one repaired text the writer can pick]
const repairs: [string, string][] = [
  ["Mastering chess takes a little of patience.", "Mastering chess takes a little patience."],
  ["With a little of luck we finish today.", "With a bit of luck we finish today."],
  ["The kettle took along time to boil.", "The kettle took a long time to boil."],
  ["We stayed for along time.", "We stayed for a long time."],
  ["For her, the job is a mean to an end.", "For her, the job is a means to an end."],
  ["Gardening is a whole another hobby.", "Gardening is a whole other hobby."],
  ["That puzzle was a whole ’nother level.", "That puzzle was a whole other level."],
  ["They repeated the rumor as nauseam.", "They repeated the rumor ad nauseam."],
  ["The fox took advantage the open gate.", "The fox took advantage of the open gate."],
  [
    "Shoppers are taking advantage an early sale.",
    "Shoppers are taking advantage of an early sale.",
  ],
  ["The rain stopped after while.", "The rain stopped after a while."],
  ["Rest here for while.", "Rest here for a while."],
  ["I will call you in while.", "I will call you in a while."],
  ["The parcel arrived afterall.", "The parcel arrived after all."],
  ["Just go ahead an book the tickets.", "Just go ahead and book the tickets."],
  ["The dog sleeps on the sofa an in the yard.", "The dog sleeps on the sofa and in the yard."],
  ["It is cheap, al beit slow.", "It is cheap, albeit slow."],
  ["A cozy room, allbe it small.", "A cozy room, albeit small."],
  ["That is all well in good for now.", "That is all well and good for now."],
  ["The boat sailed along side the pier.", "The boat sailed alongside the pier."],
  ["Bring snacks, drinks and the such.", "Bring snacks, drinks and such."],
  ["Here is yet another an odd request.", "Here is yet another odd request."],
  ["Some spoons broke, but another ones survived.", "Some spoons broke, but other ones survived."],
  ["Another things to pack are socks.", "Other things to pack are socks."],
  ["The guests arrive Friday evening.", "The guests arrive on Friday evening."],
  ["Prices are low as compare to last year.", "Prices are low as compared to last year."],
  [
    "The trend, as evident by the chart, is clear.",
    "The trend, as evidenced by the chart, is clear.",
  ],
  ["As is evident by the logs, it failed.", "As is evidenced by the logs, it failed."],
  ["The records go as early back as 1900.", "The records go as far back as 1900."],
  ["The rules are as follow: be kind.", "The rules are as follows: be kind."],
  ["As is with anything, practice helps.", "As with anything, practice helps."],
  ["As it so happens, I agree.", "As it happens, I agree."],
  ["You may stay aslong as you like.", "You may stay as long as you like."],
  ["Any route works as long that it is safe.", "Any route works as long as it is safe."],
  ["It costs twice as much than the old one.", "It costs twice as much as the old one."],
  ["As of currently, the shop is closed.", "As of now, the shop is closed."],
  ["I have been sleeping well as of lately.", "I have been sleeping well as of late."],
  ["Protect the data at all cost.", "Protect the data at all costs."],
  ["Do not take ads at face values.", "Do not take ads at face value."],
  ["But on face value the offer looks fair.", "But at face value the offer looks fair."],
  ["Even in the best of times, traffic is slow.", "Even at the best of times, traffic is slow."],
  ["They saved money at the expanse of quality.", "They saved money at the expense of quality."],
  ["Bring a coat, or in the very least a scarf.", "Bring a coat, or at the very least a scarf."],
  ["The whisper was barely hearable.", "The whisper was barely audible."],
  ["She was not aware about the change.", "She was not aware of the change."],
  ["That diner has a bad rep.", "That diner has a bad rap."],
  ["Please pay before hand.", "Please pay beforehand."],
  ["Honestly, that's besides the point.", "Honestly, that's beside the point."],
  ["You are better of resting today.", "You are better off resting today."],
  ["We were BETTER OF before.", "We were BETTER OFF before."],
  ["Beware about falling rocks.", "Beware of falling rocks."],
  ["Beware against fake reviews.", "Beware of fake reviews."],
  ["The brutalness of winter surprised us.", "The brutality of winter surprised us."],
  ["Stores capitalize off of holiday shoppers.", "Stores capitalize on holiday shoppers."],
  ["She is capitalising off the hype.", "She is capitalising on the hype."],
  ["We left early cause it is cold.", "We left early because it is cold."],
  ["The speech was full of cliches.", "The speech was full of clichés."],
  ["A CLICHE ending again.", "A CLICHÉ ending again."],
  ["The kit comprises of three tools.", "The kit comprises three tools."],
  ["The kit comprises of three tools.", "The kit is comprised of three tools."],
  ["Adrenaline was cursing through my veins.", "Adrenaline was coursing through my veins."],
  ["I am curious on how it works.", "I am curious about how it works."],
  ["We sell cutting age gadgets.", "We sell cutting-edge gadgets."],
  ["I don't wan any dessert.", "I don't want any dessert."],
  ["Sorry, I don't can hear you.", "Sorry, I can't hear you."],
  ["The auditors will do diligence first.", "The auditors will do due diligence first."],
  ["The castle stood during ages.", "The castle stood for ages."],
  ["Whisk one egg yoke with sugar.", "Whisk one egg yolk with sugar."],
  ["The herd moved on masse.", "The herd moved en masse."],
  ["The courier is in route to your house.", "The courier is en route to your house."],
  ["Our truck is on route to the depot.", "Our truck is en route to the depot."],
  ["Set the environmental variable first.", "Set the environment variable first."],
  ["Unset those environmental vars.", "Unset those environment vars."],
  ["We meet every once and again.", "We meet every once in a while."],
  ["I read every single of her novels.", "I read every single one of her novels."],
  ["Good bakeries are far and few between.", "Good bakeries are few and far between."],
  ["We are adding the finish touches.", "We are adding the finishing touches."],
  ["I fond on the shelf an old map.", "I found on the shelf an old map."],
  ["She is quite fond on jazz.", "She is quite fond of jazz."],
  ["The trip was calm for most part.", "The trip was calm for the most part."],
  ["A key was hidden into the drawer.", "A key was hidden in the drawer."],
  ["Every humans beings needs sleep.", "Every human beings needs sleep."],
  ["A sharp hunger pain woke me.", "A sharp hunger pang woke me."],
  ["The judges were impressed of her voice.", "The judges were impressed by her voice."],
  ["The path veers into a different direction.", "The path veers in a different direction."],
  ["In ideal world, nobody would starve.", "In an ideal world, nobody would starve."],
  ["Nothing changed in anyway.", "Nothing changed in any way."],
  ["You will hear back in do course.", "You will hear back in due course."],
  ["On hindsight, we should have waited.", "In hindsight, we should have waited."],
  ["In hind sight, the plan was weak.", "In hindsight, the plan was weak."],
  ["Use coupons in lue of cash.", "Use coupons in lieu of cash."],
  ["The shelter is in need for blankets.", "The shelter is in need of blankets."],
  ["Money in of itself is neutral.", "Money in and of itself is neutral."],
  ["Words in of themselves are harmless.", "Words in themselves are harmless."],
  ["Why did you leave at the first place?", "Why did you leave in the first place?"],
  ["It is minor in the grand scale of things.", "It is minor in the grand scheme of things."],
  ["A second poem followed in same vein.", "A second poem followed in the same vein."],
  ["Write the sequel in the same vane.", "Write the sequel in the same vein."],
  ["File the incidence report today.", "File the incident report today."],
  ["She initiatively cleaned the lab.", "She proactively cleaned the lab."],
  ["That joke was unsensitive.", "That joke was insensitive."],
  ["The gap seemed unsurmountable.", "The gap seemed insurmountable."],
  ["The logo is inspired from origami.", "The logo is inspired by origami."],
  ["We've go to hurry.", "We've got to hurry."],
  ["It is kinda of odd.", "It is kind of odd."],
  ["I am kind if sleepy now.", "I am kind of sleepy now."],
  ["It looked sort off broken.", "It looked sort of broken."],
];

// Correct forms and look-alikes that stay clean.
const silent = [
  "Try a little of everything on the menu.",
  "The particle moves along time and space.",
  "The ball rolled along timelines drawn on the floor.",
  "That happened a long time ago.",
  "They take advantage a lot of the time.",
  "After while loops end, the program exits.",
  "The clocks go ahead an hour tonight.",
  "She has an in with the director.",
  "The film explores an in group and its rules.",
  "They helped one another an hour later.",
  "We arrive on Monday.",
  "Read it as follow up material.",
  "The tax depends on face value.",
  "I am not in the very least surprised.",
  "Besides the point you raised, the cost is high.",
  "She got the better of him again.",
  "Which is better of the two?",
  "Beware in the dark corners of the web.",
  "The root cause it is hard to find.",
  "What could cause it is unclear.",
  "He was the most curious of the twins.",
  "Do not can the peaches yet.",
  "Children during ages 5 to 10 grow quickly.",
  "A change in route to avoid tolls helped.",
  "We parked at the first place we found.",
  "Turn sort off for this column.",
  "Be kind if possible.",
  "She stays kind if you ask nicely.",
  "He was inspired from an early age.",
  "The shoes fit well and are very good.",
  "We left early because it is cold.",
  "He stood alongside the pier.",
  "Leave by the side streets along side roads.",
  "The museum is comprised of three halls.",
  "Lo and behold, the cat came back.",
];

describe("Review idioms1: fixed expressions and their context", () => {
  test.each(repairs)("%s", (typed, repaired) => {
    expect(repairsOf(typed)).toContain(repaired);
  });

  test.each(silent)("stays silent: %s", (text) => {
    expect(findings(text).map((d) => d.ruleId)).toEqual([]);
  });

  test("frames stay off in other languages", () => {
    const text = "Ich erinnere mich an in Berlin gewesen zu sein.";
    expect(
      review(text, {}, { lang: "de_DE", enabledRules: REVIEW_SUPPORTED_RULE_IDS }).diagnostics,
    ).toEqual([]);
  });

  test("choices are offered when the writer must pick", () => {
    const [finding] = findings("The kit comprises of three tools.");
    expect(finding.requiresChoice).toBe(true);
  });
});
