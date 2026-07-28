import { InlineSuggestionView } from "./InlineSuggestionView";
import { SuggestionPositioningService } from "./SuggestionPositioningService";
import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type { SuggestionEntry } from "./types";

interface InlineSuggestionPresenterOptions {
  positioningService?: SuggestionPositioningService;
  doc?: Document;
}

export class InlineSuggestionPresenter {
  private readonly positioningService: SuggestionPositioningService;
  private readonly doc: Document;
  private activeGhost: HTMLDivElement | null = null;
  private activeEntryId: number | null = null;
  private removalObserver: MutationObserver | null = null;
  private pendingRerender: (() => void) | null = null;

  constructor(options: InlineSuggestionPresenterOptions = {}) {
    this.positioningService = options.positioningService ?? new SuggestionPositioningService();
    this.doc = options.doc ?? document;
  }

  public clearAll(): void {
    this.stopObservingRemoval();
    this.activeGhost = null;
    this.activeEntryId = null;
    this.pendingRerender = null;
    InlineSuggestionView.removeAll(this.doc);
  }

  public clearForEntry(entryId: number): void {
    if (this.activeEntryId === entryId) {
      this.stopObservingRemoval();
      this.activeGhost = null;
      this.activeEntryId = null;
      this.pendingRerender = null;
    }
    InlineSuggestionView.removeForEntry(entryId, this.doc);
  }

  public renderForEntry({
    enabled,
    entry,
    resolveMentionToken,
    resolveTrailingToken,
  }: {
    enabled: boolean;
    entry: SuggestionEntry;
    resolveMentionToken: (beforeCursor: string) => { token: string; start: number };
    resolveTrailingToken?: (afterCursor: string) => string;
  }): void {
    if (!enabled) {
      this.clearForEntry(entry.id);
      return;
    }

    const suggestion = entry.inlineSuggestion;
    if (!suggestion) {
      this.clearForEntry(entry.id);
      return;
    }

    const snapshot = TextTargetAdapter.snapshot(entry.elem);
    const mentionText = resolveMentionToken(snapshot.beforeCursor).token || entry.latestMentionText;
    if (!mentionText) {
      this.clearForEntry(entry.id);
      return;
    }

    const lowerSuggestion = suggestion.toLowerCase();
    const lowerMention = mentionText.toLowerCase();
    if (!lowerSuggestion.startsWith(lowerMention)) {
      this.clearForEntry(entry.id);
      return;
    }

    const suffix = suggestion.slice(mentionText.length);
    if (!suffix) {
      this.clearForEntry(entry.id);
      return;
    }

    const caretRect = this.positioningService.getCaretRect(entry.elem);
    if (!caretRect) {
      this.clearForEntry(entry.id);
      return;
    }

    const isMidText = snapshot.afterCursor.length > 0;
    // Acceptance consumes the trailing word chars under the caret, so hide
    // them in the preview to match the post-acceptance rendering.
    const trailingTokenText = isMidText ? (resolveTrailingToken?.(snapshot.afterCursor) ?? "") : "";

    let ghost: HTMLDivElement | null;
    if (isMidText && TextTargetAdapter.isTextValue(entry.elem as TextTarget)) {
      ghost = InlineSuggestionView.renderMirrorPreview({
        target: entry.elem as HTMLInputElement | HTMLTextAreaElement,
        suffix,
        cursorOffset: snapshot.cursorOffset,
        trailingTokenText,
        entryId: entry.id,
        doc: this.doc,
      });
    } else if (isMidText) {
      ghost = InlineSuggestionView.renderContentEditableMirrorPreview({
        target: entry.elem,
        suffix,
        trailingTokenText,
        entryId: entry.id,
        doc: this.doc,
      });
    } else {
      ghost = InlineSuggestionView.render({
        target: entry.elem,
        text: suffix,
        caretRect,
        entryId: entry.id,
        doc: this.doc,
      });
    }

    this.activeGhost = ghost;
    this.activeEntryId = entry.id;
    this.pendingRerender = () =>
      this.renderForEntry({ enabled, entry, resolveMentionToken, resolveTrailingToken });
    this.observeGhostRemoval();
  }

  private observeGhostRemoval(): void {
    this.stopObservingRemoval();
    const ghost = this.activeGhost;
    if (!ghost) {
      return;
    }
    const root = ghost.parentNode;
    if (!root) {
      return;
    }
    this.removalObserver = new MutationObserver(() => {
      if (ghost.isConnected) {
        return;
      }
      this.stopObservingRemoval();
      // Ghost was removed externally (e.g. by Google Translate DOM rebuild).
      // Re-render on next microtask so the DOM has settled.
      const rerender = this.pendingRerender;
      if (rerender) {
        this.activeGhost = null;
        void Promise.resolve().then(() => rerender());
      }
    });
    this.removalObserver.observe(root, { childList: true });
  }

  private stopObservingRemoval(): void {
    if (this.removalObserver) {
      this.removalObserver.disconnect();
      this.removalObserver = null;
    }
  }
}
