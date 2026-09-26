import type {
  ReviewApplyResult,
  ReviewCapabilities,
  ReviewTargetRead,
} from "@core/application/review/ReviewSession";
import type { ProtectedRange, ReviewEdit, TextRange } from "@core/domain/grammar/review/types";
import { mergeEdits, positionThroughEdits } from "@core/domain/grammar/review/textRanges";
import {
  DOCS_STRUCTURE_CONTROLS,
  snapshotContext,
  type DocsEdit,
  type DocsReply,
  type DocsSnapshot,
} from "../google-docs/GoogleDocsModel";
import {
  docsRangeRects,
  locateRuns,
  readDocsTextRuns,
  visibleCharacters,
  type LocatedRun,
  type VisibleText,
} from "../google-docs/GoogleDocsGeometry";
import { getDocsInput } from "../google-docs/GoogleDocsEnvironment";
import type { ReviewTargetHandle } from "./ReviewTargets";

export interface GoogleDocsReviewSurface {
  reviewRead(): Promise<DocsReply>;
  reviewApply(token: string, edit: DocsEdit): Promise<DocsReply>;
  setReviewActive(active: boolean): void;
  reviewFocusEditor(): void;
  /** Called on input in the Docs editor while a review is active; returns the unsubscribe. */
  onReviewSourceChange(listener: () => void): () => void;
  /**
   * Called on each key pressed in the Docs editor while a review is active,
   * before Docs sees it; a listener returning true consumes the key.
   */
  onReviewKey?(listener: (key: string) => boolean): () => void;
}

// Docs' structural markers, found everywhere in a snapshot.
const DOCS_CONTROLS = new RegExp(DOCS_STRUCTURE_CONTROLS.source, "gu");

/**
 * The complete part of a window cut out of a longer document: from the first
 * sentence or paragraph start (or at least word start) after a cut start, to
 * the last word start before a cut end. The cut edges are partial words and
 * sentences that would read as errors.
 */
