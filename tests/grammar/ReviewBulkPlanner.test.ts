import { describe, expect, test } from "bun:test";
import { GRAMMAR_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import { MAX_PROOF_GROUP, planBulkFix } from "../../src/core/domain/grammar/review/bulkPlanner";
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
  positionThroughEdits,
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
    stillHold: (checks, others) => stillDetectedAfter(prepared, checks, others),
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
    const plan = planBulkFix("i has", [a, b], { stillHold: (checks) => checks.map(() => true) });
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

  test("context-dependent findings need a proof, else both are deferred", () => {
    // b's evidence (context) contains a's edit.
    const a = diagnostic([edit(3, 5, "..", ".")]);
    const b = diagnostic([edit(6, 7, "t", "T")], { context: { start: 3, end: 10 } });
    const unproven = planBulkFix("end.. then", [a, b]);
    expect(unproven.deferred.map((d) => d.reason)).toEqual(["unproven", "unproven"]);
    const proven = planBulkFix("end.. then", [a, b], {
      stillHold: (checks) => checks.map(() => true),
    });
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
    expect(stillDetectedAfter(prepared, [fake], [edit(0, 0, "", "and ")])).toEqual([false]);
  });

  test("proofs run in rounds: one call per round covers every linked group", () => {
    // Two independent pairs, each: b's evidence contains a's edit.
    const a1 = diagnostic([edit(0, 1, "a", "A")]);
    const b1 = diagnostic([edit(2, 3, "b", "B")], { context: { start: 0, end: 3 } });
    const a2 = diagnostic([edit(10, 11, "c", "C")]);
    const b2 = diagnostic([edit(12, 13, "d", "D")], { context: { start: 10, end: 13 } });
    const calls: Array<{ checks: string[]; others: number[] }> = [];
    const plan = planBulkFix("a b       c d", [a1, b1, a2, b2], {
      stillHold: (checks, others) => {
        calls.push({ checks: checks.map((c) => c.id), others: others.map((e) => e.start) });
        return checks.map((c) => c.id !== b2.id);
      },
    });
    expect(calls).toEqual([
      { checks: [a1.id, a2.id], others: [2, 12] },
      { checks: [b1.id, b2.id], others: [0, 10] },
    ]);
    // One failed member defers its own group only.
    expect(plan.diagnosticIds).toEqual([a1.id, b1.id]);
    expect(plan.deferred).toEqual([
      { id: a2.id, reason: "unproven" },
      { id: b2.id, reason: "unproven" },
    ]);
  });

  test("real findings: many linked groups are proven together, without one scan each", () => {
    const text = "yes i dont know. ".repeat(200);
    const { plan } = reviewAndPlan(text);
    expect(plan.deferred).toEqual([]);
    expect(plan.expectedText).toBe("Yes I don't know. ".repeat(200));
  });

  test('a fix to the word before "i" that makes it an identifier defers the pronoun fix', () => {
    const { diagnostics, plan } = reviewAndPlan("We printed teh i value.");
    const pronoun = diagnostics.find((d) => d.ruleId === "englishPronounICapitalization");
    expect(pronoun).toBeDefined();
    expect(plan.deferred).toContainEqual({ id: pronoun!.id, reason: "unproven" });
    expect(plan.expectedText).not.toContain(" I ");
  });

  test("a chain of linked fixes longer than the proof limit is left for individual review", () => {
    const chain = Array.from({ length: MAX_PROOF_GROUP + 1 }, (_, i) =>
      diagnostic([edit(i * 2, i * 2 + 1, "x", "X")], {
        context: { start: Math.max(0, i * 2 - 2), end: i * 2 + 1 },
      }),
    );
    let called = false;
    const plan = planBulkFix("x ".repeat(MAX_PROOF_GROUP + 1), chain, {
      stillHold: (checks) => {
        called = true;
        return checks.map(() => true);
      },
    });
    expect(called).toBe(false);
    expect(plan.diagnosticIds).toEqual([]);
    expect(new Set(plan.deferred.map((d) => d.reason))).toEqual(new Set(["unproven"]));
  });

  test("cascading findings appear only on recheck, never in the same batch", () => {
    const { plan } = reviewAndPlan("Thanks,,see you.");
    expect(plan.expectedText).toBe("Thanks,see you.");
    // The missing space is a new finding for the next scan, not applied now.
    expect(reviewAndPlan(plan.expectedText).plan.expectedText).toBe("Thanks, see you.");
  });
});

