import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LocalReviewEngine } from "../../src/core/application/review/LocalReviewEngine";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";

const options = {
  lang: "en_US",
  enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};
// An ordinary draft. In an error-dense one (broken.txt) the repair pass, which is still
// text-wide, takes most of a recheck: about 2x faster than a full scan, not 10x.
const DRAFT = readFileSync("tests/fixtures/native-review-corpus/reference.txt", "utf8");
// Under the 50k limit also after the edits below: a longer text is always scanned whole.
const TEXT = DRAFT.repeat(7).slice(0, 49_000);

const request = (text: string, cache: boolean) => ({
  snapshot: { id: "t", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
  options,
  cache,
  gaps: {},
  uiLanguage: "en",
});

/** Thread CPU time in ms of one scan (the engine's pauses are no-ops). */
async function scanMs(engine: LocalReviewEngine, text: string, cache: boolean): Promise<number> {
  const start = process.threadCpuUsage();
  await engine.scan(request(text, cache));
  const { user, system } = process.threadCpuUsage(start);
  return (user + system) / 1000;
}

test("after one typed character, a 49k field is rechecked only around it", async () => {
  const pause = () => Promise.resolve();
  const engine = new LocalReviewEngine(pause);
  // Warm the detectors' regexes first.
  await scanMs(new LocalReviewEngine(pause), TEXT, false);
  const full = await scanMs(new LocalReviewEngine(pause), TEXT, false);
  await scanMs(engine, TEXT, true);
  let text = TEXT;
  const times: number[] = [];
  for (const at of [1_000, 20_000, 35_000, 49_000]) {
    text = `${text.slice(0, at)}x${text.slice(at)}`;
    times.push(await scanMs(engine, text, true));
  }
  const slowest = Math.max(...times);
  // Measured on an M2 Max: a full scan of about 340 ms, a recheck of about 25 ms (prepare
  // and finalize still read the whole text).
  expect(slowest).toBeLessThan(full / 4);
});
