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
    "didn't see not never no nothing nobody ".repeat(700),
    "a very good nice fine advice less much people ".repeat(600),
    "the tools that runs which is who make ".repeat(700),
    "how did he does it is an oldest less then more ".repeat(600),
    "I have plan the we have see all the ".repeat(700),
    "afraid from married with a in Monday a lot people between 1 to listen the went to home ".repeat(
      500,
    ),
  ];
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
});

// JavaScriptCore may run a regex in its interpreter (late in the full unit suite it does): a
// lookbehind with an unbounded run of spaces then rereads the run at every position. A child
// process without the regex JIT makes that cost visible for the slot and clause frames. A space
// run is one chunk, so the interpreter's time grows with it: doubling the run must about double
// the time (a quadratic frame quadruples it).
test("slot frames stay linear on long space runs without the regex JIT", () => {
  const module = `${import.meta.dir}/../../src/core/domain/grammar/review/reviewDiagnostics.ts`;
  const script = `
    const { prepareReview, reviewChunks, scanReviewChunk } = await import(${JSON.stringify(module)});
    const words = " didn't see nothing. a very good advice. less people. tools that runs. " +
      "how did he went. is best choice. I have plan the trip. If I would not have known. Do it. " +
      "afraid from the dark. see you in Monday. a lot people. went to home. stopped him of going. ";
    const rules = [
      "englishCountability", "englishUsagePhrases", "englishSubjectVerbAgreement",
      "englishAuxiliaryBaseVerb", "englishSentenceStructure", "englishDoubledDegree",
      "englishThenThan", "englishPerfectParticiples", "englishConfusedWords",
      "englishVerbComplements", "englishFixedPrepositions",
    ];
    const slowest = (n) => {
      const text = "x." + "\\t ".repeat(n) + words + " \\n".repeat(n) + words;
      let ms = 0;
      for (let run = 0; run < 2; run++) {
        const prepared = prepareReview(
          { id: "jit", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
          { lang: "en_US", enabledRules: rules, userDictionary: [], insertSpaceAfterAutocomplete: true },
        );
        for (const chunk of reviewChunks(prepared)) {
          const start = performance.now();
          scanReviewChunk(prepared, chunk);
          if (run) ms = Math.max(ms, performance.now() - start);
        }
      }
      return ms;
    };
    console.log(slowest(3000) / slowest(1500));`;
  const child = Bun.spawnSync([process.execPath, "-e", script], {
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  expect(child.exitCode).toBe(0);
  expect(Number(child.stdout.toString().trim())).toBeLessThan(3);
});
