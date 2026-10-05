import { expect, test } from "bun:test";
import {
  finalizeReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { prepared } from "./grammarTestUtils";
import { cpuMs } from "./reviewHarness";

// Time budget (thread CPU time). bun run test runs *.timing.test.ts files serially.
// Measured 2026-10-05: about 305 ms (the chunk scans of the same text: about 332 ms).
const BUDGET_MS = 700;

test("a text full of contraction typos finalizes quickly", () => {
  const text = "We dont need no tests and I cant hardly wait. ".repeat(1_100).slice(0, 50_000);
  const ready = prepared(text);
  const scans = reviewChunks(ready).map((chunk) => scanReviewChunk(ready, chunk));
  finalizeReview(ready, scans);
  expect(cpuMs(() => finalizeReview(ready, scans))).toBeLessThan(BUDGET_MS);
});
