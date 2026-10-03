import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

// english/slipFrames.ts: short slips with a fixed shape. All sentences are our own.
const RULES = new Set([
  "englishConfusedWords",
  "englishSubjectVerbAgreement",
  "englishNounNumber",
  "englishSentenceStructure",
  "englishItsContext",
  "englishAuxiliaryBaseVerb",
  "englishPhraseCorrections",
]);
function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "slip-frames", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["I drove to fast because I was late.", "I drove too fast because I was late."],
  ["The plan came much to soon to work.", "The plan came much too soon to work."],
  ["There is not fast way to do it.", "There is no fast way to do it."],
  ["The tool has not knowledge of the files.", "The tool has no knowledge of the files."],
  ["It ships to more than a 100 countries.", "It ships to more than 100 countries."],
  ["After a two months, we met.", "After two months, we met."],
  ["Someone else walk to the store.", "Someone else walks to the store."],
  ["He going crazy.", "He is going crazy."],
  ["I see that its working in the list.", "I see that it's working in the list."],
  ["Its 2 p.m. here.", "It's 2 p.m. here."],
  ["As usual, the will provide details.", "As usual, they will provide details."],
  ["The really would like to go.", "They really would like to go."],
  ["I really should by Google stock.", "I really should buy Google stock."],
  ["Tell me if it worse or better.", "Tell me if it is worse or better."],
  ["It would cool if you came.", "It would be cool if you came."],
  ["We will significant gains soon.", "We will be significant gains soon."],
  ["This two are the options.", "These two are the options."],
  ["These kind of errors are easy.", "This kind of errors are easy."],
  ["It is right in many way.", "It is right in many ways."],
  ["I carried it in a grocery beg.", "I carried it in a grocery bag."],
  ["It was a serious of events.", "It was a series of events."],
])("repairs %s", (input, expected) => {
  const found = scan(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each([
  "She'd go to just about any show.",
  "Did your work come to much?",
  "I was to trying to help.",
  "It is a ten minutes walk.",
  "She is a 74 years old runner.",
  "You need almost a hundred examples.",
  "We run a 9 pins connector.",
  "Can anybody else check it?",
  "However, its copying in later texts shows its use.",
  "The Don't Quit Podcast.",
  "It was referred to by Tom.",
  "Uncle Ned's Will by Ann.",
  "It will cool to 70 at night.",
  "I would sooner die.",
  "You can cheap out on the gel.",
  "To move a people is hard.",
  "The will of the people is clear.",
  "Make it safe to use.",
  "There is not much time.",
])("leaves %s", (text) => {
  expect(scan(text).map((d) => d.original)).toEqual([]);
});
