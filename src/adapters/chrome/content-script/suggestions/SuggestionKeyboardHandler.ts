import { isNativeUndoChord } from "./keyboardShortcuts";
import type { SuggestionEntry } from "./types";

interface SuggestionKeyboardHandlerOptions {
  autocompleteOnSpace: boolean;
  autocompleteOnEnter: boolean;
  autocompleteOnTab: boolean;
  selectByDigit: boolean;
  inlineSuggestionEnabled: boolean;
  handleMissingSpaceAfterAccept: (entry: SuggestionEntry, event: KeyboardEvent) => void;
  tryUndoLastExtensionEdit: (entry: SuggestionEntry, event: KeyboardEvent) => boolean;
  consumeKeyboardEvent: (event: KeyboardEvent) => void;
  clearSuggestions: (entry: SuggestionEntry) => void;
  isMenuVisible: (entry: SuggestionEntry) => boolean;
  updateSelectionHighlight: (entry: SuggestionEntry) => void;
  acceptSuggestion: (entry: SuggestionEntry, suggestion: string) => boolean;
  acceptSuggestionAtIndex: (entry: SuggestionEntry, index: number) => boolean;
  requestInlineSuggestion: (entry: SuggestionEntry) => void;
}

export class SuggestionKeyboardHandler {
  constructor(private readonly options: SuggestionKeyboardHandlerOptions) {}

  public handle(entry: SuggestionEntry, keyboardEvent: KeyboardEvent): void {
    this.options.handleMissingSpaceAfterAccept(entry, keyboardEvent);

    if (keyboardEvent.defaultPrevented) {
      return;
    }

    const key = keyboardEvent.key;
    if (
      isNativeUndoChord(keyboardEvent) &&
      this.options.tryUndoLastExtensionEdit(entry, keyboardEvent)
    ) {
      return;
    }

    const digitIndex = this.options.selectByDigit ? this.mapDigitToIndex(key) : null;
    const isInlineTab = this.options.inlineSuggestionEnabled && key === "Tab";
    const isActiveKey =
      key === "Escape" ||
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === " " ||
      (key === "Enter" && this.options.autocompleteOnEnter) ||
      (key === "Tab" && this.options.autocompleteOnTab);

    if (!isActiveKey && !isInlineTab && digitIndex === null) {
      return;
    }

    if (isInlineTab) {
      if (entry.inlineSuggestion) {
        this.options.consumeKeyboardEvent(keyboardEvent);
        this.options.acceptSuggestion(entry, entry.inlineSuggestion);
        return;
      }

      if (
        entry.suggestions.length > 0 &&
        entry.latestMentionText.length > 0 &&
        !entry.inlineRenderRejected
      ) {
        this.options.consumeKeyboardEvent(keyboardEvent);
        this.options.requestInlineSuggestion(entry);
        return;
      }
    }

    if (key === "Escape") {
      this.options.clearSuggestions(entry);
      return;
    }

    if (!this.options.isMenuVisible(entry)) {
      return;
    }

    if (key === "ArrowDown") {
      this.options.consumeKeyboardEvent(keyboardEvent);
      this.moveSelection(entry, 1);
      return;
    }

    if (key === "ArrowUp") {
      this.options.consumeKeyboardEvent(keyboardEvent);
      this.moveSelection(entry, -1);
      return;
    }

    if (digitIndex !== null && digitIndex < entry.suggestions.length) {
      this.options.consumeKeyboardEvent(keyboardEvent);
      this.options.acceptSuggestionAtIndex(entry, digitIndex);
      return;
    }

    if (
      (key === "Tab" && this.options.autocompleteOnTab) ||
      (key === "Enter" && this.options.autocompleteOnEnter) ||
      (key === " " && this.options.autocompleteOnSpace)
    ) {
      this.options.consumeKeyboardEvent(keyboardEvent);
      this.options.acceptSuggestionAtIndex(entry, entry.selectedIndex);
    }
  }

  private moveSelection(entry: SuggestionEntry, direction: number): void {
    if (entry.suggestions.length === 0) {
      return;
    }

    entry.selectedIndex =
      (entry.selectedIndex + direction + entry.suggestions.length) % entry.suggestions.length;
    this.options.updateSelectionHighlight(entry);
  }

  private mapDigitToIndex(key: string): number | null {
    if (!/^\d$/.test(key)) {
      return null;
    }
    return key === "0" ? 9 : Number(key) - 1;
  }
}
