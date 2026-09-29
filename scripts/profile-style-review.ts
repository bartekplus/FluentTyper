/** Authored style-only pipeline costs: bun scripts/profile-style-review.ts */
import assert from "node:assert/strict";
import { detectReviewDiagnostics } from "../src/core/domain/grammar/review/reviewDiagnostics";
const fixtures = {
  clean:
    "The team reviewed the draft today. We discussed the evidence and recorded our conclusions.\n\n",
  mixed:
    "Use your PIN number at the ATM machine. The team reviewed every part of the detailed proposal and carefully considered all of the important information before making any decision about the next stage of the project because there were still several questions about the final report.\n\n",
};
for (const [kind, paragraph] of Object.entries(fixtures)) {
  for (const size of [1_000, 10_000, 50_000]) {
    const text = paragraph.repeat(Math.ceil(size / paragraph.length)).slice(0, size);
    const snapshot = {
      id: "style-profile",
      text,
      scope: { start: 0, end: text.length },
      protectedRanges: [],
    };
    for (const enabled of [false, true]) {
      const options = {
        lang: "en_US",
        enabledRules: enabled ? ["styleRedundancy", "styleLongSentence"] : [],
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
        longSentenceWords: 35,
      };
      const run = () => detectReviewDiagnostics(snapshot, options);
      for (let i = 0; i < 5; i++) run();
      const times: number[] = [];
      for (let i = 0; i < 21; i++) {
        const start = performance.now();
        run();
        times.push(performance.now() - start);
      }
      const result = run();
      assert.equal(result.coverage.failedRules.length, 0);
      if (kind === "clean" || !enabled) assert.equal(result.diagnostics.length, 0);
      else assert.ok(result.diagnostics.length > 0);
      assert.ok(result.diagnostics.every((d) => d.category === "style" && !d.bulk.eligible));
      console.log(
        JSON.stringify({
          kind,
          size,
          enabled,
          findings: result.diagnostics.length,
          medianMs: Number(times.toSorted((a, b) => a - b)[10].toFixed(3)),
        }),
      );
    }
  }
}
