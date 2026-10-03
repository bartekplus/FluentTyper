import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan } from "./reviewHarness";

function scan(text: string) {
  return reviewScan(text).filter((d) => d.ruleId === "englishVerbComplements");
}

test("verb complements take the form their head verb needs", () => {
  for (const [input, expected] of [
    ["I want go home.", "I want to go home."],
    ["You should try use a VPN.", "You should try to use a VPN."],
    ["We need talk to the landlord.", "We need to talk to the landlord."],
    ["He really needs fix the roof.", "He really needs to fix the roof."],
    ["They just want be left alone.", "They just want to be left alone."],
    ["We like cook them on Sundays.", "We like to cook them on Sundays."],
    ["They don't like paint the fence.", "They don't like to paint the fence."],
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
    "I like fish a lot.",
    "She likes cake a whole lot.",
    "Why would love make us happy?",
    "I love stand up comedians.",
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
    "I want work in Berlin.",
    "We need help the most.",
    "Just like magic.",
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
