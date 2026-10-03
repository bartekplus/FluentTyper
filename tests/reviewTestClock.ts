import { setReviewClock } from "../src/core/domain/grammar/review/reviewClock";

/**
 * The day every test suite sees as "today" for Review's date checks (bun-test-preload.ts sets
 * it). A test that needs another day calls useReviewDay and then restoreReviewDay.
 */
export const TEST_REVIEW_NOW = new Date("2026-10-03T12:00:00").getTime();

/** Fixes Review's "today" to local noon of `day` ("YYYY-MM-DD"). */
export function useReviewDay(day: string): void {
  setReviewClock(new Date(`${day}T12:00:00`).getTime());
}

export function restoreReviewDay(): void {
  setReviewClock(TEST_REVIEW_NOW);
}
