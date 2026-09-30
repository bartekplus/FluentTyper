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
