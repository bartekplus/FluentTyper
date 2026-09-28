/**
 * Summarizes benchmark runs (.cache/local-ai-bench/results/<model>.json) into
 * per-model Markdown + JSON next to them, and prints the headline table.
 *
 *   bun scripts/local-ai-bench/report.ts
 *
 * Meaning-change flags are coarse lexical heuristics over the synthetic
 * fixtures (numbers, negation, hedges, capitalized names, word drift); they
 * point a human at case ids, they are not a semantic judgement.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { correctSummary, loadCorrectCases, rewriteSummary } from "../local-ai-eval/score";
import type { ModelRun } from "./fixtures";

const RESULTS = resolve(import.meta.dir, "../../.cache/local-ai-bench/results");

const NEGATION = /\b(?:not|no|never|none|nobody|nothing|neither|nor|cannot|without)\b|n['’]t\b/gi;
const HEDGE =
  /\b(?:may|might|could|maybe|perhaps|probably|possibly|likely|seems?|think|guess|not sure|i believe)\b/gi;
const NUMBER = /\d+(?:[.,:/]\d+)*/g;
const NAME = /(?<=\s)\p{Lu}[\p{L}\d]+/gu;
/** "dont" → "do not" first, so fixing a missing apostrophe is not a negation change. */
const negations = (text: string) =>
  (
    text
      .replace(
        /\b(do|does|did|is|was|were|are|can|could|would|should|have|has|had|wo|ai)nt\b/gi,
        "$1 not",
      )
      .match(NEGATION) ?? []
  ).length;
