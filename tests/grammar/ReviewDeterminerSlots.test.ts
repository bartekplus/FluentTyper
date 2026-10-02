import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { englishVerbNouns } from "../../src/core/domain/grammar/implementations/helpers/EnglishLexicon";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "determiners", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishConfusedWords");
}

test("the lexicon derives -ion and -ment nouns from flagged verbs", () => {
  expect(englishVerbNouns("translate")).toEqual(["translation"]);
  expect(englishVerbNouns("improve")).toEqual(["improvement"]);
  expect(englishVerbNouns("table")).toEqual([]);
});

test("a determiner before a bare verb or a verb phrase is repaired", () => {
  for (const [input, expected] of [
    ["The translate into French took a week.", "The translation into French took a week."],
    ["We admired the protect of the old forest.", "We admired the protection of the old forest."],
    ["The cannot attend tomorrow.", "They cannot attend tomorrow."],
    ["The will bring snacks.", "They will bring snacks."],
    ["If the hired a guide, they would know.", "If they hired a guide, they would know."],
    ["The also sell bread.", "They also sell bread."],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("nouns, compounds and participle adjectives stay silent", () => {
  for (const text of [
    "The will states that the house goes to her.",
    "The can opener is broken.",
    "The must have gadget sold out.",
    "The seriously injured man recovered.",
    "The widely praised film won.",
    "He is in the know.",
    "The install script failed.",
    "Let her decide.",
    "The allowed amount is small.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
