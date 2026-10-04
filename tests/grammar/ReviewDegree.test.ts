import { expect, test } from "bun:test";
import {
  prepareReview,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
import { scan as reviewScan } from "./reviewHarness";
const rule = "englishDoubledDegree";
function all(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return reviewScan(text, { ...options, snapshot: extra });
}
const scan = (text: string) => all(text).filter((d) => d.ruleId === rule);
const repairs: [string, string][] = [
  ["This approach is more easier to test.", "This approach is easier to test."],
  ["The revised result is more better.", "The revised result is better."],
  ["This route is more faster than before.", "This route is faster than before."],
  ["The device was more slower than expected.", "The device was slower than expected."],
  ["This model is more larger than the old model.", "This model is larger than the old model."],
  ["That version is more smaller than our version.", "That version is smaller than our version."],
  [
    "The answer is more worse than the previous answer.",
    "The answer is worse than the previous answer.",
  ],
  ["This device is more newer than your device.", "This device is newer than your device."],
  ["That model was more older than my model.", "That model was older than my model."],
  ["The option is more cheaper than 100.", "The option is cheaper than 100."],
  ["This route is more safer to use.", "This route is safer to use."],
  ["It was more easier to build.", "It was easier to build."],
  ["This is the most fastest option.", "This is the fastest option."],
  ["That was the most slowest route.", "That was the slowest route."],
  ["It is the most largest device.", "It is the largest device."],
  ["This is the most smallest model.", "This is the smallest model."],
  ["The revised result is the most best result.", "The revised result is the best result."],
  ["This was the most worst answer.", "This was the worst answer."],
  ["That is the most newest version.", "That is the newest version."],
  ["This device is the most oldest device.", "This device is the oldest device."],
  ["The plan is the most cheapest solution.", "The plan is the cheapest solution."],
  ["It was the most safest method.", "It was the safest method."],
  ["This is the most easiest test.", "This is the easiest test."],
  ["The option was the most fastest approach.", "The option was the fastest approach."],
];
test.each(repairs)("doubled degree repair %s", (source, expected) => {
  const findings = scan(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.original).toBe(source.slice(d.range.start, d.range.end));
  expect(d.bulk.eligible).toBe(false);
  expect(d.alternatives).toHaveLength(1);
  expect(d.context.start).toBeLessThan(d.range.start);
  expect(d.context.end).toBeGreaterThanOrEqual(d.range.end);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});
const valid = [
  "This is more likely to work.",
  "We need more better-quality components.",
  "It is getting better and better.",
  "The result is far better.",
  "We hired more engineers.",
  "This route is less expensive.",
  'Do not write "more better".',
  "The result is very unique.",
  "This is absolutely perfect.",
  "This is the very best option.",
  "The result is much better.",
  "This is even better than before.",
  "This route is slightly safer.",
  "The device is more energy efficient.",
  "The result is more up to date.",
  "We need more older workers.",
  "We bought more cheaper devices.",
  "More better results",
  "The most fastest options",
  "This approach is more easier-looking.",
  "The result is more better-quality.",
  "This is the most fastest-growing option.",
  "This is the most talented engineer.",
  "The answer is most helpful.",
  "This is more bitter.",
  "This is the most honest answer.",
  "This result is better than the old result.",
  "This is the fastest option.",
  "The model is older.",
  "This is more easier to unknownword.",
  "The approach is more easier than",
  "This is the most fastest unknownword.",
  "The result is more betterment.",
  "This is the most fastest_id option.",
  "This is more better.example",
  "This is more betteŕ.",
  "This is more Better.",
  "This is more bEtter.",
  "This is MORE BETTER.",
  "This is the most Fastest option.",
  "This is the Most fastest option.",
  "This is the most fastestMode option.",
  "This result is more\nbetter.",
  "This is the most\nfastest option.",
  "This is more `better`.",
  "`This is more better.`",
  'The phrase "This is more better." is quoted.',
  'The heading "This is the most fastest option." is reproduced.',
  'The label is "The result is more better."',
  'Write "This approach is more easier to test." exactly.',
  "The word better is comparative.",
  "We need more Better products.",
  "This is more easier than 1,000.",
  "This is more easier than 1," + " ".repeat(200) + "000.",
  "This is more easier than 1.5.",
  "This is more easier than 10ms.",
  "This is more easier than 10_id.",
  "This is more easier than 10/2.",
  "This is more easier than 10-20.",
];
test.each(valid)("doubled degree preserves %s", (text) => expect(scan(text)).toEqual([]));
test("degree checks retain boundaries, dictionary protections and individual scope", () => {
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
  for (const [text] of [repairs[0], repairs[12]]) {
    const d = scan(text)[0];
    const only = (extra: Partial<ReviewSourceSnapshot>, options: Partial<ReviewOptions> = {}) =>
      all(text, extra, { enabledRules: [rule], ...options });
    expect(only({}, { lang: "fr_FR" })).toEqual([]);
    expect(only({}, { userDictionary: [d.original.split(" ")[1]] })).toEqual([]);
    expect(only({ protectedRanges: [{ ...d.range, reason: "structure" }] })).toEqual([]);
    expect(only({ scope: { start: d.range.start + 1, end: d.range.end } })).toEqual([]);
    expect(only({ scope: d.range })).toHaveLength(1);
    expect(only({ id: "next" })[0].id).not.toBe(d.id);
  }
  expect(scan("This is more\uFFFC better.")).toEqual([]);
  const text = "This is more\tbetter.";
  const d = scan(text)[0];
  expect(applyEdits(text, d.alternatives[0].edits)).toBe("This is better.");
});
test("degree repairs recheck then-than against the new snapshot", () => {
  const source = "The result is more better then the old result.";
  const first = all(source);
  expect(first.filter((d) => d.ruleId === "englishThenThan")).toEqual([]);
  const degree = first.find((d) => d.ruleId === rule)!;
  const repaired = applyEdits(source, degree.alternatives[0].edits);
  const after = all(repaired, { id: "next" });
  expect(after.filter((d) => d.ruleId === rule)).toEqual([]);
  const than = after.find((d) => d.ruleId === "englishThenThan")!;
  expect(than.original).toBe("then");
  expect(applyEdits(repaired, than.alternatives[0].edits)).toBe(
    "The result is better than the old result.",
  );
});
test("degree findings own one chunk in Unicode and ordinary quoted prose", () => {
  const text = '😀 Café.\r\nShe said, "This is more better." This is the most fastest option.';
  const prepared = prepareReview(
    { id: "chunks", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang: "en_US", enabledRules: [rule], userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  const expected = scan(text);
  expect(expected).toHaveLength(2);
  for (let cut = 1; cut < text.length; cut++) {
    const raw = [
      ...scanReviewChunk(prepared, { start: 0, end: cut }).findings,
      ...scanReviewChunk(prepared, { start: cut, end: text.length }).findings,
    ].sort((a, b) => a.range.start - b.range.start);
    expect(raw.map((d) => [d.range, text.slice(d.range.start, d.range.end)])).toEqual(
      expected.map((d) => [d.range, d.original]),
    );
  }
});
