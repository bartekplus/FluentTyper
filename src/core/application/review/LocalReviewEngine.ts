import type {
  ReviewExplanations,
  ReviewProofRequest,
  ReviewScanRequest,
  ReviewScanResponse,
} from "@core/domain/contracts/reviewEngine";
import { findLiveGrammarProposals } from "@core/domain/grammar/review/liveProposals";
import type {
  LiveGrammarProposal,
  LiveProposalOptions,
} from "@core/domain/grammar/review/liveProposalSelection";
import { NativeReviewCache } from "@core/domain/grammar/review/nativeReviewCache";
import { ENGLISH_EXPLANATIONS } from "@core/domain/grammar/review/englishExplanations";
import { resolveReviewUiLanguage } from "@core/domain/grammar/review/reviewLocale";
import {
  finalizeReview,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
  stillDetectedAfterAsync,
  type ChunkScan,
  type PreparedReview,
} from "@core/domain/grammar/review/reviewDiagnostics";
import type { ReviewEngine } from "./ReviewEngine";

const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One UI language's explanations by message key (review-explanations/<lang>.json). */
export type ExplanationLoader = (
  lang: string,
) => Promise<Readonly<Record<string, string>> | undefined>;

/**
 * Review detection in this JavaScript context: the background service worker
 * runs one per review session (ReviewEngineHost), and tests use it directly.
 * Scans and proofs yield between chunks, so other work (typing predictions for
 * every tab) never waits behind a long one, and stop at the next yield once
 * `signal` aborts. Explanations are in English unless `loadExplanations` gives
 * the UI language's table; a key that table lacks stays in English.
 */
export class LocalReviewEngine implements ReviewEngine {
  private readonly cache = new NativeReviewCache();
  // The last scanned snapshot, prepared: proofs for it start from it.
  private last: PreparedReview | null = null;

  constructor(
    private readonly pause: () => Promise<void> = yieldTask,
    private readonly loadExplanations: ExplanationLoader = () => Promise.resolve(undefined),
  ) {}

  async scan(request: ReviewScanRequest, signal?: AbortSignal): Promise<ReviewScanResponse> {
    signal?.throwIfAborted();
    if (request.resetCache || !request.cache) this.cache.clear();
    const prepared = prepareReview(request.snapshot, request.options);
    const scans: ChunkScan[] = [];
    for (const chunk of reviewChunks(prepared)) {
      scans.push(scanReviewChunk(prepared, chunk, request.cache ? this.cache : undefined));
      await this.pause();
      signal?.throwIfAborted();
    }
    const result = finalizeReview(prepared, scans, request.gaps);
    this.last = prepared;
    const { snapshot, options: _options, rules, dictionary, text, ...data } = prepared;
    return {
      result,
      prepared: {
        ...data,
        rules: [...rules],
        dictionary: [...dictionary],
        ...(text !== snapshot.text && { text }),
      },
      explanations: await this.explain(
        result.diagnostics.map((d) => d.messageKey),
        request.uiLanguage,
      ),
    };
  }

  async prove(request: ReviewProofRequest, signal?: AbortSignal): Promise<boolean[]> {
    signal?.throwIfAborted();
    const last = this.last;
    // A proof starts from the scan it plans for; a worker that restarted since prepares it again.
    const prepared =
      last &&
      last.snapshot.id === request.snapshot.id &&
      last.snapshot.text === request.snapshot.text &&
      JSON.stringify(last.options) === JSON.stringify(request.options)
        ? last
        : prepareReview(request.snapshot, request.options);
    return stillDetectedAfterAsync(prepared, request.checks, request.otherEdits, async () => {
      await this.pause();
      signal?.throwIfAborted();
    });
  }

  async liveProposals(
    beforeCursor: string,
    options: LiveProposalOptions,
    uiLanguage: string,
  ): Promise<LiveGrammarProposal[]> {
    return findLiveGrammarProposals(beforeCursor, options, await this.explainer(uiLanguage));
  }

  explanations(keys: readonly string[], uiLanguage: string): Promise<ReviewExplanations> {
    return this.explain(keys, uiLanguage);
  }

  /** The explanations of `keys` in `uiLanguage`, once per key; the page's own keys left out. */
  private async explain(keys: readonly string[], uiLanguage: string): Promise<ReviewExplanations> {
    const explain = await this.explainer(uiLanguage);
    const texts: ReviewExplanations = {};
    for (const key of keys) {
      const text = explain(key);
      if (text) texts[key as keyof ReviewExplanations] = text;
    }
    return texts;
  }

  /** A key's explanation in `uiLanguage`, else in English; "" for keys the page explains. */
  private async explainer(uiLanguage: string): Promise<(key: string) => string> {
    const lang = resolveReviewUiLanguage(uiLanguage);
    const table =
      lang === "en" ? undefined : await this.loadExplanations(lang).catch(() => undefined);
    return (key) =>
      Object.hasOwn(ENGLISH_EXPLANATIONS, key) ? table?.[key] || ENGLISH_EXPLANATIONS[key] : "";
  }

  release(): void {
    this.cache.clear();
    this.last = null;
  }
}
