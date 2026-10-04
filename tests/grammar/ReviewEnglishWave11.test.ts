import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { ALL_RULES, scan } from "./reviewHarness";

// English fixes of the eleventh LanguageTool parity wave. All sentences are our own. Every
// supported rule runs.
const review = (text: string) =>
  scan(text, { enabledRules: ALL_RULES }).filter(
    (d) => d.category !== "style" && d.ruleId !== "typographicQuotes",
  );
const fixes = (text: string) =>
  review(text).map((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

test("a modal question with a person subject offers only the base verb", () => {
  expect(fixes("When will he arrived?")).toEqual([["When will he arrive?"]]);
  expect(review("When will he arrived?")[0].requiresChoice).toBe(true);
  expect(fixes("Can you elaborated on that?")).toEqual([["Can you elaborate on that?"]]);
  // "it" can still lack a passive be.
  expect(fixes("When will it fixed?")).toEqual([["When will it fix?", "When will it be fixed?"]]);
});

test("please between the subject and the verb", () => {
  expect(fixes("Can you please attached the file?")).toEqual([["Can you please attach the file?"]]);
  expect(fixes("Could you please sent me a copy?")).toEqual([["Could you please send me a copy?"]]);
  for (const text of ["Can you please attach the file?", "They will please customers."])
    expect(review(text)).toEqual([]);
});
