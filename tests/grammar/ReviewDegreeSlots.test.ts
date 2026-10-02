import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "degree", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishToToo");
}

test("to before a closing degree phrase becomes too", () => {
  for (const [input, expected] of [
    ["The soup is to hot to eat.", "The soup is too hot to eat."],
    ["I think it's probably to old.", "I think it's probably too old."],
    ["The coat was way to big for him.", "The coat was way too big for him."],
    ["They charge to much.", "They charge too much."],
    ["He left to soon.", "He left too soon."],
    ["Stop trying to hard.", "Stop trying too hard."],
    ["Rent went up 20 percent to high.", "Rent went up 20 percent too high."],
    ["We arrived three days to late.", "We arrived three days too late."],
    ["She has to much work.", "She has too much work."],
    [
      "Because to much water was spilled, we mopped.",
      "Because too much water was spilled, we mopped.",
    ],
    ["I ate two much cake.", "I ate too much cake."],
    ["I had one to many coffees.", "I had one too many coffees."],
    ["To bad that you missed it.", "Too bad that you missed it."],
    ["The shop is not to far from here.", "The shop is not too far from here."],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("to as a preposition or infinitive marker stays", () => {
  for (const text of [
    "His plans never came to much.",
    "Her savings amount to much.",
    "I set the volume to high.",
    "The ratio dropped from early to late.",
    "He has been to far more cities than me.",
    "This led to much debate.",
    "We are to blame.",
    "Here is to happy days.",
    "To new beginnings!",
    "The two much bigger rooms were taken.",
    "It is a one to many relationship.",
    "The goal is to soon launch the app.",
    "The light is back to normal.",
    "It's close to midnight.",
    "The forecast went from cool to cold.",
    "She is to perform tonight.",
    "I was to trying to help.",
    "We gave to many charities.",
    "The town became to one family.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
