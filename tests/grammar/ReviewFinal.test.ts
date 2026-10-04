import { expect, test } from "bun:test";
import {
  REVIEW_RULE_METADATA,
  reviewRuleIds,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { review as runReview } from "./grammarTestUtils";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

// The last fixes, the opt-in possible-mistakes check and the opt-in alternative phrasing.
// All sentences are our own.
const POSSIBLE: CatalogRuleId = "englishPossibleErrors";
const ALTERNATIVE: CatalogRuleId = "styleAlternativePhrasing";
const DEFAULTS = reviewRuleIds({ codeMode: false });

const review = (text: string, rules: readonly CatalogRuleId[]) =>
  runReview(text, {}, { enabledRules: rules }).diagnostics;
/** Each finding of `rule`: its offered repairs, each applied to the whole text. */
const repaired = (text: string, rule: CatalogRuleId, rules: readonly CatalogRuleId[] = [rule]) =>
  review(text, rules)
    .filter((d) => d.ruleId === rule)
    .map((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

test("the new checks are opt-in", () => {
  expect(REVIEW_RULE_METADATA[POSSIBLE]).toMatchObject({ defaultEnabled: false });
  expect(REVIEW_RULE_METADATA[ALTERNATIVE]).toMatchObject({ defaultEnabled: false });
  expect(DEFAULTS).not.toContain(POSSIBLE);
  expect(DEFAULTS).not.toContain(ALTERNATIVE);
});

// Default rules: [rule, typed, repairs of each finding]
const defaults: [CatalogRuleId, string, string[][]][] = [
  [
    "englishPossessiveNouns",
    "The musics rhythm was slow.",
    [["The music's rhythm was slow.", "The musics' rhythm was slow."]],
  ],
  // A backtick inside a word is a mistyped apostrophe, not a code span.
  [
    "englishContractionNormalization",
    "She Can`T Come, They`Re Busy.",
    [["She Can'T Come, They`Re Busy."], ["She Can`T Come, They'Re Busy."]],
  ],
  // One slash before a word inside a sentence is a typo, not a path.
  [
    "englishPhraseCorrections",
    "It was a /backhand compliment from him.",
    [["It was a /backhanded compliment from him."]],
  ],
];

test.each(defaults)("%s fixes %p", (rule, typed, repairs) => {
  expect(repaired(typed, rule, DEFAULTS)).toEqual(repairs);
});

// [typed, repairs of each englishPossibleErrors finding]
const possibles: [string, string[][]][] = [
  ["We finished 3rd and 22st.", [["We finished 3rd and 22nd."]]],
  ["The 1011rd visitor won.", [["The 1011th visitor won."]]],
  ["Their three seats left.", [["There are three seats left."]]],
  ["The reason it is obvious.", [["The reason is obvious."]]],
  ["The cause it was simple.", [["The cause was simple.", "Because it was simple."]]],
  [
    "Noise can cause it is hard to say.",
    [["That noise can cause it is hard to say.", "Noise can cause it, which is hard to say."]],
  ],
  [
    "The farmer fixed fence in yard.",
    [
      ["The farmer fixed a fence in yard.", "The farmer fixed the fence in yard."],
      ["The farmer fixed fence in the yard."],
    ],
  ],
  [
    "The boy kicked ball outside.",
    [["The boy kicked a ball outside.", "The boy kicked the ball outside."]],
  ],
  ["We have training tonight.", [["We are training tonight.", "We have been training tonight."]]],
  ["The engine won't quiet.", [["The engine won't quite."]]],
  ["Nobody could do more good.", [["Nobody could do better."]]],
  [
    "Buyers usually sort after the price.",
    [["Buyers usually sought after the price.", "Buyers usually sort by the price."]],
  ],
  ["The bot will scrap pages daily.", [["The bot will scrape pages daily."]]],
  ["We write notes in markdown.", [["We write notes in Markdown."]]],
  ["He needs leave soon.", [["He needs to leave soon."]]],
  [
    "We stopped since affect was gone.",
    [["We stopped since effect was gone.", "We stopped since the effect was gone."]],
  ],
  ["This scale lets you weight letters.", [["This scale lets you weigh letters."]]],
  ["You cars are here.", [["Your cars are here."]]],
  ["You boxes are here.", [["Your boxes are here.", "You box are here."]]],
  ["The Garcia's dog barked.", [["Garcia's dog barked."]]],
  // Random capitals hide a default check: read lowercased, it applies.
  ["We HoP you like it.", [["We hope you like it."]]],
  // Quoted wording is read too.
  ['He said "chalk full of toys" twice.', [['He said "chock-full of toys" twice.']]],
  ["The phrase 'bare with me' is wrong.", [["The phrase 'bear with me' is wrong."]]],
];

test.each(possibles)("possible mistake in %p", (typed, repairs) => {
  expect(repaired(typed, POSSIBLE)).toEqual(repairs);
});

const possibleSilent = [
  "We finished 1st, 2nd and 3rd.",
  "He weighs 11st 4lb.",
  "Their two sons left early yesterday.",
  "The cause it is fighting for is noble.",
  "My brother is tall.",
  "Stress can cause it to fail.",
  "The farmer fixed a fence in the yard.",
  "The child went to bed early.",
  "The team found work in town.",
  "We have been writing today.",
  "They have sleeping today.",
  "It doesn't quite work.",
  "The crowd doesn't quiet down.",
  "You can do more good than harm.",
  "Sort after the join finishes.",
  "They scrapped the old plan.",
  "There is a big markdown on shoes.",
  "She wants food today.",
  "The effect was gone.",
  "Weigh the letters first.",
  "You see the boxes.",
  "The Hague's courts are busy.",
  "The Smith family's dog barked.",
  "Buy an iPhone, not a PoC.",
  "He said “bear with me” twice.",
];

test.each(possibleSilent)("possible mistakes stay silent on %p", (typed) => {
  expect(repaired(typed, POSSIBLE)).toEqual([]);
});

// [typed, repairs of each styleAlternativePhrasing finding]
const alternatives: [string, string[][]][] = [
  ["You have another think coming.", [["You have another thing coming."]]],
  ["I should never have said it.", [["I never should have said it."]]],
  ["These maps are out of date.", [["These maps are out-of-date."]]],
  ["Install the Chrome extension.", [["Install the Chrome Extension."]]],
];

test.each(alternatives)("alternative form of %p", (typed, repairs) => {
  expect(repaired(typed, ALTERNATIVE)).toEqual(repairs);
});

const alternativeSilent = [
  "You have another thing coming.",
  "I never should have said it.",
  "An out-of-date map misleads.",
  "Install the Chrome Extension.",
];

test.each(alternativeSilent)("alternative phrasing stays silent on %p", (typed) => {
  expect(repaired(typed, ALTERNATIVE)).toEqual([]);
});

test("the default rules leave the look-alikes alone", () => {
  for (const typed of [
    "The physics lab is closed.",
    "Use `Option`s and `Vec`s here.",
    "Run cd /home then ls.",
    "Type /help to list commands.",
    ...possibleSilent,
  ])
    expect(review(typed, DEFAULTS).map((d) => d.ruleId)).not.toContain(POSSIBLE);
  expect(repaired("Run it from /usr/local today.", "englishPhraseCorrections", DEFAULTS)).toEqual(
    [],
  );
});
