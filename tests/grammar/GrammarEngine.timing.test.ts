import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { createLiveRules } from "../../src/core/domain/grammar/engine/liveRules";
import { cpuMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

/** The median CPU time of `runs` calls. */
const median = (runs: number, run: () => void) => {
  const times = Array.from({ length: runs }, () => cpuMs(run)).sort((a, b) => a - b);
  return times[runs >> 1];
};

const draft = readFileSync(
  new URL("../fixtures/native-review-corpus/reference.txt", import.meta.url),
  "utf8",
);

test("one keystroke through every typing rule stays under 1 ms", () => {
  const engine = new GrammarRuleEngine();
  for (const rule of createLiveRules({ insertSpaceAfterAutocomplete: true }))
    engine.registerRule(rule);
  const context = {
    beforeCursor: `${draft.slice(0, 400)} `,
    afterCursor: "",
    hints: { lang: "en_US", inputAction: "insert" as const, measurementContext: "prose" as const },
  };
  const keystroke = () => engine.process("wordBoundary", context);
  keystroke();
  expect(median(21, keystroke)).toBeLessThan(1);
});
