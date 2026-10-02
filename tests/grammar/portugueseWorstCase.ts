// Prints the slowest Review chunk time (ms) on adversarial pt_BR inputs, one JSON line.
// ReviewPortugueseNoJit.test.ts runs it with BUN_JSC_useRegExpJIT=0: without the regex JIT an
// unbounded quantifier in a lookbehind turns quadratic on long runs of spaces.
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";

const options = {
  lang: "pt_BR",
  enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};

export const PORTUGUESE_WORST_CASES = [
  `Espero que ${" ".repeat(3_000)}a sonda chega`,
  `\n${" ".repeat(3_000)}Atenciosamente${" ".repeat(500)}\n`,
  `Prezado${" ".repeat(3_000)}Senhor`,
  `O que é que ${" ".repeat(3_000)}houve.`,
  `que ${" ".repeat(3_000)}ate o fim`,
  `${"\n ".repeat(1_500)}Por exemplo hoje`,
  "1 999 349.56 ".repeat(300),
  "21,349.56 4.5 kg ".repeat(250),
  "vai fala pode come vão dormi em China ".repeat(100),
  `e,${" ".repeat(3_000)}no fundo ficou e ${" ".repeat(500)}além disso,`,
  "A arvore e, no fundo ficou e além disso, e, em geral ".repeat(80),
  "eu e a Rita viajam as crianças da escola brinca vende-se casas ".repeat(60),
  "devido a quanto a vou na praia a razão pelo qual ".repeat(80),
  `${" ".repeat(3_900)}x`.repeat(2),
];

function slowestChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
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

if (import.meta.main) {
  for (const text of PORTUGUESE_WORST_CASES) slowestChunkMs(text);
  console.log(JSON.stringify(PORTUGUESE_WORST_CASES.map(slowestChunkMs)));
}
