/**
 * Local AI Review evaluation scoring (pure; no model, no GPU, no network).
 *
 * Scores raw model outputs for the synthetic fixtures in tests/fixtures/local-ai
 * through the SAME parse and validation code the extension uses, so a score
 * reflects what a user would actually be shown. tests/grammar/ReviewAiFixtures.test.ts
 * imports these helpers; the CLI scores a saved run:
 *
 *   bun scripts/local-ai-eval/score.ts outputs.json [--kind=correct|rewrite] [--tier=standard|compact]
 *
 * outputs.json: [{ "id": "<fixture id>", "raw": "<model output>" | ["<chunk 0>", …] }]
 * Prints a Markdown summary (ids and counts only, never text).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  prepareReview,
  type PreparedReview,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewEdit } from "../../src/core/domain/grammar/review/types";
import { parseAiResponse } from "../../src/core/domain/grammar/review/ai/parse";
import { aiRequestForChunk, buildAiChunks } from "../../src/core/domain/grammar/review/ai/segments";
import type {
  AiChunk,
  AiRejectionReason,
  ConcreteRewriteStyle,
} from "../../src/core/domain/grammar/review/ai/types";
import {
  correctionFindings,
  rewriteProposal,
} from "../../src/core/domain/grammar/review/ai/validate";

export interface CorrectCase {
  id: string;
  lang: string;
  text: string;
  expect: "unchanged" | { text: string };
  tags: string[];
}

export interface RewriteCase {
  id: string;
  lang: string;
  style: ConcreteRewriteStyle;
  text: string;
  invariants: { mustKeep: string[]; forbid: string[] };
}

export interface CorrectScore {
  id: string;
  /** Every chunk output parsed against its request. */
  valid: boolean;
  /** Expected unchanged and nothing was offered. */
  unchangedOk: boolean;
  /**
   * Something was offered where nothing should be, or the offered fixes do not
   * produce the expected text (a partial fix counts here too).
   */
  falsePositive: boolean;
  /** Applying every offered fix gives exactly the expected text. */
  corrected: boolean;
  findings: number;
  rejectedReasons: Partial<Record<AiRejectionReason, number>>;
}

export interface RewriteScore {
  id: string;
  valid: boolean;
  /** A complete proposal passed validation. */
  proposalOk: boolean;
  rejection: AiRejectionReason | null;
  /** mustKeep strings missing from the proposal (case-insensitive). */
  missing: string[];
  /** forbid strings the proposal added (case-insensitive, absent from the original). */
  forbidden: string[];
}

