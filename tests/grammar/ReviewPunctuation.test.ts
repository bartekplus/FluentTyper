import { describe, expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";

// english/punctuation.ts and the date commas of englishNotation. All sentences are our own.
function scan(text: string, rule: string): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "punctuation", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === rule);
}
const fixAll = (text: string, ds: ReviewDiagnostic[]) =>
  applyEdits(
    text,
    ds.flatMap((d) => d.alternatives[0].edits),
  );

describe("englishPunctuation", () => {
  test.each([
    ["See you soon,.", "See you soon."],
    ["Great job,!", "Great job!"],
    ["Ask Ann (or her sister,) first.", "Ask Ann (or her sister), first."],
    ["It is neither hot, nor cold.", "It is neither hot nor cold."],
    ["Do you know, if the shop is open?", "Do you know if the shop is open?"],
    ["Let me know, when you arrive.", "Let me know when you arrive."],
    ["It would be great, if you could call.", "It would be great if you could call."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "englishPunctuation"))).toBe(expected);
  });

  test.each([
    "As you know, if we wait, it melts.",
    "Neither A, B, nor C came.",
    "We bought apples, pears, etc., and left.",
    "Wait, ... what?",
    'He asked "Why?".',
  ])("keeps %p", (text) => {
    expect(scan(text, "englishPunctuation")).toEqual([]);
  });
});

describe("styleIntroductoryComma (optional)", () => {
  test.each([
    ["Nevertheless we kept going.", "Nevertheless, we kept going."],
    ["In addition she paints.", "In addition, she paints."],
    ["However we stayed.", "However, we stayed."],
    ["With it I can draw.", "With it, I can draw."],
    ["If you practice with it you will improve.", "If you practice with it, you will improve."],
    ["If I can I will come.", "If I can, I will come."],
    ["Thanks Maria for the help.", "Thanks, Maria for the help."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "styleIntroductoryComma"))).toBe(expected);
  });

  test.each([
    "However hard we try, it fails.",
    "Also known as Bob.",
    "Give it to me now.",
    "If I can help, call me.",
    "Thanks again for the help.",
  ])("keeps %p", (text) => {
    expect(scan(text, "styleIntroductoryComma")).toEqual([]);
  });
});

describe("styleClauseComma (optional)", () => {
  test.each([
    ["The bus was late and we missed the start.", "The bus was late, and we missed the start."],
    ["I called twice but she never picked up.", "I called twice, but she never picked up."],
    [
      "Our printer jammed again so I fixed it myself.",
      "Our printer jammed again, so I fixed it myself.",
    ],
    [
      "He packed the tent or the kids would complain.",
      "He packed the tent, or the kids would complain.",
    ],
    ["I'm tired but there's still work to do.", "I'm tired, but there's still work to do."],
    ["It rained all week and the river rose fast.", "It rained all week, and the river rose fast."],
    [
      "Thanks for the map and please call when you land.",
      "Thanks for the map, and please call when you land.",
    ],
    ["Is the shop open today or should we wait?", "Is the shop open today, or should we wait?"],
    ["Mia sold her bike and so she walks to work.", "Mia sold her bike, and so she walks to work."],
    ["I liked the film although it ran too long.", "I liked the film, although it ran too long."],
    ["The bus was late wasn't it?", "The bus was late, wasn't it?"],
    ["You won't forget will you?", "You won't forget, will you?"],
    ["Got it thanks.", "Got it, thanks."],
    ["The longer we wait the harder it gets.", "The longer we wait, the harder it gets."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "styleClauseComma"))).toBe(expected);
  });

  test.each([
    "I think Sam and I agree.",
    "Water the plants and you will see buds by June.",
    "Tell me if you go and I will join.",
    "She left early and I did too.",
    "Bring a coat so you can stay warm.",
    "I saved money so that we could travel.",
    "My sister and I painted the fence.",
    "We sang, danced and laughed.",
    "He was tired, and he went home.",
    "Ask whether Ben or Lucy has the key.",
    "Why would they do it?",
    "Guess who is it?",
    "Please tell Ana thanks.",
    "The other the same day left.",
  ])("keeps %p", (text) => {
    expect(scan(text, "styleClauseComma")).toEqual([]);
  });
});

describe("date commas and abbreviations (englishNotation)", () => {
  test.each([
    ["She flew on June 16,1963 alone.", "She flew on June 16, 1963 alone."],
    ["It closed in October, 1958.", "It closed in October 1958."],
    ["He was born October 18 1983 in Ohio.", "He was born October 18, 1983 in Ohio."],
    ["We meet Friday July 15 at noon.", "We meet Friday, July 15 at noon."],
    ["Bring fruit, e. g. apples.", "Bring fruit, e.g. apples."],
    ["Come at 2 o' clock.", "Come at 2 o'clock."],
    ["It starts at 7:45 o'clock.", "It starts at 7:45."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "englishNotation"))).toBe(expected);
  });

  test.each(["We met on June 16, 1963.", "It closed in October 1958.", "Come at 7 o'clock."])(
    "keeps %p",
    (text) => {
      expect(scan(text, "englishNotation")).toEqual([]);
    },
  );
});
