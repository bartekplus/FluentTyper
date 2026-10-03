import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { findLiveGrammarProposals } from "../../src/core/domain/grammar/review/liveProposals";
import { requiredLiterals } from "../../src/core/domain/grammar/review/phraseTemplates";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { slowestChunkMs } from "./reviewHarness";

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
  "An because. In the third floor. Of curse. One in the same. Laughs of joy. Its a good day. " +
  "May be I. Does any one know. An on going. We will peer review it. Monday, 1 March 2023.";

test("a frame is gated only on letters every match consumes", () => {
  expect(requiredLiterals("(?<target>on)[ \\t]{1,8}face[ \\t]{1,8}value")).toEqual(["value"]);
  expect(requiredLiterals("(?<=because )(?:its|it's) own")).toEqual(["own"]);
  expect(requiredLiterals("colou?r (?:very )?happy(?:ness)*")).toEqual(["happy"]);
  expect(requiredLiterals("\\u00a0abc[xyz]+defg\\p{L}")).toEqual(["defg"]);
  expect(requiredLiterals("(?!nothing)\\p{L}+")).toEqual([]);
  // One literal for each branch, a letter in both cases as that letter.
  expect(requiredLiterals("this one|that one")).toEqual(["this", "that"]);
  expect(requiredLiterals("(?<target>[sS]eid|[Ww]eis)(?=x)")).toEqual(["seid", "weis"]);
  expect(requiredLiterals("(?:abc|de)fgh")).toEqual(["fgh"]);
  expect(requiredLiterals("(?:abc|de)")).toEqual([]);
  expect(requiredLiterals("(?:abc|def)?ghi|jk")).toEqual([]);
  expect(requiredLiterals("[sS]?eid")).toEqual(["eid"]);
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
    const start = performance.now();
    findLiveGrammarProposals(text, live);
    expect(performance.now() - start).toBeLessThan(50);
  }
});
