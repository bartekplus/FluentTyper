import { expect, test } from "bun:test";
import {
  finalizeReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { prepared } from "./grammarTestUtils";
import { cpuMs } from "./reviewHarness";

// Time budget (thread CPU time). bun run test runs *.timing.test.ts files serially.
// Measured 2026-10-05: about 160 ms (repairs every 10 words) and 120 ms (nearly every word).
const BUDGET_MS = 400;

test("a text full of contraction typos finalizes quickly", () => {
  const text = "We dont need no tests and I cant hardly wait. ".repeat(1_100).slice(0, 50_000);
  const ready = prepared(text);
  const scans = reviewChunks(ready).map((chunk) => scanReviewChunk(ready, chunk));
  finalizeReview(ready, scans);
  expect(cpuMs(() => finalizeReview(ready, scans))).toBeLessThan(BUDGET_MS);
});

test("a text where nearly every word is a contraction typo finalizes quickly", () => {
  const text = "dont go. isnt it. wasnt it. ".repeat(2_000).slice(0, 50_000);
  const ready = prepared(text);
  const scans = reviewChunks(ready).map((chunk) => scanReviewChunk(ready, chunk));
  finalizeReview(ready, scans);
  expect(cpuMs(() => finalizeReview(ready, scans))).toBeLessThan(BUDGET_MS);
});
