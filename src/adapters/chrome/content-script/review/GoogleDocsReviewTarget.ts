import type {
  ReviewApplyResult,
  ReviewCapabilities,
  ReviewTargetRead,
} from "@core/application/review/ReviewSession";
import type { ProtectedRange, ReviewEdit, TextRange } from "@core/domain/grammar/review/types";
import type { DocsEdit, DocsReply, DocsSnapshot } from "../google-docs/GoogleDocsModel";
import type { ReviewTargetHandle } from "./ReviewTargets";

export interface GoogleDocsReviewSurface {
  reviewRead(): Promise<DocsReply>;
  reviewApply(token: string, edit: DocsEdit): Promise<DocsReply>;
  setReviewActive(active: boolean): void;
  reviewFocusEditor(): void;
}

// Docs' structural markers (tables, footnotes, objects); never prose, never edited.
// eslint-disable-next-line no-control-regex -- matches Docs' private control markers.
const DOCS_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFC]/gu;

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
  private snapshot: DocsSnapshot | null = null;
  private lastRead: ReviewTargetRead | null = null;

  constructor(
    private readonly surface: GoogleDocsReviewSurface,
    readonly element: HTMLElement,
  ) {}

  /** The initial read; its selection (if any) becomes the review scope. */
  async start(): Promise<TextRange | null> {
    this.surface.reviewFocusEditor();
    const reply = await this.readWithRetry();
    if (reply.status !== "ready" || !reply.snapshot) return null;
    this.snapshot = reply.snapshot;
    const start =
      Math.min(reply.snapshot.anchor, reply.snapshot.focus) - reply.snapshot.windowStart;
    const end = Math.max(reply.snapshot.anchor, reply.snapshot.focus) - reply.snapshot.windowStart;
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
    this.snapshot = reply.snapshot;
    const protectedRanges: ProtectedRange[] = [];
    for (const match of reply.snapshot.text.matchAll(DOCS_CONTROLS)) {
      protectedRanges.push({ start: match.index, end: match.index + 1, reason: "structure" });
    }
    this.lastRead = {
      ok: true,
      text: reply.snapshot.text,
      protectedRanges,
      signature: `${reply.snapshot.scope}@${reply.snapshot.windowStart}`,
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
    const start = Math.min(...request.edits.map((edit) => edit.start));
    const end = Math.max(...request.edits.map((edit) => edit.end));
    const replacement = request.after.slice(
      start,
      request.after.length - (request.before.length - end),
    );
    this.surface.reviewFocusEditor();
    const fresh = await this.readWithRetry();
    const snapshot = fresh.snapshot;
    if (fresh.status !== "ready" || !snapshot) return { status: "stale" };
    if (
      snapshot.text !== request.before ||
      `${snapshot.scope}@${snapshot.windowStart}` !== request.signature
    ) {
      return { status: "stale" };
    }
    const delta = replacement.length - (end - start);
    const caret = snapshot.focus - snapshot.windowStart;
    const cursorAfter =
      snapshot.windowStart +
      (caret <= start ? caret : caret >= end ? caret + delta : start + replacement.length);
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
    this.snapshot = null;
  }
}
