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
  stillDetectedAfter,
  stillDetectedAfterAsync,
  type ChunkScan,
  type PreparedReview,
} from "@core/domain/grammar/review/reviewDiagnostics";
import {
  applyEdits,
  diffTexts,
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
import { REVIEW_CATEGORIES } from "@core/domain/grammar/review/types";

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
  notice: ReviewNotice | null;
  /** The text the diagnostics' offsets refer to. */
  text: string;
}

export interface ReviewSessionDependencies {
  target: ReviewTargetPort;
  options: ReviewOptions;
  /** Selection captured before any UI opened, in the target's text offsets; null = whole field. */
  initialScope: TextRange | null;
  onChange: (state: ReviewViewState) => void;
  addToDictionary?: (word: string) => Promise<boolean>;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  recheckDelayMs?: number;
}

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
  private truncated = 0;
  private unread = 0;
  private prepared: PreparedReview | null = null;
  private diagnostics: ReviewDiagnostic[] = [];
  private coverage: ReviewCoverage | null = null;
  private ignored: IgnoredOccurrence[] = [];
  // getState() runs on every change; the plan only depends on these inputs.
  private listCache: {
    key: readonly unknown[];
    active: ReviewDiagnostic[];
    visible: ReviewDiagnostic[];
  } | null = null;
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
    await this.refresh();
  }

  close(): void {
    this.generation += 1;
    this.cancelRecheck();
    this.status = "closed";
    this.diagnostics = [];
    this.planCache = null;
    this.planPending = null;
    this.emit();
  }

  /** Any edit in the editor: results are stale now; a recheck follows after a pause. */
  notifySourceChanged(): void {
    if (this.status === "closed" || this.status === "applying") return;
    this.generation += 1;
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
    return this.write(plan.edits, plan.diagnosticIds.length, plan.deferred.length);
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
        deferred: plan?.deferred.length ?? 0,
        pending: plan === null && this.planPending !== null,
      },
      notice: this.notice,
      text: this.text,
    };
  }

  // ------------------------------------------------------------------ internals

  private canWrite(): boolean {
    return this.status === "ready" && this.capabilities.apply;
  }

  private activeDiagnostics(): ReviewDiagnostic[] {
    return this.visibleLists().active;
  }

  /** The same array while results, ignores and filters stay the same: the UI keys on it. */
  private visibleDiagnostics(): ReviewDiagnostic[] {
    return this.visibleLists().visible;
  }

  private visibleLists(): { active: ReviewDiagnostic[]; visible: ReviewDiagnostic[] } {
    const key = [this.diagnostics, this.ignored, this.categories];
    if (!this.listCache || !sameKey(this.listCache.key, key)) {
      const active = this.diagnostics.filter((d) => !this.isIgnored(d));
      const visible = active.filter((d) => this.categories.has(d.category));
      this.listCache = { key, active, visible };
    }
    return this.listCache;
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
    return [this.prepared, this.text, this.diagnostics, this.ignored, this.categories];
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
    const filtered = this.categories.size < REVIEW_CATEGORIES.length ? this.categories : undefined;
    const steps = planBulkFixSteps(this.text, this.activeDiagnostics(), {
      categories: filtered,
      prove: true,
    });
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
    } catch (error) {
      if (error instanceof PlanSuperseded) return null;
      throw error;
    }
    this.planPending = null;
    this.planCache = { key: pending.key, plan: request.value };
    this.emit();
    return request.value;
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
    const hadText = this.prepared !== null;
    if (hadText && read.text !== previousText) {
      const diff = diffTexts(previousText, read.text);
      if (diff) {
        if (this.scope) {
          const next = remapScope(this.scope, diff);
          if (!next) {
            this.scope = null;
            this.status = "stale-scope";
            this.diagnostics = [];
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
    if (this.status === "stale-scope") return;
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
    this.diagnostics = result.diagnostics;
    this.coverage = result.coverage;
    this.status = "ready";
    if (this.selectedId && !this.visibleDiagnostics().some((d) => d.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.emit();
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
