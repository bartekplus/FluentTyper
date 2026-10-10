import { fileURLToPath } from "node:url";
import {
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  reviewRuleIds,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { setReviewClock } from "../../src/core/domain/grammar/review/reviewClock";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { loadAllReviewData } from "../../src/core/domain/grammar/review/reviewLanguageSources";
import { TEST_REVIEW_NOW } from "../reviewTestClock";
import { review } from "./grammarTestUtils";
import type {
  ReviewDiagnostic,
  ReviewEdit,
  ReviewOptions,
  ReviewScanResult,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";

/** The rules a user has on by default. */
export const DEFAULT_RULES = reviewRuleIds({ codeMode: false });
/** Every Review-supported rule, opt-in rules included. */
export const ALL_RULES = REVIEW_SUPPORTED_RULE_IDS;

/** The rules that run in `lang`, without the rules in `except`. */
export const languageRules = (lang: string, except: readonly string[] = []) =>
  ALL_RULES.filter((id) => runsInReviewLanguage(id, lang) && !except.includes(id));

interface ScanOptions extends Partial<ReviewOptions> {
  /** Fields that replace the whole-text snapshot defaults. */
  snapshot?: Partial<ReviewSourceSnapshot>;
}

/**
 * Runs Review on all of `text` with the defaults of grammarTestUtils.review.
 * `options` replaces each default it sets.
 */
export function scanResult(
  text: string,
  { snapshot, ...options }: ScanOptions = {},
): ReviewScanResult {
  return review(text, snapshot, options);
}

/** The diagnostics of scanResult. */
export function scan(text: string, options: ScanOptions = {}): ReviewDiagnostic[] {
  return scanResult(text, options).diagnostics;
}

/**
 * One round of "fix everything": each fixable finding's chosen fix, in text order.
 * A fix that touches an earlier one in the round is deferred to the next round.
 */
export function fixRound(text: string, options: ScanOptions = {}) {
  const fixable = scan(text, options)
    .filter((d) => !d.warningOnly && d.alternatives.length > 0)
    .sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  const applied: ReviewDiagnostic[] = [];
  const deferred: ReviewDiagnostic[] = [];
  const edits: ReviewEdit[] = [];
  for (const d of fixable) {
    const own = d.alternatives[d.bulk.eligible ? d.bulk.alternative : 0].edits;
    if (own.some((e) => edits.some((o) => e.start <= o.end && o.start <= e.end))) deferred.push(d);
    else {
      applied.push(d);
      edits.push(...own);
    }
  }
  const next = applyEdits(text, edits);
  if (next === null) throw new Error("fixRound: the chosen edits overlap");
  return { applied, deferred, text: next };
}

/** fixRound again and again until a round has nothing to fix (at most `limit` rounds). */
export function fixRounds(text: string, options: ScanOptions = {}, limit = 6) {
  const rounds: Array<ReturnType<typeof fixRound>> = [];
  let current = text;
  for (let i = 0; i < limit; i += 1) {
    const round = fixRound(current, options);
    if (round.applied.length === 0) break;
    rounds.push(round);
    current = round.text;
  }
  return { rounds, text: current };
}

/* ------------------------------------------------------------- worst cases */

/** A timing case: the language, the text and the rules (default: ALL_RULES). */
export type TimingCase = [lang: string, text: string, rules?: readonly string[]];

/**
 * CPU time of this thread in ms: a backtracking regression shows here, while time
 * spent waiting for a core (other test workers running in parallel) does not.
 */
export function cpuMs(run: () => void): number {
  const start = process.threadCpuUsage();
  run();
  const { user, system } = process.threadCpuUsage(start);
  return (user + system) / 1000;
}

/** The thread CPU time in ms of the slowest Review chunk of `text`. */
export function slowestChunkMs(
  text: string,
  lang = "en_US",
  enabledRules: readonly string[] = ALL_RULES,
): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang, enabledRules, userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  let ms = 0;
  for (const chunk of reviewChunks(prepared)) {
    ms = Math.max(
      ms,
      cpuMs(() => scanReviewChunk(prepared, chunk)),
    );
  }
  return ms;
}

/**
 * The slowest chunk time (ms) of each case. All cases are scanned once first, because
 * JavaScriptCore shows the slow path of a regex only when the regex is hot. With the regex
 * JIT off, every regex runs in the interpreter, so a check against a fixed limit can skip that
 * first pass with `warm = false`. A check that compares two cases needs it: else the first
 * case also pays the one-time JavaScriptCore compilation.
 */
export function chunkTimes(cases: readonly TimingCase[], warm = true): number[] {
  if (warm) for (const [lang, text, rules] of cases) slowestChunkMs(text, lang, rules);
  return cases.map(([lang, text, rules]) => slowestChunkMs(text, lang, rules));
}

/**
 * chunkTimes in a child process with the regex JIT off (BUN_JSC_useRegExpJIT=0).
 * JavaScriptCore can run a regex in its interpreter also with the JIT on. There, a
 * lookbehind with an unbounded quantifier reads a long run of spaces again at each
 * position, so the time goes quadratic. Without the JIT, this cost is always visible.
 */
export function chunkTimesWithoutJit(cases: readonly TimingCase[], warm = true): number[] {
  const run = Bun.spawnSync([process.execPath, fileURLToPath(import.meta.url)], {
    stdin: new TextEncoder().encode(JSON.stringify({ cases, warm })),
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return JSON.parse(run.stdout.toString()) as number[];
}

if (import.meta.main) {
  setReviewClock(TEST_REVIEW_NOW);
  // This child process has no test preload.
  loadAllReviewData();
  const { cases, warm } = JSON.parse(await Bun.stdin.text()) as {
    cases: TimingCase[];
    warm: boolean;
  };
  console.log(JSON.stringify(chunkTimes(cases, warm)));
}
