import { expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";

// Worst cases for the English apostrophe, typography and naming frames: every word opens one.
const options = {
  lang: "en_US",
  enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};

function slowestChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "tables", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    options,
  );
  let slowest = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    slowest = Math.max(slowest, performance.now() - start);
  }
  return slowest;
}

test("no chunk stalls on runs of frame-opening words", () => {
  const inputs = [
    "two lamp's ".repeat(1_500),
    "many old CD's ".repeat(1_200),
    "he see's it ".repeat(1_500),
    "who's car is ".repeat(1_200),
    "other's ideas ".repeat(1_200),
    "last weeks game ".repeat(1_000),
    "I' m they 're ".repeat(1_000),
    "we''ll ".repeat(2_000),
    "most user's would ".repeat(1_000),
    "french polish ".repeat(1_500),
    "the excel file ".repeat(1_200),
    "you tube google ".repeat(1_200),
    "1.250.000,5 7,5% ".repeat(1_000),
    "U.S.A e.g PH.D ".repeat(1_000),
    '4 x 5 -> "a" (c) 1914-1918 '.repeat(600),
    "cold - very ".repeat(1_500),
    "Why do not you with who you ".repeat(800),
    "combined together wanna ".repeat(1_000),
    "was not always generally quickly made up by ".repeat(500),
    "If I can with it I Do you know, if neither a, nor ".repeat(400),
    "June 16,1963 Friday July 15 October, 1958 ".repeat(400),
    "in Big Blue Green Sea is oldest city in lot of ".repeat(400),
  ];
  // Warm-up: the first scan compiles every frame and decodes the lexicon.
  for (const text of inputs) slowestChunkMs(text);
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
});
