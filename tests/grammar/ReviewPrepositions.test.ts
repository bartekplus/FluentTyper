import { expect, test } from "bun:test";
import {
  detectReviewDiagnostics,
  prepareReview,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
const rule = "englishFixedPrepositions";
function scan(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    {
      id: "prepositions",
      text,
      scope: { start: 0, end: text.length },
      protectedRanges: [],
      ...extra,
    },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      ...options,
    },
  ).diagnostics.filter((d) => d.ruleId === rule);
}
const errors: [string, string][] = [
  ["Despite of the delay, we finished.", "Despite the delay, we finished."],
  ["We walked despite of the heavy rain.", "We walked despite the heavy rain."],
  ["Despite of the loud noise, I slept.", "Despite the loud noise, I slept."],
  ["Despite of the bad weather, we went out.", "Despite the bad weather, we went out."],
  ["Despite of this problem, it works.", "Despite this problem, it works."],
  ["He continued despite of that warning.", "He continued despite that warning."],
  ["Despite of the high risk, she agreed.", "Despite the high risk, she agreed."],
  ["We bought it despite of the high cost.", "We bought it despite the high cost."],
  ["Despite of the pressure, we stayed calm.", "Despite the pressure, we stayed calm."],
  ["They played despite of the heat.", "They played despite the heat."],
  ["Despite of the cold, he swam.", "Despite the cold, he swam."],
  ["We arrived despite of the traffic.", "We arrived despite the traffic."],
  ["We discussed about the release.", "We discussed the release."],
  ["They discuss about our plan.", "They discuss our plan."],
  ["She discusses about the report.", "She discusses the report."],
  ["I am discussing about this problem.", "I am discussing this problem."],
  ["He is discussing about the proposal.", "He is discussing the proposal."],
  ["We are discussing about their results.", "We are discussing their results."],
  ["They were discussing about the schedule.", "They were discussing the schedule."],
  ["She was discussing about the budget.", "She was discussing the budget."],
  ["Please discuss about our new design.", "Please discuss our new design."],
  ["You discussed about that issue.", "You discussed that issue."],
  ["We discussed about the proposed changes.", "We discussed the proposed changes."],
  ["I discussed about your project.", "I discussed your project."],
  ["I am interested on learning Rust.", "I am interested in learning Rust."],
  ["She is interested on learning English.", "She is interested in learning English."],
  ["They are interested on learning French.", "They are interested in learning French."],
  ["We were interested on learning Python.", "We were interested in learning Python."],
  ["He was interested on learning TypeScript.", "He was interested in learning TypeScript."],
  ["You are interested on writing code.", "You are interested in writing code."],
  ["I am interested on reading books.", "I am interested in reading books."],
  ["She is interested on playing chess.", "She is interested in playing chess."],
  ["They are interested on building apps.", "They are interested in building apps."],
  ["We are interested on testing software.", "We are interested in testing software."],
  ["He is interested on the new release.", "He is interested in the new release."],
  ["I am interested on your project.", "I am interested in your project."],
];
test.each(errors)("fixed prepositions repair %s", (source, expected) => {
  const findings = scan(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.original).toBe(source.slice(d.range.start, d.range.end));
  expect(d.bulk.eligible).toBe(false);
  expect(d.alternatives[0].edits).toHaveLength(1);
  expect(d.context.start).toBeLessThan(d.range.start);
  expect(d.context.end).toBeGreaterThan(d.range.end);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});