describe("adversarial review regressions: planning", () => {
  test("a sentence start decided by an abbreviation is never batched with the spacing fix", () => {
    for (const text of ["It costs approx . five dollars.", "pears etc . and more"]) {
      const { plan } = reviewAndPlan(text);
      expect(plan.expectedText).not.toMatch(/approx\. Five|etc\. And/);
      // Whatever is applied, the result is what re-detection agrees with.
      expect(applyEdits(text, plan.edits)).toBe(plan.expectedText);
    }
  });

  test("Fix all leaves objects, dialogue tags, named marks, hyphenated names and tables alone", () => {
    for (const text of [
      "Everything I told you was a lie. The gift I gave you was expensive.",
      "Saying thank you was the least I could do.",
      "“Stop!” she shouted. “Why?” he asked. He said, 'Stop!' and she left.",
      "In Vim, press . to repeat. Type ? for help.",
      "Run it with --dont-ask. Set the dont-care bits. Use alot-lib.",
      "| Application | `src/core/application/` | adapters, UI              |",
    ]) {
      expect(reviewAndPlan(text).plan.expectedText).toBe(text);
    }
    // What is left still gets fixed, CRLF included.
    expect(reviewAndPlan("Thanks!\r\nYour welcome\r\nBye").plan.expectedText).toBe(
      "Thanks!\r\nYou're welcome\r\nBye",
    );
    expect(reviewAndPlan("You was late. Hello . Next").plan.expectedText).toBe(
      "You were late. Hello. Next",
    );
  });

  test("Fix all fixes stray marks and dashes, and leaves a clause's subject for review", () => {
    expect(reviewAndPlan("It was late . we left.").plan.expectedText).toBe("It was late. We left.");
    expect(reviewAndPlan("I dont--really--care.").plan.expectedText).toBe("I don't--really--care.");
    // "you was" after a clause-opening verb is found, but fixed one at a time.
    for (const text of ["I heard you was sick.", "I was hoping you was coming."]) {
      const { diagnostics, plan } = reviewAndPlan(text);
      expect(diagnostics.map((d) => d.original)).toEqual(["you was"]);
      expect(plan.expectedText).toBe(text);
    }
  });
});

describe("text ranges", () => {
  test("applyEdits rejects an insertion touching another edit, wherever it is", () => {
    expect(applyEdits("ab", [edit(2, 2, "", "x"), edit(2, 2, "", "y")])).toBeNull();
    expect(applyEdits("ab", [edit(1, 1, "", "x"), edit(1, 2, "b", "B")])).toBeNull();
    expect(applyEdits("ab", [edit(0, 1, "a", "A"), edit(1, 1, "", "x")])).toBeNull();
    expect(applyEdits("ab", [edit(2, 2, "", "!"), edit(0, 1, "a", "A")])).toBe("Ab!");
  });

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

  test("grapheme boundaries inside long runs of flags", () => {
    const flags = "\u{1F1FA}\u{1F1F8}".repeat(12);
    for (let index = 0; index <= flags.length; index += 1) {
      expect(isGraphemeBoundary(flags, index)).toBe(index % 4 === 0);
    }
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

  test("a caret between separate fixes keeps its place; one inside a fix moves past it", () => {
    // "teh  cat and teh dog" -> "the cat and the dog"
    const edits = [edit(1, 3, "eh", "he"), edit(3, 5, "  ", " "), edit(14, 16, "eh", "he")];
    expect(positionThroughEdits(0, edits)).toBe(0);
    expect(positionThroughEdits(1, edits)).toBe(1);
    expect(positionThroughEdits(2, edits)).toBe(3);
    expect(positionThroughEdits(6, edits)).toBe(5);
    expect(positionThroughEdits(13, edits)).toBe(12);
    expect(positionThroughEdits(15, edits)).toBe(15);
    expect(positionThroughEdits(20, edits)).toBe(19);
    // An insertion at the caret goes after it; order of edits does not matter.
    expect(positionThroughEdits(3, [edit(3, 3, "", "!"), edit(0, 1, "a", "")])).toBe(2);
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
