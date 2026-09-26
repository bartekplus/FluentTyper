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
import type { ReviewTargetHandle } from "./ReviewTargets";

export interface GoogleDocsReviewSurface {
  reviewRead(): Promise<DocsReply>;
  reviewApply(token: string, edit: DocsEdit): Promise<DocsReply>;
  setReviewActive(active: boolean): void;
  reviewFocusEditor(): void;
  /** Called on input in the Docs editor while a review is active; returns the unsubscribe. */
  onReviewSourceChange(listener: () => void): () => void;
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
 * Google Docs through its logical-text bridge. The canvas gives no reliable
 * geometry, so findings are listed in the panel only. Each fix is ONE
 * token-checked, model-verified transaction; "Fix all" is not offered
 * because Docs has no atomic multi-edit transaction.
 */
export class GoogleDocsReviewTarget implements ReviewTargetHandle {
  readonly kind = "model-editor" as const;
  readonly capabilities: ReviewCapabilities = {
    inline: false,
    apply: true,
    bulk: false,
    undo: "per-edit",
  };
  composing = false;
  private lastRead: ReviewTargetRead | null = null;

  constructor(
    private readonly surface: GoogleDocsReviewSurface,
    readonly element: HTMLElement,
  ) {}

  onSourceChange(listener: () => void): () => void {
    return this.surface.onReviewSourceChange(listener);
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
    const cursorAfter =
      snapshot.windowStart +
      positionThroughEdits(snapshot.focus - snapshot.windowStart, request.edits);
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

  rangeRects(): DOMRect[] {
    return [];
  }

  domRange(): Range | null {
    return null;
  }

  focusEditor(): void {
    this.surface.reviewFocusEditor();
  }

  reveal(): void {
    // No reliable canvas geometry: the panel list is the navigation surface.
  }

  setMeasurementRoot(): void {}

  dispose(): void {
    // Nothing is held between reads.
  }
}
