import { expect, test } from "bun:test";
import {
  finalizeReview,
  finalizeReviewAsync,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { prepared } from "./grammarTestUtils";

function scansOf(text: string) {
  const ready = prepared(text);
  return { ready, scans: reviewChunks(ready).map((chunk) => scanReviewChunk(ready, chunk)) };
}

test("the async finalize gives the sync result", async () => {
  const { ready, scans } = scansOf("We is ready. Teh cat sat on the the mat.");
  let pauses = 0;
  const result = await finalizeReviewAsync(ready, scans, {}, async () => {
    pauses += 1;
  });
  expect(result).toEqual(finalizeReview(ready, scans));
  expect(pauses).toBe(0);
});
