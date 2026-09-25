import { planBulkFix } from "@core/domain/grammar/review/bulkPlanner";
import {
  MAX_REVIEW_CHARS,
  finalizeReview,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
  stillDetectedAfter,
  type ChunkScan,
  type PreparedReview,
} from "@core/domain/grammar/review/reviewDiagnostics";
import {
  applyEdits,
  diffTexts,
  remapRange,
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
  languageSkipped: number;
  noRules: boolean;
  bulk: { count: number; deferred: number };
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
  const sameList = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && x.every((value, index) => value === y[index]);
  return (
    a.lang === b.lang &&
    a.insertSpaceAfterAutocomplete === b.insertSpaceAfterAutocomplete &&
    sameList(a.enabledRules, b.enabledRules) &&
    sameList(a.userDictionary, b.userDictionary)
  );
}

const ALL_CATEGORIES: ReviewCategory[] = ["spelling", "grammar", "punctuation", "typography"];

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
  private prepared: PreparedReview | null = null;
  private diagnostics: ReviewDiagnostic[] = [];
  private coverage: ReviewCoverage | null = null;
  private ignored: IgnoredOccurrence[] = [];
  private resolvedCount = 0;
  private categories = new Set<ReviewCategory>(ALL_CATEGORIES);
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
    this.emit();
  }

  /** Any edit in the editor: results are stale now; a recheck follows after a pause. */
  notifySourceChanged(): void {
    if (this.status === "closed" || this.status === "applying") return;
    this.generation += 1;
    if (this.status !== "stale-scope") {
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
    if (shown) this.categories.add(category);
    else this.categories.delete(category);
    if (this.selectedId && !this.visibleDiagnostics().some((d) => d.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.emit();
  }

  /** Ignores this occurrence for this session only. */
  ignore(id: string): void {
    const diagnostic = this.diagnostics.find((d) => d.id === id);
    if (!diagnostic) return;
    this.ignored.push({
      ruleId: diagnostic.ruleId,
      range: { ...diagnostic.range },
      original: diagnostic.original,
    });
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
    const plan = this.planBulk();
    if (!plan || plan.edits.length === 0) return null;
    return this.write(plan.edits, plan.diagnosticIds.length, plan.deferred.length);
  }

  getState(): ReviewViewState {
    const plan = this.status === "ready" && this.capabilities.bulk ? this.planBulk() : null;
    return {
      status: this.status,
      unavailable: this.unavailable,
      scopeKind: this.scopeKind,
      capabilities: this.capabilities,
      diagnostics: this.status === "ready" ? this.visibleDiagnostics() : [],
      ignoredCount: this.ignoredDiagnostics().length,
      resolvedCount: this.resolvedCount,
      categories: new Set(this.categories),
      selectedId: this.selectedId,
      coverage: this.coverage,
      truncated: this.truncated,
      languageSkipped: this.prepared?.languageSkipped.length ?? 0,
      noRules: this.prepared !== null && this.prepared.rules.size === 0,
      bulk: {
        count: plan?.diagnosticIds.length ?? 0,
        deferred: plan?.deferred.length ?? 0,
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
    return this.diagnostics.filter((d) => !this.isIgnored(d));
  }

  private visibleDiagnostics(): ReviewDiagnostic[] {
    return this.activeDiagnostics().filter((d) => this.categories.has(d.category));
  }

  private ignoredDiagnostics(): ReviewDiagnostic[] {
    return this.diagnostics.filter((d) => this.isIgnored(d));
  }

  private isIgnored(diagnostic: ReviewDiagnostic): boolean {
    return this.ignored.some(
      (entry) =>
        entry.ruleId === diagnostic.ruleId &&
        entry.range.start === diagnostic.range.start &&
        entry.range.end === diagnostic.range.end &&
        entry.original === diagnostic.original,
    );
  }

  private planBulk() {
    if (!this.prepared) return null;
    const prepared = this.prepared;
    const filtered = this.categories.size < ALL_CATEGORIES.length ? this.categories : undefined;
    return planBulkFix(this.text, this.activeDiagnostics(), {
      categories: filtered,
      stillHolds: (diagnostic, others) => stillDetectedAfter(prepared, diagnostic, others),
    });
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
      this.remapIgnored(before, after, edits);
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

  private remapIgnored(before: string, after: string, edits: ReviewEdit[]): void {
    const diff = diffTexts(before, after);
    if (!diff) return;
    // Several own edits: carry each ignore through them one by one.
    const sorted = [...edits].sort((a, b) => b.start - a.start);
    this.ignored = this.ignored.flatMap((entry) => {
      let range: TextRange | null = entry.range;
      let text = before;
      for (const edit of sorted) {
        if (!range) break;
        const next = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
        const step = diffTexts(text, next);
        range = step ? remapRange(range, step) : range;
        text = next;
      }
      return range ? [{ ...entry, range }] : [];
    });
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
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
      await new Promise<void>((resolve) => this.setTimer(resolve, 0));
      if (generation !== this.generation || this.isClosed) return;
    }
    const result = finalizeReview(
      prepared,
      scans,
      this.truncated > 0 ? { "size-limit": this.truncated } : {},
    );
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

  private emit(): void {
    this.deps.onChange(this.getState());
  }
}
