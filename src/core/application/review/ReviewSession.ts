import {
  planBulkFixSteps,
  type BulkPlan,
  type ProofRequest,
} from "@core/domain/grammar/review/bulkPlanner";
import {
  MAX_REVIEW_CHARS,
  finalizeReview,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
  spellingDiagnostic,
  stillDetectedAfter,
  stillDetectedAfterAsync,
  type ChunkScan,
  type PreparedReview,
} from "@core/domain/grammar/review/reviewDiagnostics";
import {
  applyEdits,
  diffTexts,
  rangesOverlap,
  positionMapper,
  remapRange,
  remapRangeThroughEdits,
  remapScope,
} from "@core/domain/grammar/review/textRanges";
import type {
  ProtectedRange,
  ReviewCategory,
  ReviewCoverage,
  ReviewDiagnostic,
  ReviewEdit,
  ReviewOptions,
  TextRange,
} from "@core/domain/grammar/review/types";
import {
  REVIEW_CATEGORIES,
  REVIEW_LOCAL_AI_CHECK,
  REVIEW_SPELLING_CHECK,
} from "@core/domain/grammar/review/types";
import {
  aiCacheKey,
  conflictFreeFindings,
  reviewAiAvailability,
  sameChange,
  type AiBatchPreview,
  type ReviewAiAvailability,
  type ReviewAiCoverage,
  type ReviewAiProvider,
  type ReviewAiViewState,
  type ReviewMode,
  type RewriteViewState,
} from "./reviewAi";
import type { LocalAiStatus } from "@core/domain/contracts/localAi";
import type {
  AiChunk,
  AiChunkPlan,
  AiErrorCode,
  AiGenerationOutcome,
  EditorContextHint,
  RewriteProposal,
  RewriteStyle,
} from "@core/domain/grammar/review/ai/types";
import { AI_PROMPT_VERSION } from "@core/domain/grammar/review/ai/prompts";
import { aiRequestForChunk, buildAiChunks } from "@core/domain/grammar/review/ai/segments";
import { resolveRewriteStyle } from "@core/domain/grammar/review/ai/style";
import { correctionFindings, rewriteProposal } from "@core/domain/grammar/review/ai/validate";
import {
  rankSpellingSuggestions,
  spellingCandidates,
  type SpellingCandidate,
} from "@core/domain/grammar/review/reviewSpelling";

/** What a review target can honestly do; the UI shows limits, never hides them. */
export interface ReviewCapabilities {
  /** Findings can be painted in the editor itself. */
  inline: boolean;
  /** Single fixes can be written and verified. */
  apply: boolean;
  /** "Fix all" can be written and verified. */
  bulk: boolean;
  /** How native undo sees a fix. */
  undo: "single-step" | "per-edit" | "host-history" | "none";
}

export interface ReviewTargetText {
  text: string;
  /** Code, non-editable islands and virtual block separators, in `text` offsets. */
  protectedRanges: ProtectedRange[];
  /** Changes when structure or protection changes even if `text` does not. */
  signature: string;
  /**
   * Characters of the editor outside `text`, when the adapter can only read a
   * window of a long document: never reviewed, so the review is partial.
   */
  unread?: number;
}

export type ReviewUnavailable = "detached" | "ineligible" | "composing" | "unsupported";

export type ReviewTargetRead =
  ({ ok: true } & ReviewTargetText) | { ok: false; reason: ReviewUnavailable };

export type ReviewApplyResult =
  | { status: "applied" }
  | { status: "stale" }
  | { status: "rejected"; reason: ReviewUnavailable | "host-refused" }
  | { status: "partial"; applied: number }
  | { status: "unverified" };

/**
 * Editor side of a review. Adapters implement it; the session never touches the DOM.
 * `apply` receives edits against `before` (descending, non-overlapping) and must
 * check the editor still holds exactly `before` with `signature`, write through
 * the editor's own mechanism, and report "applied" only after reading back `after`.
 */
export interface ReviewTargetPort {
  readonly capabilities: ReviewCapabilities;
  read(): ReviewTargetRead | Promise<ReviewTargetRead>;
  apply(request: {
    edits: ReviewEdit[];
    before: string;
    after: string;
    signature: string;
  }): Promise<ReviewApplyResult>;
}

export type ReviewStatus =
  | "loading"
  | "ready"
  | "updating"
  | "applying"
  | "stale-scope"
  | "unavailable"
  | "error"
  | "closed";

export type ReviewNotice =
  | { kind: "applied"; count: number; deferred: number }
  | { kind: "stale" }
  | { kind: "partial"; applied: number }
  | { kind: "unverified" }
  | { kind: "refused" }
  | { kind: "dictionary-added"; word: string }
  | { kind: "dictionary-failed" };

export interface ReviewViewState {
  status: ReviewStatus;
  unavailable?: ReviewUnavailable;
  scopeKind: "selection" | "field";
  capabilities: ReviewCapabilities;
  /** Current, not ignored. */
  diagnostics: ReviewDiagnostic[];
  ignoredCount: number;
  resolvedCount: number;
  categories: ReadonlySet<ReviewCategory>;
  selectedId: string | null;
  coverage: ReviewCoverage | null;
  /** Characters beyond the size limit that were not reviewed. */
  truncated: number;
  /** Characters of the document the editor did not hand over (outside its window). */
  unread: number;
  languageSkipped: number;
  noRules: boolean;
  /** `pending`: the plan is still being proven; Fix all waits for it. */
  bulk: { count: number; deferred: number; pending: boolean };
  /**
   * The dictionary check, which runs after the rule results are shown:
   * `off` without a lookup (or with no rules on), `unavailable` when the
   * language has no dictionary, `partial` when it stopped at its limit for
   * one pass (see SPELLING_WORDS_PER_PASS) with words left unchecked.
   */
  spelling: "off" | "checking" | "done" | "partial" | "unavailable";
  notice: ReviewNotice | null;
  /** The text the diagnostics' offsets refer to. */
  text: string;
  /** Correct (default for every new review) or Rewrite (explicit). */
  mode: ReviewMode;
  /** Local AI state for this review, tracked apart from rule coverage. */
  ai: ReviewAiViewState;
  /** Rewrite panel state; null in Correct mode. */
  rewrite: RewriteViewState | null;
  /** Open "Apply selected AI corrections" preview, if any. */
  aiBatch: AiBatchPreview | null;
}

/** Session-local AI answers kept for reuse (per chunk key, model and prompt version). */
const AI_CACHE_ENTRIES = 256;

/** Errors after which the next chunk would fail the same way: the pass stops. */
const AI_PASS_FATAL: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  "unavailable",
  "not-installed",
  "not-ready",
  "device-lost",
]);

type AiSegments = ReadonlyArray<{ id: string; text: string }>;

/** Individually reviewed only: never planned into Fix all, counted as left for the user. */
function individualOnly(diagnostic: ReviewDiagnostic): boolean {
  return diagnostic.ruleId === REVIEW_SPELLING_CHECK || diagnostic.ruleId === REVIEW_LOCAL_AI_CHECK;
}

export interface ReviewSessionDependencies {
  target: ReviewTargetPort;
  options: ReviewOptions;
  /** Selection captured before any UI opened, in the target's text offsets; null = whole field. */
  initialScope: TextRange | null;
  onChange: (state: ReviewViewState) => void;
  addToDictionary?: (word: string) => Promise<boolean>;
  /** Local dictionary lookups (see ReviewSpellingLookup). */
  lookupSpelling?: ReviewSpellingLookup;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  recheckDelayMs?: number;
  /** Optional on-device model; without it Review works exactly as without Local AI. */
  ai?: ReviewAiProvider;
  /** Pause after a text change before new text goes to the model (slower than rule rechecks). */
  aiRecheckDelayMs?: number;
}

