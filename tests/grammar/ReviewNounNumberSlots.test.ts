import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { englishNounPair } from "../../src/core/domain/grammar/implementations/helpers/EnglishLexicon";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "number", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishNounNumber");
}

test("the lexicon pairs regular singular and plural nouns", () => {
  expect(englishNounPair("issue")).toEqual({ singular: "issue", plural: "issues" });
  expect(englishNounPair("boxes")).toEqual({ singular: "box", plural: "boxes" });
  expect(englishNounPair("quickly")).toBeNull();
});

test("noun number follows its determiner or count", () => {
  for (const [input, expected] of [
    ["That was a strange results of the test.", "That was a strange result of the test."],
    ["Many child were waiting.", "Many children were waiting."],
    ["We tested several option.", "We tested several options."],
    ["These error are annoying.", "These errors are annoying."],
    ["Each students has a badge.", "Each student has a badge."],
    ["I waited a three hours for the bus.", "I waited three hours for the bus."],
    ["There were too much cars on the road.", "There were too many cars on the road."],
    ["Other might disagree.", "Others might disagree."],
    ["I wonder what other think.", "I wonder what others think."],
    ["Three of my neighbor have dogs.", "Three of my neighbors have dogs."],
    ["That is hardly a new ideas.", "That is hardly a new idea."],
    ["She had a questions about the fee.", "She had a question about the fee."],
    ["It was a good suggestions.", "It was a good suggestion."],
    ["Only a weeks later, it snowed.", "Only a week later, it snowed."],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("compounds, pronoun counts and invariant nouns keep their number", () => {
  for (const text of [
    "A dog walks into a bar.",
    "We heard how a dog barks.",
    "A round costs ten dollars.",
    "Watch how a young bird flies.",
    "The program has a sales team.",
    "It is a means to an end.",
    "She gave a big thanks to everyone.",
    "We need a hundred volunteers.",
    "Many believe it is true.",
    "These help a lot.",
    "Every few days the price changes.",
    "They each took a slice.",
    "On the other hand, it works.",
    "This means trouble.",
    "We have a five star hotel.",
    "He is a two year old boy.",
    "Much remains to be done.",
    "A great many people came.",
    "Each of the tests passed.",
    "Among other things, he sings.",
    "His remarks were a series of jokes.",
    "It was a problem students kept raising.",
    "A fish swims in the tank.",
    "Thank you so much guys!",
    "The storm hit force 9 winds.",
    "You two look tired.",
    "One of the jury spoke.",
    "Worth a 1000 words.",
    "He took the car a few miles further.",
    "We spent a few days there.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
