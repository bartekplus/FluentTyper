/**
 * Screening metrics for benchmark runs (Correct mode):
 *
 *   bun scripts/local-ai-bench/recall.ts .cache/local-ai-bench/results/<run>.json …
 *
 * Recall = expected word-level fixes (hunks of an LCS token diff between the
 * fixture and its expected text) that the output also makes, split into the
 * user-reported "dense" set and the "heldout" set, measured both on the raw
 * model proposal (placeholders already restored, failed chunks = original)
 * and on what validation accepted. FP = expected-unchanged fixtures whose text
 * changed (controls + traps when screening); extraAccepted = correction fixtures
 * where an accepted change is not one of the expected fixes (needs human review:
 * a valid alternative fix or a wrong edit).
 */
import { loadCorrectCases } from "../local-ai-eval/score";
import type { ModelRun } from "./fixtures";

const tokens = (text: string) => text.match(/[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu) ?? [];

/** Changed hunks of an LCS diff, keyed by position in `a`: "3:was→were". */
export function hunks(a: readonly string[], b: readonly string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  let at = 0;
  let del: string[] = [];
  let ins: string[] = [];
  const flush = () => {
    if (del.length || ins.length) out.push(`${at}:${del.join(" ")}→${ins.join(" ")}`);
    del = [];
    ins = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
      at = i;
    } else if (j < m && (i === n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      ins.push(b[j++]!);
    } else {
      del.push(a[i++]!);
    }
  }
  flush();
  return out;
}

type Group = "dense" | "heldout" | "control" | "trap" | "other";
export function groupOf(id: string): Group {
  if (/^(dense-ok|heldout-ok)-/.test(id)) return "control";
  if (/^(dense|dense-para)-\d+$/.test(id)) return "dense";
  if (/^heldout-\d+$/.test(id)) return "heldout";
  if (/^(spec|ambiguous|tech)-/.test(id)) return "trap";
  return "other";
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

interface Screening {
  run: string;
  recall: Record<
    "dense" | "heldout" | "rest",
    { model: number; accepted: number; expected: number; otherModel: number }
  >;
  /** Dense + held-out fixtures whose accepted text equals the expected text / has some expected fixes. */
  fixed: { full: number; partial: number; of: number };
  /** Correction fixtures where validation accepted a change that is not one of the expected fixes. */
  extraAccepted: string[];
  fpModel: string[];
  fpAccepted: string[];
  invalidRequests: number;
  requests: number;
  p50: number | null;
  p90: number | null;
  /** Median time to first streamed token. */
  ttftP50: number | null;
  coldLoadMs: number | null;
}

export function screen(name: string, run: ModelRun): Screening {
  const cases = new Map(loadCorrectCases().map((c) => [c.id, c]));
  const recall: Screening["recall"] = {
    dense: { model: 0, accepted: 0, expected: 0, otherModel: 0 },
    heldout: { model: 0, accepted: 0, expected: 0, otherModel: 0 },
    rest: { model: 0, accepted: 0, expected: 0, otherModel: 0 },
  };
  const fpModel: string[] = [];
  const fpAccepted: string[] = [];
  const extraAccepted: string[] = [];
  const fixed = { full: 0, partial: 0, of: 0 };
  for (const item of run.correct) {
    const fixture = cases.get(item.id);
    if (!fixture) continue;
    const group = groupOf(item.id);
    const proposed = item.proposedPartial ?? item.proposed ?? item.input;
    // Every expected-unchanged fixture in the run counts (controls + traps when screening).
    if (fixture.expect === "unchanged") {
      if (proposed !== item.input) fpModel.push(item.id);
      if (item.accepted !== item.input) fpAccepted.push(item.id);
      continue;
    }
    const source = tokens(item.input);
    const want = new Set(hunks(source, tokens(fixture.expect.text)));
    const got = hunks(source, tokens(proposed));
    const acc = hunks(source, tokens(item.accepted));
    const bucket = recall[group === "dense" || group === "heldout" ? group : "rest"];
    bucket.expected += want.size;
    bucket.model += got.filter((h) => want.has(h)).length;
    bucket.accepted += acc.filter((h) => want.has(h)).length;
    bucket.otherModel += got.filter((h) => !want.has(h)).length;
    if (acc.some((h) => !want.has(h))) extraAccepted.push(item.id);
    if (group === "dense" || group === "heldout") {
      fixed.of += 1;
      if (item.accepted === fixture.expect.text) fixed.full += 1;
      else if (acc.some((h) => want.has(h))) fixed.partial += 1;
    }
  }
  const gens = run.correct.flatMap((item) => item.generations);
  const times = gens.map((g) => g.parsedMs);
  return {
    run: name,
    recall,
    extraAccepted,
    fixed,
    fpModel,
    fpAccepted,
    invalidRequests: gens.filter((g) => !g.outcome?.ok).length,
    requests: gens.length,
    p50: quantile(times, 0.5),
    p90: quantile(times, 0.9),
    ttftP50: quantile(
      gens.flatMap((g) => (g.ttftMs === null ? [] : [g.ttftMs])),
      0.5,
    ),
    coldLoadMs: run.coldLoadMs,
  };
}

const pct = (num: number, den: number) =>
  den === 0 ? "—" : `${Math.round((100 * num) / den)}% (${num}/${den})`;

function screeningRow(s: Screening): string {
  const ms = (v: number | null) => (v === null ? "—" : `${Math.round(v)}`);
  return `| ${s.run} | ${pct(s.recall.dense.model, s.recall.dense.expected)} | ${pct(s.recall.heldout.model, s.recall.heldout.expected)} | ${pct(s.recall.dense.accepted, s.recall.dense.expected)} | ${pct(s.recall.heldout.accepted, s.recall.heldout.expected)} | ${s.fpModel.length} ${s.fpModel.length ? `(${s.fpModel.join(", ")})` : ""} | ${s.fpAccepted.length} ${s.fpAccepted.length ? `(${s.fpAccepted.join(", ")})` : ""} | ${s.recall.rest.expected ? pct(s.recall.rest.accepted, s.recall.rest.expected) : "—"} | ${s.extraAccepted.length} ${s.extraAccepted.length ? `(${s.extraAccepted.join(", ")})` : ""} | ${s.invalidRequests}/${s.requests} | ${ms(s.p50)} / ${ms(s.p90)} | ${ms(s.coldLoadMs)} |`;
}

if (import.meta.main) {
  console.log(
    "| Run | Recall dense (model) | Recall held-out (model) | Dense accepted | Held-out accepted | FP model (unchanged fixtures) | FP accepted | Other corrections accepted | Extra accepted edits (review) | Invalid req. | p50 / p90 ms per sentence | Cold load ms |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const file of process.argv.slice(2)) {
    const run = (await Bun.file(file).json()) as ModelRun;
    const name = file
      .split("/")
      .pop()!
      .replace(/\.json$/, "");
    console.log(screeningRow(screen(name, run)));
  }
}