/**
 * Per word: null when the dictionary knows it, else candidate replacements
 * ranked for `before`. Null overall: no dictionary for the language. The
 * answer may be shorter than `words` (the background bounds each lookup's
 * time): it covers the first words, and the rest were not looked up yet.
 */
export type ReviewSpellingLookup = (
  lang: string,
  words: ReadonlyArray<{ word: string; before: string }>,
) => Promise<Array<string[] | null> | null>;

/** Words per lookup: small, so typing predictions sharing the engine never wait long. */
const SPELLING_REQUEST_WORDS = 25;

/**
 * Dictionary work per pass, in document order. Each different word is looked
 * up once, but an unknown word costs the engine far more than a known one
 * (tens of milliseconds against about one), so the check stops after this
 * many different words, or after the batch in which this many turned out
 * unknown (text in another language, say). The panel says the check was
 * partial; answers are remembered, so a recheck continues where it stopped.
 */
export const SPELLING_WORDS_PER_PASS = 2000;
export const SPELLING_UNKNOWN_PER_PASS = 100;

interface IgnoredOccurrence {
  ruleId: string;
  range: TextRange;
  original: string;
}

function sameOptions(a: ReviewOptions, b: ReviewOptions): boolean {
  return (
    a.lang === b.lang &&
    a.insertSpaceAfterAutocomplete === b.insertSpaceAfterAutocomplete &&
    sameKey(a.enabledRules, b.enabledRules) &&
    sameKey(a.userDictionary, b.userDictionary)
  );
}

interface PendingPlan {
  key: readonly unknown[];
  promise: Promise<BulkPlan | null>;
}

class PlanSuperseded extends Error {}

const NO_DIAGNOSTICS: ReviewDiagnostic[] = [];

function occurrenceKey(entry: IgnoredOccurrence): string {
  return `${entry.ruleId}|${entry.range.start}|${entry.range.end}|${entry.original}`;
}

/** Proof checks a plan may run at once before it continues asynchronously. */
const SYNC_PROOF_CHECKS = 64;

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function textOrder(a: ReviewDiagnostic, b: ReviewDiagnostic): number {
  return a.range.start - b.range.start || a.range.end - b.range.end;
}

/** `shown` (already in text order) with `added` merged in; on a tie, shown first. */
function mergeInTextOrder(
  shown: readonly ReviewDiagnostic[],
  added: ReviewDiagnostic[],
): ReviewDiagnostic[] {
  added.sort(textOrder);
  const merged: ReviewDiagnostic[] = [];
  let i = 0;
  let j = 0;
  while (i < shown.length || j < added.length) {
    if (j >= added.length || (i < shown.length && textOrder(shown[i], added[j]) <= 0)) {
      merged.push(shown[i++]);
    } else {
      merged.push(added[j++]);
    }
  }
  return merged;
}

/**
 * One review session over one editor. Owns generations, cancellation and the
 * scope; every write goes through the target port with verification.
 * Starting a review reads only: no text, formatting, setting or learning changes.
 */
export class ReviewSession {
  private generation = 0;
  private status: ReviewStatus = "loading";
  private unavailable: ReviewUnavailable | undefined;
  private text = "";
  private signature = "";
  private protectedRanges: ProtectedRange[] = [];
  private scope: TextRange | null;
  private readonly scopeKind: "selection" | "field";
  // An edit the selection could not be followed through: the review stays
  // stale until it is closed, and never widens to the whole field.
  private scopeLost = false;
  // True once a read succeeded: `text` is then what the scope and ignores refer to.
  private hasRead = false;
  private truncated = 0;
  private unread = 0;
  private prepared: PreparedReview | null = null;
  private diagnostics: ReviewDiagnostic[] = [];
  // The rule findings alone: Fix all plans from these (spelling is never batched).
  private ruleDiagnostics: ReviewDiagnostic[] = [];
  private spelling: ReviewViewState["spelling"] = "off";
  // Lookups already answered, per language and lowercased word: known words, and candidates.
  private spellingCache = {
    lang: "",
    unavailable: false,
    known: new Set<string>(),
    candidates: new Map<string, string[]>(),
  };
  private coverage: ReviewCoverage | null = null;
  private ignored: IgnoredOccurrence[] = [];
  // getState() runs on every change; the plan only depends on these inputs.
  private listCache: { key: readonly unknown[]; visible: ReviewDiagnostic[] } | null = null;
  // Lookup set for `ignored`, rebuilt when the list is replaced.
  private ignoredKeys: { list: IgnoredOccurrence[]; keys: Set<string> } | null = null;
  private planCache: { key: readonly unknown[]; plan: BulkPlan } | null = null;
  private planPending: { key: readonly unknown[]; promise: Promise<BulkPlan | null> } | null = null;
  private resolvedCount = 0;
  private categories = new Set<ReviewCategory>(REVIEW_CATEGORIES);
  private selectedId: string | null = null;
  private notice: ReviewNotice | null = null;
  private recheckTimer: unknown = null;
  private options: ReviewOptions;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  // Local AI. Mode, pause and style are this review's own: never persisted.
  private mode: ReviewMode = "correct";
  private aiEnabled = true;
  private aiPaused = false;
  private aiStatus: LocalAiStatus | null = null;
  // The setup offer was answered in this review (opened or declined).
  private aiOfferAnswered = false;
  private aiUnsubscribe: (() => void) | null = null;
  // Bumped to drop an AI pass: whatever it awaits is discarded when it lands.
  private aiToken = 0;
  private aiAbort: AbortController | null = null;
  private aiTimer: unknown = null;
  // The results the current or last AI pass was for; null lets the next one start.
  private aiPassFor: PreparedReview | null = null;
  // The text changed: new text waits a pause before it goes to the model.
  private aiDelayNext = false;
  // Validated AI findings for `prepared`, before deduplication against the checks.
  private aiFindings: ReviewDiagnostic[] = [];
  // Answers by chunk key, model and prompt version; a hit must match the whole request.
  private readonly aiCache = new Map<string, { request: string; segments: AiSegments }>();
  private aiCoverage: ReviewAiCoverage = "idle";
  private aiCounts = { checked: 0, eligible: 0, skipped: 0, rejected: 0 };
  private aiFailure: AiErrorCode | null = null;
  private rewriteStyle: RewriteStyle = "keep-voice";
  private rewriteHint: EditorContextHint = "general";
  private rewrite: RewriteViewState | null = null;
  // The validated proposal's edits, and the text and generation they were made for.
  private rewriteEdits: { edits: ReviewEdit[]; generation: number; text: string } | null = null;
  private rewriteToken = 0;
  private rewriteAbort: AbortController | null = null;
  // The preview, with the list it was made from: it stands only while that list is shown.
  private aiBatch: {
    preview: AiBatchPreview;
    edits: ReviewEdit[];
    generation: number;
    list: ReviewDiagnostic[];
  } | null = null;

