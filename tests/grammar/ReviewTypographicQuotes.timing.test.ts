import { describe, expect, test } from "bun:test";
import { QUOTES_WORST_CASES } from "./quotesWorstCase.fixture";
import { chunkTimes } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

describe("typographicQuotes", () => {
  test("no chunk is slow on adversarial quote runs", () => {
    for (const ms of chunkTimes(QUOTES_WORST_CASES)) expect(ms).toBeLessThan(100);
  });
});
