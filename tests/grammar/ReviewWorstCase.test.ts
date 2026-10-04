import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { findLiveGrammarProposals } from "../../src/core/domain/grammar/review/liveProposals";
import { requiredLiteral } from "../../src/core/domain/grammar/review/phraseTemplates";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";

const options = {
  lang: "en_US",
  enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};
const BROKEN = readFileSync("tests/fixtures/native-review-corpus/broken.txt", "utf8");
// Frames whose clause lookbehinds once reread long runs of spaces at every position.
const TRIGGERS =
  "Halo, has we. On face value. In route to. Suffice to say. Do the mistakes. You out to be. " +
  "An because. In the third floor. Of curse. One in the same. Laughs of joy. Its a good day.";

/**
 * CPU time of this thread in ms: a backtracking regression shows here, while time
 * spent waiting for a core (other test workers running in parallel) does not.
 */
function cpuMs(run: () => void): number {
  const start = process.threadCpuUsage();
  run();
  const { user, system } = process.threadCpuUsage(start);
  return (user + system) / 1000;
}

function slowestChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    options,
  );
  let slowest = 0;
  for (const chunk of reviewChunks(prepared)) {
    slowest = Math.max(
      slowest,
      cpuMs(() => scanReviewChunk(prepared, chunk)),
    );
  }
  return slowest;
}

test("a frame is gated only on letters every match consumes", () => {
  expect(requiredLiteral("(?<target>on)[ \\t]{1,8}face[ \\t]{1,8}value")).toBe("value");
  expect(requiredLiteral("(?<=because )(?:its|it's) own")).toBe("own");
  expect(requiredLiteral("colou?r (?:very )?happy(?:ness)*")).toBe("happy");
  expect(requiredLiteral("\\u00a0abc[xyz]+defg\\p{L}")).toBe("defg");
  expect(requiredLiteral("(?!nothing)\\p{L}+")).toBe("");
  expect(requiredLiteral("this one|that one")).toBe("");
});

// Generous bounds: before, a chunk of these took 0.25-1 s in JavaScriptCore (a scan is ~10 ms).
test("no chunk stalls on long runs of spaces and tabs or repeated trigger words", () => {
  // Warm every regex first: JavaScriptCore's slow paths appear once a regex is hot.
  slowestChunkMs(`${BROKEN}\n${TRIGGERS}`.repeat(3));
  const inputs = [
    "\t ".repeat(6_000),
    `x${" ".repeat(3_800)}${TRIGGERS}`.repeat(3),
    `x.${"\t ".repeat(1_900)}${TRIGGERS}`.repeat(3),
    "its ".repeat(3_000),
    "Laughs of joy. ".repeat(800),
  ];
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
});

test("a typing-time check stays fast on the same inputs", () => {
  const live = { ...options, liveRules: [] };
  for (const text of [`x${" ".repeat(450)}${TRIGGERS}`, "its ".repeat(200), TRIGGERS]) {
    findLiveGrammarProposals(text, live);
    expect(cpuMs(() => findLiveGrammarProposals(text, live))).toBeLessThan(50);
  }
});
