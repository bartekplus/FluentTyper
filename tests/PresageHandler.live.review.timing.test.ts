import { describe, expect, test } from "bun:test";
import { cpuMs } from "./grammar/reviewHarness";
import { createLiveConfig, createLiveHandler } from "./support/presageLive";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

describe("PresageHandler live review spelling", () => {
  test("foreign words and stray letters are quick to look up in the large dictionaries", async () => {
    // Before the affix tuning and the single-round pool these took 300-700 ms each
    // (about 3 s in all), now mostly well under 100 ms. The bound is generous.
    const handler = await createLiveHandler();
    handler.setConfig(createLiveConfig([]));
    const words: Record<string, string[]> = {
      pt_BR: ["understanding", "maintenant", "essentiellement", "dd"],
      pl_PL: ["naj", "understanding", "dd", "ll"],
      el_GR: ["understanding", "maintenant"],
      fr_FR: ["understanding", "dd"],
    };
    let elapsed = 0;
    for (const [lang, list] of Object.entries(words)) {
      for (const word of list) {
        let result: string[] | null = null;
        // Thread CPU time: time spent waiting for a core (parallel test workers) does not count.
        elapsed += cpuMs(() => {
          [result] = handler.lookupSpelling(lang, [{ word, before: "" }])!;
        });
        expect(result).not.toBeNull();
      }
    }
    expect(elapsed).toBeLessThan(1500);
  }, 30_000);
});
