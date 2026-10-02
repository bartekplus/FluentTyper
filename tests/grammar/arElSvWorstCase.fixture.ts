import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";

// Adversarial Arabic, Greek and Swedish inputs: frame-opening words around long runs of
// spaces and tabs. Run directly (bun tests/grammar/arElSvWorstCase.fixture.ts) it prints the
// slowest chunk in milliseconds, so a test can time it with the regex JIT off
// (BUN_JSC_useRegExpJIT=0), where a lookbehind with an unbounded quantifier goes quadratic.
const gap = (n = 3_000) => "\t ".repeat(n);

export const AR_EL_SV_WORST_CASES: Array<[string, string]> = [
  ["ar_SA", `لم ${gap()}يذهب. كلما${gap()}كلما ${gap()}قرأ`],
  ["ar_SA", `إلا ${gap()}كلمة${gap()}فقط. بين ${gap()}البيت${gap()}وبين المدرسة`],
  ["ar_SA", `هذا ${gap()}الكتب في ${gap()}31 ${gap()}مارس${gap()}2022`],
  ["ar_SA", `الرسالة${gap()}الذي ${gap()}كتبتها. قام${gap()}بالعمل${gap()}بشكل${gap()}مناسب`],
  ["ar_SA", `لا ${gap()}يخافوا. ثلاثة${gap()}وثلاثون${gap()}صفحات. ما ${gap()}زال${gap()}يعمل${gap()}كمدير`],
  ["ar_SA", "و ".repeat(6_000) + "لم يذهبوا"],
  ["el_GR", `τη ${gap()}μέρα. Αυτό${gap()}που ${gap()}λες. δεν${gap()}θα${gap()}έχω${gap()}πάει`],
  ["el_GR", `κι ${gap()}έτσι. Που ${gap()}είσαι${gap()};  πιο ${gap()}καλύτερος!!${gap()}…`],
  ["el_GR", "και ".repeat(5_000) + "πως"],
  ["sv_SE", `Mellan ${gap()}två${gap()}till${gap()}fyra. En${gap()}till${gap()}kaka.`],
  ["sv_SE", `Dem ${gap()}är. med${gap()}de${gap()}. Det var bra${gap()}sa${gap()}Johan.`],
  ["sv_SE", `ett${gap()}mörk${gap()}kväll. 2a${gap()}APIs ${gap()}Måndag${gap()}den 3e.`],
  ["sv_SE", "och ".repeat(5_000) + "sa hon."],
];

export function slowestChunkMs(lang: string, text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang,
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
  for (const [lang, text] of AR_EL_SV_WORST_CASES) slowestChunkMs(lang, text);
  const times = AR_EL_SV_WORST_CASES.map(([lang, text]) => slowestChunkMs(lang, text));
  if (process.argv.includes("--verbose")) console.error(times.map((t) => t.toFixed(1)).join(" "));
  console.log(Math.max(...times).toFixed(1));
}
