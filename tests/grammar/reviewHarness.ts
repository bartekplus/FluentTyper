import {
  detectReviewDiagnostics,
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
import { loadAllReviewData } from "../../src/core/domain/grammar/review/reviewLanguageSources";
import { TEST_REVIEW_NOW } from "../reviewTestClock";
import type {
  ReviewDiagnostic,
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
 * Runs Review on all of `text`. Defaults: en_US, DEFAULT_RULES, no user
 * dictionary, no protected ranges. `options` replaces each default it sets.
 */
export function scanResult(
  text: string,
  { snapshot, ...options }: ScanOptions = {},
): ReviewScanResult {
  return detectReviewDiagnostics(
    { id: "scan", text, scope: { start: 0, end: text.length }, protectedRanges: [], ...snapshot },
    {
      lang: "en_US",
      enabledRules: DEFAULT_RULES,
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      ...options,
    },
  );
}

/** The diagnostics of scanResult. */
export function scan(text: string, options: ScanOptions = {}): ReviewDiagnostic[] {
  return scanResult(text, options).diagnostics;
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
 * JavaScriptCore shows the slow path of a regex only when the regex is hot.
 */
export function chunkTimes(cases: readonly TimingCase[]): number[] {
  for (const [lang, text, rules] of cases) slowestChunkMs(text, lang, rules);
  return cases.map(([lang, text, rules]) => slowestChunkMs(text, lang, rules));
}

/**
 * chunkTimes in a child process with the regex JIT off (BUN_JSC_useRegExpJIT=0).
 * JavaScriptCore can run a regex in its interpreter also with the JIT on. There, a
 * lookbehind with an unbounded quantifier reads a long run of spaces again at each
 * position, so the time goes quadratic. Without the JIT, this cost is always visible.
 */
export function chunkTimesWithoutJit(cases: readonly TimingCase[]): number[] {
  const run = Bun.spawnSync([process.execPath, import.meta.path], {
    stdin: new TextEncoder().encode(JSON.stringify(cases)),
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return JSON.parse(run.stdout.toString()) as number[];
}

if (import.meta.main) {
  setReviewClock(TEST_REVIEW_NOW);
  // This child process has no test preload.
  loadAllReviewData();
  console.log(JSON.stringify(chunkTimes(JSON.parse(await Bun.stdin.text()))));
}
