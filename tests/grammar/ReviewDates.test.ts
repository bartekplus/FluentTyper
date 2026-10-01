import { expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";

// english/dates.ts: weekdays that do not match their date, and days a month lacks.
// All sentences are our own.
function scan(text: string, lang = "en_US"): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "dates", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang,
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishDateConsistency");
}

// 1 March 2023 was a Wednesday; 29 February 2024 a Thursday.
// The weekday, the nearest day on the typed weekday, then the nearest year it fell on.
const WEEKDAYS: [text: string, original: string, previews: string[]][] = [
  [
    "The launch is on Monday, 1 March 2023.",
    "Monday, 1 March 2023",
    ["Wednesday, 1 March 2023", "Monday, 6 March 2023", "Monday, 1 March 2021"],
  ],
  [
    "We met on Wednesday, March 9th, 2023.",
    "Wednesday, March 9th, 2023",
    ["Thursday, March 9th, 2023", "Wednesday, March 8th, 2023", "Wednesday, March 9th, 2022"],
  ],
  [
    "Payday: Friday, 2024-02-29.",
    "Friday, 2024-02-29",
    ["Thursday, 2024-02-29", "Friday, 2024-02-23"],
  ],
  [
    "Filed Friday, 03/25/2023 by post.",
    "Friday, 03/25/2023",
    ["Saturday, 03/25/2023", "Friday, 03/24/2023", "Friday, 03/25/2022"],
  ],
];

test.each(WEEKDAYS)("a mismatched weekday %p", (text, original, previews) => {
  const [finding, ...rest] = scan(text);
  expect(rest).toEqual([]);
  expect(finding.original).toBe(original);
  expect(finding.alternatives.map((a) => a.preview)).toEqual(previews);
  expect(finding.requiresChoice).toBe(true);
});

const CORRECT_WEEKDAYS = [
  "The launch is on Wednesday, 1 March 2023.",
  "We met on Friday 3rd March 2023.",
  "Doors open Sunday, March 5, 2023 at noon.",
  "The deadline is Tue, March 7th 2023.",
  "Payday: Thursday, 2024-02-29.",
  "Filed Saturday, 25/03/2023 by post.",
  // No year: the weekday depends on which year is meant.
  "See you Monday, March 6.",
  // Ambiguous day and month order.
  "Filed Monday, 03/04/2023 by post.",
];
test.each(CORRECT_WEEKDAYS)("a matching or undecidable weekday stays: %p", (text) => {
  expect(scan(text)).toEqual([]);
});

const IMPOSSIBLE = [
  ["The offer ends on June 31.", "June 31"],
  ["We arrive on the 31st of April.", "31st of April"],
  ["Rent is due Feb 30, 2024.", "Feb 30, 2024"],
  ["The audit was on February 29, 2023.", "February 29, 2023"],
  ["Her birthday is September 31st.", "September 31st"],
  ["Ship by 2/30/2025, please.", "2/30/2025"],
  ["Ship by 31.11.2025, please.", "31.11.2025"],
  ["The form says 14/31/2025.", "14/31/2025"],
] as const;
test.each(IMPOSSIBLE)("an impossible date %p", (text, original) => {
  const [finding, ...rest] = scan(text);
  expect(rest).toEqual([]);
  expect(finding.original).toBe(original);
  expect(finding.warningOnly).toBe(true);
  expect(finding.alternatives).toEqual([]);
});

const POSSIBLE = [
  "Leap day fell on February 29, 2024.",
  "Leap day is February 29.",
  "The sale runs until April 30.",
  "We march 40 miles a day.",
  "You may 32 times in a row.",
  "Version 1.31.2025 shipped.",
  "Ship by 12/31/2025, please.",
  "Ship by 31/12/2025, please.",
  "The ratio was 3/32.",
  "Chapter 4 covers pages 31 to 40 of the June 2023 issue.",
];
test.each(POSSIBLE)("a possible date stays: %p", (text) => {
  expect(scan(text)).toEqual([]);
});

test("only English text is checked", () => {
  expect(scan("The offer ends on June 31.", "de_DE")).toEqual([]);
});
