import { expect, test } from "bun:test";

// Without the regex JIT (JavaScriptCore's fallback), an unbounded quantifier inside a lookbehind
// goes quadratic on long runs of spaces. The script times the Portuguese worst cases in a child
// process with the JIT off; a linear scan stays well under a second per chunk.
test("Portuguese frames stay linear with the regex JIT off", () => {
  const run = Bun.spawnSync([process.execPath, "tests/grammar/portugueseWorstCase.ts"], {
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  expect(run.exitCode).toBe(0);
  const times = JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!) as number[];
  for (const ms of times) expect(ms).toBeLessThan(1_000);
}, 120_000);
