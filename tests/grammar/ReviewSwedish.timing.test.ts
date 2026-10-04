import { expect, test } from "bun:test";
import { slowestChunkMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

test("a Swedish chunk with many candidates scans quickly", () => {
  const slowest = (text: string) => slowestChunkMs(text, "sv_SE");
  const inputs = [
    "en ett en ett ".repeat(900),
    "ett mörk kväll ".repeat(300),
    "mellan två ".repeat(800) + "till fyra",
    "2a 3e APIs Måndag ".repeat(250),
    "dem är med de. en till kaka ".repeat(250),
    `Det var bra ${"och ".repeat(900)}sa Johan.`,
  ];
  slowest(inputs.join("\n"));
  for (const text of inputs) expect(slowest(text)).toBeLessThan(100);
});
