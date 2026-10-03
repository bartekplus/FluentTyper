import { describe, expect, test } from "bun:test";
import {
  correctSummary,
  fixturePrepared,
  loadCorrectCases,
  loadRewriteCases,
  oracleOutputs,
  rewriteSummary,
  scoreCorrectCase,
  scoreRewriteCase,
} from "../../scripts/local-ai-eval/score";
import { parseAiResponse } from "../../src/core/domain/grammar/review/ai/parse";
import { aiRequestForChunk, buildAiChunks } from "../../src/core/domain/grammar/review/ai/segments";
import { correctionFindings } from "../../src/core/domain/grammar/review/ai/validate";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";

const CORRECT = loadCorrectCases();
const DENSE = CORRECT.filter((fixture) => fixture.tags.includes("dense"));

/**
 * Dense fixtures whose expected text includes a change Correct mode rightly
 * refuses, with the refusal reason and the word changes still offered.
 */
const PARTIAL_DENSE: Record<string, { reason: string; minOffered: number }> = {
  // Dropping "them" (a pronoun, not a closed-class insertion) is a content change.
  "dense-05": { reason: "drift", minOffered: 4 },
  // Inserting "it" ("like it when") is not a closed-class correction; "dont" is one
  // word away and shares its unit.
  "dense-11": { reason: "drift", minOffered: 2 },
  // "Our team have" is valid British usage (team takes either verb number); "we has" is still fixed.
  "dense-13": { reason: "drift", minOffered: 2 },
  // Held-out: "suggested me to restart" -> "suggested that I restart" is a restructure.
  "heldout-08": { reason: "drift", minOffered: 1 },
  // The user's paragraph: the pronoun deletion in dense-05 is still refused.
  "dense-para-01": { reason: "drift", minOffered: 28 },
};

/** Word-and-punctuation edit distance. */
function wordDistance(a: string, b: string): number {
  const split = (text: string) => text.match(/[\p{L}\p{M}\p{N}'’-]+|\S/gu) ?? [];
  const x = split(a);
  const y = split(b);
  let row = y.map((_, j) => j + 1);
  row.unshift(0);
  for (let i = 1; i <= x.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= y.length; j += 1) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[y.length];
}

/** Correct-mode findings for a fixture when the model returns `target`. */
function oracleFindings(fixture: (typeof CORRECT)[number], target: string) {
  const prepared = fixturePrepared(fixture.text, fixture.lang);
  const chunks = buildAiChunks(prepared, { mode: "correct", style: null }).chunks;
  const raws = oracleOutputs(fixture, target);
  const diagnostics: ReviewDiagnostic[] = [];
  const rejected: Record<string, number> = {};
  chunks.forEach((chunk, index) => {
    const outcome = parseAiResponse(
      raws[index],
      aiRequestForChunk(chunk, fixture.lang, "correct", null),
    );
    if (!outcome.ok) throw new Error(`${fixture.id}: oracle output did not parse`);
    const result = correctionFindings(prepared, chunk, outcome.segments);
    diagnostics.push(...result.diagnostics);
    for (const [reason, count] of Object.entries(result.rejected)) {
      rejected[reason] = (rejected[reason] ?? 0) + (count ?? 0);
    }
  });
  return { diagnostics, rejected };
}
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
    expect(DENSE.length).toBeGreaterThanOrEqual(20);
    expect(CORRECT.filter((fixture) => fixture.tags.includes("dense-control")).length).toBe(22);
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
    CORRECT.filter(
      (fixture) => fixture.expect !== "unchanged" && !fixture.tags.includes("dense"),
    ).map((fixture) => [fixture.id, fixture] as const),
  )("%s: the expected correction is offered and reconstructs exactly", (_id, fixture) => {
    const target = (fixture.expect as { text: string }).text;
    const score = scoreCorrectCase(fixture, oracleOutputs(fixture, target));
    expect(score).toMatchObject({ valid: true, corrected: true, falsePositive: false });
  });

  test.each(DENSE.map((fixture) => [fixture.id, fixture] as const))(
    "%s: dense text — every accepted unit is part of the expected fix; most are offered",
    (_id, fixture) => {
      const target = (fixture.expect as { text: string }).text;
      const { diagnostics, rejected } = oracleFindings(fixture, target);
      const needed = wordDistance(fixture.text, target);
      // Each accepted unit on its own lies on a shortest path to the expected text:
      // it never makes a change the expected text does not make.
      for (const diagnostic of diagnostics) {
        const alone = applyEdits(fixture.text, diagnostic.alternatives[0].edits) ?? "";
        expect(wordDistance(fixture.text, alone) + wordDistance(alone, target)).toBe(needed);
      }
      const all = applyEdits(
        fixture.text,
        diagnostics.flatMap((diagnostic) => diagnostic.alternatives[0].edits),
      );
      expect(all).not.toBeNull();
      const offered = wordDistance(fixture.text, all ?? "");
      expect(offered + wordDistance(all ?? "", target)).toBe(needed);
      // These targets require unsupported restructuring or a chosen count unit.
      // Keep the corpus targets and require the exact conservative result.
      const narrowed: Record<string, string> = {
        "dense-10":
          "Me and my colleague discussed about this problem, and we decided not to change anything for now.",
        "heldout-02": "He gave me three advices yesterday and all of them were useful.",
      };
      if (Object.hasOwn(narrowed, fixture.id)) {
        expect(all).toBe(narrowed[fixture.id]);
        expect(rejected).toEqual({ "drift.lexical_substitution": 1 });
        return;
      }
      const partial = PARTIAL_DENSE[fixture.id];
      if (partial) {
        // Known partial: the stated unit is rejected, not accepted wrongly.
        expect(
          Object.entries(rejected)
            .filter(
              ([reason]) => reason === partial.reason || reason.startsWith(`${partial.reason}.`),
            )
            .reduce((sum, [, count]) => sum + count, 0),
        ).toBeGreaterThan(0);
        expect(offered).toBeGreaterThanOrEqual(partial.minOffered);
      } else {
        expect(all).toBe(target);
      }
    },
  );

  test.each(REWRITE.map((fixture) => [fixture.id, fixture] as const))(
    "%s: an echoed rewrite is valid but has nothing to apply; its must-keep terms are in the text",
    (_id, fixture) => {
      const score = scoreRewriteCase(
        fixture,
        oracleOutputs(fixture, fixture.text, "rewrite", fixture.style),
      );
      expect(score).toMatchObject({ valid: true, proposalOk: false, rejection: "unchanged" });
      const text = fixture.text.toLowerCase();
      expect(
        fixture.invariants.mustKeep.filter((keep) => !text.includes(keep.toLowerCase())),
      ).toEqual([]);
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
    expect(rewrites).toContain("| 1 | 1 | 0 | 0 |");
    expect(rewrites).not.toContain(REWRITE[0].text);
  });
});

test("Compact evaluation reconstructs single-sentence requests", () => {
  const fixture = {
    id: "compact-two",
    lang: "en",
    text: "This works. That works.",
    expect: "unchanged" as const,
    tags: [],
  };
  const raw = ["This works.", "That works."].map((text) =>
    JSON.stringify({ segments: [{ id: "s0", text }] }),
  );
  expect(scoreCorrectCase(fixture, raw, false).unchangedOk).toBe(true);
  expect(scoreCorrectCase(fixture, raw).valid).toBe(false);
});
