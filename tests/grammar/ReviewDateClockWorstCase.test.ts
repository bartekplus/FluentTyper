import { expect, test } from "bun:test";

// The date checks that read the Review clock (a weekday next to a date with no year, a verb
// tense against a dated year) on long runs of blanks and on many dates, scanned with
// JavaScriptCore's regex JIT off. Each 4,000-character chunk must stay linear.
const SCRIPT = `
import { REVIEW_SUPPORTED_RULE_IDS, runsInReviewLanguage } from "./src/core/domain/grammar/review/reviewCatalog";
import { prepareReview, reviewChunks, scanReviewChunk } from "./src/core/domain/grammar/review/reviewDiagnostics";
import { setReviewClock } from "./src/core/domain/grammar/review/reviewClock";
setReviewClock(new Date("2026-10-03T12:00:00").getTime());
function slowest(text, lang) {
  const rules = REVIEW_SUPPORTED_RULE_IDS.filter((id) => runsInReviewLanguage(id, lang));
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang, enabledRules: rules, userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  let max = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    max = Math.max(max, performance.now() - start);
  }
  return max;
}
const gap = (a, b, n = 40) => (a + " ".repeat(300) + b + " ").repeat(n);
const inputs = {
  en_US: [
    gap("Monday,", "12 October"),
    gap("On", "12 March 2026, we will"),
    "We will visit them on 12 March 2026 and ".repeat(150),
    "Monday, 31/10 Tuesday, 12 October ".repeat(150),
  ],
  de_DE: [
    gap("am", "12.03.2028 haben wir"),
    gap("Sonntag,", "12.10."),
    "Wir haben am 12.03.2028 den Vertrag abgeschickt. ".repeat(100),
  ],
  fr_FR: [gap("le", "12 mars 2028 nous avons"), "Nous avons envoyé le contrat le 12 mars 2028. ".repeat(100)],
  es_ES: [gap("el", "12 de marzo de 2028"), "Hemos enviado el contrato el 12 de marzo de 2028. ".repeat(100)],
  pt_BR: [gap("em", "12 de março de 2028"), gap("Segunda,", "31/10"), "Visitei o cliente em 12 de março de 2028. ".repeat(100)],
  pl_PL: [gap("dnia", "12 marca 2028 r."), "Podpisaliśmy umowę 12 marca 2028 r. ".repeat(100)],
  ar_SA: [gap("في", "12 مارس 2028"), "لقد زرنا العميل في 12 مارس 2028. ".repeat(100)],
};
let max = 0;
for (const [lang, texts] of Object.entries(inputs)) {
  slowest("Warm up.", lang);
  for (const text of texts) max = Math.max(max, slowest(text, lang));
}
console.log(max);
`;

test("date checks with the Review clock stay linear with the regex JIT off", () => {
  const run = Bun.spawnSync([process.execPath, "-e", SCRIPT], {
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  expect(run.stderr.toString()).toBe("");
  // Linear scans take a few hundred ms per chunk without the JIT; a quadratic one takes seconds.
  expect(Number(run.stdout.toString())).toBeLessThan(1_500);
}, 120_000);
