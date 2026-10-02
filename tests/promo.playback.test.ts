import { expect, test } from "bun:test";
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
