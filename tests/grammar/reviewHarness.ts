import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  reviewRuleIds,
} from "../../src/core/domain/grammar/review/reviewCatalog";
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

export interface ScanOptions extends Partial<ReviewOptions> {
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