const valid = [
  "In spite of the delay, we finished.",
  "Despite the rain, we walked.",
  "Despite this warning, he continued.",
  "The word despite is a preposition.",
  "Despite of",
  "Despite of the",
  "Despite of an unknownword.",
  'The example "Despite of the delay, we finished." is incorrect.',
  'Type "despite of the rain." exactly.',
  "`Despite of the delay, we finished.`",
  "Despite\nof the delay, we finished.",
  "Despite of\nthe rain, we walked.",
  "Despite of the delay.file",
  "Despite of the delay_name",
  "Despite of the delaý, we left.",
  "We were tired of the delay.",
  "Because of the rain, we stayed.",
  "The cost of the delay was high.",
  "She spoke of the weather.",
  "He was aware of the risk.",
  "Despite of the",
  "Despite of what he said, we stayed.",
  "We read Despite of the Delay by an unknown author.",
  "Despite.of the delay",
  "@despite of the delay.",
  "We talked about the release.",
  "We asked about the release.",
  "We discussed what the book was about.",
  'Please discuss the word "about".',
  "We discussed the release.",
  "They discuss our plan.",
  "The discussion about the release ended.",
  "She discusses whether we should leave.",
  "We discussed about",
  "We discussed about the",
  "We discussed about five issues.",
  "We discussed about half the report.",
  "We discussed about a dozen proposals.",
  "We discussed about 20 projects.",
  "The discuss-about option is off.",
  "We\ndiscussed about the release.",
  "We discussed\nabout the release.",
  "We discussed about\nthe release.",
  "We discussed about the release.next",
  "We discussed about the release_note.",
  'The example "We discussed about the release." is incorrect.',
  'Type "We discussed about the release." exactly.',
  "`We discussed about the release.`",
  "We discussed about the unknownword.",
  "We discussed about the releasé.",
  "She is interested in learning Rust.",
  "That depends on the situation.",
  "I was interested on Monday in the proposal.",
  "He looked interested on screen.",
  "She became interested on her own.",
  "They were interested on arrival.",
  "The interested party agreed.",
  "I am interested on",
  "I am interested on learning",
  "I am interested on the",
  "I am interested on learning unknownword.",
  "I am interested on reading unknownword.",
  "I am interested on Monday.",
  "I am interested\non learning Rust.",
  "I am interested on\nlearning Rust.",
  "I am interested on learning Rust.lang",
  "I am interested on learning Rust_code.",
  "I am interested on learning Rust́.",
  'Type "I am interested on learning Rust." exactly.',
  'The phrase "interested on learning Rust" is incorrect.',
  "`I am interested on learning Rust.`",
  "I am not interested in your project.",
  "She is interested in the release.",
  "On learning Rust, I changed my mind.",
];
test.each([...new Set(valid)])("fixed prepositions preserve %s", (text) =>
  expect(scan(text)).toEqual([]),
);
test("new prepositions stay isolated from typing and protected or out-of-scope evidence", () => {
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
  for (const [text] of [errors[0], errors[12], errors[24]]) {
    const d = scan(text)[0];
    expect(scan(text, {}, { lang: "fr_FR" })).toEqual([]);
    expect(scan(text, {}, { userDictionary: [d.original.trim()] })).toEqual([]);
    expect(scan(text, { protectedRanges: [{ ...d.range, reason: "code" }] })).toEqual([]);
    expect(scan(text, { scope: { start: d.range.start + 1, end: d.range.end } })).toEqual([]);
    expect(scan(text, { scope: d.range })).toHaveLength(1);
    expect(scan(text, { id: "new" })[0].id).not.toBe(d.id);
  }
});
test("full phrase evidence owns one chunk and preserves Unicode, CRLF and ordinary quotations", () => {
  const text =
    '😀 Café.\r\nShe said, "We discussed about the release." Despite of the rain, we went out.';
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
    ];
    expect(
      raw
        .sort((a, b) => a.range.start - b.range.start)
        .map((d) => [d.range, text.slice(d.range.start, d.range.end)]),
    ).toEqual(expected.map((d) => [d.range, d.original]));
  }
  expect(scan("I am interested on learning\uFFFC Rust.")).toEqual([]);
  expect(scan("We discussed about `the release`.")).toEqual([]);
});

test.each([
  ["We have waited since three hours.", "We have waited for three hours."],
  ["It runs fine since 2 weeks now.", "It runs fine for 2 weeks now."],
  ["Since several years, I use it.", "For several years, I use it."],
  ["It has been broken since more than 9 days.", "It has been broken for more than 9 days."],
])("since + a length of time becomes for: %s", (source, expected) => {
  const [d] = scan(source);
  expect(scan(source)).toHaveLength(1);
  expect(d.bulk.eligible).toBe(false);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});
test.each([
  "It has worked since 2019.",
  "Since two days were lost, we left early.",
  "Since two weeks ago, it works.",
  "I have been here since three o'clock.",
  "It changed since the last two weeks.",
])("since + time preserves %s", (text) => expect(scan(text)).toEqual([]));
