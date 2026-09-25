import { describe, expect, test } from "bun:test";
import { GRAMMAR_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import { planBulkFix } from "../../src/core/domain/grammar/review/bulkPlanner";
import {
  detectReviewDiagnostics,
  prepareReview,
  stillDetectedAfter,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  applyEdits,
  diffTexts,
  editTouches,
  isGraphemeBoundary,
  remapRange,
  remapScope,
} from "../../src/core/domain/grammar/review/textRanges";
import { findMarkdownCodeRanges } from "../../src/core/domain/grammar/implementations/helpers/ProtectedSpanShared";
import type {
  ReviewDiagnostic,
  ReviewEdit,
  ReviewOptions,
} from "../../src/core/domain/grammar/review/types";

const OPTIONS: ReviewOptions = {
  lang: "en_US",
  enabledRules: GRAMMAR_RULE_IDS,
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};

function edit(start: number, end: number, original: string, replacement: string): ReviewEdit {
  return { start, end, original, replacement };
}

let counter = 0;
function diagnostic(
  edits: ReviewEdit[],
  overrides: Partial<ReviewDiagnostic> = {},
): ReviewDiagnostic {
  counter += 1;
  const start = Math.min(...edits.map((e) => e.start));
  const end = Math.max(...edits.map((e) => e.end));
  return {
    id: `d${counter}`,
    snapshotId: "s",
    ruleId: "englishTypoWhitelistCorrection",
    category: "spelling",
    messageKey: "review_msg_typo",
    lang: "en_US",
    range: { start, end },
    original: "",
    alternatives: [{ edits, preview: "" }],
    bulk: { eligible: true, alternative: 0 },
    context: { start, end },
    ...overrides,
  };
}

function reviewAndPlan(text: string) {
  const snapshot = { id: "s", text, scope: { start: 0, end: text.length }, protectedRanges: [] };
  const prepared = prepareReview(snapshot, OPTIONS);
  const { diagnostics } = detectReviewDiagnostics(snapshot, OPTIONS);
  const plan = planBulkFix(text, diagnostics, {
    stillHolds: (d, others) => stillDetectedAfter(prepared, d, others),
  });
  return { diagnostics, plan };
}

describe("bulk planning", () => {
  test("independent edits all apply, descending, from one snapshot", () => {
    const text = "teh cat and teh dog";
    const a = diagnostic([edit(0, 3, "teh", "the")]);
    const b = diagnostic([edit(12, 15, "teh", "the")]);
    const plan = planBulkFix(text, [a, b]);
    expect(plan.diagnosticIds).toEqual([a.id, b.id]);
    expect(plan.edits.map((e) => e.start)).toEqual([12, 0]);
    expect(plan.expectedText).toBe("the cat and the dog");
    expect(plan.deferred).toEqual([]);
  });

  test("overlapping edits defer the whole group instead of picking a winner", () => {
    const text = "abcdef";
    const a = diagnostic([edit(0, 3, "abc", "X")]);
    const b = diagnostic([edit(2, 5, "cde", "Y")]);
    const c = diagnostic([edit(5, 6, "f", "F")]);
    const plan = planBulkFix(text, [a, b, c]);
    expect(plan.diagnosticIds).toEqual([c.id]);
    expect(plan.deferred).toEqual([
      { id: a.id, reason: "conflict" },
      { id: b.id, reason: "conflict" },
    ]);
    expect(plan.expectedText).toBe("abcdeF");
  });

  test("adjacent edits are independent", () => {
    const a = diagnostic([edit(0, 2, "ab", "AB")]);
    const b = diagnostic([edit(2, 4, "cd", "CD")]);
    expect(planBulkFix("abcd", [a, b]).expectedText).toBe("ABCD");
  });

  test("identical edits from two findings are applied once", () => {
    const a = diagnostic([edit(0, 1, "i", "I")]);
    const b = diagnostic([edit(0, 1, "i", "I"), edit(4, 5, "s", "ve")], {
      context: { start: 0, end: 5 },
    });
    const plan = planBulkFix("i has", [a, b], { stillHolds: () => true });
    expect(plan.edits).toHaveLength(2);
    expect(plan.expectedText).toBe("I have");
  });

  test("insertions: a shared insertion point conflicts; insertion vs deletion elsewhere is fine", () => {
    const a = diagnostic([edit(2, 2, "", "x")]);
    const b = diagnostic([edit(2, 2, "", "y")]);
    const c = diagnostic([edit(4, 6, "ef", "")]);
    const plan = planBulkFix("abcdef", [a, b, c]);
    expect(plan.deferred.map((d) => d.reason)).toEqual(["conflict", "conflict"]);
    expect(plan.expectedText).toBe("abcd");
    // An insertion inside another edit's range collides too.
    const d = diagnostic([edit(3, 3, "", "z")]);
    const e = diagnostic([edit(2, 5, "cde", "C")]);
    expect(planBulkFix("abcdef", [d, e]).diagnosticIds).toEqual([]);
  });

  test("deletions apply and shift nothing before them", () => {
    const a = diagnostic([edit(3, 5, "  ", " ")]);
    const b = diagnostic([edit(8, 9, ",", "")]);
    expect(planBulkFix("one  two,, end", [a, b]).expectedText).toBe("one two, end");
  });

  test("ineligible and ambiguous findings are left for individual review", () => {
    const a = diagnostic([edit(0, 1, "a", "A")], {
      bulk: { eligible: false, reason: "rule-not-batch-approved" },
    });
    const b = diagnostic([edit(2, 3, "b", "B")], {
      alternatives: [
        { edits: [edit(2, 3, "b", "B")], preview: "B" },
        { edits: [edit(2, 3, "b", "C")], preview: "C" },
      ],
      bulk: { eligible: false, reason: "ambiguous" },
    });
    const plan = planBulkFix("a b", [a, b]);
    expect(plan.diagnosticIds).toEqual([]);
    expect(plan.deferred.map((d) => d.id)).toEqual([a.id, b.id]);
  });

  test("ignored findings and hidden categories are excluded, not deferred", () => {
    const a = diagnostic([edit(0, 1, "a", "A")]);
    const b = diagnostic([edit(2, 3, "b", "B")], { category: "grammar" });
    const plan = planBulkFix("a b", [a, b], {
      ignored: new Set([a.id]),
      categories: new Set(["spelling"]),
    });
    expect(plan.diagnosticIds).toEqual([]);
    expect(plan.deferred).toEqual([]);
  });

  test("context-dependent findings need a proof, else both are deferred", () => {
    // b's evidence (context) contains a's edit.
    const a = diagnostic([edit(3, 5, "..", ".")]);
    const b = diagnostic([edit(6, 7, "t", "T")], { context: { start: 3, end: 10 } });
    const unproven = planBulkFix("end.. then", [a, b]);
    expect(unproven.deferred.map((d) => d.reason)).toEqual(["unproven", "unproven"]);
    const proven = planBulkFix("end.. then", [a, b], { stillHolds: () => true });
    expect(proven.expectedText).toBe("end. Then");
  });

  test("real findings: a sentence start whose evidence another fix touches is proven together", () => {
    const { plan } = reviewAndPlan("Stop.  then i has it");
    expect(plan.expectedText).toBe("Stop. Then I have it");
    expect(plan.deferred).toEqual([]);
  });

  test("real findings: a change that removes another finding's evidence is not proven", () => {
    const text = "ok";
    const snapshot = { id: "s", text, scope: { start: 0, end: 2 }, protectedRanges: [] };
    const prepared = prepareReview(snapshot, OPTIONS);
    const fake = diagnostic([edit(0, 1, "o", "O")], { ruleId: "capitalizeSentenceStart" });
    // Prepending a lowercase word makes "ok" no longer a sentence start.
    expect(stillDetectedAfter(prepared, fake, [edit(0, 0, "", "and ")])).toBe(false);
  });

  test("cascading findings appear only on recheck, never in the same batch", () => {
    const { plan } = reviewAndPlan("Thanks,,see you.");
    expect(plan.expectedText).toBe("Thanks,see you.");
    // The missing space is a new finding for the next scan, not applied now.
    expect(reviewAndPlan(plan.expectedText).plan.expectedText).toBe("Thanks, see you.");
  });
});

describe("text ranges", () => {
  test("applyEdits verifies originals and rejects overlaps", () => {
    expect(applyEdits("abc", [edit(0, 1, "a", "A"), edit(2, 3, "c", "C")])).toBe("AbC");
    expect(applyEdits("abc", [edit(0, 1, "x", "A")])).toBeNull();
    expect(applyEdits("abc", [edit(0, 2, "ab", "A"), edit(1, 3, "bc", "B")])).toBeNull();
    expect(applyEdits("abc", [edit(1, 1, "", "x"), edit(1, 1, "", "y")])).toBeNull();
  });

  test("editTouches treats insertions at a boundary as touching", () => {
    expect(editTouches({ start: 3, end: 3 }, { start: 3, end: 6 })).toBe(true);
    expect(editTouches({ start: 6, end: 6 }, { start: 3, end: 6 })).toBe(true);
    expect(editTouches({ start: 1, end: 3 }, { start: 3, end: 6 })).toBe(false);
  });

  test("grapheme boundaries: emoji, skin tones, combining marks, surrogates", () => {
    const text = "a👍🏽e\u0301";
    expect(isGraphemeBoundary(text, 1)).toBe(true);
    expect(isGraphemeBoundary(text, 2)).toBe(false);
    expect(isGraphemeBoundary(text, 3)).toBe(false);
    expect(isGraphemeBoundary(text, 5)).toBe(true);
    expect(isGraphemeBoundary(text, 6)).toBe(false);
    expect(isGraphemeBoundary(text, 7)).toBe(true);
  });

  test("diffs and remapping of finding ranges", () => {
    const diff = diffTexts("teh cat teh", "teh cats teh")!;
    expect(diff).toMatchObject({ start: 7, oldEnd: 7, newEnd: 8, slackStart: 7 });
    expect(remapRange({ start: 0, end: 3 }, diff)).toEqual({ start: 0, end: 3 });
    expect(remapRange({ start: 8, end: 11 }, diff)).toEqual({ start: 9, end: 12 });
    // "teh big cat" could be " big" after "teh" or "big " before "cat": touching either way.
    expect(
      remapRange({ start: 0, end: 3 }, diffTexts("teh cat teh", "teh big cat teh")!),
    ).toBeNull();
    // Typing right against a finding changes it.
    expect(remapRange({ start: 0, end: 3 }, diffTexts("teh cat", "tehx cat")!)).toBeNull();
    // An insertion in a run of repeated characters could be on either side.
    const ambiguous = diffTexts("aa b", "aaa b")!;
    expect(ambiguous.slackStart).toBe(0);
    expect(remapRange({ start: 1, end: 2 }, ambiguous)).toBeNull();
  });

  test("scope remapping grows inside, shifts outside, invalidates on a boundary", () => {
    const scope = { start: 4, end: 11 };
    const text = "one two three four";
    expect(remapScope(scope, diffTexts(text, "one tw o three four")!)).toEqual({
      start: 4,
      end: 12,
    });
    expect(remapScope(scope, diffTexts(text, "one two three fourX")!)).toEqual(scope);
    expect(remapScope(scope, diffTexts(text, "XXone two three four")!)).toEqual({
      start: 6,
      end: 13,
    });
    // Typing exactly at the selection start or end could belong to either side.
    expect(remapScope(scope, diffTexts(text, "one Xtwo three four")!)).toBeNull();
    expect(remapScope(scope, diffTexts(text, "one two thrXee four")!)).toBeNull();
    // Replacing the selection's own first character stays inside.
    expect(remapScope(scope, diffTexts(text, "one Two three four")!)).toEqual(scope);
  });
});

describe("markdown code ranges in finished text", () => {
  test("spans, fences, unclosed backticks, escapes and indented code", () => {
    const text =
      "a `b` c ``d ` e`` f\\`g ` lone\n\n```js\ncode\n```\nafter\n\n    indented\n    more\ntext";
    const ranges = findMarkdownCodeRanges(text).map(([s, e]) => text.slice(s, e));
    expect(ranges).toEqual(["`b`", "``d ` e``", "```js\ncode\n```", "    indented", "    more"]);
    expect(findMarkdownCodeRanges("~~~\nopen fence to end")).toEqual([[0, 21]]);
    expect(findMarkdownCodeRanges("plain prose")).toEqual([]);
    // A list continuation (no blank line before) is not indented code.
    expect(findMarkdownCodeRanges("- item\n    continued")).toEqual([]);
  });
});
