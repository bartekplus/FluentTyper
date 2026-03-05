import { describe, expect, jest, test } from "bun:test";
import { SuggestionKeyboardHandler } from "../src/adapters/chrome/content-script/suggestions/SuggestionKeyboardHandler";
import { createSuggestionEntry } from "./suggestionTestUtils";

function createEvent(key: string): KeyboardEvent {
  const event = new Event("keydown", { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(event, "key", { value: key });
  return event;
}

describe("SuggestionKeyboardHandler", () => {
  test("moves selection on ArrowDown when menu is visible", () => {
    const consumeKeyboardEvent = jest.fn((event: KeyboardEvent) => {
      event.preventDefault();
    });
    const updateSelectionHighlight = jest.fn();
    const handler = new SuggestionKeyboardHandler({
      autocompleteOnSpace: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      selectByDigit: true,
      revertOnBackspace: true,
      inlineSuggestionEnabled: true,
      handleMissingSpaceAfterAccept: jest.fn(),
      tryRevertLastReplacement: jest.fn(() => false),
      tryRevertLastAutoFix: jest.fn(() => false),
      tryDeleteTrailingPunctuationSpace: jest.fn(() => false),
      tryRevertLastAutoFixOnUndo: jest.fn(() => false),
      consumeKeyboardEvent,
      clearSuggestions: jest.fn(),
      isMenuVisible: jest.fn(() => true),
      updateSelectionHighlight,
      acceptSuggestion: jest.fn(),
      acceptSuggestionAtIndex: jest.fn(),
      requestInlineSuggestion: jest.fn(),
    });
    const entry = createSuggestionEntry({
      suggestions: ["one", "two"],
      selectedIndex: 0,
    });

    handler.handle(entry, createEvent("ArrowDown"));

    expect(consumeKeyboardEvent).toHaveBeenCalledTimes(1);
    expect(entry.selectedIndex).toBe(1);
    expect(updateSelectionHighlight).toHaveBeenCalledWith(entry);
  });

  test("requests inline suggestion on Tab when inline suggestion is missing", () => {
    const requestInlineSuggestion = jest.fn();
    const consumeKeyboardEvent = jest.fn((event: KeyboardEvent) => {
      event.preventDefault();
    });
    const handler = new SuggestionKeyboardHandler({
      autocompleteOnSpace: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      selectByDigit: true,
      revertOnBackspace: true,
      inlineSuggestionEnabled: true,
      handleMissingSpaceAfterAccept: jest.fn(),
      tryRevertLastReplacement: jest.fn(() => false),
      tryRevertLastAutoFix: jest.fn(() => false),
      tryDeleteTrailingPunctuationSpace: jest.fn(() => false),
      tryRevertLastAutoFixOnUndo: jest.fn(() => false),
      consumeKeyboardEvent,
      clearSuggestions: jest.fn(),
      isMenuVisible: jest.fn(() => false),
      updateSelectionHighlight: jest.fn(),
      acceptSuggestion: jest.fn(),
      acceptSuggestionAtIndex: jest.fn(),
      requestInlineSuggestion,
    });
    const entry = createSuggestionEntry({
      inlineSuggestion: null,
      latestMentionText: "fu",
    });

    handler.handle(entry, createEvent("Tab"));

    expect(consumeKeyboardEvent).toHaveBeenCalledTimes(1);
    expect(requestInlineSuggestion).toHaveBeenCalledWith(entry);
  });

  test("tries grammar auto-fix revert on Backspace when suggestion revert does not apply", () => {
    const tryRevertLastAutoFix = jest.fn(() => true);
    const handler = new SuggestionKeyboardHandler({
      autocompleteOnSpace: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      selectByDigit: true,
      revertOnBackspace: true,
      inlineSuggestionEnabled: true,
      handleMissingSpaceAfterAccept: jest.fn(),
      tryRevertLastReplacement: jest.fn(() => false),
      tryRevertLastAutoFix,
      tryDeleteTrailingPunctuationSpace: jest.fn(() => false),
      tryRevertLastAutoFixOnUndo: jest.fn(() => false),
      consumeKeyboardEvent: jest.fn(),
      clearSuggestions: jest.fn(),
      isMenuVisible: jest.fn(() => false),
      updateSelectionHighlight: jest.fn(),
      acceptSuggestion: jest.fn(),
      acceptSuggestionAtIndex: jest.fn(),
      requestInlineSuggestion: jest.fn(),
    });
    const entry = createSuggestionEntry();

    handler.handle(entry, createEvent("Backspace"));

    expect(tryRevertLastAutoFix).toHaveBeenCalledTimes(1);
  });

  test("tries grammar auto-fix revert on Cmd/Ctrl+Z before native undo", () => {
    const tryRevertLastAutoFixOnUndo = jest.fn(() => true);
    const handler = new SuggestionKeyboardHandler({
      autocompleteOnSpace: true,
      autocompleteOnEnter: true,
      autocompleteOnTab: true,
      selectByDigit: true,
      revertOnBackspace: true,
      inlineSuggestionEnabled: true,
      handleMissingSpaceAfterAccept: jest.fn(),
      tryRevertLastReplacement: jest.fn(() => false),
      tryRevertLastAutoFix: jest.fn(() => false),
      tryDeleteTrailingPunctuationSpace: jest.fn(() => false),
      tryRevertLastAutoFixOnUndo,
      consumeKeyboardEvent: jest.fn(),
      clearSuggestions: jest.fn(),
      isMenuVisible: jest.fn(() => false),
      updateSelectionHighlight: jest.fn(),
      acceptSuggestion: jest.fn(),
      acceptSuggestionAtIndex: jest.fn(),
      requestInlineSuggestion: jest.fn(),
    });
    const entry = createSuggestionEntry();
    const event = createEvent("z");
    Object.defineProperty(event, "ctrlKey", { value: true });

    handler.handle(entry, event);

    expect(tryRevertLastAutoFixOnUndo).toHaveBeenCalledTimes(1);
  });
});
