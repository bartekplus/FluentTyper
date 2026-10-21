// Times a full Review of a 3,000-character draft in each Review language (median of 60 runs).
// --check: exit 1 when a median is 5 ms or more. Run it on a machine with no other load.
import { readFileSync } from "node:fs";
import path from "node:path";
import { reviewRuleIds } from "../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../src/core/domain/grammar/review/reviewDiagnostics";
import { loadAllReviewData } from "../src/core/domain/grammar/review/reviewLanguageSources";

const BUDGET_MS = 5;
const RUNS = 60;
const corpus = (file: string) =>
  readFileSync(path.join("tests/fixtures/native-review-corpus", file), "utf8").slice(0, 3000);
const repeat = (paragraph: string) =>
  paragraph.repeat(Math.ceil(3000 / paragraph.length)).slice(0, 3000);
const DRAFTS: Record<string, string> = {
  en_US: corpus("reference.txt"),
  de_DE: corpus("german-clean.txt"),
  fr_FR: corpus("french-clean.txt"),
  es_ES: corpus("spanish-clean.txt"),
  pt_BR: corpus("portuguese-clean.txt"),
  pl_PL: corpus("polish-clean.txt"),
  ar_SA: corpus("arabic-clean.txt"),
  el_GR: repeat("Η ομάδα έστειλε την αναφορά χθες. Θα τη διαβάσουμε αύριο το πρωί.\n\n"),
  sv_SE: repeat("Teamet skickade rapporten i går. Vi läser den i morgon bitti.\n\n"),
  hr_HR: repeat("Tim je jučer poslao izvješće. Pročitat ćemo ga sutra ujutro.\n\n"),
};

loadAllReviewData();
let over = false;
for (const [lang, text] of Object.entries(DRAFTS)) {
  const options = {
    lang,
    enabledRules: reviewRuleIds({ codeMode: false }),
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
  };
  const review = (id: string) =>
    detectReviewDiagnostics(
      { id, text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      options,
    );
  for (let i = 0; i < 10; i++) review(`warm${i}`);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    review(`run${i}`);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[RUNS >> 1];
  over ||= median >= BUDGET_MS;
  console.log(`${lang}  median ${median.toFixed(2)} ms  min ${times[0].toFixed(2)} ms`);
}
if (process.argv.includes("--check") && over) {
  console.error(`A full Review took ${BUDGET_MS} ms or more.`);
  process.exit(1);
}
