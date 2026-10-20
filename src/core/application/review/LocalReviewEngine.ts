import type {
  ReviewExplanations,
  ReviewProofRequest,
  ReviewScanRequest,
  ReviewScanResponse,
} from "@core/domain/contracts/reviewEngine";
import { findLiveProposals } from "@core/domain/grammar/review/liveProposals";
import { reviewText } from "@core/domain/grammar/review/reviewMessages";
import { rankSpellingSuggestions } from "@core/domain/grammar/review/reviewSpelling";
import { REVIEW_SPELLING_CHECK } from "@core/domain/grammar/review/types";
import type { ReviewSpellingLookup } from "./ReviewSession";
import type {
  LiveGrammarProposal,
  LiveProposalOptions,
} from "@core/domain/grammar/review/liveProposalSelection";
import { NativeReviewCache } from "@core/domain/grammar/review/nativeReviewCache";
import { ENGLISH_EXPLANATIONS } from "@core/domain/grammar/review/englishExplanations";
import { resolveReviewUiLanguage } from "@core/domain/grammar/review/reviewLocale";
import {
  needsReviewData,
  setReviewData,
  type ReviewLanguageData,
} from "@core/domain/grammar/review/reviewLanguageData";
import { reviewDay } from "@core/domain/grammar/review/reviewClock";
import type { RawFinding } from "@core/domain/grammar/review/reviewDetectors";
import {
  finalizeReviewAsync,
  incrementalScan,
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

/** One language's generated Review data (review-data/<lang>.json); undefined when it fails. */
export type ReviewDataLoader = (lang: string) => Promise<ReviewLanguageData | undefined>;

/**
 * Review detection in this JavaScript context: the background service worker
 * runs one per review session (ReviewEngineHost), and tests use it directly.
 * Scans and proofs yield between chunks, so other work (typing predictions for
 * every tab) never waits behind a long one, and stop at the next yield once
 * `signal` aborts. Explanations are in English unless `loadExplanations` gives
 * the UI language's table; a key that table lacks stays in English. Before
 * the first check of text in a language with generated data, `loadData` gives
 * that data; if it fails, the checks that need it fail (a rule error) and give
 * no findings.
 */
export class LocalReviewEngine implements ReviewEngine {
  private readonly cache = new NativeReviewCache();
  // The last scanned snapshot, prepared: proofs for it start from it.
  private last: PreparedReview | null = null;
  // The last scan's raw findings, when the next whole-field scan may reuse them.
  private memory: { prepared: PreparedReview; findings: RawFinding[]; day: number } | null = null;

  constructor(
    private readonly pause: () => Promise<void> = yieldTask,
    private readonly loadExplanations: ExplanationLoader = () => Promise.resolve(undefined),
    private readonly loadData: ReviewDataLoader = () => Promise.resolve(undefined),
  ) {}

  /** Loads the generated data of the language of `locale` ("fr_FR") once. */
  private async loadLanguage(locale: string): Promise<void> {
    const lang = locale.slice(0, 2);
    if (!needsReviewData(lang)) return;
    const data = await this.loadData(lang).catch(() => undefined);
    if (data && needsReviewData(lang)) setReviewData(lang, data);
  }

  async scan(request: ReviewScanRequest, signal?: AbortSignal): Promise<ReviewScanResponse> {
    signal?.throwIfAborted();
    await this.loadLanguage(request.options.lang);
    signal?.throwIfAborted();
    if (request.resetCache || !request.cache) this.cache.clear();
    if (request.resetCache) this.memory = null;
    const prepared = prepareReview(request.snapshot, request.options);
    const cache = request.cache ? this.cache : undefined;
    const day = reviewDay();
    // After an edit, only the text around it is scanned again.
    const plan =
      request.cache && this.memory?.day === day ? incrementalScan(this.memory, prepared) : null;
    const scans: ChunkScan[] = plan ? [{ findings: plan.reused, failedRules: [] }] : [];
    const ranges = plan
      ? plan.window
        ? reviewChunks(prepared, plan.window)
        : []
      : reviewChunks(prepared);
    for (const chunk of ranges) {
      scans.push(scanReviewChunk(prepared, chunk, cache));
      await this.pause();
      signal?.throwIfAborted();
    }
    const result = await finalizeReviewAsync(prepared, scans, request.gaps, async () => {
      await this.pause();
      signal?.throwIfAborted();
    });
    this.last = prepared;
    const findings = scans.flatMap((scan) => scan.findings);
    this.memory = scans.every((scan) => scan.failedRules.length === 0)
      ? { prepared, findings, day }
      : null;
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
    await this.loadLanguage(request.options.lang);
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

  /** `lookupSpelling` (the background's dictionary) adds the last finished word's best spelling. */
  async liveProposals(
    beforeCursor: string,
    options: LiveProposalOptions,
    uiLanguage: string,
    lookupSpelling?: ReviewSpellingLookup,
  ): Promise<LiveGrammarProposal[]> {
    await this.loadLanguage(options.lang);
    const { proposals, spelling } = findLiveProposals(
      beforeCursor,
      options,
      await this.explainer(uiLanguage),
    );
    if (!spelling || !lookupSpelling) return proposals;
    // The last finished word, when the dictionary does not know it: its best candidate.
    const answer = await lookupSpelling(options.lang, [
      { word: spelling.lookup, before: spelling.before },
    ]).catch(() => null);
    const candidates = answer?.[0];
    const replacement = candidates
      ? rankSpellingSuggestions(spelling.word, candidates, options.lang)[0]
      : undefined;
    if (!replacement) return proposals;
    return [
      ...proposals,
      {
        ruleId: REVIEW_SPELLING_CHECK,
        messageKey: "review_msg_unknown_word" as const,
        start: spelling.range.start,
        end: spelling.range.end,
        original: spelling.word,
        replacement,
        explanation: reviewText("review_msg_unknown_word", uiLanguage),
      },
    ].sort((a, b) => a.start - b.start);
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
    this.memory = null;
  }
}