const words = (text: string) => text.toLowerCase().match(/[\p{L}'’]+/gu) ?? [];
const bag = (text: string, pattern: RegExp) =>
  (text.match(pattern) ?? [])
    .map((m) => m.toLowerCase())
    .sort()
    .join("|");

/** Coarse meaning-change flags between an input and a changed output. */
export function meaningFlags(input: string, output: string): string[] {
  if (input === output) return [];
  const flags: string[] = [];
  if (bag(input, NUMBER) !== bag(output, NUMBER)) flags.push("number");
  if (negations(input) !== negations(output)) flags.push("negation");
  if (bag(input, HEDGE) !== bag(output, HEDGE)) flags.push("hedge");
  if (bag(input, NAME) !== bag(output, NAME)) flags.push("name");
  const a = words(input);
  const b = new Set(words(output));
  const lost = a.filter((word) => !b.has(word)).length;
  if (lost >= 2 && lost / a.length > 0.3) flags.push("drift");
  return flags;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}
const ms = (value: number | null) => (value === null ? "—" : `${Math.round(value)} ms`);
const pct = (num: number, den: number) =>
  den === 0 ? "—" : `${((100 * num) / den).toFixed(1)}% (${num}/${den})`;

export interface ModelSummary {
  modelId: string;
  revision: string;
  libSha256: string;
  downloadBytes: number;
  downloadMs: number | null;
  coldLoadMs: number | null;
  warmupMs: number | null;
  correctN: number;
  unchangedN: number;
  correctionN: number;
  valid: number;
  /** Model returned every segment verbatim (before validation). */
  echoedOnCorrection: number;
  proposedOnUnchanged: number;
  falsePositivesOnUnchanged: number;
  corrected: number;
  wrongFixOnCorrection: number;
  rejected: Record<string, number>;
  meaningAccepted: Record<string, string[]>;
  meaningBlocked: Record<string, string[]>;
  correctP50: number | null;
  correctP90: number | null;
  rewriteN: number;
  rewriteValid: number;
  rewriteProposalOk: number;
  rewriteChanged: number;
  rewriteInvariantsOk: number;
  rewriteByStyle: Record<string, { n: number; changed: number; invariantsOk: number }>;
  rewriteP50: number | null;
  rewriteP90: number | null;
  cancelP50: number | null;
  cancelMax: number | null;
  promptTokensP50: number | null;
  completionTokensP50: number | null;
  thinking: ModelRun["thinkingProbe"];
}

export function summarize(run: ModelRun): ModelSummary {
  const cases = new Map(loadCorrectCases().map((c) => [c.id, c]));
  const unchanged = run.correct.filter((r) => cases.get(r.id)?.expect === "unchanged");
  const correction = run.correct.filter((r) => cases.get(r.id)?.expect !== "unchanged");
  const rejected: Record<string, number> = {};
  for (const item of run.correct) {
    for (const [reason, count] of Object.entries(item.score.rejectedReasons)) {
      rejected[reason] = (rejected[reason] ?? 0) + (count ?? 0);
    }
  }
  for (const item of run.rewrite) {
    if (item.score.rejection)
      rejected[`rewrite:${item.score.rejection}`] =
        (rejected[`rewrite:${item.score.rejection}`] ?? 0) + 1;
  }
  const meaningAccepted: Record<string, string[]> = {};
  const meaningBlocked: Record<string, string[]> = {};
  for (const item of unchanged) {
    for (const flag of meaningFlags(item.input, item.accepted))
      (meaningAccepted[flag] ??= []).push(item.id);
    if (item.proposed !== null && item.accepted === item.input) {
      for (const flag of meaningFlags(item.input, item.proposed))
        (meaningBlocked[flag] ??= []).push(item.id);
    }
  }
  for (const item of correction) {
    const expected = (cases.get(item.id)!.expect as { text: string }).text;
    // Flags relative to the expected correction, so the intended fix is not counted.
    for (const flag of meaningFlags(expected, item.accepted)) {
      if (item.accepted !== item.input) (meaningAccepted[flag] ??= []).push(item.id);
    }
  }
  for (const item of run.rewrite) {
    if (item.accepted === item.input) continue;
    for (const flag of meaningFlags(item.input, item.accepted).filter((f) => f !== "drift")) {
      (meaningAccepted[`rewrite:${flag}`] ??= []).push(`${item.id}`);
    }
  }
  const rewriteByStyle: ModelSummary["rewriteByStyle"] = {};
  for (const item of run.rewrite) {
    const entry = (rewriteByStyle[item.style ?? "?"] ??= { n: 0, changed: 0, invariantsOk: 0 });
    entry.n += 1;
    const changed = item.accepted !== item.input;
    if (changed) entry.changed += 1;
    if (changed && item.score.missing.length === 0 && item.score.forbidden.length === 0)
      entry.invariantsOk += 1;
  }
  const gens = [...run.correct, ...run.rewrite].flatMap((item) => item.generations);
  const settle = run.cancel.map((c) => c.settleMs).filter((v) => v >= 0);
  return {
    modelId: run.modelId,
    revision: run.revision,
    libSha256: run.libSha256,
    downloadBytes: run.downloadBytes,
    downloadMs: run.downloadMs,
    coldLoadMs: run.coldLoadMs,
    warmupMs: run.warmupMs,
    correctN: run.correct.length,
    unchangedN: unchanged.length,
    correctionN: correction.length,
    valid: run.correct.filter((r) => r.score.valid).length,
    echoedOnCorrection: correction.filter((r) => r.proposed === r.input).length,
    proposedOnUnchanged: unchanged.filter((r) => r.proposed !== null && r.proposed !== r.input)
      .length,
    falsePositivesOnUnchanged: unchanged.filter((r) => r.score.falsePositive).length,
    corrected: correction.filter((r) => r.score.corrected).length,
    wrongFixOnCorrection: correction.filter((r) => r.score.falsePositive).length,
    rejected,
    meaningAccepted,
    meaningBlocked,
    correctP50: quantile(
      run.correct.map((r) => r.latencyMs),
      0.5,
    ),
    correctP90: quantile(
      run.correct.map((r) => r.latencyMs),
      0.9,
    ),
    rewriteN: run.rewrite.length,
    rewriteValid: run.rewrite.filter((r) => r.score.valid).length,
    rewriteProposalOk: run.rewrite.filter((r) => r.score.proposalOk).length,
    rewriteChanged: run.rewrite.filter((r) => r.accepted !== r.input).length,
    rewriteInvariantsOk: run.rewrite.filter(
      (r) =>
        r.accepted !== r.input && r.score.missing.length === 0 && r.score.forbidden.length === 0,
    ).length,
    rewriteByStyle,
    rewriteP50: quantile(
      run.rewrite.map((r) => r.latencyMs),
      0.5,
    ),
    rewriteP90: quantile(
      run.rewrite.map((r) => r.latencyMs),
      0.9,
    ),
    cancelP50: quantile(settle, 0.5),
    cancelMax: settle.length ? Math.max(...settle) : null,
    promptTokensP50: quantile(
      gens.flatMap((g) => (g.usage ? [g.usage.prompt_tokens] : [])),
      0.5,
    ),
    completionTokensP50: quantile(
      gens.flatMap((g) => (g.usage ? [g.usage.completion_tokens] : [])),
      0.5,
    ),
    thinking: run.thinkingProbe,
  };
}

const list = (map: Record<string, string[]>) =>
  Object.entries(map)
    .map(([flag, ids]) => `${flag}: ${ids.join(", ")}`)
    .join("; ") || "none";

export function modelMarkdown(run: ModelRun, s: ModelSummary): string {
  return [
    `# ${s.modelId}`,
    "",
    `revision ${s.revision}, lib sha256 ${s.libSha256}, prompt ${String(run.environment.promptVersion)}, ${String(run.environment.browser)}, GPU ${String(run.environment.gpu)}, ${String(run.environment.date)}`,
    "",
    `- Valid responses (correct): ${pct(s.valid, s.correctN)}; rewrite: ${pct(s.rewriteValid, s.rewriteN)}`,
    `- False positives on expected-unchanged: ${pct(s.falsePositivesOnUnchanged, s.unchangedN)} (model proposed a change before validation: ${pct(s.proposedOnUnchanged, s.unchangedN)})`,
    `- Corrected exactly: ${pct(s.corrected, s.correctionN)}; wrong/partial fix offered: ${pct(s.wrongFixOnCorrection, s.correctionN)}; model echoed the input unchanged: ${pct(s.echoedOnCorrection, s.correctionN)}`,
    `- Rejected by validator: ${
      Object.entries(s.rejected)
        .map(([r, n]) => `${r}×${n}`)
        .join(", ") || "none"
    }`,
    `- Meaning flags in ACCEPTED output: ${list(s.meaningAccepted)}`,
    `- Meaning flags in model output BLOCKED by validation (unchanged cases): ${list(s.meaningBlocked)}`,
    `- Latency correct p50/p90: ${ms(s.correctP50)} / ${ms(s.correctP90)}; rewrite p50/p90: ${ms(s.rewriteP50)} / ${ms(s.rewriteP90)}`,
    `- Cold load ${ms(s.coldLoadMs)}, first generation ${ms(s.warmupMs)}, download+cache ${ms(s.downloadMs)} (${(s.downloadBytes / 1e9).toFixed(2)} GB)`,
    `- Cancel→settle p50 ${ms(s.cancelP50)}, max ${ms(s.cancelMax)}`,
    `- Tokens p50: prompt ${s.promptTokensP50 ?? "—"}, completion ${s.completionTokensP50 ?? "—"}`,
    `- Rewrite: proposal ok ${pct(s.rewriteProposalOk, s.rewriteN)}, actually changed ${pct(s.rewriteChanged, s.rewriteN)}, changed + invariants ok ${pct(s.rewriteInvariantsOk, s.rewriteN)}`,
    ...Object.entries(s.rewriteByStyle).map(
      ([style, v]) =>
        `  - ${style}: changed ${v.changed}/${v.n}, invariants ok ${v.invariantsOk}/${v.n}`,
    ),
    "",
    "## Correct (scorer)",
    "",
    correctSummary(run.correct.map((r) => r.score)),
    "",
    "## Rewrite (scorer)",
    "",
    rewriteSummary(run.rewrite.map((r) => r.score)),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const files = existsSync(RESULTS)
    ? readdirSync(RESULTS).filter(
        (f) =>
          f.endsWith(".json") &&
          f !== "downloads.json" &&
          !/\.(smoke|summary|worker)\.json$/.test(f),
      )
    : [];
  const rows: string[] = [
    "| Model | Valid | FP on unchanged | Corrected | Wrong/partial fix | Correct p50/p90 | Rewrite changed / inv. ok | Rewrite p50/p90 | Cold load | Cancel p50 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const file of files) {
    const run = (await Bun.file(join(RESULTS, file)).json()) as ModelRun;
    if (run.correct.length === 0 && run.rewrite.length === 0) continue;
    const s = summarize(run);
    const base = join(RESULTS, file.replace(/\.json$/, ""));
    await Bun.write(`${base}.summary.json`, JSON.stringify(s, null, 2));
    await Bun.write(`${base}.md`, modelMarkdown(run, s));
    rows.push(
      `| ${file.replace(/\.json$/, "")} | ${pct(s.valid, s.correctN)} | ${pct(s.falsePositivesOnUnchanged, s.unchangedN)} | ${pct(s.corrected, s.correctionN)} | ${pct(s.wrongFixOnCorrection, s.correctionN)} | ${ms(s.correctP50)} / ${ms(s.correctP90)} | ${s.rewriteChanged}/${s.rewriteN} / ${s.rewriteInvariantsOk}/${s.rewriteN} | ${ms(s.rewriteP50)} / ${ms(s.rewriteP90)} | ${ms(s.coldLoadMs)} | ${ms(s.cancelP50)} |`,
    );
  }
  console.log(rows.join("\n"));
}
