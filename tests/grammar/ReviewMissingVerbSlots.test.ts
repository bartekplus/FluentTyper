import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

const RULES = new Set(["englishSentenceStructure", "englishConfusedWords"]);
function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "be", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}

test("a clause without its verb gets be, and no/not swap where a verb or noun follows", () => {
  for (const [input, expected] of [
    ["It very easy to use.", "It is very easy to use."],
    ["I not sure about that.", "I am not sure about that."],
    ["He a good teacher.", "He is a good teacher."],
    ["This a simple test.", "This is a simple test."],
    ["There a lot of options.", "There are a lot of options."],
    ["Here my new design.", "Here is my new design."],
    ["If there any questions, call me.", "If there are any questions, call me."],
    ["Can we able to fix it?", "Can we be able to fix it?"],
    ["Have you able to finish?", "Have you been able to finish?"],
    ["It would very helpful.", "It would be very helpful."],
    ["She could no hear you.", "She could not hear you."],
    ["I have not idea.", "I have no idea."],
    ["She going to call later.", "She is going to call later."],
    ["We now building a shed.", "We are now building a shed."],
    ["What they doing?", "What are they doing?"],
    ["Honestly, it normal to worry.", "Honestly, it is normal to worry."],
    ["If it dark then the light turns on.", "If it is dark then the light turns on."],
    ["How it possible?", "How is it possible?"],
    ["Lena and I leaving at noon.", "Lena and I are leaving at noon."],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("objects, gapping, idioms and verbs stay silent", () => {
  for (const text of [
    "Make it easy for them.",
    "It being Sunday, we rested.",
    "I can no longer wait.",
    "It does no harm.",
    "There is not a single one.",
    "I have not seen it.",
    "This not only helps us.",
    "Here the road ends.",
    "I found it useful.",
    "It will no doubt rain.",
    "He is no good.",
    "It all started yesterday.",
    "This really works.",
    "I bought a pen and he a ruler.",
    "They thought it a great honor.",
    "There was no stopping him.",
    "It is no easy task.",
    "You dithering fool!",
    "We kindly ask you to wait.",
    "The cooks there are not chefs.",
    "How are Lena and I doing?",
    "I think it fun.",
    "Keep it safe for later.",
    "Lena and I cooking dinner was fun.",
    "The meeting rooms they booking left.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
