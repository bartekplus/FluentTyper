import { expect, test } from "bun:test";
import {
  scanReviewChunk,
  finalizeReview,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { TYPING_RULE_IDS, GRAMMAR_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
import { prepared, review, planBulkFix } from "./grammarTestUtils";
const rule = "englishCanonicalCasing";
const scan = (
  text: string,
  extra?: Partial<ReviewSourceSnapshot>,
  options?: Partial<ReviewOptions>,
) => review(text, extra, { enabledRules: [rule], ...options }).diagnostics;
const positives = [
  ["We host the project on github.", "GitHub"],
  ["The implementation uses javascript.", "JavaScript"],
  ["The transport is based on webrtc.", "WebRTC"],
  ["The extension is called fluenttyper.", "FluentTyper"],
  ["The compiler accepts typescript.", "TypeScript"],
  ["I bought an iphone yesterday.", "iPhone"],
  ["The laptop runs macos.", "macOS"],
  ["We listed it on ebay.", "eBay"],
  ["Github hosts our source.", "GitHub"],
  ["Javascript runs in the browser.", "JavaScript"],
  ["iphone sales increased.", "iPhone"],
  ["ebay lists used goods.", "eBay"],
  ["Done. macos is installed.", "macOS"],
  ["😀 Café. We use typescript.\r\nAnother paragraph.", "TypeScript"],
  ["She said, “We use github.”", "GitHub"],
  ["Use github, then publish the change.", "GitHub"],
];
test.each(positives)("canonical casing offers the exact form: %s", (text, canonical) => {
  const findings = scan(text);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.alternatives[0].preview).toBe(canonical);
  expect(d.original).toBe(text.slice(d.range.start, d.range.end));
  expect(d.context.start).toBeLessThanOrEqual(d.range.start);
  expect(d.context.end).toBeGreaterThanOrEqual(d.range.end);
  expect(d.bulk.eligible).toBe(false);
  expect(planBulkFix(text, findings).edits).toEqual([]);
  const fixed = applyEdits(text, d.alternatives[0].edits)!;
  expect(scan(fixed)).toEqual([]);
  const all = review(fixed, {}, { enabledRules: GRAMMAR_RULE_IDS }).diagnostics;
  expect(
    all.filter((f) =>
      [rule, "capitalizeSentenceStart", "capitalizeAfterLineBreak"].includes(f.ruleId),
    ),
  ).toEqual([]);
});
const negatives = [
  '"github" is the incorrect spelling.',
  'The name is "github".',
  'It is spelled "javascript".',
  "Use key=github here.",

  "The iron will rust.",
  "Please go home.",
  "It may work.",
  "The property name is githubUrl.",
  "Visit github.com.",
  "The file is javascript.ts.",
  "The identifier is fluentTyperConfig.",
  "We use GitHub and JavaScript.",
  "TypeScript and WebRTC work here.",
  "FluentTyper is installed.",
  "iPhone sales increased.",
  "macOS is installed.",
  "eBay lists goods.",
  "WE USE GITHUB.",
  "We use TYPESCRIPT.",
  "The variable is javaSCRIPT.",
  "Contact @github.",
  "Use #javascript.",
  "Read /github/source.",
  "Read src/javascript.",
  "Visit https://github.com/test.",
  "Send mail to github@example.com.",
  "Use github_based code.",
  "We use github-based tooling.",
  "We use javascript2.",
  "Write `github` here.",
  "```text\ngithub\n```",
  'The word "github" is lowercase.',
  'The spelling is "javascript".',
  'The example is "we use webrtc".',
  'The identifier is "fluenttyper".',
  "The name is supergithub.",
  "We use githubé.",
  "We use github\u0301.",
  "The property is $github.",
  "This is github's repository.",
  "The literal is “macos”.",
];
test.each(negatives)("canonical casing preserves deliberate or technical text: %s", (text) =>
  expect(scan(text)).toEqual([]),
);
test("canonical casing respects dictionary, scope, protection and typing separation", () => {
  const text = positives[0][0];
  const start = text.indexOf("github");
  expect(scan(text, {}, { userDictionary: ["GitHub"] })).toEqual([]);
  expect(scan(text, { scope: { start: start + 1, end: text.length } })).toEqual([]);
  expect(scan(text, { protectedRanges: [{ start, end: start + 6, reason: "code" }] })).toEqual([]);
  // Brand names are spelled the same in every language.
  for (const lang of ["fr_FR", "de_DE", "pl_PL", "el_GR"]) {
    expect(
      scan(text, {}, { lang })
        .filter((d) => d.ruleId === rule)
        .map((d) => d.alternatives[0].preview),
    ).toEqual(["GitHub"]);
  }
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
});
test("canonical casing owns sentence starts only when its suggestion is enabled", () => {
  for (const text of [
    "github hosts code.",
    "iphone sales increased.",
    "Done.\nmacos is installed.",
  ]) {
    const rules = [
      rule,
      "capitalizeSentenceStart",
      "capitalizeAfterLineBreak",
      "englishProperNounCapitalization",
    ];
    const findings = review(text, {}, { enabledRules: rules }).diagnostics;
    expect(findings.map((d) => d.ruleId)).toEqual([rule]);
    expect(review(text, {}, { enabledRules: rules.slice(1) }).diagnostics).toHaveLength(1);
  }
});
test("canonical casing offsets and ownership survive every Unicode chunk split", () => {
  const text = "😀 Cafe\u0301. We use github and typescript.\r\nWe run macos.";
  const prep = prepared(text, {}, { enabledRules: [rule] });
  for (let cut = 1; cut < text.length; cut++) {
    const findings = finalizeReview(prep, [
      scanReviewChunk(prep, { start: 0, end: cut }),
      scanReviewChunk(prep, { start: cut, end: text.length }),
    ]).diagnostics;
    expect(findings).toEqual(scan(text));
  }
});

test("case-only edits leave unchanged letters between formatting boundaries untouched", () => {
  const text = "We use javascript.";
  expect(scan(text)[0].alternatives[0].edits).toEqual([
    { start: 7, end: 8, original: "j", replacement: "J" },
    { start: 11, end: 12, original: "s", replacement: "S" },
  ]);
});
