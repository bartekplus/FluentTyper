import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function review(text: string, lang = "en_US") {
  return detectReviewDiagnostics(
    { id: "gb", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang,
      enabledRules: ["englishBritishSpelling"],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
}
const repaired = (text: string) =>
  review(text).map((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

test.each([
  ["Cut a 3-meter length of pipe.", "Cut a 3-metre length of pipe."],
  ["The lake is 40 meters deep.", "The lake is 40 metres deep."],
  ["Add 2 liters of stock.", "Add 2 litres of stock."],
  ["They walked 5 kilometers home.", "They walked 5 kilometres home."],
  ["Her car's trunk was full of shopping.", "Her car's boot was full of shopping."],
  ["Bring your license tomorrow.", "Bring your licence tomorrow."],
  ["We rent an apartment near the park.", "We rent a flat near the park."],
  ["Prices have gotten higher.", "Prices have got higher."],
  ["She is taking a nap upstairs.", "She is having a nap upstairs."],
  ["The air plane landed late.", "The aeroplane landed late."],
])("repairs %s", (text, fixed) => {
  expect(repaired(text)).toEqual([[fixed]]);
});

test.each([
  "The water meter needs reading.",
  "A tree trunk blocked the road.",
  "Pack your swimming trunks.",
  "They license their software widely.",
  "Measure it in meters, not feet.",
  "The elephant raised its trunk.",
])("leaves %s", (text) => {
  expect(review(text)).toEqual([]);
});

test("is English only", () => {
  expect(review("Cut a 3-meter length of pipe.", "fr_FR")).toEqual([]);
});
