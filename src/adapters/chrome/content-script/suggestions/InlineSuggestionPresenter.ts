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

  constructor(options: InlineSuggestionPresenterOptions = {}) {
    this.positioningService = options.positioningService ?? new SuggestionPositioningService();
    this.doc = options.doc ?? document;
  }

  public clearAll(): void {
    InlineSuggestionView.removeAll(this.doc);
  }

  public renderForEntry({
    enabled,
    entry,
    resolveMentionToken,
  }: {
    enabled: boolean;
    entry: SuggestionEntry;
    resolveMentionToken: (beforeCursor: string) => { token: string; start: number };
  }): void {
    if (!enabled) {
      this.clearAll();
      return;
    }

    const suggestion = entry.inlineSuggestion;
    if (!suggestion) {
      this.clearAll();
      return;
    }

    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const mentionText = resolveMentionToken(snapshot.beforeCursor).token || entry.latestMentionText;
    if (!mentionText) {
      this.clearAll();
      return;
    }

    const lowerSuggestion = suggestion.toLowerCase();
    const lowerMention = mentionText.toLowerCase();
    if (!lowerSuggestion.startsWith(lowerMention)) {
      this.clearAll();
      return;
    }

    const suffix = suggestion.slice(mentionText.length);
    if (!suffix) {
      this.clearAll();
      return;
    }

    const caretRect = this.positioningService.getCaretRect(entry.elem);
    if (!caretRect) {
      this.clearAll();
      return;
    }

    InlineSuggestionView.render({
      target: entry.elem,
      text: suffix,
      caretRect,
      doc: this.doc,
    });
  }
}
