import { expect, test } from "bun:test";
import {
  finalizeReview,
  finalizeReviewAsync,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  REPAIR_WINDOW,
  repairShadow,
  repairWindows,
  selectRepairs,
} from "../../src/core/domain/grammar/review/repairPass";
import { REVIEW_CHUNK_CHARS } from "../../src/core/domain/grammar/review/types";
import { prepared } from "./grammarTestUtils";
import { scan } from "./reviewHarness";

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

test("a contraction that only lacks its apostrophe is a repair", () => {
  const repairs = selectRepairs(scan("Bob cant go."));
  expect(repairs.map((d) => [d.original, d.alternatives[0].preview])).toEqual([["cant", "can't"]]);
});

test("a contraction its detector doubts is no repair", () => {
  // "wont" is read from context (context-dependent); "Somethings" has two fixes.
  expect(selectRepairs(scan("I wont go there."))).toEqual([]);
  expect(selectRepairs(scan("Somethings going well."))).toEqual([]);
});

test("the shadow maps positions both ways", () => {
  const text = "We didnt see it and dont care.";
  const shadow = repairShadow(selectRepairs(scan(text)));
  expect(shadow.repairs.map((d) => d.original)).toEqual(["didnt", "dont"]);
  // Outside the repaired words, a position goes there and back unchanged.
  for (const position of [0, 3, 9, 16, 20, text.length])
    expect(shadow.fromShadow(shadow.toShadow(position))).toBe(position);
  const shadowText = "We didn't see it and don't care.";
  expect(shadow.spans.map((span) => shadowText.slice(span.start, span.end))).toEqual([
    "didn't",
    "don't",
  ]);
});

test("repair windows are clipped, joined and split", () => {
  const scope = { start: 0, end: 20_000 };
  expect(repairWindows([{ start: 10, end: 15 }], scope)).toEqual([
    { start: 0, end: 15 + REPAIR_WINDOW },
  ]);
  expect(
    repairWindows(
      [
        { start: 1_000, end: 1_005 },
        { start: 1_100, end: 1_105 },
      ],
      scope,
    ),
  ).toEqual([{ start: 1_000 - REPAIR_WINDOW, end: 1_105 + REPAIR_WINDOW }]);
  const dense = Array.from({ length: 100 }, (_, i) => ({ start: i * 100, end: i * 100 + 4 }));
  const windows = repairWindows(dense, scope);
  expect(windows.every((w) => w.end - w.start <= REVIEW_CHUNK_CHARS)).toBe(true);
  expect(windows[0].start).toBe(0);
  expect(windows.at(-1)?.end).toBe(9_904 + REPAIR_WINDOW);
  for (let i = 1; i < windows.length; i += 1) expect(windows[i].start).toBe(windows[i - 1].end);
});
