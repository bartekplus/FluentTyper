import { expect, test } from "bun:test";

// JavaScriptCore runs some regexes in its interpreter even with the JIT on; there an unbounded
// run of spaces inside a lookbehind is reread at every position of a long space run and goes
// quadratic. Scanning with the JIT off shows it: each 4,000-character chunk must stay linear.
const SCRIPT = `
import { REVIEW_SUPPORTED_RULE_IDS, runsInReviewLanguage } from "./src/core/domain/grammar/review/reviewCatalog";
import { prepareReview, reviewChunks, scanReviewChunk } from "./src/core/domain/grammar/review/reviewDiagnostics";
const rules = REVIEW_SUPPORTED_RULE_IDS.filter((id) => runsInReviewLanguage(id, "pl_PL"));
function slowest(text) {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang: "pl_PL", enabledRules: rules, userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  let max = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    max = Math.max(max, performance.now() - start);
  }
  return max;
}
slowest("Rozgrzewka w domu.");
const inputs = [
  "\\t ".repeat(6000),
  "\\u00a0 ".repeat(6000),
  ("lata" + " ".repeat(300)).repeat(40),
  (". " + " ".repeat(300)).repeat(40),
  ("w szkole" + " ".repeat(300)).repeat(40),
];
console.log(Math.max(...inputs.map(slowest)));
`;

test("Polish checks stay linear on long space runs with the regex JIT off", () => {
  const run = Bun.spawnSync([process.execPath, "-e", SCRIPT], {
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  expect(run.stderr.toString()).toBe("");
  // Linear scans take about 350 ms per chunk without the JIT; a quadratic one takes seconds.
  expect(Number(run.stdout.toString())).toBeLessThan(1_500);
}, 60_000);
