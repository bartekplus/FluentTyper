import { expect, test, spyOn } from "bun:test";
import { NativeReviewCache } from "../../src/core/domain/grammar/review/nativeReviewCache";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
  finalizeReview,
  detectReviewDiagnostics,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { REVIEW_DETECTORS } from "../../src/core/domain/grammar/review/reviewDetectors";
import { planBulkFix } from "../../src/core/domain/grammar/review/bulkPlanner";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
const options: ReviewOptions = {
  lang: "en_US",
  enabledRules: ["englishFixedPrepositions", "englishUsagePhrases", "unclosedQuotation"],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};
const paragraph =
  "We discussed about the plan. They are one in the same. This story peaked my interest.\n\n";
function scan(
  cache: NativeReviewCache,
  text: string,
  id: string,
  opts = options,
  extra: Partial<ReviewSourceSnapshot> = {},
) {
  const snapshot = {
    id,
    text,
    scope: { start: 0, end: text.length },
    protectedRanges: [],
    ...extra,
  };
  const prepared = prepareReview(snapshot, opts);
  const result = finalizeReview(
    prepared,
    reviewChunks(prepared).map((chunk) => scanReviewChunk(prepared, chunk, cache)),
  );
  const full = detectReviewDiagnostics(snapshot, opts);
  expect(result).toEqual(full);
  expect(planBulkFix(text, result.diagnostics)).toEqual(planBulkFix(text, full.diagnostics));
  return result;
}

test("native reuse skips unchanged chunks and remaps findings to fresh snapshot IDs", () => {
  const cache = new NativeReviewCache();
  const detector = REVIEW_DETECTORS.find((d) => d.rules[0] === "englishFixedPrepositions")!;
  const spy = spyOn(detector, "detect");
  try {
    const text = Array.from({ length: 200 }, (_, i) => `${paragraph}Record ${i}.\n\n`).join("");
    scan(cache, text, "a");
    spy.mockClear();
    const edited = "A new opening paragraph.\n\n" + text;
    const result = scan(cache, edited, "b");
    const chunks = reviewChunks(
      prepareReview(
        { id: "b", text: edited, scope: { start: 0, end: edited.length }, protectedRanges: [] },
        options,
      ),
    ).length;
    // Includes the oracle's calls; fewer than two full scans proves reuse.
    expect(spy.mock.calls.length).toBeLessThan(chunks * 2);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((d) => d.id.startsWith("b/"))).toBe(true);
    cache.clear();
    spy.mockClear();
    scan(cache, edited, "c");
    expect(spy.mock.calls.length).toBe(chunks * 2);
  } finally {
    spy.mockRestore();
  }
});

test("native cache invalidates fences, dictionary, rules, protection and partial scope", () => {
  const cache = new NativeReviewCache();
  const text = paragraph.repeat(70);
  scan(cache, text, "a");
  expect(scan(cache, "```\n" + text, "fence").diagnostics).toEqual([]);
  scan(cache, text, "dictionary", { ...options, userDictionary: ["discussed", "story"] });
  scan(cache, text, "rules", { ...options, enabledRules: ["englishUsagePhrases"] });
  scan(cache, text, "protected", options, {
    protectedRanges: [{ start: 0, end: text.length, reason: "code" }],
  });
  scan(cache, text, "selection", options, { selection: true, scope: { start: 9, end: 4500 } });
  scan(cache, text, "unread", options, { incomplete: true });
});

test("seeded edits preserve exact full-scan diagnostics, context, coverage and bulk decisions", () => {
  const cache = new NativeReviewCache();
  let text = paragraph.repeat(62);
  let seed = 71039;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const inserts = ["", "x", "\n", "\n\n", '"', "‘", "🙂", " about ", 'literal: "', ".", "\u0301"];
  for (let n = 0; n < 100; n++) {
    const at = n % 5 === 0 ? Math.min(4000, text.length) : random(text.length + 1);
    text =
      text.slice(0, at) +
      inserts[random(inserts.length)] +
      text.slice(Math.min(text.length, at + random(4)));
    scan(cache, text, `edit${n}`);
  }
});

test("native cache evicts bounded entries and falls back for oversized keys", () => {
  const detector = REVIEW_DETECTORS.find((d) => d.rules[0] === "englishFixedPrepositions")!;
  const spy = spyOn(detector, "detect");
  try {
    for (const dictionarySize of [0, 30_000, 600_000]) {
      const cache = new NativeReviewCache();
      const opts = {
        ...options,
        userDictionary: dictionarySize ? ["z".repeat(dictionarySize)] : [],
      };
      const count = dictionarySize === 0 ? 70 : dictionarySize === 30_000 ? 12 : 2;
      for (let i = 0; i < count; i++) scan(cache, `${paragraph}Record ${i}.`, `${i}`, opts);
      spy.mockClear();
      scan(cache, `${paragraph}Record 0.`, "again", opts);
      // First fixture is evicted, or was too large to retain: cached path + oracle each call.
      expect(spy.mock.calls.length).toBe(2);
    }
  } finally {
    spy.mockRestore();
  }
});
