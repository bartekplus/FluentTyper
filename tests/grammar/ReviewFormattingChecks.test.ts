import { describe, expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

function review(text: string, ruleId: CatalogRuleId, lang = "en_US") {
  return detectReviewDiagnostics(
    { id: "format", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: [...reviewRuleIds({ codeMode: false }), ruleId],
      lang,
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

/** The text with every finding's first alternative applied. */
function repaired(text: string, ruleId: CatalogRuleId, lang = "en_US"): string {
  return applyEdits(
    text,
    review(text, ruleId, lang).flatMap((d) => d.alternatives[0].edits),
  );
}

describe("comma fixes (commaPeriodSpacing)", () => {
  const rule = "commaPeriodSpacing";
  test.each([
    ["Pack the tent ,stove and map.", "Pack the tent, stove and map."],
    ["Bring tea ，milk and bread.", "Bring tea, milk and bread."],
    ["Colors: red，green、blue.", "Colors: red, green, blue."],
    ["Call Anna， then leave.", "Call Anna, then leave."],
    ["😀 Done、 thanks.", "😀 Done, thanks."],
    ["Tick 3，4 and 5.", "Tick 3, 4 and 5."],
    ["Ναι，εντάξει.", "Ναι, εντάξει."],
    ["Oui ，merci.", "Oui, merci."],
    ["It ends here，\nthen more.", "It ends here,\nthen more."],
  ])("repairs %p", (input, expected) => {
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each([
    "東京、大阪、京都に行きました。",
    "我们去了北京，然后回家。",
    "Mix ASCII、日本語 here.",
    "Lists use a , b rarely.",
    "Numbers like 1,000 stay.",
  ])("keeps %p", (input) => {
    expect(
      review(input, rule)
        .filter((d) => /[，、]/.test(d.original))
        .map((d) => d.original),
    ).toEqual([]);
  });

  test("a wide comma is batched", () => {
    expect(review("tea，milk", rule)[0].bulk).toEqual({ eligible: true, alternative: 0 });
  });
});

describe("ordinal suffix casing (englishOrdinalSuffix)", () => {
  const rule = "englishOrdinalSuffix";
  test.each([
    ["She finished 2ND in the race.", "She finished 2nd in the race."],
    ["Our 3Rd attempt worked.", "Our 3rd attempt worked."],
    ["It is the 21sT time.", "It is the 21st time."],
    ["😀 the 11TH hour", "😀 the 11th hour"],
    ["(4TH floor)", "(4th floor)"],
    ["We placed 102nD overall.", "We placed 102nd overall."],
  ])("repairs %p", (input, expected) => {
    const findings = review(input, rule);
    expect(findings.map((d) => d.bulk)).toEqual([{ eligible: false, reason: "context-dependent" }]);
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each([
    "THE 3RD ROUND",
    "Turn left on 42RD today.",
    "Meet at 5TH AVE tonight.",
    "the 2nd round",
    "He is 16rd long.",
    'Never write "2ND" there.',
  ])("keeps %p", (input) => {
    expect(review(input, rule)).toEqual([]);
  });

  test("still fixes a wrong lowercase suffix", () => {
    expect(repaired("the 101nd run", rule)).toBe("the 101st run");
  });
});

describe("apostrophe look-alikes (englishContractionNormalization)", () => {
  const rule = "englishContractionNormalization";
  test.each([
    ["We don´t know yet.", "We don't know yet.", true],
    ["I´m on my way.", "I'm on my way.", true],
    ["The team´s plan works.", "The team's plan works.", true],
    ["THEY´RE LATE.", "THEY'RE LATE.", true],
    ["😀 You´ll see.", "😀 You'll see.", true],
    ["It doesn`t matter.", "It doesn't matter.", false],
    ["Sorry, I can;t come.", "Sorry, I can't come.", false],
    ["Let;s go home.", "Let's go home.", false],
    ["I think we;ve met.", "I think we've met.", false],
    ["She said it’s fine but won´t stay.", "She said it’s fine but won’t stay.", true],
  ])("repairs %p", (input, expected, batched) => {
    const found = review(input, rule);
    expect(found).toHaveLength(1);
    expect(found[0].bulk.eligible).toBe(batched);
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each([
    "We don't know yet.",
    "Run `git`s help.",
    "Use a;s as a separator.",
    "Values: x;t and y;s.",
    "The sign ´ alone.",
    'Never write "don´t" like that.',
  ])("keeps %p", (input) => {
    expect(review(input, rule)).toEqual([]);
  });
});

describe("kelvin degree sign (measurementUnitFormatting)", () => {
  const rule = "measurementUnitFormatting";
  test.each([
    ["The sample sat at 77°K overnight.", "The sample sat at 77 K overnight."],
    ["Space is about 3 °K cold.", "Space is about 3 K cold."],
    ["😀 Set it to 300°K.", "😀 Set it to 300 K."],
    ["Temperatures (°K) are listed.", "Temperatures (K) are listed."],
  ])("repairs %p", (input, expected) => {
    expect(repaired(input, rule)).toBe(expected);
  });

  test.each(["It is 300 K now.", "Use °Kelvin rarely.", "Heat to 20 °C.", "Code x°K2 here."])(
    "keeps %p",
    (input) => {
      expect(review(input, rule)).toEqual([]);
    },
  );
});

describe("ellipsis length (duplicatePunctuationCollapse)", () => {
  const rule = "duplicatePunctuationCollapse";
  test.each([
    ["So..... anyway, we left.", "So... anyway, we left."],
    ["The line went dead......", "The line went dead..."],
    ["Well.... maybe tomorrow.", "Well... maybe tomorrow."],
    ["😀 Hmm..... fine.", "😀 Hmm... fine."],
    ["“Later.....” she said.", "“Later...” she said."],
    ["Alors..... on y va ?", "Alors... on y va ?"],
  ])("repairs %p", (input, expected) => {
    expect(repaired(input, rule)).toBe(expected);
  });

  test("five or more dots are batched; four dots stay individual", () => {
    expect(review("It stopped..... then", rule)[0].bulk).toEqual({
      eligible: true,
      alternative: 0,
    });
    expect(review("It stopped.... then", rule)[0].bulk).toEqual({
      eligible: false,
      reason: "context-dependent",
    });
  });

  // "word.." is one period too many, not a short ellipsis.
  test.each([
    "It went quiet... then loud.",
    "Intro .......... 3",
    "Rows 2....7 are empty.",
    "Open ..../cache first.",
    "It ended ….",
  ])("keeps %p", (input) => {
    expect(review(input, rule).filter((d) => d.original.length > 2)).toEqual([]);
  });
});
