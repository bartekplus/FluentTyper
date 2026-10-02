import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "agreement", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishSubjectVerbAgreement");
}

test("a noun-phrase subject agrees with its verb", () => {
  for (const [input, expected] of [
    ["The kids is outside.", "The kids are outside."],
    ["My parents was here yesterday.", "My parents were here yesterday."],
    ["The dog are hungry.", "The dog is hungry."],
    ["The leaves of the tree is yellow.", "The leaves of the tree are yellow."],
    ["Some people thinks so.", "Some people think so."],
    ["These includes a manual.", "These include a manual."],
    ["This are my notes.", "These are my notes."],
    ["Has your parents called?", "Have your parents called?"],
    ["Where is your keys?", "Where are your keys?"],
    ["Does you like it?", "Do you like it?"],
    ["Does anyone knows the answer?", "Does anyone know the answer?"],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("collectives, objects, subjunctives and compound nouns stay silent", () => {
  for (const text of [
    "The dog barks at night.",
    "The team are winning.",
    "The news is good.",
    "The users settings page loads.",
    "A people that loses its past suffers.",
    "This means trouble.",
    "Do your homework.",
    "The police are here.",
    "Meeting new people is fun.",
    "How many people does it take?",
    "If the county were to build it, we would go.",
    "The rich are not always happy.",
    "The solvents present in the glue are toxic.",
    "My three cats are asleep.",
    "The public demands answers.",
    "Those flips you did were great.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
