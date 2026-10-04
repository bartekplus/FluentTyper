import { expect, test } from "bun:test";
import { slowestChunkMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

test("a Greek chunk with many candidates scans quickly", () => {
  const slowest = (text: string) => slowestChunkMs(text, "el_GR");
  const inputs = [
    "τη δε μη κι το που πως ".repeat(600),
    `Που ${"λέξη ".repeat(900)};`,
    "έχω έχω έχω πάω ".repeat(700),
    "πιο ".repeat(1_500) + "καλύτερος",
    "Συνεπώς ".repeat(1_000),
  ];
  slowest(inputs.join("\n"));
  for (const text of inputs) expect(slowest(text)).toBeLessThan(100);
});
