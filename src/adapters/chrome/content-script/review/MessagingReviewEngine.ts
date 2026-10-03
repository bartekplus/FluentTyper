import { withDeadline } from "@core/application/transport-utils";
import type { ReviewEngine } from "@core/application/review/ReviewEngine";
import { CMD_CONTENT_SCRIPT_REVIEW_ENGINE } from "@core/domain/constants";
import type {
  ReviewEngineRequest,
  ReviewEngineResponse,
  ReviewExplanations,
  ReviewProofRequest,
  ReviewScanRequest,
  ReviewScanResponse,
} from "@core/domain/contracts/reviewEngine";
import type {
  LiveGrammarProposal,
  LiveProposalOptions,
} from "@core/domain/grammar/review/liveProposalSelection";
import type { ContentScriptReviewEngineMessage } from "@core/domain/messageTypes";

/** findLiveGrammarProposals reads the last 500 characters; one more keeps the cut identical. */
const LIVE_TAIL_CHARS = 501;

/**
 * Review detection in the extension's own background service worker, the way
 * predictions are asked for: one runtime message per scan pass, proof round or
 * typing pause. The first message wakes the worker. Text goes to the
 * background only, which neither logs nor keeps it past the session.
 */
export class MessagingReviewEngine implements ReviewEngine {
  // Random; the background also keys sessions by sender tab and frame.
  private readonly session = crypto.getRandomValues(new Uint32Array(2)).join("-");
  private nextId = 0;

  constructor(
    private readonly send: (message: ContentScriptReviewEngineMessage) => Promise<unknown>,
  ) {}

  scan(request: ReviewScanRequest, signal?: AbortSignal): Promise<ReviewScanResponse> {
    return this.call((id) => ({ op: "scan", session: this.session, id, request }), signal);
  }

  prove(request: ReviewProofRequest, signal?: AbortSignal): Promise<boolean[]> {
    return this.call((id) => ({ op: "prove", session: this.session, id, request }), signal);
  }

  async liveProposals(
    beforeCursor: string,
    options: LiveProposalOptions,
    uiLanguage: string,
  ): Promise<LiveGrammarProposal[]> {
    // Only the window the check reads travels; offsets are shifted back.
    const shift = Math.max(0, beforeCursor.length - LIVE_TAIL_CHARS);
    const proposals = await this.call<LiveGrammarProposal[]>(() => ({
      op: "live",
      beforeCursor: beforeCursor.slice(shift),
      options,
      uiLanguage,
    }));
    return proposals.map((p) => ({ ...p, start: p.start + shift, end: p.end + shift }));
  }

  explanations(keys: readonly string[], uiLanguage: string): Promise<ReviewExplanations> {
    return this.call(() => ({ op: "explain", keys: [...keys], uiLanguage }));
  }

  release(): void {
    void this.post({ op: "release", session: this.session });
  }

  /** Fire and forget: a worker that is gone has nothing to release or cancel. */
  private async post(context: ReviewEngineRequest): Promise<void> {
    try {
      await this.send({ command: CMD_CONTENT_SCRIPT_REVIEW_ENGINE, context });
    } catch {
      // Nothing to do.
    }
  }

  /** One request; an abort cancels it in the background and rejects at once. */
  private async call<T>(
    request: (id: number) => ReviewEngineRequest,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const id = ++this.nextId;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        void this.post({ op: "cancel", session: this.session, id });
        reject(new DOMException("Review request cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const response = (await withDeadline(
        Promise.race([
          this.send({ command: CMD_CONTENT_SCRIPT_REVIEW_ENGINE, context: request(id) }),
          aborted,
        ]),
      )) as ReviewEngineResponse<T> | undefined;
      if (response?.ok !== true) {
        throw new Error(`Review engine request failed: ${response?.error ?? "no answer"}`);
      }
      return response.value;
    } catch (error) {
      // A timeout or transport failure also ends ownership of background work.
      // External abort already sent its cancellation message.
      if (!signal?.aborted) void this.post({ op: "cancel", session: this.session, id });
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort!);
    }
  }
}
