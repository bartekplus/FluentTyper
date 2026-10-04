import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan, scanResult } from "./reviewHarness";

// subjectAgreement's general frame: a determiner, one counted noun, a verb and a closing -ly
// adverb (or a linking verb and an adjective) at a sentence opening.

type Options = Parameters<typeof reviewScan>[1];
const scan = (text: string, options?: Options) =>
  reviewScan(text, options).filter((d) => d.ruleId === "englishSubjectVerbAgreement");

test.each([
  ["The build work correctly.", "The build works correctly."],
  ["The feature run correctly.", "The feature runs correctly."],
  ["These reports looks good.", "These reports look good."],
  ["The page load slowly.", "The page loads slowly."],
  ["This script work properly.", "This script works properly."],
  ["Every request fail silently.", "Every request fails silently."],
  ["Each test pass reliably.", "Each test passes reliably."],
  ["Her app crash randomly.", "Her app crashes randomly."],
  ["My laptop restart randomly.", "My laptop restarts randomly."],
  ["The widget render correctly.", "The widget renders correctly."],
  ["The button look good.", "The button looks good."],
  ["Our server respond slowly.", "Our server responds slowly."],
  ["The dog bark loudly.", "The dog barks loudly."],
  ["Those scripts runs smoothly.", "Those scripts run smoothly."],
  ["Our builds fails randomly.", "Our builds fail randomly."],
  ["It failed. The machine run continuously.", "It failed. The machine runs continuously."],
  ["Note: the build work correctly.", "Note: the build works correctly."],
])("a determiner subject agrees with its verb: %s", (input, expected) => {
  const found = scan(input);
  expect(found).toHaveLength(1);
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test("a determiner subject finding is never part of Fix all", () => {
  const [found] = scanResult("The build work correctly.").diagnostics.filter(
    (d) => d.ruleId === "englishSubjectVerbAgreement",
  );
  expect(found.bulk.eligible).toBe(false);
});

test.each([
  // A noun-verb word in the subject or verb slot with no closing word to decide it.
  "The project plans work.",
  "The test runs fast.",
  "The data shows.",
  "The build work is done.",
  "The test run successfully completed.",
  "The build work correctly and fast.",
  "The test set correctly.",
  "The page sound right.",
  // Agreeing verbs.
  "The build works correctly.",
  "The tests run correctly.",
  "These features look good.",
  // Mass and collective nouns.
  "The data show clearly.",
  "The team work efficiently.",
  "The staff work efficiently.",
  "The police work quickly.",
  "The news spread quickly.",
  "The series run weekly.",
  "The species adapt quickly.",
  "The family live happily.",
  "The information flow smoothly.",
  "The stuff work correctly.",
  // A compound noun or an adjective before the noun.
  "The user interface work correctly.",
  "The project plan work nicely.",
  "The code review process run smoothly.",
  "The test cases pass reliably.",
  "The general work slowly.",
  "The final run smoothly.",
  "The good look great.",
  // Not a sentence opening: a relative clause, a soft line wrap, after a comma.
  "The report that the build work correctly.",
  "The tool which the team run daily.",
  "The system and\nthe application work correctly.",
  "However, the build work correctly.",
  // Questions.
  "Does the build work correctly?",
  "The build work correctly?",
  "Why does the feature run slowly?",
  // The subjunctive.
  "I suggest that the build run nightly.",
  "It is important that the feature work correctly.",
  "We insist that the server restart automatically.",
  "They demanded that the page load quickly.",
  // Imperatives and causatives.
  "Make the build work correctly.",
  "Let the feature run smoothly.",
  "Ensure the build work correctly.",
  // Code, technical tokens and names.
  "`the build work correctly`",
  "The build_tool work correctly.",
  "The config.json work correctly.",
  "The build-system work correctly.",
  "The Build work correctly.",
  "The build Work correctly.",
  "THE BUILD WORK CORRECTLY.",
])("keeps %s", (input) => {
  expect({ input, found: scan(input).map((d) => d.original) }).toEqual({ input, found: [] });
});

test("a determiner subject frame skips user dictionary words and code", () => {
  const text = "The build work correctly.";
  expect(scan(text, { userDictionary: ["build"] })).toEqual([]);
  expect(
    scan(text, { snapshot: { protectedRanges: [{ start: 4, end: 9, reason: "code" }] } }),
  ).toEqual([]);
});
