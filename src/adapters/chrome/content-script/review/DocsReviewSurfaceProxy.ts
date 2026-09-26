import type { DocsEdit, DocsReply } from "../google-docs/GoogleDocsModel";
import type { GoogleDocsReviewSurface } from "./GoogleDocsReviewTarget";

/**
 * The Docs review surface a review holds for its whole life. An open review
 * outlives a settings restart, which replaces the Docs adapter: this forwards
 * to whichever adapter is current, tells a new adapter the review is open, and
 * keeps the review's source-change listeners across the replacement.
 */
export class DocsReviewSurfaceProxy implements GoogleDocsReviewSurface {
  private adapter: GoogleDocsReviewSurface | null = null;
  private active = false;
  private readonly listeners = new Set<() => void>();
  private readonly keyListeners = new Set<(key: string) => boolean>();

  /** The current adapter (null when Docs support stops); a new one inherits the review. */
  attach(adapter: GoogleDocsReviewSurface | null): void {
    this.adapter = adapter;
    if (!adapter) return;
    adapter.onReviewSourceChange(() => {
      if (this.adapter !== adapter) return;
      for (const listener of this.listeners) listener();
    });
    adapter.onReviewKey?.((key) => {
      if (this.adapter !== adapter) return false;
      for (const listener of this.keyListeners) if (listener(key)) return true;
      return false;
    });
    if (this.active) adapter.setReviewActive(true);
  }

  reviewRead(): Promise<DocsReply> {
    return this.adapter?.reviewRead() ?? Promise.resolve({ status: "busy" });
  }

  reviewApply(token: string, edit: DocsEdit): Promise<DocsReply> {
    return this.adapter?.reviewApply(token, edit) ?? Promise.resolve({ status: "busy" });
  }

  setReviewActive(active: boolean): void {
    this.active = active;
    this.adapter?.setReviewActive(active);
  }

  reviewFocusEditor(): void {
    this.adapter?.reviewFocusEditor();
  }

  onReviewSourceChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onReviewKey(listener: (key: string) => boolean): () => void {
    this.keyListeners.add(listener);
    return () => {
      this.keyListeners.delete(listener);
    };
  }
}
