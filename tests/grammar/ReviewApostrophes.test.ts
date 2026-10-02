import { describe, expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";

// english/apostrophes.ts: plurals and verbs written with 's, doubled or spaced apostrophes,
// missing possessives, who's/whose. All sentences are our own.
function scan(text: string, rule: string, lang = "en_US"): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "apostrophes", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang,
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === rule);
}
const fixed = (text: string, d: ReviewDiagnostic) => applyEdits(text, d.alternatives[0].edits);

describe("englishApostrophes", () => {
  test.each([
    ["We bought three lamp's for the hall.", "We bought three lamps for the hall."],
    ["She keeps several DVD's in a box.", "She keeps several DVDs in a box."],
    ["Many guest's came late.", "Many guests came late."],
    ["I own 3 bike's and a car.", "I own 3 bikes and a car."],
    ["These reply's are useful.", "These replies are useful."],
    ["Most driver's would stop here.", "Most drivers would stop here."],
    ["I think painter's should rest.", "I think painters should rest."],
    ["She really like's to paint.", "She really likes to paint."],
    ["He watch's the news daily.", "He watches the news daily."],
    ["It work's for me.", "It works for me."],
    ["They''ll arrive soon.", "They'll arrive soon."],
    ["I' m nearly done.", "I'm nearly done."],
    ["Maybe they 're lost.", "Maybe they're lost."],
    ["Anna' s bike broke.", "Anna's bike broke."],
    ["He copied other's homework.", "He copied others' homework."],
    ["Last weeks game was fun.", "Last week's game was fun."],
    ["We cut this years budget.", "We cut this year's budget."],
    ["A driver who's car broke down called.", "A driver whose car broke down called."],
    ["By who's rules do we play?", "By whose rules do we play?"],
  ])("fixes %p", (text, expected) => {
    const [d] = scan(text, "englishApostrophes");
    expect(d).toBeDefined();
    expect(fixed(text, d)).toBe(expected);
  });

  test("a plural before another noun may own it: the writer chooses", () => {
    const [d] = scan("Give two week's warning.", "englishApostrophes");
    expect(d.alternatives.map((a) => a.preview)).toEqual(["weeks'", "weeks"]);
    expect(d.requiresChoice).toBe(true);
  });

  test.each([
    "Many people's lives changed.",
    "That dog's bowl is empty.",
    "They help each other's kids.",
    "The other's coat is red.",
    "In the last weeks we grew.",
    "Last weeks were hard.",
    "Who's coming tonight?",
    "The guy who's friends with Sam left.",
    "The WHO's list is long.",
    "Chapter 2 owner's manual is missing.",
    "Both Sam's and Ann's bikes are new.",
    "Mine is red, and my dad's are blue.",
    "The 1990's were loud.",
    "He gave it Mom's blessing.",
    "Their wiki uses ''italic'' text.",
  ])("keeps %p", (text) => {
    expect(scan(text, "englishApostrophes")).toEqual([]);
  });

  test("is English only", () => {
    expect(scan("We bought three lamp's.", "englishApostrophes", "de_DE")).toEqual([]);
  });
});
