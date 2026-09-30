import { expect, test } from "bun:test";
import {
  detectReviewDiagnostics,
  prepareReview,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import { englishVerbGerund } from "../../src/core/domain/grammar/implementations/helpers/EnglishVerbForms";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
const rule = "englishVerbComplements";
function scan(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    {
      id: "complements",
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
  ["We need fix this bug.", "We need to fix this bug."],
  ["They plan deploy tomorrow.", "They plan to deploy tomorrow."],
  ["I want make the change.", "I want to make the change."],
  ["She needs take a break.", "She needs to take a break."],
  ["He wanted write the report.", "He wanted to write the report."],
  ["We planned run the tests.", "We planned to run the tests."],
  ["They needed come home.", "They needed to come home."],
  ["I want see the results.", "I want to see the results."],
  ["She plans learn Rust.", "She plans to learn Rust."],
  ["He wants visit the office.", "He wants to visit the office."],
  ["You need read the file.", "You need to read the file."],
  ["We plan send the message.", "We plan to send the message."],
  ["I look forward to meet you.", "I look forward to meeting you."],
  ["We look forward to make the change.", "We look forward to making the change."],
  ["She looks forward to take a break.", "She looks forward to taking a break."],
  ["He looked forward to write the report.", "He looked forward to writing the report."],
  ["They are looking forward to run the tests.", "They are looking forward to running the tests."],
  ["I am looking forward to come home.", "I am looking forward to coming home."],
  ["We were looking forward to see the results.", "We were looking forward to seeing the results."],
  ["She was looking forward to learn Python.", "She was looking forward to learning Python."],
  ["You look forward to visit the office.", "You look forward to visiting the office."],
  ["He is looking forward to read the file.", "He is looking forward to reading the file."],
  ["They look forward to send the message.", "They look forward to sending the message."],
  ["We look forward to go home.", "We look forward to going home."],
  ["We do not need fix this bug.", "We do not need to fix this bug."],
  ["I don't want make the change.", "I don't want to make the change."],
  ["She doesn’t plan deploy tomorrow.", "She doesn’t plan to deploy tomorrow."],
  ["They did not want visit the office.", "They did not want to visit the office."],
  ["I am not looking forward to run the tests.", "I am not looking forward to running the tests."],
  ["He doesn't look forward to take a break.", "He doesn't look forward to taking a break."],
];
test.each(errors)("verb complements repair %s", (source, expected) => {
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
  "We need not change it.",
  "Can you help fix this?",
  "Please let me know.",
  "They made it work.",
  "We need work, not promises.",
  "We need input data.",
  "We need a fix for this bug.",
  "They plan the deployment.",
  "I want a break.",
  "I want change, not promises.",
  "We need to fix this bug.",
  "They plan to deploy tomorrow.",
  "I want to make the change.",
  "She needs to take a break.",
  "He wanted to write the report.",
  "We planned to run the tests.",
  "I need not go home.",
  "He need not read the file.",
  "We don't need to fix this bug.",
  "They do not plan to deploy tomorrow.",
  "Need fix this bug.",
  "Plan deploy tomorrow",
  "Want see the results",
  "Need: fix this bug.",
  "We need fix",
  "They plan deploy",
  "We need unknownword this bug.",
  "We need fix unknownword.",
  "We need\nfix this bug.",
  "We need fix\nthis bug.",
  "We need `fix` this bug.",
  "We need fix this bug.report",
  "We need fix this bug_id.",
  "We need fix this buǵ.",
  'Type "We need fix this bug." exactly.',
  'The example "They plan deploy tomorrow." is wrong.',
  "We need the word fix.",
  "I would like to go home.",
  "I look forward to meeting you.",
  "We are used to working remotely.",
  "I look forward to work.",
  "I look forward to the meeting.",
  "We look forward to the report.",
  "She looks forward to taking a break.",
  "They are looking forward to running the tests.",
  "He looked forward to writing the report.",
  "We look forward to good weather.",
  "I look forward to tomorrow.",
  "I look forward to meet",
  "I look forward to",
  "Look forward to meet you.",
  "Looking forward to meet you.",
  "I look forward to unknownword you.",
  "I look forward to meet unknownword.",
  "I look forward to went home.",
  "I look forward to\nmeet you.",
  "I look forward to meet\nyou.",
  "I look forward to meet you.name",
  "I look forward to meet you_id.",
  "I look forward to meet yoú.",
  'The phrase "I look forward to meet you." is incorrect.',
  'Type "I look forward to meet you." exactly.',
  "`I look forward to meet you.`",
  "I look forward to make-believe.",
  "I am used to work as a verb in this example.",
  "Please help me run the tests.",
  "Let them visit the office.",
  "Make him read the file.",
  "We can go home.",
  "I saw her write the report.",
  "They had us run the tests.",
  "He made me take a break.",
  "We need meeting notes.",
  "I'd like to meet you.",
  "We'd planned to deploy tomorrow.",
];
test.each(valid)("verb complements preserve %s", (text) => expect(scan(text)).toEqual([]));
test("missing-to insertion uses the existing one-grapheme anchor and preserves separators", () => {
  const text = "We need\tfix this bug.";
  const d = scan(text)[0];
  const start = text.indexOf("fix");
  expect(d.range).toEqual({ start, end: start + 3 });
  expect(d.alternatives[0].edits).toEqual([
    { start, end: start + 1, original: "f", replacement: "to f" },
  ]);
  expect(applyEdits(text, d.alternatives[0].edits)).toBe("We need\tto fix this bug.");
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
});
test("explicit gerunds include irregular spelling without broadening auxiliary forms", () => {
  for (const [base, gerund] of [
    ["make", "making"],
    ["run", "running"],
    ["take", "taking"],
    ["write", "writing"],
    ["see", "seeing"],
  ])
    expect(englishVerbGerund(base)).toBe(gerund);
  for (const word of ["went", "wrote", "unknownword", "toString", "meeting"])
    expect(englishVerbGerund(word)).toBeNull();
});
test("complement evidence respects dictionary, language, protection, selection and chunk ownership", () => {
  for (const [text] of [errors[0], errors[12]]) {
    const d = scan(text)[0];
    expect(scan(text, {}, { lang: "fr_FR" })).toEqual([]);
    expect(scan(text, {}, { userDictionary: [d.original] })).toEqual([]);
    expect(scan(text, { protectedRanges: [{ ...d.range, reason: "code" }] })).toEqual([]);
    expect(scan(text, { scope: { start: d.range.start + 1, end: d.range.end } })).toEqual([]);
    expect(scan(text, { scope: d.range })).toHaveLength(1);
    expect(scan(text, { id: "new" })[0].id).not.toBe(d.id);
  }
  const text = '😀 Café.\r\nShe said, "We need fix this bug." I look forward to meet you.';
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
  expect(scan("We need fix\uFFFC this bug.")).toEqual([]);
});
