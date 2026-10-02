import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "complements", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishVerbComplements");
}

test("verb complements take the form their head verb needs", () => {
  for (const [input, expected] of [
    ["I want go home.", "I want to go home."],
    ["She needs be there by noon.", "She needs to be there by noon."],
    ["Let's try fix it together.", "Let's try to fix it together."],
    ["We can't afford hiring more staff.", "We can't afford to hire more staff."],
    ["I enjoy to swim in the lake.", "I enjoy swimming in the lake."],
    ["We avoided to mention it.", "We avoided mentioning it."],
    ["We are used to eat late.", "We are used to eating late."],
    ["It's easy get lost here.", "It's easy to get lost here."],
    ["I'd be happy help you.", "I'd be happy to help you."],
    ["He wants that I call him.", "He wants me to call him."],
    ["I look forward hearing from you.", "I look forward to hearing from you."],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("nouns, relative clauses, passives and idioms stay silent", () => {
  for (const text of [
    "I need help with this.",
    "It looks like rain.",
    "For want of a nail.",
    "The need arose.",
    "I like cats.",
    "It is considered to be the best.",
    "This tool is used to test code.",
    "I regret to inform you.",
    "It is good work.",
    "Keep to the left.",
    "I want that book.",
    "Our needs grow each year.",
    "The ones you love leave too soon.",
    "Pick the plans you want using the filter.",
    "If need be, we can wait.",
    "Why would love make us happy?",
    "The belt wants replacing.",
    "It's high time we left.",
    "Any feedback would be great thank you.",
    "The documents that the managers need include a form.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