export function windowReviewable(snapshot: DocsSnapshot): { start: number; end: number } {
  const { text } = snapshot;
  let start = 0;
  if (snapshot.windowStart > 0) {
    const boundary =
      /[.!?\u2026]["'\u201D\u2019)\]]*[ \t\u00A0]+|\n/u.exec(text) ?? /\s+/u.exec(text);
    start = boundary ? boundary.index + boundary[0].length : text.length;
  }
  let end = text.length;
  if (snapshot.windowStart + text.length < snapshot.documentLength) {
    while (end > start && !/\s/u.test(text[end - 1])) end -= 1;
  }
  return { start, end: Math.max(start, end) };
}

/** What a snapshot's text is relative to: formatting-free, so the scope and window. */
function snapshotSignature(snapshot: DocsSnapshot): string {
  return `${snapshot.scope}@${snapshot.windowStart}`;
}

/**
 * Google Docs through its logical-text bridge. Findings are highlighted where
 * Docs shows their text (see GoogleDocsGeometry); text on pages Docs has not
 * rendered is listed in the panel only. Each fix is ONE token-checked,
 * model-verified transaction; "Fix all" is not offered because Docs has no
 * atomic multi-edit transaction.
 */
export class GoogleDocsReviewTarget implements ReviewTargetHandle {
  readonly kind = "model-editor" as const;
  readonly capabilities: ReviewCapabilities = {
    inline: true,
    apply: true,
    bulk: false,
    undo: "per-edit",
  };
  composing = false;
  private lastRead: ReviewTargetRead | null = null;
  // The rendered runs placed in `placedFor`'s text, kept until Docs re-renders
  // them (see onLayoutChange) or the text changes: a scroll only moves them.
  private runs: LocatedRun[] | null = null;
  private runsFound = 0;
  private placedFor: string | null = null;
  // Boxes are re-read once per task: one paint asks for every finding's rectangles.
  private boxesFresh = false;
  // The last read's visible characters, indexed once per read, not per paint.
  private indexed: { text: string; index: VisibleText } | null = null;
  private layoutObserver: MutationObserver | null = null;
  private readonly layoutListeners = new Set<() => void>();

  constructor(
    private readonly surface: GoogleDocsReviewSurface,
    readonly element: HTMLElement,
  ) {}

  onSourceChange(listener: () => void): () => void {
    return this.surface.onReviewSourceChange(listener);
  }

  /** Keys pressed in Docs' editor (its own input frame) while reviewing; true consumes one. */
  onKey(listener: (key: string) => boolean): () => void {
    return this.surface.onReviewKey?.(listener) ?? (() => {});
  }

  /** True when Docs can be read now: its input frame has focus. */
  editorFocused(): boolean {
    return getDocsInput(this.element.ownerDocument) !== null;
  }

  /** The initial read; its selection (if any) becomes the review scope. */
  async start(): Promise<TextRange | null> {
    this.surface.reviewFocusEditor();
    const reply = await this.readWithRetry();
    if (reply.status !== "ready" || !reply.snapshot) return null;
    const { start, end } = snapshotContext(reply.snapshot);
    return end > start ? { start, end } : null;
  }

  /** The bridge allows two requests in flight; a busy reply is retried briefly, never an edit. */
  private async readWithRetry(): Promise<DocsReply> {
    let reply = await this.surface.reviewRead();
    for (let attempt = 0; attempt < 10 && reply.status === "busy"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      reply = await this.surface.reviewRead();
    }
    return reply;
  }

  async read(): Promise<ReviewTargetRead> {
    const reply = await this.readWithRetry();
    // Docs reads only while its input frame has focus. With focus in the review
    // panel the last read stands; every write re-reads with the editor focused.
    if (reply.status === "inactive" && this.lastRead) return this.lastRead;
    if (reply.status === "composing") return { ok: false, reason: "composing" };
    if (reply.status !== "ready" || !reply.snapshot) return { ok: false, reason: "detached" };
    const { snapshot } = reply;
    const protectedRanges: ProtectedRange[] = [];
    // Docs hands over a window around the cursor; the rest, and the window's
    // cut edges, are not reviewed.
    const reviewable = windowReviewable(snapshot);
    if (reviewable.start > 0) {
      protectedRanges.push({ start: 0, end: reviewable.start, reason: "outside-window" });
    }
    for (const match of snapshot.text.matchAll(DOCS_CONTROLS)) {
      protectedRanges.push({ start: match.index, end: match.index + 1, reason: "structure" });
    }
    if (reviewable.end < snapshot.text.length) {
      protectedRanges.push({
        start: reviewable.end,
        end: snapshot.text.length,
        reason: "outside-window",
      });
    }
    this.lastRead = {
      ok: true,
      text: snapshot.text,
      protectedRanges,
      signature: snapshotSignature(snapshot),
      unread: snapshot.documentLength - (reviewable.end - reviewable.start),
    };
    return this.lastRead;
  }

  async apply(request: {
    edits: ReviewEdit[];
    before: string;
    after: string;
    signature: string;
  }): Promise<ReviewApplyResult> {
    if (request.edits.length === 0) return { status: "applied" };
    // One transaction is one contiguous replacement; a finding's edits are merged.
    const { start, end, replacement } = mergeEdits(request.before, request.after, request.edits);
    this.surface.reviewFocusEditor();
    const fresh = await this.readWithRetry();
    const snapshot = fresh.snapshot;
    if (fresh.status !== "ready" || !snapshot) return { status: "stale" };
    if (snapshot.text !== request.before || snapshotSignature(snapshot) !== request.signature) {
      return { status: "stale" };
    }
    // The real caret, which a large selection can put outside the window.
    const caret = snapshot.caret ?? snapshot.focus;
    const cursorAfter =
      snapshot.windowStart + positionThroughEdits(caret - snapshot.windowStart, request.edits);
    const reply = await this.surface.reviewApply(snapshot.token, {
      start: snapshot.windowStart + start,
      end: snapshot.windowStart + end,
      replacement,
      cursorAfter,
    });
    switch (reply.status) {
      case "applied":
        return { status: "applied" };
      case "stale":
      case "busy":
        return { status: "stale" };
      case "unverified":
        return { status: "unverified" };
      case "composing":
        return { status: "rejected", reason: "composing" };
      default:
        return { status: "rejected", reason: "host-refused" };
    }
  }

  /** True when Docs shows its text as runs this review can place (an allowed extension). */
  canHighlight(): boolean {
    this.placedRuns();
    return this.runsFound > 0;
  }

  /**
   * `listener` runs when Docs re-renders its text runs (pages scrolled into
   * view, edits, a collaborator's change). Returns the unsubscribe.
   */
  onLayoutChange(listener: () => void): () => void {
    this.layoutListeners.add(listener);
    if (!this.layoutObserver) {
      this.layoutObserver = new MutationObserver(() => {
        this.runs = null;
        for (const notify of this.layoutListeners) notify();
      });
      this.layoutObserver.observe(this.element, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["aria-label", "x", "y", "width", "height", "transform"],
      });
    }
    return () => {
      this.layoutListeners.delete(listener);
      if (this.layoutListeners.size === 0) {
        this.layoutObserver?.disconnect();
        this.layoutObserver = null;
      }
    };
  }

  rangeRects(range: TextRange): DOMRect[] {
    const runs = this.placedRuns();
    return runs ? docsRangeRects(runs, range.start, range.end) : [];
  }

  /** The runs placed in the last read's text, their boxes current for this task. */
  private placedRuns(): LocatedRun[] | null {
    const read = this.lastRead;
    if (!read?.ok) return null;
    if (!this.runs || this.placedFor !== read.text) {
      if (this.indexed?.text !== read.text) {
        this.indexed = { text: read.text, index: visibleCharacters(read.text) };
      }
      const found = readDocsTextRuns(this.element);
      this.runsFound = found.length;
      this.runs = locateRuns(this.indexed.index, found);
      this.placedFor = read.text;
      this.freshUntilNextTask();
    } else if (!this.boxesFresh) {
      // Scrolled or zoomed since: the same runs, somewhere else on screen.
      for (const run of this.runs) if (run.element) run.box = run.element.getBoundingClientRect();
      this.freshUntilNextTask();
    }
    return this.runs;
  }

  private freshUntilNextTask(): void {
    this.boxesFresh = true;
    queueMicrotask(() => {
      this.boxesFresh = false;
    });
  }

  domRange(): Range | null {
    return null;
  }

  focusEditor(): void {
    this.surface.reviewFocusEditor();
  }

  reveal(): void {
    // Docs renders only the pages near its own scroll position and owns that
    // scroll: the panel list is the way to a finding elsewhere.
  }

  setMeasurementRoot(): void {}

  dispose(): void {
    this.layoutListeners.clear();
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.runs = null;
  }
}
