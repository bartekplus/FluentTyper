import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";

// Adversarial inputs for typographicQuotes: one long line full of quote marks, so every chunk
// rereads the line from its start. Run directly (bun tests/grammar/quotesWorstCase.fixture.ts)
// it prints the slowest chunk in milliseconds, so a test can time it with the regex JIT off
// (BUN_JSC_useRegExpJIT=0).
export const QUOTES_WORST_CASES: Array<[string, string]> = [
  ["en_US", 'a "b" '.repeat(8_000)],
  ["en_US", `"x 'y' z" don't `.repeat(4_000)],
  ["en_US", '"a '.repeat(12_000)],
  ["en_US", "'a ".repeat(12_000)],
  ["en_US", '"'.repeat(30_000)],
  ["de_DE", "„a „b „c ".repeat(5_000)],
  ["fr_FR", '« a "b" » '.repeat(5_000)],
  ["sv_SE", 'a ”b "c" d” '.repeat(4_000)],
  ["pl_PL", `"a" 'b' it's 5'2" `.repeat(3_000)],
];

export function slowestChunkMs(lang: string, text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang,
      enabledRules: ["typographicQuotes"],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  );
  let ms = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    ms = Math.max(ms, performance.now() - start);
  }
  return ms;
}

if (import.meta.main) {
  for (const [lang, text] of QUOTES_WORST_CASES) slowestChunkMs(lang, text);
  const times = QUOTES_WORST_CASES.map(([lang, text]) => slowestChunkMs(lang, text));
  if (process.argv.includes("--verbose")) console.error(times.map((t) => t.toFixed(1)).join(" "));
  console.log(Math.max(...times).toFixed(1));
}
