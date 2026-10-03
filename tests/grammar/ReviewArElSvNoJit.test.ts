import { expect, test } from "bun:test";
import { AR_EL_SV_WORST_CASES, slowestChunkMs } from "./arElSvWorstCase.fixture";

test("no Arabic, Greek or Swedish chunk stalls on long space runs", () => {
  for (const [lang, text] of AR_EL_SV_WORST_CASES) slowestChunkMs(lang, text);
  for (const [lang, text] of AR_EL_SV_WORST_CASES)
    expect(slowestChunkMs(lang, text)).toBeLessThan(100);
});

// Without the JIT, a lookbehind with an unbounded run of spaces rereads the run at every
// position (about 800 ms a chunk here); bounded frames stay near 20 ms.
test("no Arabic, Greek or Swedish chunk goes quadratic with the regex JIT off", () => {
  const run = Bun.spawnSync(["bun", "tests/grammar/arElSvWorstCase.fixture.ts"], {
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  expect(run.exitCode).toBe(0);
  expect(Number(run.stdout.toString())).toBeLessThan(250);
}, 60_000);