/** A textarea-like snapshot of a fixture: whole text in scope, no adapter protection. */
export function fixturePrepared(text: string, lang: string): PreparedReview {
  return prepareReview(
    { id: "eval", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang, enabledRules: [], userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
}

function chunksFor(
  prepared: PreparedReview,
  mode: "correct" | "rewrite",
  style: ConcreteRewriteStyle | null,
  pairSentences = true,
): AiChunk[] {
  return buildAiChunks(prepared, { mode, pairSentences }).chunks;
}

const asArray = (raw: string | readonly string[]) => (typeof raw === "string" ? [raw] : [...raw]);

/**
 * Oracle outputs: what a perfect model would return for `fixture` if the
 * intended text is `target` (the fixture text itself = echo). A string target
 * must split into the same segments (paired by position); an array gives the
 * proposed text of every segment, in document order.
 */
export function oracleOutputs(
  fixture: { text: string; lang: string },
  target: string | readonly string[],
  mode: "correct" | "rewrite" = "correct",
  style: ConcreteRewriteStyle | null = null,
): string[] {
  const source = chunksFor(fixturePrepared(fixture.text, fixture.lang), mode, style);
  const texts =
    typeof target === "string"
      ? chunksFor(fixturePrepared(target, fixture.lang), mode, style).flatMap((chunk) =>
          chunk.segments.map((segment) => segment.text),
        )
      : [...target];
  if (texts.length !== source.reduce((sum, chunk) => sum + chunk.segments.length, 0)) {
    throw new Error("oracleOutputs: target does not split like the fixture");
  }
  return source.map((chunk) =>
    JSON.stringify({
      segments: chunk.segments.map((segment) => ({ id: segment.id, text: texts.shift() ?? "" })),
    }),
  );
}

export function scoreCorrectCase(
  fixture: CorrectCase,
  raw: string | readonly string[],
  pairSentences = true,
): CorrectScore {
  const prepared = fixturePrepared(fixture.text, fixture.lang);
  const chunks = chunksFor(prepared, "correct", null, pairSentences);
  const outputs = asArray(raw);
  const rejectedReasons: Partial<Record<AiRejectionReason, number>> = {};
  const edits: ReviewEdit[] = [];
  let valid = outputs.length === chunks.length;
  let findings = 0;
  chunks.forEach((chunk, index) => {
    if (!valid) return;
    const parsed = parseAiResponse(
      outputs[index],
      aiRequestForChunk(chunk, fixture.lang, "correct", null),
    );
    if (!parsed.ok) {
      valid = false;
      return;
    }
    const result = correctionFindings(prepared, chunk, parsed.segments);
    for (const [reason, count] of Object.entries(result.rejected)) {
      const key = reason as AiRejectionReason;
      rejectedReasons[key] = (rejectedReasons[key] ?? 0) + (count ?? 0);
    }
    findings += result.diagnostics.length;
    for (const diagnostic of result.diagnostics) edits.push(...diagnostic.alternatives[0].edits);
  });
  const result = valid ? applyEdits(fixture.text, edits) : null;
  const unchanged = fixture.expect === "unchanged";
  const corrected = !unchanged && result === (fixture.expect as { text: string }).text;
  return {
    id: fixture.id,
    valid,
    unchangedOk: valid && unchanged && findings === 0,
    falsePositive: valid && findings > 0 && (unchanged || !corrected),
    corrected,
    findings,
    rejectedReasons,
  };
}

export function scoreRewriteCase(
  fixture: RewriteCase,
  raw: string | readonly string[],
): RewriteScore {
  const prepared = fixturePrepared(fixture.text, fixture.lang);
  const chunks = chunksFor(prepared, "rewrite", fixture.style);
  const outputs = asArray(raw);
  const parsed: Array<Array<{ id: string; text: string }>> = [];
  let valid = chunks.length > 0 && outputs.length === chunks.length;
  chunks.forEach((chunk, index) => {
    if (!valid) return;
    const outcome = parseAiResponse(
      outputs[index],
      aiRequestForChunk(chunk, fixture.lang, "rewrite", fixture.style),
    );
    if (outcome.ok) parsed.push(outcome.segments);
    else valid = false;
  });
  const empty = { missing: [], forbidden: [] };
  if (!valid) return { id: fixture.id, valid, proposalOk: false, rejection: null, ...empty };
  const proposal = rewriteProposal(prepared, chunks, parsed);
  if (!proposal.ok) {
    return { id: fixture.id, valid, proposalOk: false, rejection: proposal.reason, ...empty };
  }
  const after = proposal.after.toLowerCase();
  const before = fixture.text.toLowerCase();
  return {
    id: fixture.id,
    valid,
    proposalOk: true,
    rejection: null,
    missing: fixture.invariants.mustKeep.filter((keep) => !after.includes(keep.toLowerCase())),
    forbidden: fixture.invariants.forbid.filter(
      (word) => after.includes(word.toLowerCase()) && !before.includes(word.toLowerCase()),
    ),
  };
}

const reasons = (counts: Partial<Record<string, number>>) =>
  Object.entries(counts)
    .map(([reason, count]) => `${reason}×${count}`)
    .join(", ") || "—";

/** Markdown summary of correct-case scores (ids and counts only). */
export function correctSummary(scores: readonly CorrectScore[]): string {
  const total = (pick: (score: CorrectScore) => boolean) => scores.filter(pick).length;
  const lines = [
    "| Cases | Valid | Unchanged OK | False positives | Corrected |",
    "| --- | --- | --- | --- | --- |",
    `| ${scores.length} | ${total((s) => s.valid)} | ${total((s) => s.unchangedOk)} | ${total((s) => s.falsePositive)} | ${total((s) => s.corrected)} |`,
    "",
    "| Id | Valid | Findings | Result | Rejected |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const score of scores) {
    const result = score.corrected
      ? "corrected"
      : score.unchangedOk
        ? "unchanged ok"
        : score.falsePositive
          ? "FALSE POSITIVE"
          : "missed";
    lines.push(
      `| ${score.id} | ${score.valid ? "yes" : "NO"} | ${score.findings} | ${result} | ${reasons(score.rejectedReasons)} |`,
    );
  }
  return lines.join("\n");
}

/** Markdown summary of rewrite-case scores (ids and invariant names only). */
export function rewriteSummary(scores: readonly RewriteScore[]): string {
  const clean = scores.filter(
    (s) => s.proposalOk && s.missing.length === 0 && s.forbidden.length === 0,
  ).length;
  const lines = [
    "| Cases | Valid | Proposal OK | Invariants OK |",
    "| --- | --- | --- | --- |",
    `| ${scores.length} | ${scores.filter((s) => s.valid).length} | ${scores.filter((s) => s.proposalOk).length} | ${clean} |`,
    "",
    "| Id | Valid | Proposal | Missing | Forbidden |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const score of scores) {
    lines.push(
      `| ${score.id} | ${score.valid ? "yes" : "NO"} | ${score.proposalOk ? "ok" : (score.rejection ?? "—")} | ${score.missing.length} | ${score.forbidden.length} |`,
    );
  }
  return lines.join("\n");
}

const FIXTURES = path.resolve(import.meta.dir, "../../tests/fixtures/local-ai");

export function loadCorrectCases(): CorrectCase[] {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, "correct-cases.json"), "utf8"),
  ) as CorrectCase[];
}

export function loadRewriteCases(): RewriteCase[] {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, "rewrite-cases.json"), "utf8"),
  ) as RewriteCase[];
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      kind: { type: "string", default: "correct" },
      tier: { type: "string", default: "standard" },
    },
  });
  const [file] = positionals;
  const { kind, tier } = values;
  if (
    !file ||
    (kind !== "correct" && kind !== "rewrite") ||
    (tier !== "standard" && tier !== "compact")
  ) {
    console.error(
      "usage: bun scripts/local-ai-eval/score.ts outputs.json [--kind=correct|rewrite] [--tier=standard|compact]",
    );
    process.exit(2);
  }
  const runs = JSON.parse(readFileSync(file, "utf8")) as Array<{
    id: string;
    raw: string | string[];
  }>;
  const byId = new Map(runs.map((run) => [run.id, run.raw]));
  if (kind === "correct") {
    const scores = loadCorrectCases()
      .filter((fixture) => byId.has(fixture.id))
      .map((fixture) => scoreCorrectCase(fixture, byId.get(fixture.id) ?? "", tier === "standard"));
    console.log(correctSummary(scores));
  } else {
    const scores = loadRewriteCases()
      .filter((fixture) => byId.has(fixture.id))
      .map((fixture) => scoreRewriteCase(fixture, byId.get(fixture.id) ?? ""));
    console.log(rewriteSummary(scores));
  }
}
