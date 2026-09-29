import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  reviewRuleIds,
  REVIEW_RULE_METADATA,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { TYPING_RULE_IDS, GRAMMAR_RULE_CATALOG } from "../../src/core/domain/grammar/ruleCatalog";
import { planBulkFix } from "../../src/core/domain/grammar/review/bulkPlanner";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
const rules = ["styleRedundancy", "styleLongSentence"];
const options: ReviewOptions = {
  lang: "en_US",
  enabledRules: rules,
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
  longSentenceWords: 10,
};
function scan(
  text: string,
  opts: Partial<ReviewOptions> = {},
  extra: Partial<ReviewSourceSnapshot> = {},
) {
  return detectReviewDiagnostics(
    { id: "style", text, scope: { start: 0, end: text.length }, protectedRanges: [], ...extra },
    { ...options, ...opts },
  );
}
test("style is explicitly opt-in, never typing, recommended or safe bulk", () => {
  const defaults = reviewRuleIds({ codeMode: false });
  for (const id of rules) {
    expect(defaults).not.toContain(id);
    expect(TYPING_RULE_IDS as readonly string[]).not.toContain(id);
    expect(GRAMMAR_RULE_CATALOG.find((entry) => entry.id === id)).toMatchObject({
      typing: false,
      recommended: false,
      defaultRollout: "off",
    });
  }
  expect(
    scan("Use your PIN number at the ATM machine.", { enabledRules: defaults }).diagnostics,
  ).toEqual([]);
  expect(reviewRuleIds({ codeMode: false, overrides: { styleRedundancy: true } })).toContain(
    "styleRedundancy",
  );
  expect(REVIEW_RULE_METADATA.styleLongSentence).toMatchObject({
    category: "style",
    bulk: "individual",
    defaultEnabled: false,
  });
});

test("explicit acronym pairs offer optional literal repairs without changing voice", () => {
  const text = "You might use your PIN number at the ATM machine, but you may choose not to.";
  const result = scan(text, { enabledRules: ["styleRedundancy"] });
  expect(result.diagnostics.map((d) => d.original)).toEqual(["PIN number", "ATM machine"]);
  expect(result.diagnostics.every((d) => d.category === "style" && !d.bulk.eligible)).toBe(true);
  expect(
    applyEdits(
      text,
      result.diagnostics.flatMap((d) => d.alternatives[0].edits),
    ),
  ).toBe("You might use your PIN at the ATM, but you may choose not to.");
  expect(planBulkFix(text, result.diagnostics).edits).toEqual([]);
});

test.each([
  'The contract says "PIN number".',
  "The contract says “The PIN number remains. The ATM machine stays.”",
  "The contract says 'PIN number'.",
  "The contract says ‘Don't change the PIN number.’",
  'An opening quote: "PIN number\n\nATM machine',
  "`PIN number`",
  "```\nATM machine",
  "src/PIN number",
  "PIN numbers",
  "ATM machines",
  "pin number",
  "Pin number",
  "PIN Number",
  "PIN number.ts",
  "@ATM machine",
])("style preserves quoted legal wording, code and ambiguous forms: %s", (text) => {
  expect(scan(text, { enabledRules: ["styleRedundancy"] }).diagnostics).toEqual([]);
});

test("style acronym matching observes dictionaries, scope, language and incomplete sources", () => {
  const text = "Use your PIN number.";
  expect(scan(text, { userDictionary: ["PIN"] }).diagnostics).toEqual([]);
  expect(scan(text, { lang: "fr_FR" }).diagnostics).toEqual([]);
  expect(scan(text, {}, { scope: { start: 10, end: text.length } }).diagnostics).toEqual([]);
  expect(scan(text, {}, { incomplete: true }).diagnostics).toEqual([]);
});

test("long-sentence advice is a warning with no split or batch edit, including decimal prose", () => {
  const text =
    "Dr. Rowan said that the price is 3.14 dollars and the team should review every part before making any decision.";
  const result = scan(text, { enabledRules: ["styleLongSentence"] });
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toMatchObject({
    category: "style",
    warningOnly: true,
    original: text,
    alternatives: [],
    bulk: { eligible: false, reason: "warning-only" },
  });
  expect(planBulkFix(text, result.diagnostics).edits).toEqual([]);
  expect(
    scan(text, { enabledRules: ["styleLongSentence"], longSentenceWords: 200 }).diagnostics,
  ).toEqual([]);
  expect(
    scan(text, {}, { scope: { start: 10, end: text.length }, selection: true }).diagnostics,
  ).toEqual([]);
});

test("unavailable sentence segmentation reports incomplete coverage without losing other advice", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
  try {
    Object.defineProperty(Intl, "Segmenter", { ...descriptor, value: undefined });
    const result = scan("Use your PIN number.");
    expect(result.diagnostics.map((d) => d.ruleId)).toEqual(["styleRedundancy"]);
    expect(result.coverage.failedRules).toEqual(["styleLongSentence"]);
    expect(result.coverage.skipped["rule-error"]).toBe(1);
  } finally {
    Object.defineProperty(Intl, "Segmenter", descriptor);
  }
});
