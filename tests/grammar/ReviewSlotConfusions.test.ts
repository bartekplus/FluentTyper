import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

const RULES: CatalogRuleId[] = [
  "englishPhraseCorrections",
  "englishContextualCompounds",
  "englishSentenceStructure",
];
function review(text: string, lang = "en_US") {
  return detectReviewDiagnostics(
    { id: "slots", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang, enabledRules: RULES, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics;
}
const repaired = (text: string) =>
  review(text).map((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

test.each([
  ["We moved here four moths ago.", "We moved here four months ago."],
  ["It will be ready in a few moths.", "It will be ready in a few months."],
  ["She barley noticed the noise.", "She barely noticed the noise."],
  ["They could barley see the road.", "They could barely see the road."],
  ["We tried anther approach.", "We tried another approach."],
  ["The wold wide web changed news.", "The world wide web changed news."],
  ["This mans everything to us.", "This means everything to us."],
  ["You can due that tomorrow.", "You can do that tomorrow."],
  ["Due they ship abroad?", "Do they ship abroad?"],
  ["You should us a stronger password.", "You should use a stronger password."],
  ["It event runs on old phones.", "It even runs on old phones."],
  ["Nobody could here us shouting.", "Nobody could hear us shouting."],
  ["Nice to here that you are well.", "Nice to hear that you are well."],
  ["That point bares repeating.", "That point bears repeating."],
  ["We ones lived by the sea.", "We once lived by the sea."],
  ["I sat in he front row.", "I sat in the front row."],
  ["Let's discus the budget today.", "Let's discuss the budget today."],
  ["She discuses the results with us.", "She discusses the results with us."],
  ["Don't loose your ticket.", "Don't lose your ticket."],
  ["He kept loosing track of time.", "He kept losing track of time."],
  ["I was at a lose for words.", "I was at a loss for words."],
  ["We got several complains about it.", "We got several complaints about it."],
  ["The main complain was the price.", "The main complaint was the price."],
  ["He can't swim, yet alone dive.", "He can't swim, let alone dive."],
  ["Of the two plans, the later is cheaper.", "Of the two plans, the latter is cheaper."],
  ["We have all ready paid.", "We have already paid."],
  ["Please attache your receipt.", "Please attach your receipt."],
  ["I knew tat it was late.", "I knew that it was late."],
  ["They have setup the stage.", "They have set up the stage."],
  ["We just backup the files nightly.", "We just back up the files nightly."],
  ["Wait here instead off leaving.", "Wait here instead of leaving."],
  ["He named three basic principals.", "He named three basic principles."],
  ["She met the school principle.", "She met the school principal."],
  ["Kids dislike a tattle-tail.", "Kids dislike a tattle-tale."],
  ["You don't eat meat, are you?", "You don't eat meat, do you?"],
  ["He didn't phone back, was he?", "He didn't phone back, did he?"],
  ["They aren't ready yet, do they?", "They aren't ready yet, are they?"],
  ["I'm not wrong about this, do I?", "I'm not wrong about this, am I?"],
])("repairs %s", (text, fixed) => {
  expect(repaired(text)).toEqual([[fixed]]);
});

test.each([
  "Moths gathered around the porch light.",
  "Two moths flew in last night.",
  "The farm grows barley and oats.",
  "Pollen sits on the anther of the flower.",
  "Sheep grazed on the wold above the village.",
  "The old man's hat blew away.",
  "Rent is due next week.",
  "Due to rain, we stayed in.",
  "She told us the truth.",
  "Please give us the keys.",
  "The event starts at noon.",
  "This event gives us hope.",
  "Come here and sit.",
  "We moved to here from Leeds.",
  "He bared his teeth.",
  "Those ones are mine.",
  "He said he first had to leave.",
  "The athlete threw the discus far.",
  "These screws are loose.",
  "Let the dogs loose in the yard.",
  "Win or lose, we tried.",
  "She always complains about noise.",
  "He is not yet alone in this.",
  "See you later.",
  "The later chapters are better.",
  "Sooner or later the later trains stop.",
  "We are all ready to leave.",
  "The cultural attache arrived.",
  "He has a tat on his arm.",
  "The setup is easy.",
  "First off, thank you.",
  "Fill in any form you like.",
  "The principle of fairness applies.",
  "You don't like it, do you?",
  "I don't know, is it true?",
  "I don't know, is it?",
  "She isn't here, is she?",
  "You don't eat meat, are you sure.",
])("leaves %s", (text) => {
  expect(review(text)).toEqual([]);
});

test("is English only", () => {
  expect(review("We moved here four moths ago.", "de_DE")).toEqual([]);
});
