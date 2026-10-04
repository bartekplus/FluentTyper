import { expect, test } from "bun:test";
import { GERMAN_WORST_CASES } from "./germanWorstCase.fixture";
import { slowestChunkMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

test("no German chunk stalls on repeated determiners and lowercase nouns", () => {
  slowestChunkMs(GERMAN_WORST_CASES.join("\n"), "de_DE");
  for (const text of GERMAN_WORST_CASES) expect(slowestChunkMs(text, "de_DE")).toBeLessThan(100);
});
