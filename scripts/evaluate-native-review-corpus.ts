import { readFileSync } from "node:fs";
import { reviewRuleIds } from "../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
} from "../src/core/domain/grammar/review/reviewDiagnostics";
import { spellingDiagnostic } from "../src/core/domain/grammar/review/reviewFindings";
import {
  spellingCandidates,
  rankSpellingSuggestions,
} from "../src/core/domain/grammar/review/reviewSpelling";
// User-supplied evaluation corpus: report findings, do not treat prose notes as a correctness oracle.
// Run from the repository root: bun scripts/evaluate-native-review-corpus.ts
const broken = readFileSync("tests/fixtures/native-review-corpus/broken.txt", "utf8").trim();
const clean = readFileSync("tests/fixtures/native-review-corpus/reference.txt", "utf8").trim();
for (const [kind, text] of Object.entries({ broken, clean }))
  for (const style of [false, true]) {
    const options = {
      lang: "en_US",
      enabledRules: reviewRuleIds({
        codeMode: false,
        overrides: style ? { styleRedundancy: true, styleLongSentence: true } : {},
      }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    };
    const run = () =>
      detectReviewDiagnostics(
        { id: "corpus", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
        options,
      );
    for (let i = 0; i < 3; i++) run();
    const timings = [];
    for (let i = 0; i < 11; i++) {
      const t = performance.now();
      run();
      timings.push(performance.now() - t);
    }
    const r = run();
    const findings = r.diagnostics.map((d) => ({
      rule: d.ruleId,
      original: d.original,
      alternatives: d.alternatives.map((a) => a.preview),
      line: text.slice(0, d.range.start).split("\n").length,
      context: text.slice(Math.max(0, d.range.start - 45), Math.min(text.length, d.range.end + 45)),
      range: d.range,
      edits: d.alternatives.map((a) => a.edits),
      warning: !!d.warningOnly,
    }));
    const result = {
      kind,
      style,
      characters: text.length,
      count: findings.length,
      medianMs: timings.toSorted((a, b) => a - b)[5],
      counts: Object.fromEntries(
        [...new Set(findings.map((f) => f.rule))].map((id) => [
          id,
          findings.filter((f) => f.rule === id).length,
        ]),
      ),
      coverage: r.coverage,
      findings,
    };
    console.log(JSON.stringify(result));
  }

// Optional offline dictionary pass. This measures complete lookup coverage,
// not the browser session's per-pass scheduling budget or rendering latency.
if (process.argv.includes("--spelling")) {
  const { default: libPresage } = await import("../src/third_party/libpresage/libpresage.js");
  const { PresageHandler } = await import("../src/adapters/chrome/background/PresageHandler");
  const root = process.cwd();
  const module = await libPresage({
    locateFile: (name: string) =>
      name.endsWith(".wasm")
        ? `${root}/src/third_party/libpresage/${name}`
        : `${root}/public/third_party/libpresage/${name}`,
  });
  const handler = new PresageHandler(module);
  handler.setConfig({
    numSuggestions: 5,
    engineNumSuggestions: 10,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: true,
    autoCapitalize: false,
    prefixOnlyMode: false,
    textExpansions: [],
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
  });
  for (const [kind, text] of Object.entries({ broken, clean })) {
    const snapshot = {
      id: "corpus",
      text,
      scope: { start: 0, end: text.length },
      protectedRanges: [],
    };
    const options = {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    };
    const native = detectReviewDiagnostics(snapshot, options).diagnostics;
    const prepared = prepareReview(snapshot, options);
    const candidates = spellingCandidates(
      prepared,
      native.filter((d) => d.category !== "style").map((d) => d.range),
    );
    const first = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      const key = candidate.lookup.toLowerCase();
      if (!first.has(key)) first.set(key, candidate);
    }
    const unique = [...first.values()];
    const start = performance.now();
    const results = handler.lookupSpelling(
      "en_US",
      unique.map((c) => ({ word: c.lookup, before: c.before })),
    );
    if (!results || results.length !== unique.length)
      throw new Error("Incomplete dictionary evaluation");
    const answers = new Map(unique.map((c, i) => [c.lookup.toLowerCase(), results[i]]));
    const diagnostics = candidates.flatMap((candidate) => {
      const answer = answers.get(candidate.lookup.toLowerCase());
      if (!answer) return [];
      const d = spellingDiagnostic(
        prepared,
        candidate,
        rankSpellingSuggestions(candidate.word, answer),
      );
      return d
        ? [
            {
              original: d.original,
              range: d.range,
              alternatives: d.alternatives.map((a) => a.preview),
            },
          ]
        : [];
    });
    console.log(
      JSON.stringify({
        kind,
        stage: "dictionary",
        uniqueLookups: unique.length,
        elapsedMs: performance.now() - start,
        native: native.length,
        spelling: diagnostics.length,
        combined: native.length + diagnostics.length,
        findings: diagnostics,
      }),
    );
  }
}