  constructor(private readonly deps: ReviewSessionDependencies) {
    this.options = deps.options;
    this.scope = deps.initialScope ? { ...deps.initialScope } : null;
    this.scopeKind = deps.initialScope ? "selection" : "field";
    this.setTimer = deps.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer =
      deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get isClosed(): boolean {
    return this.status === "closed";
  }

  get capabilities(): ReviewCapabilities {
    return this.deps.target.capabilities;
  }

  /** Reads and scans. Resolves once the first results (or an error) are shown. */
  async start(): Promise<void> {
    this.emit();
    const ai = this.deps.ai;
    if (ai) {
      this.aiUnsubscribe = ai.onStatus((status) => this.onAiStatus(status));
      this.fetchAiStatus(ai);
    }
    await this.refresh();
  }

  close(): void {
    this.generation += 1;
    this.cancelRecheck();
    this.cancelAi();
    this.cancelRewriteRun();
    this.aiUnsubscribe?.();
    this.aiUnsubscribe = null;
    this.aiCache.clear();
    this.aiFindings = [];
    this.rewrite = null;
    this.rewriteEdits = null;
    this.aiBatch = null;
    this.status = "closed";
    this.diagnostics = [];
    this.planCache = null;
    this.planPending = null;
    this.emit();
  }

  /** Any edit in the editor: results are stale now; a recheck follows after a pause. */
  notifySourceChanged(): void {
    if (this.status === "closed" || this.status === "applying" || this.scopeLost) return;
    this.generation += 1;
    this.textChanging();
    // "Fixed: 3" describes our last write; after the user's own edit (say, an
    // undo) it no longer describes the text.
    const changed = this.notice !== null || this.status !== "updating" || this.selectedId !== null;
    this.notice = null;
    // Already showing "updating" (the next keystroke): only the pause restarts.
    if (this.status !== "stale-scope" && changed) {
      this.status = "updating";
      this.selectedId = null;
      this.emit();
    }
    this.cancelRecheck();
    this.recheckTimer = this.setTimer(() => {
      this.recheckTimer = null;
      void this.refresh();
    }, this.deps.recheckDelayMs ?? 400);
  }

  /** Settings broadcasts repeat unchanged values; only a real change rechecks. */
  updateOptions(options: ReviewOptions): void {
    if (this.status === "closed" || sameOptions(this.options, options)) return;
    this.options = options;
    this.notifySourceChanged();
  }

  select(id: string | null): void {
    if (id !== null && !this.visibleDiagnostics().some((d) => d.id === id)) return;
    this.selectedId = id;
    this.emit();
  }

  setCategory(category: ReviewCategory, shown: boolean): void {
    // A new set per change: the plan cache keys on identity.
    const categories = new Set(this.categories);
    if (shown) categories.add(category);
    else categories.delete(category);
    this.categories = categories;
    if (this.selectedId && !this.visibleDiagnostics().some((d) => d.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.emit();
  }

  /** Ignores this occurrence for this session only. */
  ignore(id: string): void {
    const diagnostic = this.diagnostics.find((d) => d.id === id);
    if (!diagnostic) return;
    // A new list per change: the plan cache keys on identity.
    this.ignored = [
      ...this.ignored,
      { ruleId: diagnostic.ruleId, range: { ...diagnostic.range }, original: diagnostic.original },
    ];
    if (this.selectedId === id) this.selectedId = null;
    this.emit();
  }

  async addToDictionary(id: string): Promise<void> {
    const diagnostic = this.diagnostics.find((d) => d.id === id);
    const word = diagnostic?.dictionaryWord;
    if (!word || !this.deps.addToDictionary || this.status !== "ready") return;
    const added = await this.deps.addToDictionary(word).catch(() => false);
    if (this.isClosed) return;
    if (!added) {
      this.notice = { kind: "dictionary-failed" };
      this.emit();
      return;
    }
    this.options = { ...this.options, userDictionary: [...this.options.userDictionary, word] };
    this.notice = { kind: "dictionary-added", word };
    this.generation += 1;
    // The findings are rebuilt for the new dictionary; so is the AI pass, and a
    // proposal or preview made before it is stale.
    this.textChanging();
    await this.refresh();
  }

  /** Applies one alternative of one current finding. */
  async apply(id: string, alternativeIndex = 0): Promise<ReviewApplyResult | null> {
    const diagnostic = this.diagnostics.find((d) => d.id === id);
    const alternative = diagnostic?.alternatives[alternativeIndex];
    if (!diagnostic || !alternative || !this.canWrite()) return null;
    return this.write(alternative.edits, 1, 0);
  }

  /** Applies every safe fix in the shown categories as one planned batch. */
  async fixAll(): Promise<ReviewApplyResult | null> {
    if (!this.canWrite() || !this.capabilities.bulk) return null;
    let plan = this.planBulk();
    if (!plan && this.planPending) {
      // Still proving: wait for it, then act only if nothing changed meanwhile.
      const generation = this.generation;
      plan = await this.planPending.promise;
      if (generation !== this.generation || !this.canWrite()) return null;
    }
    if (!plan || plan.edits.length === 0) return null;
    return this.write(plan.edits, plan.diagnosticIds.length, this.deferredCount(plan));
  }

  /** The text the current results describe. */
  get sourceText(): string {
    return this.text;
  }

  getState(): ReviewViewState {
    const plan = this.status === "ready" && this.capabilities.bulk ? this.planBulk() : null;
    return {
      status: this.status,
      unavailable: this.unavailable,
      scopeKind: this.scopeKind,
      capabilities: this.capabilities,
      diagnostics: this.status === "ready" ? this.visibleDiagnostics() : NO_DIAGNOSTICS,
      ignoredCount: this.ignoredDiagnostics().length,
      resolvedCount: this.resolvedCount,
      categories: new Set(this.categories),
      selectedId: this.selectedId,
      coverage: this.coverage,
      truncated: this.truncated,
      unread: this.unread,
      languageSkipped: this.prepared?.languageSkipped.length ?? 0,
      noRules: this.prepared !== null && this.prepared.rules.size === 0,
      bulk: {
        count: plan?.diagnosticIds.length ?? 0,
        deferred: plan ? this.deferredCount(plan) : 0,
        pending: plan === null && this.planPending !== null,
      },
      spelling: this.spelling,
      notice: this.notice,
      text: this.text,
      mode: this.mode,
      ai: this.aiViewState(),
      rewrite:
        this.mode === "rewrite" && this.rewrite
          ? {
              ...this.rewrite,
              canApply: this.rewriteApplicable(),
              previewOnly: !this.capabilities.apply,
            }
          : null,
      aiBatch: this.openAiBatch()?.preview ?? null,
    };
  }

  // ---------------------------------------------------------------- local AI

  /** Correct (conservative findings) or Rewrite (explicit proposal); never persisted. */
  setMode(mode: ReviewMode): void {
    if (this.isClosed || mode === this.mode) return;
    this.mode = mode;
    this.aiBatch = null;
    if (mode === "rewrite") {
      // Findings already shown stay; the pass stops where it is.
      this.cancelAi();
      this.rewrite = this.idleRewrite();
    } else {
      this.cancelRewriteRun();
      this.rewrite = null;
      this.rewriteEdits = null;
      this.startAi();
    }
    this.emit();
  }

  /** Pauses Local AI for this review only; findings already shown stay. */
  setAiPaused(paused: boolean): void {
    if (this.isClosed || paused === this.aiPaused) return;
    this.aiPaused = paused;
    if (paused) {
      this.cancelAi();
      this.stopRewriteGeneration("idle");
    } else {
      this.startAi();
    }
    this.emit();
  }

  /** The persistent preference changed while the review is open. */
  setAiEnabled(enabled: boolean): void {
    if (this.isClosed || enabled === this.aiEnabled) return;
    this.aiEnabled = enabled;
    if (enabled && this.deps.ai) this.fetchAiStatus(this.deps.ai, true);
    if (enabled) this.startAi();
    else this.aiOff();
    this.emit();
  }

  openAiSetup(): void {
    if (!this.deps.ai || this.isClosed) return;
    this.deps.ai.openSetup();
    this.aiOfferAnswered = true;
    this.emit();
  }

  dismissAiSetup(): void {
    if (!this.deps.ai || this.isClosed) return;
    this.deps.ai.dismissSetupOffer();
    this.aiOfferAnswered = true;
    this.emit();
  }

  /** Changes the style only: never generates. A ready proposal no longer matches it. */
  setRewriteStyle(style: RewriteStyle): void {
    if (!this.rewrite || this.rewrite.status === "applying" || style === this.rewriteStyle) return;
    this.rewriteStyle = style;
    this.rewriteSettingsChanged();
  }

  setRewriteContext(hint: EditorContextHint): void {
    if (!this.rewrite || this.rewrite.status === "applying" || hint === this.rewriteHint) return;
    this.rewriteHint = hint;
    this.rewriteSettingsChanged();
  }

  /** One proposal for the scope in the chosen style; nothing is written until applyRewrite(). */
  generateRewrite(): void {
    const { rewrite, prepared } = this;
    const ai = this.deps.ai;
    if (
      !rewrite ||
      !prepared ||
      !ai ||
      this.status !== "ready" ||
      rewrite.status === "generating" ||
      rewrite.status === "applying" ||
      // Pause stops automatic checking; an explicit Generate still works.
      (this.aiAvailability() !== "ready" && this.aiAvailability() !== "paused")
    ) {
      return;
    }
    void this.runRewrite(ai, prepared, this.generation);
  }

  cancelRewrite(): void {
    if (this.rewrite?.status !== "generating") return;
    this.stopRewriteGeneration("idle");
    this.emit();
  }

  /** Writes a complete, validated proposal through the verified target transaction. */
  async applyRewrite(): Promise<ReviewApplyResult | null> {
    const pending = this.rewriteEdits;
    if (!this.rewrite || !pending || !this.rewriteApplicable()) return null;
    this.rewriteEdits = null;
    this.rewrite = { ...this.rewrite, status: "applying" };
    const result = await this.write(pending.edits, pending.edits.length, 0);
    if (this.isClosed || !this.rewrite) return result;
    this.rewrite =
      result.status === "applied" ? this.idleRewrite() : { ...this.rewrite, status: "stale" };
    this.emit();
    return result;
  }

  /** Opens the combined diff of the shown AI findings (or `ids` among them). */
  previewAiBatch(ids?: readonly string[]): void {
    const prepared = this.prepared;
    if (this.status !== "ready" || !prepared) return;
    const wanted = ids ? new Set(ids) : null;
    const selected = this.visibleDiagnostics().filter(
      (d) => d.ruleId === REVIEW_LOCAL_AI_CHECK && (!wanted || wanted.has(d.id)),
    );
    const { included, excluded } = conflictFreeFindings(this.text, selected);
    const edits = included.flatMap((d) => d.alternatives[0]?.edits ?? []);
    const { start, end } = prepared.snapshot.scope;
    const before = this.text.slice(start, end);
    const after = applyEdits(
      before,
      edits.map((edit) => ({ ...edit, start: edit.start - start, end: edit.end - start })),
    );
    if (after === null || selected.length === 0) return;
    this.aiBatch = {
      preview: {
        diagnosticIds: included.map((d) => d.id),
        excluded,
        before,
        after,
        canApply: this.capabilities.apply && this.capabilities.bulk && included.length > 0,
      },
      edits,
      generation: this.generation,
      list: this.visibleDiagnostics(),
    };
    this.emit();
  }

  /** Applies the open preview as one verified multi-edit write; never part of Fix all. */
  async applyAiBatch(): Promise<ReviewApplyResult | null> {
    const batch = this.openAiBatch();
    if (!batch?.preview.canApply || !this.canWrite()) return null;
    this.aiBatch = null;
    return this.write(batch.edits, batch.preview.diagnosticIds.length, 0);
  }

  cancelAiBatch(): void {
    if (!this.aiBatch) return;
    this.aiBatch = null;
    this.emit();
  }

  // ------------------------------------------------------------------ internals

  private canWrite(): boolean {
    return this.status === "ready" && this.capabilities.apply;
  }

  /** The same array while results, ignores and filters stay the same: the UI keys on it. */
  private visibleDiagnostics(): ReviewDiagnostic[] {
    const key = [this.diagnostics, this.ignored, this.categories];
    if (!this.listCache || !sameKey(this.listCache.key, key)) {
      const visible = this.diagnostics.filter(
        (d) => !this.isIgnored(d) && this.categories.has(d.category),
      );
      this.listCache = { key, visible };
    }
    return this.listCache.visible;
  }

  private ignoredDiagnostics(): ReviewDiagnostic[] {
    return this.diagnostics.filter((d) => this.isIgnored(d));
  }

  private isIgnored(diagnostic: ReviewDiagnostic): boolean {
    if (this.ignoredKeys?.list !== this.ignored) {
      this.ignoredKeys = { list: this.ignored, keys: new Set(this.ignored.map(occurrenceKey)) };
    }
    return this.ignoredKeys.keys.has(occurrenceKey(diagnostic));
  }

  private planKey(): readonly unknown[] | null {
    if (!this.prepared) return null;
    // Rule findings only: spelling results arriving later never re-plan Fix all.
    return [this.prepared, this.text, this.ruleDiagnostics, this.ignored, this.categories];
  }

  /** Findings Fix all leaves for the user: the plan's, plus every shown spelling and AI finding. */
  private deferredCount(plan: BulkPlan): number {
    return plan.deferred.length + this.visibleDiagnostics().filter(individualOnly).length;
  }

  /**
   * The Fix-all plan for the current results, or null while it is still being
   * proven. Most plans need no proof, and small proofs run at once; larger ones
   * (dense errors in long text) continue asynchronously, pausing between scans,
   * and are dropped when newer results replace them.
   */
  private planBulk(): BulkPlan | null {
    const key = this.planKey();
    if (!key || !this.prepared) return null;
    if (this.planCache && sameKey(this.planCache.key, key)) return this.planCache.plan;
    if (this.planPending && sameKey(this.planPending.key, key)) return null;
    const prepared = this.prepared;
    // What is shown: ignored findings and hidden categories are neither fixed nor counted.
    const ruleFindings = this.visibleDiagnostics().filter((d) => !individualOnly(d));
    const steps = planBulkFixSteps(this.text, ruleFindings, { prove: true });
    let budget = SYNC_PROOF_CHECKS;
    let step = steps.next();
    while (!step.done && step.value.checks.length <= budget) {
      budget -= step.value.checks.length;
      step = steps.next(stillDetectedAfter(prepared, step.value.checks, step.value.otherEdits));
    }
    if (step.done) {
      this.planCache = { key, plan: step.value };
      return step.value;
    }
    const pending: PendingPlan = { key, promise: Promise.resolve(null) };
    this.planPending = pending;
    pending.promise = this.provePlan(pending, steps, step.value, prepared);
    return null;
  }

  /** Answers the remaining proof rounds, pausing between scans; dropped if superseded. */
  private async provePlan(
    pending: PendingPlan,
    steps: Generator<ProofRequest, BulkPlan, boolean[]>,
    first: ProofRequest,
    prepared: PreparedReview,
  ): Promise<BulkPlan | null> {
    let request: IteratorResult<ProofRequest, BulkPlan> = { done: false, value: first };
    // Newer results replace this plan: stop at the next pause, not after the round.
    const pause = async () => {
      await this.pause();
      if (this.planPending !== pending) throw new PlanSuperseded();
    };
    let plan: BulkPlan;
    try {
      while (!request.done) {
        const answer = await stillDetectedAfterAsync(
          prepared,
          request.value.checks,
          request.value.otherEdits,
          pause,
        );
        request = steps.next(answer);
      }
      plan = request.value;
    } catch (error) {
      if (error instanceof PlanSuperseded || this.planPending !== pending) return null;
      // Any other failure: what is still unproven stays unproven, so Fix all never waits forever.
      plan = this.unprovenPlan(steps, request, prepared.text);
    }
    this.planPending = null;
    this.planCache = { key: pending.key, plan };
    this.emit();
    return plan;
  }

  /**
   * Finishes a plan whose proof failed: every open check counts as not holding,
   * so its group is left for individual review. If the planner itself failed,
   * nothing is batched.
   */
  private unprovenPlan(
    steps: Generator<ProofRequest, BulkPlan, boolean[]>,
    request: IteratorResult<ProofRequest, BulkPlan>,
    text: string,
  ): BulkPlan {
    try {
      let step = request;
      while (!step.done) step = steps.next(step.value.checks.map(() => false));
      // A planner that threw is finished without a plan: `next` returns no value.
      if (step.value) return step.value;
    } catch {
      // The planner failed while finishing: the same as having no plan.
    }
    const deferred = this.visibleDiagnostics()
      .filter((d) => !individualOnly(d))
      .map((d) => ({ id: d.id, reason: "unproven" as const }));
    return { diagnosticIds: [], edits: [], expectedText: text, deferred };
  }

  private async write(
    edits: ReviewEdit[],
    count: number,
    deferred: number,
  ): Promise<ReviewApplyResult> {
    const after = applyEdits(this.text, edits);
    if (after === null) return { status: "stale" };
    this.generation += 1;
    this.cancelRecheck();
    this.textChanging();
    this.status = "applying";
    this.selectedId = null;
    this.emit();

    const before = this.text;
    let result: ReviewApplyResult;
    try {
      result = await this.deps.target.apply({
        edits: [...edits].sort((a, b) => b.start - a.start),
        before,
        after,
        signature: this.signature,
      });
    } catch {
      result = { status: "unverified" };
    }
    if (this.isClosed) return result;

    if (result.status === "applied") {
      this.resolvedCount += count;
      this.notice = { kind: "applied", count, deferred };
      // Our own edits are exactly known: carry scope and ignores through them.
      const delta = after.length - before.length;
      if (this.scope) this.scope = { start: this.scope.start, end: this.scope.end + delta };
      this.remapIgnored(edits);
      this.text = after;
    } else if (result.status === "stale") {
      this.notice = { kind: "stale" };
    } else if (result.status === "partial") {
      this.notice = { kind: "partial", applied: result.applied };
    } else if (result.status === "unverified") {
      this.notice = { kind: "unverified" };
    } else {
      this.notice = { kind: "refused" };
    }
    // Always re-read: never assume the editor holds what we asked for.
    this.status = "loading";
    this.emit();
    await this.refresh();
    return result;
  }

  /** Our own edits are exactly known: each ignore moves with them, or goes if one touches it. */
  private remapIgnored(edits: ReviewEdit[]): void {
    if (this.ignored.length === 0) return;
    const map = positionMapper(edits);
    this.ignored = this.ignored.flatMap((entry) => {
      const range = remapRangeThroughEdits(entry.range, edits, map);
      return range ? [{ ...entry, range }] : [];
    });
  }

  /** Re-reads and rescans; a failure anywhere is shown as an error, never as "Checking…" forever. */
  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    try {
      await this.readAndScan(generation);
    } catch {
      if (this.isClosed || this.generation !== generation) return;
      this.status = "error";
      this.diagnostics = [];
      this.selectedId = null;
      this.emit();
    }
  }

  private async readAndScan(generation: number): Promise<void> {
    if (this.scopeLost) return;
    let read: ReviewTargetRead;
    try {
      read = await this.deps.target.read();
    } catch {
      read = { ok: false, reason: "detached" };
    }
    if (generation !== this.generation || this.isClosed) return;
    if (!read.ok) {
      this.status = "unavailable";
      this.unavailable = read.reason;
      this.diagnostics = [];
      this.emit();
      return;
    }
    this.unavailable = undefined;

    const previousText = this.text;
    // The last text read is what the scope and ignores refer to, even when its
    // scan was cut short by this very change.
    const hadText = this.hasRead;
    this.hasRead = true;
    if (hadText && read.text !== previousText) {
      const diff = diffTexts(previousText, read.text);
      if (diff) {
        if (this.scope) {
          const next = remapScope(this.scope, diff);
          if (!next) {
            this.scopeLost = true;
            this.cancelRecheck();
            this.status = "stale-scope";
            this.diagnostics = [];
            this.selectedId = null;
            this.text = read.text;
            this.emit();
            return;
          }
          this.scope = next;
        }
        this.ignored = this.ignored.flatMap((entry) => {
          const range = remapRange(entry.range, diff);
          return range ? [{ ...entry, range }] : [];
        });
      }
    }
    // Formatting-only change: same text, different protection. Old ignores
    // still refer to the same characters; findings are recomputed below.
    this.text = read.text;
    this.signature = read.signature;
    this.protectedRanges = read.protectedRanges;
    this.unread = read.unread ?? 0;
    await this.scan(generation);
  }

  private async scan(generation: number): Promise<void> {
    const fullScope = this.scope ?? { start: 0, end: this.text.length };
    const scopeEnd = Math.min(fullScope.end, fullScope.start + MAX_REVIEW_CHARS);
    let cutEnd = scopeEnd;
    if (scopeEnd < fullScope.end) {
      const lineBreak = this.text.lastIndexOf("\n", scopeEnd);
      if (lineBreak > fullScope.start) cutEnd = lineBreak + 1;
    }
    this.truncated = fullScope.end - cutEnd;
    const prepared = prepareReview(
      {
        id: `g${generation}`,
        text: this.text,
        scope: { start: fullScope.start, end: cutEnd },
        protectedRanges: this.protectedRanges,
      },
      this.options,
    );
    const scans: ChunkScan[] = [];
    for (const chunk of reviewChunks(prepared)) {
      scans.push(scanReviewChunk(prepared, chunk));
      // Yield between chunks so typing is never blocked by a long scan.
      await this.pause();
      if (generation !== this.generation || this.isClosed) return;
    }
    const result = finalizeReview(prepared, scans, {
      ...(this.truncated > 0 && { "size-limit": this.truncated }),
      ...(this.unread > 0 && { "outside-window": this.unread }),
    });
    this.prepared = prepared;
    this.ruleDiagnostics = result.diagnostics;
    this.diagnostics = result.diagnostics;
    this.aiFindings = [];
    // A rewrite not generated yet is for the text as it is now.
    if (this.rewrite?.status === "idle" || this.rewrite?.status === "too-long") {
      this.rewrite = this.idleRewrite();
    }
    this.coverage = result.coverage;
    this.status = "ready";
    if (this.selectedId && !this.visibleDiagnostics().some((d) => d.id === this.selectedId)) {
      this.selectedId = null;
    }
    const lookup = this.deps.lookupSpelling;
    const spelling = lookup && prepared.rules.size > 0;
    if (spelling) this.spellingCache = this.cacheFor(prepared.options.lang);
    this.spelling = !spelling ? "off" : this.spellingCache.unavailable ? "unavailable" : "checking";
    this.emit();
    // Local AI starts only now, after the checks' results are on screen.
    this.startAi();
    if (this.spelling !== "checking") return;
    // Not awaited: results are usable now, and suggestions join them as they come.
    this.checkSpelling(generation, prepared, lookup!).catch(() => {
      if (generation !== this.generation || this.isClosed) return;
      this.spelling = "unavailable";
      this.emit();
    });
  }

  private cacheFor(lang: string): ReviewSession["spellingCache"] {
    if (this.spellingCache.lang === lang) return this.spellingCache;
    return { lang, unavailable: false, known: new Set(), candidates: new Map() };
  }

  /**
   * The dictionary check, after the rule results are on screen: looks up the
   * words not answered before, a few at a time, and adds a pick-one finding
   * for each unknown word with close suggestions. Each different word is
   * looked up once, in the context of its first occurrence: whether the
   * dictionary knows a word does not depend on the words before it. Stops at
   * the per-pass limits. Dropped as soon as newer results replace these; a
   * missing dictionary is reported, not retried.
   */
  private async checkSpelling(
    generation: number,
    prepared: PreparedReview,
    lookup: ReviewSpellingLookup,
  ): Promise<void> {
    const cache = this.spellingCache;
    const occurrences = new Map<string, SpellingCandidate[]>();
    for (const candidate of spellingCandidates(
      prepared,
      this.ruleDiagnostics.map((d) => d.range),
    )) {
      const key = candidate.lookup.toLowerCase();
      const list = occurrences.get(key);
      if (list) list.push(candidate);
      else occurrences.set(key, [candidate]);
    }
    const queue: Array<{ key: string; word: string; before: string }> = [];
    for (const [key, [first]] of occurrences) {
      if (cache.known.has(key) || cache.candidates.has(key)) continue;
      queue.push({ key, word: first.lookup, before: first.before });
    }
    // Words answered on an earlier pass are shown at once.
    const ranked = new Map<string, string[]>();
    this.showSpelling(prepared, occurrences, ranked, [...occurrences.keys()]);
    let next = 0;
    let unknown = 0;
    while (
      next < queue.length &&
      next < SPELLING_WORDS_PER_PASS &&
      unknown < SPELLING_UNKNOWN_PER_PASS
    ) {
      const batch = queue.slice(
        next,
        Math.min(next + SPELLING_REQUEST_WORDS, SPELLING_WORDS_PER_PASS),
      );
      let results: Array<string[] | null> | null;
      try {
        results = await lookup(
          cache.lang,
          batch.map(({ word, before }) => ({ word, before })),
        );
      } catch {
        results = null;
      }
      if (generation !== this.generation || this.isClosed) return;
      // A shorter answer covers the first words; the rest go in the next request.
      if (!results || results.length === 0 || results.length > batch.length) {
        cache.unavailable = true;
        this.spelling = "unavailable";
        this.emit();
        return;
      }
      const answered = batch.slice(0, results.length);
      const unknownKeys: string[] = [];
      answered.forEach(({ key }, position) => {
        const result = results[position];
        if (result === null) {
          cache.known.add(key);
        } else {
          cache.candidates.set(key, result);
          unknownKeys.push(key);
        }
      });
      next += answered.length;
      unknown += unknownKeys.length;
      this.showSpelling(prepared, occurrences, ranked, unknownKeys);
    }
    this.spelling = next < queue.length ? "partial" : "done";
    this.emit();
  }

  /**
   * Adds the findings for newly answered words to those already shown, in
   * text order. Earlier findings are kept as they are, and suggestions are
   * ranked once per written form of a word; nothing is emitted when nothing
   * new was found.
   */
  private showSpelling(
    prepared: PreparedReview,
    occurrences: ReadonlyMap<string, readonly SpellingCandidate[]>,
    ranked: Map<string, string[]>,
    keys: readonly string[],
  ): void {
    const found: ReviewDiagnostic[] = [];
    for (const key of keys) {
      const answer = this.spellingCache.candidates.get(key);
      if (!answer) continue;
      for (const candidate of occurrences.get(key) ?? []) {
        let suggestions = ranked.get(candidate.word);
        if (!suggestions) {
          suggestions = rankSpellingSuggestions(candidate.word, answer);
          ranked.set(candidate.word, suggestions);
        }
        const diagnostic = spellingDiagnostic(prepared, candidate, suggestions);
        if (diagnostic) found.push(diagnostic);
      }
    }
    if (found.length === 0) return;
    this.diagnostics = mergeInTextOrder(this.diagnostics, found);
    // An AI finding a spelling finding now covers steps aside.
    if (this.aiFindings.length) this.mergeAiFindings();
    this.emit();
  }

  // ------------------------------------------------------- local AI internals

  /**
   * The open batch preview while it still describes what is shown: the same
   * text and the same list (an ignore, a filter or new findings close it, so
   * its ids are always among the shown findings).
   */
  private openAiBatch(): ReviewSession["aiBatch"] {
    const batch = this.aiBatch;
    return batch &&
      this.status === "ready" &&
      batch.generation === this.generation &&
      batch.list === this.visibleDiagnostics()
      ? batch
      : null;
  }

  private aiAvailability(): ReviewAiAvailability {
    return this.deps.ai
      ? reviewAiAvailability(this.aiStatus, this.aiEnabled, this.aiPaused, this.options.lang)
      : "off";
  }

  private aiViewState(): ReviewAiViewState {
    const availability = this.aiAvailability();
    const coverage = availability === "off" ? "idle" : this.aiCoverage;
    return {
      availability,
      coverage:
        coverage === "checking" && this.aiStatus?.runtime === "loading" ? "loading" : coverage,
      status: this.deps.ai ? this.aiStatus : null,
      checkedChars: this.aiCounts.checked,
      eligibleChars: this.aiCounts.eligible,
      skippedChars: this.aiCounts.skipped,
      findings:
        this.status === "ready"
          ? this.visibleDiagnostics().filter((d) => d.ruleId === REVIEW_LOCAL_AI_CHECK).length
          : 0,
      rejected: this.aiCounts.rejected,
      failure: this.aiFailure,
      offerSetup:
        availability === "setup-needed" &&
        this.aiStatus?.offerSetup === true &&
        !this.aiOfferAnswered,
    };
  }

  /** A pushed status wins over an older answer still on its way. */
  private fetchAiStatus(ai: ReviewAiProvider, replace = false): void {
    ai.status().then(
      (status) => {
        if (replace || this.aiStatus === null) this.onAiStatus(status);
      },
      () => {
        // No answer: Local AI stays off for this review; the checks are unaffected.
      },
    );
  }

  private onAiStatus(status: LocalAiStatus): void {
    if (this.isClosed) return;
    const modelChanged = this.aiStatus !== null && this.aiStatus.modelId !== status.modelId;
    this.aiStatus = status;
    const availability = this.aiAvailability();
    if (availability === "off") {
      this.aiOff();
    } else if (modelChanged || availability !== "ready") {
      // Another model's answers do not describe this one's: they go.
      this.cancelAi();
      this.stopRewriteGeneration("idle");
      if (modelChanged) this.dropAiFindings();
    }
    this.startAi();
    this.emit();
  }

  /** Local AI turned off: its work, findings, previews and Rewrite mode end. */
  private aiOff(): void {
    this.cancelAi();
    this.cancelRewriteRun();
    this.dropAiFindings();
    this.aiCoverage = "idle";
    this.aiBatch = null;
    this.mode = "correct";
    this.rewrite = null;
    this.rewriteEdits = null;
  }

  private dropAiFindings(): void {
    this.aiFindings = [];
    this.aiCounts = { checked: 0, eligible: 0, skipped: 0, rejected: 0 };
    this.aiFailure = null;
    this.mergeAiFindings();
  }

  /** Starts the Correct pass for the shown results, unless one ran or something stops it. */
  private startAi(): void {
    const { prepared } = this;
    const ai = this.deps.ai;
    if (
      !ai ||
      !prepared ||
      this.status !== "ready" ||
      this.mode !== "correct" ||
      this.aiAvailability() !== "ready" ||
      this.aiPassFor === prepared
    ) {
      return;
    }
    void this.runAiPass(ai, prepared, this.generation);
  }

  /** Aborts the model request in flight; whatever the pass awaits is dropped when it lands. */
  private cancelAi(): void {
    this.aiToken += 1;
    this.aiAbort?.abort();
    this.aiAbort = null;
    if (this.aiTimer !== null) {
      this.clearTimer(this.aiTimer);
      this.aiTimer = null;
    }
    this.aiPassFor = null;
    if (this.aiCoverage === "waiting" || this.aiCoverage === "checking") {
      this.aiCoverage = "cancelled";
    }
  }

  /** The text is changing: AI work for the old text is dropped; a proposal or preview for it is stale. */
  private textChanging(): void {
    this.cancelAi();
    if (this.aiAvailability() === "ready" && this.mode === "correct") this.aiCoverage = "waiting";
    this.aiDelayNext = true;
    this.aiBatch = null;
    this.rewriteEdits = null;
    if (this.rewrite?.status === "ready") this.rewrite = { ...this.rewrite, status: "stale" };
    this.stopRewriteGeneration("stale");
  }

  /**
   * The Correct pass over the results just shown: answers this review already
   * has are used at once, then one chunk at a time goes to the model in
   * document order (after a pause when the text just changed). Each validated
   * answer joins the list as it lands; anything that changes what the model
   * saw drops the pass.
   */
  private async runAiPass(
    ai: ReviewAiProvider,
    prepared: PreparedReview,
    generation: number,
  ): Promise<void> {
    this.cancelAi();
    const token = this.aiToken;
    const abort = new AbortController();
    this.aiAbort = abort;
    this.aiPassFor = prepared;
    const live = () => token === this.aiToken && generation === this.generation && !this.isClosed;
    const delayed = this.aiDelayNext;
    this.aiDelayNext = false;
    this.aiFindings = [];
    this.aiFailure = null;
    let plan: AiChunkPlan;
    try {
      plan = buildAiChunks(prepared, { mode: "correct", style: null });
    } catch {
      plan = { chunks: [], skipped: { protected: 0, unsafe: 0, limit: 0 } };
      this.aiFailure = "invalid-request";
    }
    const { protected: protectedChars, unsafe, limit } = plan.skipped;
    const counts = {
      checked: 0,
      eligible: 0,
      // Text the checks did not read either is unchecked by the model too.
      skipped: protectedChars + unsafe + limit + this.truncated + this.unread,
      rejected: 0,
    };
    for (const chunk of plan.chunks) counts.eligible += chunk.range.end - chunk.range.start;
    this.aiCounts = counts;
    let checkedChunks = 0;
    const accept = (chunk: AiChunk, segments: AiSegments) => {
      try {
        const result = correctionFindings(prepared, chunk, segments);
        this.aiFindings.push(...result.diagnostics);
        for (const count of Object.values(result.rejected)) counts.rejected += count ?? 0;
        counts.checked += chunk.range.end - chunk.range.start;
        checkedChunks += 1;
      } catch {
        this.aiFailure = "malformed";
      }
    };
    const finish = () => {
      this.aiAbort = null;
      this.aiCoverage =
        this.aiFailure === "invalid-request" || (checkedChunks === 0 && plan.chunks.length > 0)
          ? "failed"
          : checkedChunks < plan.chunks.length || counts.skipped > 0
            ? "partial"
            : "complete";
    };

    const modelId = this.aiStatus?.modelId ?? "";
    const pending: AiChunk[] = [];
    const requestFor = (chunk: AiChunk) =>
      aiRequestForChunk(chunk, prepared.options.lang, "correct", null);
    for (const chunk of plan.chunks) {
      const cached = this.aiCache.get(aiCacheKey(chunk.key, modelId, AI_PROMPT_VERSION));
      if (cached?.request === JSON.stringify(requestFor(chunk))) accept(chunk, cached.segments);
      else pending.push(chunk);
    }
    if (pending.length === 0) finish();
    else this.aiCoverage = delayed ? "waiting" : "checking";
    this.mergeAiFindings();
    this.emit();
    if (pending.length === 0) return;

    if (delayed) {
      await new Promise<void>((resolve) => {
        this.aiTimer = this.setTimer(() => {
          this.aiTimer = null;
          resolve();
        }, this.deps.aiRecheckDelayMs ?? 1500);
      });
      if (!live()) return;
      this.aiCoverage = "checking";
      this.emit();
    }
    for (const chunk of pending) {
      let answer: { outcome: AiGenerationOutcome; modelId: string; promptVersion: string };
      const request = requestFor(chunk);
      try {
        answer = await ai.generate(request, abort.signal);
      } catch {
        answer = { outcome: { ok: false, error: "engine-failed" }, modelId: "", promptVersion: "" };
      }
      if (!live()) return;
      const { outcome } = answer;
      if (!outcome.ok) {
        this.aiFailure = outcome.error;
        // The runtime dropped it (not us): a later trigger may start again.
        if (outcome.error === "cancelled") {
          this.aiAbort = null;
          this.aiPassFor = null;
          this.aiCoverage = "cancelled";
          this.emit();
          return;
        }
        if (AI_PASS_FATAL.has(outcome.error)) break;
        continue;
      }
      this.rememberAi(aiCacheKey(chunk.key, answer.modelId, answer.promptVersion), {
        request: JSON.stringify(request),
        segments: outcome.segments,
      });
      accept(chunk, outcome.segments);
      this.mergeAiFindings();
      this.emit();
    }
    finish();
    this.emit();
  }

  /** Bounded and session-local; the oldest answer goes first. */
  private rememberAi(key: string, entry: { request: string; segments: AiSegments }): void {
    if (this.aiCache.size >= AI_CACHE_ENTRIES) {
      this.aiCache.delete(this.aiCache.keys().next().value!);
    }
    this.aiCache.set(key, entry);
  }

  /**
   * Shows the AI findings no check already covers: an identical change stays
   * the check's, and one overlapping a rule or spelling finding is left out
   * rather than composed with it. Runs again as spelling findings arrive.
   */
  private mergeAiFindings(): void {
    // The checks as they found them (without options added by an earlier merge).
    const checks = this.diagnostics
      .filter((d) => d.ruleId !== REVIEW_LOCAL_AI_CHECK)
      .map((d) =>
        d.alternatives.some((alternative) => alternative.localAi)
          ? { ...d, alternatives: d.alternatives.filter((alternative) => !alternative.localAi) }
          : d,
      );
    const shown: ReviewDiagnostic[] = [];
    const extra = new Map<ReviewDiagnostic, ReviewDiagnostic["alternatives"]>();
    for (const finding of this.aiFindings) {
      if (checks.some((d) => sameChange(d, finding) || this.sameResult(finding, d))) continue;
      const overlapping = checks.filter((d) => rangesOverlap(d.range, finding.range));
      if (overlapping.every((d) => this.includesCheckFix(finding, d))) {
        // No overlap, or the AI fix makes each overlapping check's own fix and more
        // ("is saved immediatly" -> "are saved immediately"): both can be offered.
        shown.push(finding);
        continue;
      }
      // A different fix for exactly the text a check flags ("dont" -> "don't" or
      // "doesn't"): an explicit choice on that finding. Anything else is left out.
      const [check] = overlapping;
      const alternative = finding.alternatives[0];
      if (
        overlapping.length === 1 &&
        alternative &&
        check.range.start === finding.range.start &&
        check.range.end === finding.range.end
      ) {
        extra.set(check, [...(extra.get(check) ?? []), { ...alternative, localAi: true }]);
      }
    }
    const merged = checks.map((d) =>
      extra.has(d) ? { ...d, alternatives: [...d.alternatives, ...extra.get(d)!] } : d,
    );
    if (
      shown.length === 0 &&
      extra.size === 0 &&
      merged.length === this.diagnostics.length &&
      merged.every((d, index) => d === this.diagnostics[index])
    ) {
      return;
    }
    this.diagnostics = mergeInTextOrder(merged, shown);
    if (this.selectedId && !this.visibleDiagnostics().some((d) => d.id === this.selectedId)) {
      this.selectedId = null;
    }
  }

  /** The AI's text for its range, or null when its edits do not apply. */
  private aiReplacement(finding: ReviewDiagnostic): string | null {
    const replaced = applyEdits(this.text, finding.alternatives[0]?.edits ?? []);
    if (replaced === null) return null;
    return replaced.slice(
      finding.range.start,
      replaced.length - (this.text.length - finding.range.end),
    );
  }

  /** Same range, same corrected text as one of the check's own fixes, however the edits are split. */
  private sameResult(finding: ReviewDiagnostic, check: ReviewDiagnostic): boolean {
    if (finding.range.start !== check.range.start || finding.range.end !== check.range.end) {
      return false;
    }
    const aiText = this.aiReplacement(finding);
    return check.alternatives.some(
      (alternative) => !alternative.localAi && alternative.preview === aiText,
    );
  }

  /**
   * The AI finding's replacement contains one of the check's own corrections
   * in the check's place, at the start or end of the AI's range. A check fix in
   * the middle of a larger AI change is not matched: it stays excluded.
   */
  private includesCheckFix(finding: ReviewDiagnostic, check: ReviewDiagnostic): boolean {
    const outer = finding.range;
    if (check.range.start < outer.start || check.range.end > outer.end) return false;
    const aiText = this.aiReplacement(finding);
    if (aiText === null) return false;
    const head = this.text.slice(outer.start, check.range.start);
    const tail = this.text.slice(check.range.end, outer.end);
    return check.alternatives.some(
      (alternative) =>
        !alternative.localAi &&
        (aiText.startsWith(head + alternative.preview) ||
          aiText.endsWith(alternative.preview + tail)),
    );
  }

  private scopeText(): string {
    if (!this.prepared) return "";
    const { start, end } = this.prepared.snapshot.scope;
    return this.prepared.snapshot.text.slice(start, end);
  }

  private idleRewrite(): RewriteViewState {
    const before = this.scopeText();
    return {
      style: this.rewriteStyle,
      resolvedStyle: resolveRewriteStyle(this.rewriteStyle, this.rewriteHint, before),
      contextHint: this.rewriteHint,
      status: "idle",
      before,
      after: null,
      hunks: [],
      rejection: null,
      kept: {},
      failure: null,
      canApply: false,
      previewOnly: !this.capabilities.apply,
    };
  }

  /** Style or context changed: a proposal in the old one stays visible, marked stale. */
  private rewriteSettingsChanged(): void {
    if (!this.rewrite) return;
    const shown = this.rewrite.status === "ready" || this.rewrite.status === "stale";
    this.cancelRewriteRun();
    this.rewriteEdits = null;
    const next = this.idleRewrite();
    this.rewrite = shown
      ? {
          ...this.rewrite,
          style: next.style,
          resolvedStyle: next.resolvedStyle,
          contextHint: next.contextHint,
          status: "stale",
        }
      : next;
    this.emit();
  }

  private rewriteApplicable(): boolean {
    return (
      this.rewrite?.status === "ready" &&
      this.rewriteEdits?.generation === this.generation &&
      this.rewriteEdits.text === this.text &&
      this.canWrite()
    );
  }

  private cancelRewriteRun(): void {
    this.rewriteToken += 1;
    this.rewriteAbort?.abort();
    this.rewriteAbort = null;
  }

  private stopRewriteGeneration(next: "idle" | "stale"): void {
    if (this.rewrite?.status !== "generating") return;
    this.cancelRewriteRun();
    this.rewrite = { ...this.rewrite, status: next };
  }

  /**
   * One proposal for the whole scope: every chunk must come back, then the
   * proposal is validated as a whole. Long scopes are not rewritten piecemeal:
   * the user is asked to select a passage and nothing is sent.
   */
  private async runRewrite(
    ai: ReviewAiProvider,
    prepared: PreparedReview,
    generation: number,
  ): Promise<void> {
    this.cancelRewriteRun();
    const token = this.rewriteToken;
    const abort = new AbortController();
    this.rewriteAbort = abort;
    const live = () =>
      token === this.rewriteToken && generation === this.generation && !this.isClosed;
    const base = this.idleRewrite();
    const style = base.resolvedStyle;
    const done = (update: Partial<RewriteViewState>) => {
      this.rewriteAbort = null;
      this.rewrite = { ...base, ...update };
      this.emit();
    };
    let plan: AiChunkPlan;
    try {
      plan = buildAiChunks(prepared, { mode: "rewrite", style });
    } catch {
      done({ status: "failed", failure: "invalid-request" });
      return;
    }
    if (plan.skipped.limit > 0 || this.truncated > 0 || this.unread > 0) {
      done({ status: "too-long" });
      return;
    }
    if (plan.chunks.length === 0) {
      done({ status: "failed", failure: "invalid-request" });
      return;
    }
    this.rewrite = { ...base, status: "generating" };
    this.emit();
    const outputs: AiSegments[] = [];
    for (const chunk of plan.chunks) {
      let outcome: AiGenerationOutcome;
      try {
        const request = aiRequestForChunk(chunk, prepared.options.lang, "rewrite", style);
        outcome = (await ai.generate(request, abort.signal)).outcome;
      } catch {
        outcome = { ok: false, error: "engine-failed" };
      }
      if (!live()) return;
      if (!outcome.ok) {
        const cancelled = outcome.error === "cancelled";
        done({ status: cancelled ? "idle" : "failed", failure: cancelled ? null : outcome.error });
        return;
      }
      outputs.push(outcome.segments);
    }
    let proposal: RewriteProposal;
    try {
      proposal = rewriteProposal(prepared, plan.chunks, outputs, style);
    } catch {
      proposal = { ok: false, reason: "shape" };
    }
    if (!proposal.ok) {
      done({ status: "rejected", rejection: proposal.reason });
      return;
    }
    const offset = prepared.snapshot.scope.start;
    const hunks = proposal.edits.map((edit) => ({
      ...edit,
      start: edit.start - offset,
      end: edit.end - offset,
    }));
    // What the diff shows must be exactly what Apply writes.
    if (proposal.before !== base.before || applyEdits(proposal.before, hunks) !== proposal.after) {
      done({ status: "rejected", rejection: "shape" });
      return;
    }
    this.rewriteEdits = { edits: proposal.edits, generation, text: this.text };
    done({ status: "ready", after: proposal.after, hunks, kept: proposal.kept });
  }

  private cancelRecheck(): void {
    if (this.recheckTimer !== null) {
      this.clearTimer(this.recheckTimer);
      this.recheckTimer = null;
    }
  }

  /** Lets the host run (typing, painting) between chunks of work. */
  private pause(): Promise<void> {
    return new Promise<void>((resolve) => this.setTimer(resolve, 0));
  }

  private emit(): void {
    this.deps.onChange(this.getState());
  }
}
