import { stripIgnoredWordChars } from "@core/domain/lang";
import { ContentEditableAdapter } from "./ContentEditableAdapter";
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
  private readonly contentEditableAdapter = new ContentEditableAdapter();
  private activeGhost: HTMLDivElement | null = null;
  private activeEntryId: number | null = null;
  private removalObserver: MutationObserver | null = null;
  private pendingRerender: (() => void) | null = null;

  constructor(options: InlineSuggestionPresenterOptions = {}) {
    this.positioningService = options.positioningService ?? new SuggestionPositioningService();
    this.doc = options.doc ?? document;
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

  // An unrendered suggestion must not stay armed for Tab acceptance.
  private dropForEntry(entry: SuggestionEntry): void {
    entry.inlineSuggestion = null;
    entry.inlineRenderRejected = true;
    this.clearForEntry(entry.id);
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
    const suggestion = enabled ? entry.inlineSuggestion : null;
    if (!suggestion) {
      this.clearForEntry(entry.id);
      return;
    }

    // Judge the caret's block like acceptance does: the whole-editor text joins
    // blocks without separators and counts later blocks (e.g. a signature).
    const snapshot =
      (!TextTargetAdapter.isTextValue(entry.elem) &&
        this.contentEditableAdapter.getBlockContext(entry.elem)) ||
      TextTargetAdapter.snapshot(entry.elem);
    const mentionText = resolveMentionToken(snapshot.beforeCursor).token || entry.latestMentionText;
    if (!mentionText) {
      this.dropForEntry(entry);
      return;
    }

    const { isReplacement, text: suffix } = InlineSuggestionView.previewText(
      suggestion,
      mentionText,
    );
    // A text expansion is only valid for the token it was predicted for: after
    // further typing the suggestion is stale and must not stay armed.
    if (
      isReplacement &&
      (entry.inlineSuggestionToken === null ||
        stripIgnoredWordChars(entry.inlineSuggestionToken) !== stripIgnoredWordChars(mentionText) ||
        !snapshot.beforeCursor.endsWith(mentionText))
    ) {
      this.dropForEntry(entry);
      return;
    }

    if (!suffix) {
      // Nothing to preview, but Tab may still accept (a no-op completion).
      this.clearForEntry(entry.id);
      return;
    }

    const caretRect = this.positioningService.getCaretRect(entry.elem);
    if (!caretRect) {
      this.dropForEntry(entry);
      return;
    }

    const isMidText = snapshot.afterCursor.length > 0;
    // A floating ghost can't be placed when the run opposes the paragraph
    // direction (e.g. Arabic in an LTR input): let the mirror lay out bidi.
    const useMirror =
      isReplacement ||
      isMidText ||
      InlineSuggestionView.runOpposesParagraph({
        target: entry.elem,
        token: mentionText,
        suffix,
        doc: this.doc,
      });
    // Acceptance consumes the trailing word chars under the caret, so hide
    // them in the preview to match the post-acceptance rendering.
    const trailingTokenText = isMidText ? (resolveTrailingToken?.(snapshot.afterCursor) ?? "") : "";

    let ghost: HTMLDivElement | null;
    if (useMirror && TextTargetAdapter.isTextValue(entry.elem as TextTarget)) {
      ghost = InlineSuggestionView.renderMirrorPreview({
        target: entry.elem as HTMLInputElement | HTMLTextAreaElement,
        suffix,
        cursorOffset: snapshot.beforeCursor.length,
        trailingTokenText,
        entryId: entry.id,
        doc: this.doc,
      });
    } else if (useMirror && !isReplacement) {
      ghost = InlineSuggestionView.renderContentEditableMirrorPreview({
        target: entry.elem,
        suffix,
        trailingTokenText,
        entryId: entry.id,
        doc: this.doc,
      });
    } else if (isReplacement && isMidText) {
      // ponytail: no mid-text contenteditable replacement preview (the clone
      // can't show that acceptance also consumes the trailing token), so Tab
      // isn't armed there.
      ghost = null;
    } else {
      ghost = InlineSuggestionView.render({
        target: entry.elem,
        text: suffix,
        caretRect,
        entryId: entry.id,
        doc: this.doc,
      });
    }
    if (ghost === null) {
      this.dropForEntry(entry);
      return;
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
    const root = ghost?.parentNode;
    if (!ghost || !root) {
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
    this.removalObserver?.disconnect();
    this.removalObserver = null;
  }
}
