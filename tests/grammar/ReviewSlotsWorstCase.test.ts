import { expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";

// Worst cases for the lexicon slot frames in review/english/*Slots.ts: every word starts a
// frame and the token reader looks ahead from each one.
const options = {
  lang: "en_US",
  enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};

function slowestChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "slots", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
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

const SLOT_WORDS =
  "its your it you to too two the a an this these those many much each every other have has " +
  "had be is was were do does did can could would should there here people not no I he she we " +
  "who that me myself and ";

test("no chunk stalls on runs of slot-opening words or spaces between them", () => {
  slowestChunkMs(SLOT_WORDS.repeat(40));
  const inputs = [
    SLOT_WORDS.repeat(160),
    SLOT_WORDS.split(" ").join(" ".repeat(60)).repeat(8),
    "its very very very ".repeat(1_500),
    "the the the the ".repeat(1_500),
    "There a lot of ".repeat(1_000),
    "could possible ".repeat(2_000),
    "people thinks ".repeat(2_000),
    ". The tall guys who met him yesterday really ".repeat(500),
    "Tim and me and Sam and me went ".repeat(600),
    "better a b c d e then ".repeat(800),
    "an ever by then were where ".repeat(700),
    "there is many a few there are no ".repeat(700),
  ];
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
});
