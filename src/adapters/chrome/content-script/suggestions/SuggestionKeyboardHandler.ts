import { isSearchField } from "./NativeAutocompleteConflictDetector";
import { isNativeUndoChord } from "./keyboardShortcuts";
import { isSuggestionMenuReversed } from "./SuggestionMenuHost";
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
  acceptGrammarProposal: (entry: SuggestionEntry) => boolean;
  requestInlineSuggestion: (entry: SuggestionEntry) => void;
}

/** Suggestion rows in the menu: none when suggestions show inline instead. */
export function menuSuggestionRows(entry: SuggestionEntry, inline: boolean): number {
  return inline ? 0 : entry.suggestions.length;
}

/**
 * The highlighted menu row: suggestions come first, the grammar proposal is the
 * row after them, and -1 means none (a proposal alone is never preselected).
 */
export function highlightedMenuRow(entry: SuggestionEntry, rows: number): number {
  if (entry.grammarProposal && entry.grammarProposalSelected) {
    return rows;
  }
  return rows > 0 ? entry.selectedIndex : -1;
}

export class SuggestionKeyboardHandler {
  constructor(private readonly options: SuggestionKeyboardHandlerOptions) {}

  public handle(entry: SuggestionEntry, keyboardEvent: KeyboardEvent): void {
    if (!isSearchField(entry.elem))
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

    if (
      keyboardEvent.shiftKey ||
      keyboardEvent.altKey ||
      keyboardEvent.ctrlKey ||
      keyboardEvent.metaKey
    )
      return;

    const digitIndex = this.options.selectByDigit ? this.mapDigitToIndex(key) : null;
    const isInlineTab = this.options.inlineSuggestionEnabled && key === "Tab";
    const isAcceptKey =
      (key === "Tab" && this.options.autocompleteOnTab) ||
      (key === "Enter" && this.options.autocompleteOnEnter) ||
      (key === " " && this.options.autocompleteOnSpace && !isSearchField(entry.elem));
    const isActiveKey =
      key === "Escape" || key === "ArrowUp" || key === "ArrowDown" || key === " " || isAcceptKey;

    if (!isActiveKey && !isInlineTab && digitIndex === null) {
      return;
    }

    // A grammar proposal is applied only once the user has moved onto it.
    if (
      entry.grammarProposal &&
      entry.grammarProposalSelected &&
      (isAcceptKey || isInlineTab) &&
      this.options.isMenuVisible(entry)
    ) {
      if (this.options.acceptGrammarProposal(entry))
        this.options.consumeKeyboardEvent(keyboardEvent);
      return;
    }

    if (isInlineTab) {
      if (entry.inlineSuggestion) {
        if (this.options.acceptSuggestion(entry, entry.inlineSuggestion))
          this.options.consumeKeyboardEvent(keyboardEvent);
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

    const rows = menuSuggestionRows(entry, this.options.inlineSuggestionEnabled);
    if (key === "ArrowDown" || key === "ArrowUp") {
      this.options.consumeKeyboardEvent(keyboardEvent);
      // Arrows follow the screen: a reversed menu lists the next item above.
      const reversed = isSuggestionMenuReversed(entry.menu);
      this.moveSelection(entry, rows, (key === "ArrowDown") !== reversed ? 1 : -1);
      return;
    }

    if (digitIndex !== null && digitIndex < rows) {
      if (this.options.acceptSuggestionAtIndex(entry, digitIndex))
        this.options.consumeKeyboardEvent(keyboardEvent);
      return;
    }

    // With only an unselected proposal showing, the key stays the host's.
    if (isAcceptKey && rows > 0) {
      if (this.options.acceptSuggestionAtIndex(entry, entry.selectedIndex))
        this.options.consumeKeyboardEvent(keyboardEvent);
    }
  }

  private moveSelection(entry: SuggestionEntry, rows: number, direction: number): void {
    const count = rows + (entry.grammarProposal ? 1 : 0);
    if (count === 0) {
      return;
    }

    const next = (highlightedMenuRow(entry, rows) + direction + count) % count;
    entry.grammarProposalSelected = next === rows;
    if (next < rows) {
      entry.selectedIndex = next;
    }
    this.options.updateSelectionHighlight(entry);
  }

  private mapDigitToIndex(key: string): number | null {
    if (!/^\d$/.test(key)) {
      return null;
    }
    return key === "0" ? 9 : Number(key) - 1;
  }
}
