import { expect, test } from "bun:test";
import {
  detectReviewDiagnostics,
  prepareReview,
  scanReviewChunk,
  stillDetectedAfter,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { planBulkFix } from "../../src/core/domain/grammar/review/bulkPlanner";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import type { ReviewSourceSnapshot } from "../../src/core/domain/grammar/review/types";
const rule = "unclosedQuotation";
const options = {
  lang: "en_US",
  enabledRules: [rule],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};
const snapshot = (
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
): ReviewSourceSnapshot => ({
  id: "quotes",
  text,
  scope: { start: 0, end: text.length },
  protectedRanges: [],
  ...extra,
});
const scan = (text: string, extra: Partial<ReviewSourceSnapshot> = {}) =>
  detectReviewDiagnostics(snapshot(text, extra), options).diagnostics;
const warnings = [
  "He wrote, “The build is ready.",
  'She said, "We should leave now.',
  "The message reads: «The test passed.",
  "His reply was ‹Try again.",
  "She replied, ‘The file is missing.",
  "“A new beginning.",
  "He said, “She called it ‘useful’.",
  'He said, "The board is ready.',
  "He wrote, “First paragraph.\n\n“Second paragraph.",
  'He wrote, "First paragraph.\n\n"Second paragraph.',
  "😀 Café. He said, “A Unicode example.",
  "She wrote, «A first paragraph.\r\n\r\n«A second paragraph.",
];
test.each(warnings)("unclosed quotation warns without a replacement: %s", (text) => {
  const findings = scan(text);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.warningOnly).toBe(true);
  expect(d.alternatives).toEqual([]);
  expect(d.bulk).toEqual({ eligible: false, reason: "warning-only" });
  expect(d.original).toBe(text.slice(d.range.start, d.range.end));
  expect(d.range.end - d.range.start).toBe(1);
  expect(d.context).toEqual({ start: 0, end: text.length });
  expect(planBulkFix(text, findings).edits).toEqual([]);
});
const preserved = [
  "He wrote, “The build is ready.”",
  "It's ready.",
  "The user's folder is here.",
  'The board is 6" wide.',
  "The users’ folders are here.",
  "It’s ready.",
  "‘Tis the season.",
  "'Twas the night before.",
  'He said, "Ready."',
  "She replied, ‘Ready.’",
  "She replied, « Ready. »",
  "She replied, ‹Ready.›",
  "He said, “She replied, ‘Ready.’”",
  "He said, “First.\n\n“Second.”",
  'He said, "First.\n\n"Second."',
  "She replied, «First.\r\n\r\n«Second.»",
  "The measurement is 6′ 2″.",
  'He said "6" today.',
  "The user said, “It’s ready.”",
  'Demand grew by 6".',
  "The character “ opens a quotation.",
  'The symbol " is a double quote.',
  "He wrote „Ready“.",
  "He wrote ‚Ready‘.",
  "He wrote, “A mixed closing style»",
  "He wrote, “An unexpected “second opener.",
  "Only a closing mark.”",
  "Do not insert an Oxford comma.",
  "This is a long sentence, it continues without a quotation.",
  "The brackets [are not closed.",
  "A lone opening mark: “",
  "A straight single quote: 'Ready.",
];
test.each(preserved)("quotation scan abstains or preserves: %s", (text) =>
  expect(scan(text)).toEqual([]),
);
test("quotation warnings require complete unprotected evidence", () => {
  const text = warnings[0];
  expect(scan(text, { scope: { start: 10, end: text.length } })).toEqual([]);
  expect(scan(text, { scope: { start: 0, end: text.length - 1 } })).toEqual([]);
  expect(scan(text, { incomplete: true })).toEqual([]);
  expect(scan(text, { protectedRanges: [{ start: 20, end: 25, reason: "code" }] })).toEqual([]);
  expect(
    scan(text, { protectedRanges: [{ start: 20, end: 25, reason: "outside-window" }] }),
  ).toEqual([]);
  expect(scan("He wrote, “Use `code` here.")).toEqual([]);
  expect(scan("He wrote, “Visit https://example.test here.")).toEqual([]);
  expect(scan(text + "x".repeat(50_000))).toEqual([]);
  expect(
    detectReviewDiagnostics(snapshot(text), { ...options, lang: "fr_FR" }).diagnostics,
  ).toEqual([]);
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
});
test("quotation warning ownership is independent of scan chunk splits", () => {
  const text =
    "😀 Café. He wrote, “First.\r\n\r\n“Another paragraph with ‘an unclosed nested quote.";
  const prepared = prepareReview(snapshot(text), options);
  expect(prepared.quotationFindings).toHaveLength(2);
  for (let cut = 1; cut < text.length; cut++) {
    const raw = [
      ...scanReviewChunk(prepared, { start: 0, end: cut }).findings,
      ...scanReviewChunk(prepared, { start: cut, end: text.length }).findings,
    ];
    expect(raw.map((d) => d.range)).toEqual(scan(text).map((d) => d.range));
  }
});
test("warning-only diagnostics cannot become edits even with forged bulk metadata", () => {
  const text = warnings[0];
  const d = scan(text)[0];
  expect(planBulkFix(text, [{ ...d, bulk: { eligible: true, alternative: 0 } }]).edits).toEqual([]);
  expect(stillDetectedAfter(prepareReview(snapshot(text), options), [d], [])).toEqual([false]);
});
