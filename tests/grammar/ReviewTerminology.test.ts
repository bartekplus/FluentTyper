import { expect, test } from "bun:test";
import {
  scanReviewChunk,
  finalizeReview,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { spellingCandidates } from "../../src/core/domain/grammar/review/reviewSpelling";
import { GRAMMAR_RULE_IDS, TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { planBulkFix } from "../../src/core/domain/grammar/review/bulkPlanner";
import type { ReviewSourceSnapshot } from "../../src/core/domain/grammar/review/types";
import { prepared, review, reviewOptions, term } from "./grammarTestUtils";
const options = (entries = [term()]) =>
  reviewOptions({
    enabledRules: ["preferredTerminology"],
    preferredTerminology: { version: 1, enabled: true, entries },
  });
const scan = (text: string, opts = options(), extra: Partial<ReviewSourceSnapshot> = {}) =>
  review(text, extra, opts).diagnostics;

test("enabled literal terminology preserves stable entry identity and authored explanation", () => {
  const text = "We use Acme Suite today.";
  const findings = scan(text);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.id).toContain("/preferredTerminology:acme@");
  expect(d.terminology).toEqual({ id: "acme", explanation: "Our preferred product name." });
  expect(d.original).toBe("Acme Suite");
  expect(d.original).toBe(text.slice(d.range.start, d.range.end));
  expect(d.alternatives[0].preview).toBe("Acme Workspace");
  expect(planBulkFix(text, findings).edits).toEqual([]);
  expect(scan(applyEdits(text, d.alternatives[0].edits)!)).toEqual([]);
});

test("terminology is silent until explicitly enabled and after entry removal", () => {
  const text = "Acme Suite is here.";
  expect(scan(text, { ...options(), preferredTerminology: undefined })).toEqual([]);
  expect(
    scan(text, {
      ...options(),
      preferredTerminology: { version: 1, enabled: false, entries: [term()] },
    }),
  ).toEqual([]);
  expect(scan(text, options([term({ enabled: false })]))).toEqual([]);
  expect(scan(text, options([]))).toEqual([]);
  expect(scan(text, { ...options(), enabledRules: [] })).toEqual([]);
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain("preferredTerminology");
});

test.each([
  "superAcme Suite",
  "Acme Suites",
  "Acme Suite2",
  "@Acme Suite",
  "Acme Suite/path",
  "src/Acme Suite",
  "Acme Suite.ts",
  "Acme Suite_name",
  "Acme Suite-based",
  "Acme Suite's",
  "Acme Suite\u0301",
  "`Acme Suite`",
  "```\nAcme Suite\n```",
  "https://example.test/Acme Suite",
  "Acme Suite@example.test",
])("literal terminology respects token and code boundaries: %s", (text) =>
  expect(scan(text)).toEqual([]),
);

test("case policy is explicit and matching does not recase the preferred literal", () => {
  expect(scan("We use acme suite.")).toEqual([]);
  for (const text of ["We use acme suite.", "We use ACME SUITE.", "We use AcMe SuItE."]) {
    expect(
      scan(text, options([term({ casePolicy: "insensitive" })]))[0].alternatives[0].preview,
    ).toBe("Acme Workspace");
  }
});

test("literal metacharacters and HTML replacements are not interpreted as regex or markup", () => {
  const opts = options([
    term({
      source: "Acme (old)",
      replacement: "<img src=x>",
      explanation: "<script>alert(1)</script>",
    }),
  ]);
  expect(scan("We use Acme old.", opts)).toEqual([]);
  const d = scan("We use Acme (old).", opts)[0];
  expect(d.alternatives[0].preview).toBe("<img src=x>");
  expect(d.terminology?.explanation).toBe("<script>alert(1)</script>");
});

test("dictionary, language, protected spans and explicit selection policy apply", () => {
  const text = "We use Acme Suite.";
  const start = text.indexOf("Acme");
  expect(scan(text, { ...options(), userDictionary: ["Acme"] })).toEqual([]);
  expect(scan(text, { ...options(), lang: "fr_FR" })).toEqual([]);
  expect(
    scan(text, options(), { protectedRanges: [{ start, end: start + 10, reason: "structure" }] }),
  ).toEqual([]);
  expect(scan(text, options(), { scope: { start: start + 1, end: text.length } })).toEqual([]);
  const opts = options([term({ scope: "selection" })]);
  expect(scan(text, opts)).toEqual([]);
  expect(scan(text, opts, { selection: true })).toHaveLength(1);
  expect(scan(text, { ...options([term({ language: "fr_FR" })]), lang: "fr_FR" })).toHaveLength(1);
});

test("longest overlapping source wins independent of entry order", () => {
  const a = term();
  const b = term({ id: "short", source: "Acme", replacement: "Vendor" });
  for (const entries of [
    [a, b],
    [b, a],
  ])
    expect(scan("Acme Suite is here.", options(entries)).map((d) => d.terminology?.id)).toEqual([
      "acme",
    ]);
});

test("preferred words own native and spelling corrections without changing the dictionary", () => {
  const opts = {
    ...options([term({ source: "GitHub", replacement: "github" })]),
    enabledRules: GRAMMAR_RULE_IDS,
  };
  const source = "GitHub hosts code.";
  const d = scan(source, opts);
  expect(d.map((f) => f.ruleId)).toEqual(["preferredTerminology"]);
  const fixed = applyEdits(source, d[0].alternatives[0].edits)!;
  expect(scan(fixed, opts)).toEqual([]);
  expect(spellingCandidates(prepared(fixed, {}, opts), []).map((c) => c.word)).not.toContain(
    "github",
  );
  expect(opts.userDictionary).toEqual([]);
});

test("terminology ownership is stable across every chunk split and entry reordering", () => {
  const text = "😀 Cafe\u0301. Acme Suite is here.\r\nAcme Suite is useful.";
  const p = prepared(text, {}, options());
  for (let cut = 1; cut < text.length; cut++)
    expect(
      finalizeReview(p, [
        scanReviewChunk(p, { start: 0, end: cut }),
        scanReviewChunk(p, { start: cut, end: text.length }),
      ]).diagnostics,
    ).toEqual(scan(text));
});

test("oversized direct scans report the terminology limit instead of silently claiming coverage", () => {
  const text = "Plain text. ".repeat(5000) + "Acme Suite.";
  const result = review(text, {}, options());
  expect(result.diagnostics).toEqual([]);
  expect(result.coverage.skipped["size-limit"]).toBe(text.length - 50000);
});
