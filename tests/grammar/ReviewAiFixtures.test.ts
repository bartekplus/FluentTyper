import { describe, expect, test } from "bun:test";
import {
  correctSummary,
  loadCorrectCases,
  loadRewriteCases,
  oracleOutputs,
  rewriteSummary,
  scoreCorrectCase,
  scoreRewriteCase,
} from "../../scripts/local-ai-eval/score";

const CORRECT = loadCorrectCases();
const REWRITE = loadRewriteCases();
const english = CORRECT.filter((fixture) => fixture.lang.startsWith("en"));

/** Spec §12.2: every one of these must stay unchanged. */
const SPEC_UNCHANGED = [
  "I may be wrong, but the issue could be hardware-related.",
  "Do not enable this in production.",
  "We measured 6.3 GB, not 63 GB.",
  "The meeting is on 03/04; please confirm the date format.",
  "It may rain in May.",
  "The cant of the roof is unusual.",
  '"21th" is wrong; the correct form is "21st".',
  "He weighs 11 st. A 16 rd chain was used.",
  "Set rtpjitterbuffer latency=200 and keep do-lost=true.",
  "Version 1.0.9 comes before 1.0.10.",
  "Thanks — looks good to me!",
  "Maybe tomorrow. Not sure yet.",
];

describe("Local AI fixtures", () => {
  test("corpus shape meets the evaluation minimums", () => {
    expect(new Set(CORRECT.map((fixture) => fixture.id)).size).toBe(CORRECT.length);
    expect(english.length).toBeGreaterThanOrEqual(100);
    const unchanged = english.filter((fixture) => fixture.expect === "unchanged");
    expect(unchanged.length * 2).toBeGreaterThanOrEqual(english.length);
    for (const sentence of SPEC_UNCHANGED) {
      expect(unchanged.map((fixture) => fixture.text)).toContain(sentence);
    }
    const polish = CORRECT.filter((fixture) => fixture.lang.startsWith("pl"));
    expect(polish.length).toBeGreaterThanOrEqual(12);
    for (const fixture of polish) expect(fixture.tags).toContain("notAdvertised");
    expect(CORRECT.filter((fixture) => fixture.tags.includes("injection")).length).toBeGreaterThan(
      3,
    );
    expect(REWRITE.length).toBeGreaterThanOrEqual(30);
    expect(new Set(REWRITE.map((fixture) => fixture.id)).size).toBe(REWRITE.length);
  });

  test.each(CORRECT.map((fixture) => [fixture.id, fixture] as const))(
    "%s: an echo produces no finding and no rejection",
    (_id, fixture) => {
      const score = scoreCorrectCase(fixture, oracleOutputs(fixture, fixture.text));
      expect(score).toMatchObject({ valid: true, findings: 0, rejectedReasons: {} });
    },
  );

  test.each(
    CORRECT.filter((fixture) => fixture.expect !== "unchanged").map(
      (fixture) => [fixture.id, fixture] as const,
    ),
  )("%s: the expected correction is offered and reconstructs exactly", (_id, fixture) => {
    const target = (fixture.expect as { text: string }).text;
    const score = scoreCorrectCase(fixture, oracleOutputs(fixture, target));
    expect(score).toMatchObject({ valid: true, corrected: true, falsePositive: false });
  });

  test.each(REWRITE.map((fixture) => [fixture.id, fixture] as const))(
    "%s: an unchanged rewrite passes validation and its own invariants",
    (_id, fixture) => {
      const score = scoreRewriteCase(
        fixture,
        oracleOutputs(fixture, fixture.text, "rewrite", fixture.style),
      );
      expect(score).toMatchObject({ valid: true, proposalOk: true, missing: [], forbidden: [] });
    },
  );

  test("scoring reports invalid output, false positives and invariant breaks", () => {
    const fixture = english.find((candidate) => candidate.id === "spec-02");
    if (!fixture) throw new Error("missing spec-02");
    expect(scoreCorrectCase(fixture, "not json").valid).toBe(false);
    const dropped = scoreCorrectCase(
      fixture,
      oracleOutputs(fixture, "Do enable this in production."),
    );
    expect(dropped).toMatchObject({ valid: true, findings: 0, rejectedReasons: { negation: 1 } });

    const rewrite = REWRITE.find((candidate) => candidate.id === "rw-07");
    if (!rewrite) throw new Error("missing rw-07");
    expect(
      scoreRewriteCase(
        rewrite,
        oracleOutputs(rewrite, ["Merge this before the ⟦1⟧ release."], "rewrite", rewrite.style),
      ),
    ).toMatchObject({ proposalOk: false, rejection: "negation" });
  });

  test("summaries carry ids and counts, never text", () => {
    const scores = CORRECT.slice(0, 3).map((fixture) =>
      scoreCorrectCase(fixture, oracleOutputs(fixture, fixture.text)),
    );
    const summary = correctSummary(scores);
    expect(summary).toContain("| 3 | 3 | 3 | 0 | 0 |");
    for (const fixture of CORRECT.slice(0, 3)) expect(summary).not.toContain(fixture.text);
    const rewrites = rewriteSummary([
      scoreRewriteCase(
        REWRITE[0],
        oracleOutputs(REWRITE[0], REWRITE[0].text, "rewrite", REWRITE[0].style),
      ),
    ]);
    expect(rewrites).toContain("| 1 | 1 | 1 | 1 |");
    expect(rewrites).not.toContain(REWRITE[0].text);
  });
});
