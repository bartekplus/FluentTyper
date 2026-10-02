import { expect, test } from "bun:test";
import { isReviewWriteComplete } from "../marketing/promo/scripts/review-write-state.mjs";
import {
  assertCompletePlayback,
  EXPECTED_DURATION,
  EXPECTED_FRAMES,
} from "../marketing/promo/scripts/playback-validation.mjs";

const complete = {
  error: null,
  duration: EXPECTED_DURATION,
  currentTime: EXPECTED_DURATION,
  dropped: 0,
  decoded: EXPECTED_FRAMES,
  videoFrames: EXPECTED_FRAMES,
};

test("accepts complete playback for each independent run", () => {
  for (const muted of [false, true])
    expect(() => assertCompletePlayback({ ...complete, muted })).not.toThrow();
});

test("rejects degraded playback even when the video reaches its end", () => {
  for (const patch of [
    { dropped: 1 },
    { decoded: EXPECTED_FRAMES - 1 },
    { videoFrames: EXPECTED_FRAMES - 1 },
    { decoded: EXPECTED_FRAMES * 2, videoFrames: EXPECTED_FRAMES * 2 },
    { decoded: undefined },
    { videoFrames: undefined },
    { dropped: undefined },
    { duration: EXPECTED_DURATION - 1 },
    { currentTime: NaN },
    { currentTime: EXPECTED_DURATION - 1 },
    { error: "Decode failed" },
  ])
    expect(() => assertCompletePlayback({ ...complete, ...patch })).toThrow();
});

test("waits for both the review write and diagnostics before filming", () => {
  const text = "I received the report. We should have reviewed it on Monday.";
  const ready = { open: true, spelling: "done", items: [], fixAll: { disabled: true } };
  expect(isReviewWriteComplete("Old draft", ready, text, 0)).toBe(false);
  expect(isReviewWriteComplete(text, { ...ready, items: [{ id: "old-finding" }] }, text, 0)).toBe(
    false,
  );
  expect(isReviewWriteComplete(text, { ...ready, spelling: "loading" }, text, 0)).toBe(false);
  expect(isReviewWriteComplete(text, { ...ready, fixAll: { disabled: false } }, text, 0)).toBe(
    false,
  );
  expect(isReviewWriteComplete(text, ready, text, 0)).toBe(true);
  const partial = { ...ready, items: [{ id: "remaining-finding" }], fixAll: { disabled: false } };
  expect(isReviewWriteComplete(text, partial, text, partial.items.length)).toBe(true);
  expect(
    isReviewWriteComplete(
      text,
      { ...partial, fixAll: { disabled: true } },
      text,
      partial.items.length,
    ),
  ).toBe(false);
});
