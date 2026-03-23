import { SuggestionKeyboardController } from "./SuggestionKeyboardController";
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
  private readonly autocompleteOnSpace: boolean;
  private readonly autocompleteOnEnter: boolean;
  private readonly autocompleteOnTab: boolean;
  private readonly selectByDigit: boolean;
  private readonly inlineSuggestionEnabled: boolean;
  private readonly activeKeys: string[];
  private readonly handleMissingSpaceAfterAccept: (
    entry: SuggestionEntry,
    event: KeyboardEvent,
  ) => void;
  private readonly tryUndoLastExtensionEdit: (
    entry: SuggestionEntry,
    event: KeyboardEvent,
  ) => boolean;
  private readonly consumeKeyboardEvent: (event: KeyboardEvent) => void;
  private readonly clearSuggestions: (entry: SuggestionEntry) => void;
  private readonly isMenuVisible: (entry: SuggestionEntry) => boolean;
  private readonly updateSelectionHighlight: (entry: SuggestionEntry) => void;
  private readonly acceptSuggestion: (entry: SuggestionEntry, suggestion: string) => boolean;
  private readonly acceptSuggestionAtIndex: (entry: SuggestionEntry, index: number) => boolean;
  private readonly requestInlineSuggestion: (entry: SuggestionEntry) => void;

  constructor(options: SuggestionKeyboardHandlerOptions) {
    this.autocompleteOnSpace = options.autocompleteOnSpace;
    this.autocompleteOnEnter = options.autocompleteOnEnter;
    this.autocompleteOnTab = options.autocompleteOnTab;
    this.selectByDigit = options.selectByDigit;
    this.inlineSuggestionEnabled = options.inlineSuggestionEnabled;
    this.activeKeys = SuggestionKeyboardController.buildActiveKeys({
      autocompleteOnEnter: this.autocompleteOnEnter,
      autocompleteOnTab: this.autocompleteOnTab,
    });
    this.handleMissingSpaceAfterAccept = options.handleMissingSpaceAfterAccept;
    this.tryUndoLastExtensionEdit = options.tryUndoLastExtensionEdit;
    this.consumeKeyboardEvent = options.consumeKeyboardEvent;
    this.clearSuggestions = options.clearSuggestions;
    this.isMenuVisible = options.isMenuVisible;
    this.updateSelectionHighlight = options.updateSelectionHighlight;
    this.acceptSuggestion = options.acceptSuggestion;
    this.acceptSuggestionAtIndex = options.acceptSuggestionAtIndex;
    this.requestInlineSuggestion = options.requestInlineSuggestion;
  }

  public handle(entry: SuggestionEntry, keyboardEvent: KeyboardEvent): void {
    this.handleMissingSpaceAfterAccept(entry, keyboardEvent);

    if (keyboardEvent.defaultPrevented) {
      return;
    }

    const key = keyboardEvent.key;
    if (isNativeUndoChord(keyboardEvent) && this.tryUndoLastExtensionEdit(entry, keyboardEvent)) {
      return;
    }

    const digitIndex = this.selectByDigit ? this.mapDigitToIndex(key) : null;
    const isInlineTab = this.inlineSuggestionEnabled && key === "Tab";

    if (
      !SuggestionKeyboardController.isActiveKey(this.activeKeys, key) &&
      !isInlineTab &&
      digitIndex === null
    ) {
      return;
    }

    if (isInlineTab) {
      if (entry.inlineSuggestion) {
        this.consumeKeyboardEvent(keyboardEvent);
        this.acceptSuggestion(entry, entry.inlineSuggestion);
        return;
      }

      if (entry.suggestions.length > 0 && entry.latestMentionText.length > 0) {
        this.consumeKeyboardEvent(keyboardEvent);
        this.requestInlineSuggestion(entry);
        return;
      }
    }

    if (key === "Escape") {
      this.clearSuggestions(entry);
      return;
    }

    if (!this.isMenuVisible(entry)) {
      return;
    }

    if (key === "ArrowDown") {
      this.consumeKeyboardEvent(keyboardEvent);
      this.moveSelection(entry, 1);
      return;
    }

    if (key === "ArrowUp") {
      this.consumeKeyboardEvent(keyboardEvent);
      this.moveSelection(entry, -1);
      return;
    }

    if (digitIndex !== null && digitIndex < entry.suggestions.length) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, digitIndex);
      return;
    }

    if (key === "Tab" && this.autocompleteOnTab) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, entry.selectedIndex);
      return;
    }

    if (key === "Enter" && this.autocompleteOnEnter) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, entry.selectedIndex);
      return;
    }

    if (key === " " && this.autocompleteOnSpace) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, entry.selectedIndex);
    }
  }

  private moveSelection(entry: SuggestionEntry, direction: number): void {
    if (entry.suggestions.length === 0) {
      return;
    }

    const next =
      (entry.selectedIndex + direction + entry.suggestions.length) % entry.suggestions.length;
    entry.selectedIndex = next;
    this.updateSelectionHighlight(entry);
  }

  private mapDigitToIndex(key: string): number | null {
    if (!/^\d$/.test(key)) {
      return null;
    }
    return key === "0" ? 9 : Number(key) - 1;
  }
}
