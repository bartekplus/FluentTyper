import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";

// Adversarial German inputs: runs of frame-opening words and of spaces. Run directly (bun
// tests/grammar/germanWorstCase.fixture.ts) it prints the slowest chunk in milliseconds, so a
// test can time it with the regex JIT off (BUN_JSC_useRegExpJIT=0), where a lookbehind with
// an unbounded quantifier goes quadratic.
export const GERMAN_WORST_CASES = [
  "die kosten die kosten ".repeat(400),
  "mit den schönen hohen ".repeat(400),
  "ihr seit mir dem seid den mich ".repeat(300),
  `der ${"\t ".repeat(3_000)}vertrag`,
  "ich glaube weil um zu wissen was ob sondern ".repeat(300),
  "Wir habe. Sollte wir du kann ich hast ".repeat(300),
  "mir ist zu recht Ernst nach Links riesen Dank im arm die schuld ".repeat(250),
  "zwei und zwanzig hundert tausend mal drei an halb viele Lösung ".repeat(250),
  "Der Auto mit dem Frau eine sehr schönes Haus ich habe ein Tisch ".repeat(250),
  "ich helfe den Mann er fragt dem Lehrer das alter die grenzen meiner Stadt sind ".repeat(250),
  "rausgucken rum runterladen Rumspielen rein- und raus vom zweiten Weltkrieg ".repeat(250),
  "\nHallo Liebe Anna,\nLiebe Herr Müller, etwas ganz sehr besonderes ".repeat(250),
  `Ich ${"habe ein schöne neue ".repeat(400)}Haustürschlüsselbundanhänger.`,
  `Wann ${"kommst du ".repeat(2_000)}. Wie viel kostet das. Hast du Zeit, oder.`,
  `Seit${" ".repeat(4_000)}ihr. Das${" ".repeat(4_000)}ich am${" ".repeat(4_000)}12.3. mir`,
  `ist ${" ".repeat(4_000)}mir ${" ".repeat(4_000)}Recht. Ein ${" ".repeat(4_000)}schönes paar`,
  `zwei ${" ".repeat(4_000)}Million. ${"a".repeat(4_000)} seid ${"x".repeat(3_000)}`,
];

export function slowestGermanChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "de_DE",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
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
  slowestGermanChunkMs(GERMAN_WORST_CASES.join("\n"));
  console.log(Math.max(...GERMAN_WORST_CASES.map(slowestGermanChunkMs)).toFixed(1));
}
