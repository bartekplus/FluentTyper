import type {
  PreparedReviewData,
  ReviewExplanations,
  ReviewProofRequest,
  ReviewScanRequest,
  ReviewScanResponse,
} from "@core/domain/contracts/reviewEngine";
import type {
  LiveGrammarProposal,
  LiveProposalOptions,
} from "@core/domain/grammar/review/liveProposalSelection";
import type { PreparedReview } from "@core/domain/grammar/review/reviewDiagnostics";
import type { ReviewOptions, ReviewSourceSnapshot } from "@core/domain/grammar/review/types";

/**
 * Review detection, wherever it runs: in the background service worker for a
 * page (MessagingReviewEngine, answered by ReviewEngineHost), or in process
 * (LocalReviewEngine: the host itself, tests). One instance per review session;
 * `liveProposals` and `explanations` are stateless. Every call may reject (the
 * worker is gone, the request was cancelled through `signal`); callers decide
 * what that means.
 */
export interface ReviewEngine {
  /** One whole scan pass over a snapshot. */
  scan(request: ReviewScanRequest, signal?: AbortSignal): Promise<ReviewScanResponse>;
  /** One bulk-plan proof round (see stillDetectedAfter). */
  prove(request: ReviewProofRequest, signal?: AbortSignal): Promise<boolean[]>;
  /** Typing-time proposals for the text before the caret (see findLiveGrammarProposals). */
  liveProposals(
    beforeCursor: string,
    options: LiveProposalOptions,
    uiLanguage: string,
  ): Promise<LiveGrammarProposal[]>;
  /** Findings' explanations again, in another UI language (see reviewExplanations). */
  explanations(keys: readonly string[], uiLanguage: string): Promise<ReviewExplanations>;
  /** The session is over: drop what it keeps. */
  release(): void;
}

/** The prepared review as the domain functions take it, from a scan's plain data. */
export function hydratePrepared(
  data: PreparedReviewData,
  snapshot: ReviewSourceSnapshot,
  options: ReviewOptions,
): PreparedReview {
  return {
    ...data,
    snapshot,
    options,
    text: data.text ?? snapshot.text,
    rules: new Set(data.rules),
    dictionary: new Set(data.dictionary),
  };
}
