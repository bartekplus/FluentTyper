import { isObjectRecord } from "../guards";
import type {
  LiveGrammarProposal,
  LiveProposalOptions,
} from "../grammar/review/liveProposalSelection";
import type { PreparedReview } from "../grammar/review/reviewDiagnostics";
import type {
  CoverageGap,
  ReviewDiagnostic,
  ReviewEdit,
  ReviewOptions,
  ReviewScanResult,
  ReviewSourceSnapshot,
} from "../grammar/review/types";
import type { CatalogRuleId } from "../grammar/ruleCatalog";

/**
 * Review detection transport contract.
 *
 * Review's detectors and their data run in the background service worker only:
 *   content script ──runtime message CMD_CONTENT_SCRIPT_REVIEW_ENGINE──> background
 * One request per scan pass, proof round or typing pause. A review session's
 * state (its native-result cache, its last prepared snapshot) is bound to the
 * sender tab and frame plus the session id, bounded, and dropped on "release".
 * Text is never logged or stored; the content side validates every write itself.
 */

export interface ReviewScanRequest {
  snapshot: ReviewSourceSnapshot;
  options: ReviewOptions;
  /** Reuse unchanged native results kept for this session (long whole-field drafts). */
  cache: boolean;
  /** Forget the session's kept results first (structure, settings or availability changed). */
  resetCache?: boolean;
  /** Coverage gaps the page side knows of (size limit, unread text). */
  gaps: Partial<Record<CoverageGap, number>>;
}

/** The prepared review, less what the page sent (snapshot, options) and in plain data. */
export type PreparedReviewData = Omit<
  PreparedReview,
  "snapshot" | "options" | "rules" | "dictionary" | "text"
> & {
  rules: CatalogRuleId[];
  dictionary: string[];
  /** The masked analysis text, only when it differs from the source. */
  text?: string;
};

export interface ReviewScanResponse {
  result: ReviewScanResult;
  prepared: PreparedReviewData;
}

/** One bulk-plan proof round: are `checks` still found after `otherEdits`? */
export interface ReviewProofRequest {
  snapshot: ReviewSourceSnapshot;
  options: ReviewOptions;
  checks: ReviewDiagnostic[];
  otherEdits: ReviewEdit[];
}

export type ReviewEngineRequest =
  | { op: "scan"; session: string; id: number; request: ReviewScanRequest }
  | { op: "prove"; session: string; id: number; request: ReviewProofRequest }
  | { op: "live"; beforeCursor: string; options: LiveProposalOptions }
  | { op: "cancel"; session: string; id: number }
  | { op: "release"; session: string };

export type ReviewEngineFailure = "invalid" | "aborted" | "failed";

export type ReviewEngineResponse<T = unknown> =
  { ok: true; value: T } | { ok: false; error: ReviewEngineFailure };

export type ReviewEngineValue = ReviewScanResponse | boolean[] | LiveGrammarProposal[] | null;

/** Whole editor text a scan may carry; far above any real field. */
export const MAX_REVIEW_ENGINE_TEXT = 5_000_000;
/** Text before the caret a typing-time request carries (it reads the last 500). */
export const MAX_LIVE_PROPOSAL_TEXT = 4_096;

const isInt = (value: unknown): value is number => Number.isSafeInteger(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const isOptionalTrue = (value: unknown) => value === undefined || value === true;
const isRange = (value: unknown, length: number): boolean =>
  isObjectRecord(value) &&
  isInt(value.start) &&
  isInt(value.end) &&
  value.start >= 0 &&
  value.start <= value.end &&
  value.end <= length;

function isSnapshot(value: unknown): value is ReviewSourceSnapshot {
  if (!isObjectRecord(value)) return false;
  const { id, text, scope, protectedRanges } = value;
  return (
    typeof id === "string" &&
    id.length <= 64 &&
    typeof text === "string" &&
    text.length <= MAX_REVIEW_ENGINE_TEXT &&
    isRange(scope, text.length) &&
    Array.isArray(protectedRanges) &&
    protectedRanges.every(
      (range) =>
        isRange(range, text.length) && typeof (range as { reason?: unknown }).reason === "string",
    ) &&
    isOptionalTrue(value.incomplete) &&
    isOptionalTrue(value.selection)
  );
}

function isOptions(value: unknown): value is ReviewOptions {
  return (
    isObjectRecord(value) &&
    typeof value.lang === "string" &&
    isStringArray(value.enabledRules) &&
    isStringArray(value.userDictionary) &&
    typeof value.insertSpaceAfterAutocomplete === "boolean" &&
    (value.spellingEnabled === undefined || typeof value.spellingEnabled === "boolean") &&
    (value.longSentenceWords === undefined || typeof value.longSentenceWords === "number") &&
    (value.preferredTerminology === undefined || isObjectRecord(value.preferredTerminology))
  );
}

const isEdit = (value: unknown): value is ReviewEdit =>
  isRange(value, Number.MAX_SAFE_INTEGER) &&
  typeof (value as ReviewEdit).original === "string" &&
  typeof (value as ReviewEdit).replacement === "string";

const isDiagnostic = (value: unknown): value is ReviewDiagnostic =>
  isObjectRecord(value) &&
  isRange(value.range, Number.MAX_SAFE_INTEGER) &&
  isObjectRecord(value.bulk) &&
  Array.isArray(value.alternatives) &&
  value.alternatives.every(
    (alternative) =>
      isObjectRecord(alternative) &&
      Array.isArray(alternative.edits) &&
      alternative.edits.every(isEdit),
  );

/**
 * Validates a request from a content script. Shapes only: detection itself is
 * pure and bounded, and its failures are answered as "failed".
 */
export function parseReviewEngineRequest(value: unknown): ReviewEngineRequest | null {
  if (!isObjectRecord(value)) return null;
  const { op, session, id, request } = value;
  if (op === "live") {
    const { beforeCursor, options } = value;
    return typeof beforeCursor === "string" &&
      beforeCursor.length <= MAX_LIVE_PROPOSAL_TEXT &&
      isOptions(options) &&
      isStringArray((options as { liveRules?: unknown }).liveRules)
      ? (value as ReviewEngineRequest)
      : null;
  }
  if (typeof session !== "string" || session.length === 0 || session.length > 64) return null;
  if (op === "release") return { op, session };
  if (!isInt(id)) return null;
  if (op === "cancel") return { op, session, id };
  if (!isObjectRecord(request) || !isSnapshot(request.snapshot) || !isOptions(request.options)) {
    return null;
  }
  if (op === "scan") {
    return typeof request.cache === "boolean" &&
      (request.resetCache === undefined || typeof request.resetCache === "boolean") &&
      isObjectRecord(request.gaps) &&
      Object.values(request.gaps).every((count) => typeof count === "number")
      ? (value as ReviewEngineRequest)
      : null;
  }
  if (op === "prove") {
    return Array.isArray(request.checks) &&
      request.checks.every(isDiagnostic) &&
      Array.isArray(request.otherEdits) &&
      request.otherEdits.every(isEdit)
      ? (value as ReviewEngineRequest)
      : null;
  }
  return null;
}
