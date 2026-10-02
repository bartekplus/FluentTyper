export const EXPECTED_DURATION = 42;
export const EXPECTED_FRAMES = EXPECTED_DURATION * 30;

export function assertCompletePlayback(result) {
  if (
    result.error !== null ||
    result.duration !== EXPECTED_DURATION ||
    !(result.currentTime >= EXPECTED_DURATION - 0.1 && result.currentTime <= EXPECTED_DURATION) ||
    result.dropped !== 0 ||
    result.decoded !== EXPECTED_FRAMES ||
    result.videoFrames !== EXPECTED_FRAMES
  )
    throw new Error("Incomplete or degraded playback: " + JSON.stringify(result));
}
