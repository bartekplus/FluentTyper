/** Domain candidate: bun scripts/profile-native-reuse.ts (five warmups, 21 A/B/A samples). */
import assert from "node:assert/strict";
import { NativeReviewCache } from "../src/core/domain/grammar/review/nativeReviewCache";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
  finalizeReview,
} from "../src/core/domain/grammar/review/reviewDiagnostics";
import { GRAMMAR_RULE_IDS } from "../src/core/domain/grammar/ruleCatalog";
const options = {
  lang: "en_US",
  enabledRules: GRAMMAR_RULE_IDS,
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};
const paragraph =
  "We discussed about the plan. They are one in the same. This story peaked my interest. The team checked the evidence before recording its conclusions.\n\n";
const median = (v: number[]) => v.toSorted((a, b) => a - b)[Math.floor(v.length / 2)];
for (const size of [1000, 10000, 50000]) {
  const text = Array.from({ length: 400 }, (_, i) => `${paragraph}Record ${i}.\n\n`)
    .join("")
    .slice(0, size);
  const edited = text.replace("Record 3.", "Record 4.");
  const cache = new NativeReviewCache();
  const run = (source: string, reused?: NativeReviewCache) => {
    const p = prepareReview(
      { id: "probe", text: source, scope: { start: 0, end: source.length }, protectedRanges: [] },
      options,
    );
    return finalizeReview(
      p,
      reviewChunks(p).map((c) => scanReviewChunk(p, c, reused)),
    );
  };
  for (let i = 0; i < 5; i++) {
    run(text);
    run(text, cache);
  }
  const full: number[] = [],
    cached: number[] = [];
  for (let i = 0; i < 21; i++) {
    cache.clear();
    run(text, cache);
    let t = performance.now();
    const before = run(edited);
    full.push(performance.now() - t);
    t = performance.now();
    const reuse = run(edited, cache);
    cached.push(performance.now() - t);
    t = performance.now();
    const after = run(edited);
    full.push(performance.now() - t);
    assert.deepEqual(reuse, before);
    assert.deepEqual(reuse, after);
  }
  console.log(JSON.stringify({ size, fullMedianMs: median(full), cachedMedianMs: median(cached) }));
}
