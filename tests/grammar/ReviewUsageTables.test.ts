import { expect, test } from "bun:test";
import { PHRASES, STYLE } from "../../src/core/domain/grammar/review/english/usageTables";
import type { PhraseRow } from "../../src/core/domain/grammar/review/englishPhraseTables";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";

// english/usageTables.ts: split contractions, holiday apostrophes and optional plain style.
// All sentences are our own.
function scan(text: string, ruleId: string): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "usage", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}
const previews = (d: ReviewDiagnostic) => d.alternatives.map((a) => a.preview);

const TABLES: [string, readonly PhraseRow[]][] = [
  ["englishPhraseCorrections", PHRASES],
  ["stylePhrasing", STYLE],
];
test.each(
  TABLES.flatMap(([ruleId, rows]) =>
    rows.flatMap(([typed, replacement]) =>
      [typed].flat().map((form) => [ruleId, form, [replacement].flat()] as const),
    ),
  ),
)("%s row %p", (ruleId, form, replacements) => {
  const findings = scan(`Later we said ${form} there.`, ruleId);
  expect(findings).toHaveLength(1);
  expect(findings[0].original).toBe(form);
  expect(previews(findings[0])).toEqual(replacements);
});

const FRAMES: [text: string, original: string, fix: string][] = [
  ["She packed in a careless manner.", "in a careless manner", "carelessly"],
  ["He replied in an angry way.", "in an angry way", "angrily"],
  ["We will send you an email soon.", "send you an email", "email you"],
  ["She was sending us an e-mail.", "sending us an e-mail", "e-mailing us"],
  ["The data was not accurate.", "not accurate", "inaccurate"],
  ["Their reply seemed not polite.", "not polite", "impolite"],
];
test.each(FRAMES)("style frame %p", (text, original, fix) => {
  const [finding, ...rest] = scan(text, "stylePhrasing");
  expect(rest).toEqual([]);
  expect(finding.original).toBe(original);
  expect(previews(finding)).toEqual([fix]);
});

const QUIET = [
  "He did it in a way that worked.",
  "In a manner of speaking, yes.",
  "They grew in a big way.",
  "The report is not complete enough.",
  "It is not only fast but cheap.",
  "We sent him a letter.",
  "Ask Don to sign the form.",
];
test.each(QUIET)("stays silent: %p", (text) => {
  expect(scan(text, "stylePhrasing")).toEqual([]);
  expect(scan(text, "englishPhraseCorrections")).toEqual([]);
});

test.each([
  ["They'Re late.", "Re", "re"],
  ["We can'T stay.", "T", "t"],
  ["You'Ll see.", "Ll", "ll"],
  ["The plan'S fine.", "S", "s"],
] as const)("a capital after a contraction apostrophe %p", (text, original, fix) => {
  const [finding, ...rest] = scan(text, "englishContractionNormalization");
  expect(rest).toEqual([]);
  expect(finding.original).toBe(original);
  expect(previews(finding)).toEqual([fix]);
});

test.each(["DON'T STOP.", "I'M READY.", "Ask O'Neil.", "Meet D'Arcy today."])(
  "contraction case stays: %p",
  (text) => {
    expect(scan(text, "englishContractionNormalization")).toEqual([]);
  },
);
