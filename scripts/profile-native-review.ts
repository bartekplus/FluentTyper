/** Run with `bun scripts/profile-native-review.ts`. Authored local fixtures only. */
import assert from "node:assert/strict";
import { planBulkFix } from "../src/core/domain/grammar/review/bulkPlanner";
import { REVIEW_DETECTORS } from "../src/core/domain/grammar/review/reviewDetectors";
import {
  detectReviewDiagnostics,
  finalizeReview,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
  stillDetectedAfter,
} from "../src/core/domain/grammar/review/reviewDiagnostics";
import { GRAMMAR_RULE_IDS } from "../src/core/domain/grammar/ruleCatalog";
import type { ReviewOptions } from "../src/core/domain/grammar/review/types";

const options: ReviewOptions = {
  lang: "en_US",
  enabledRules: GRAMMAR_RULE_IDS,
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};
const paragraphs = {
  clean:
    "The team reviewed the draft today. We discussed the evidence and recorded our conclusions. The next meeting will cover the remaining questions.\n\n",
  proof: "It was late . we left. It costs approx . five dollars. We waited for the next train.\n\n",
  errors:
    "this  draft has has several errors. We should of checked the notes. She don't agree with the proposal. We use github for the project.\n\n",
};
const median = (values: number[]) =>
  Number(values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(3));

console.log(JSON.stringify({ runtime: Bun.version, warmups: 5, samples: 21 }));
for (const [kind, paragraph] of Object.entries(paragraphs)) {
  for (const size of [1_000, 10_000, 50_000]) {
    const text = paragraph.repeat(Math.ceil(size / paragraph.length)).slice(0, size);
    const snapshot = { id: "profile", text, scope: { start: 0, end: size }, protectedRanges: [] };
    const timings = { preparation: [], detection: [], finalization: [], bulk: [] } as Record<
      string,
      number[]
    >;
    let phase: "detection" | "proof" = "detection";
    const run = () => {
      let start = performance.now();
      const prepared = prepareReview(snapshot, options);
      const preparation = performance.now() - start;
      start = performance.now();
      phase = "detection";
      const chunks = reviewChunks(prepared);
      const scans = chunks.map((chunk) => scanReviewChunk(prepared, chunk));
      const detection = performance.now() - start;
      start = performance.now();
      const result = finalizeReview(prepared, scans);
      const finalization = performance.now() - start;
      let proofRequests = 0;
      let proofMs = 0;
      start = performance.now();
      phase = "proof";
      const plan = planBulkFix(text, result.diagnostics, {
        stillHold: (checks, edits) => {
          proofRequests++;
          const before = performance.now();
          const answer = stillDetectedAfter(prepared, checks, edits);
          proofMs += performance.now() - before;
          return answer;
        },
      });
      return {
        times: { preparation, detection, finalization, bulk: performance.now() - start },
        proofRequests,
        proofMs,
        result,
        plan,
        chunks: chunks.length,
      };
    };
    for (let n = 0; n < 5; n++) run();
    const proofTimes: number[] = [];
    for (let n = 0; n < 21; n++) {
      const sample = run();
      for (const [phase, ms] of Object.entries(sample.times)) timings[phase].push(ms);
      proofTimes.push(sample.proofMs);
    }

    // Instrument a separate run: per-detector clocks never inflate the medians above.
    const counts = REVIEW_DETECTORS.map(() => ({ detection: 0, proof: 0, ms: 0 }));
    const originals = REVIEW_DETECTORS.map((detector) => detector.detect);
    let measured: ReturnType<typeof run>;
    try {
      REVIEW_DETECTORS.forEach((detector, index) => {
        detector.detect = (context) => {
          const start = performance.now();
          counts[index][phase]++;
          try {
            return originals[index](context);
          } finally {
            counts[index].ms += performance.now() - start;
          }
        };
      });
      measured = run();
    } finally {
      REVIEW_DETECTORS.forEach((detector, index) => (detector.detect = originals[index]));
    }
    assert.deepEqual(measured.result, detectReviewDiagnostics(snapshot, options));
    assert.equal(measured.result.coverage.failedRules.length, 0);
    assert.equal(kind === "clean", measured.result.diagnostics.length === 0);
    if (kind === "proof") assert.ok(measured.proofRequests > 0);
    console.log(
      JSON.stringify({
        kind,
        size,
        chunks: measured.chunks,
        diagnostics: measured.result.diagnostics.length,
        bulkEdits: measured.plan.edits.length,
        proofRequests: measured.proofRequests,
        medianMs: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, median(v)])),
        proofMedianMs: median(proofTimes),
        detectorCalls: counts.reduce((sum, count) => sum + count.detection, 0),
        proofDetectorCalls: counts.reduce((sum, count) => sum + count.proof, 0),
        detectors: REVIEW_DETECTORS.map((detector, i) => ({
          rules: detector.rules,
          detectionCalls: counts[i].detection,
          proofCalls: counts[i].proof,
          ms: Number(counts[i].ms.toFixed(3)),
        })).toSorted((a, b) => b.ms - a.ms),
      }),
    );
  }
}
