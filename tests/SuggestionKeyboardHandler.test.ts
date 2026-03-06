import { describe, expect, jest, test } from "bun:test";
import { SuggestionKeyboardHandler } from "../src/adapters/chrome/content-script/suggestions/SuggestionKeyboardHandler";
import { createSuggestionEntry } from "./suggestionTestUtils";

function createEvent(key: string): KeyboardEvent {
  const event = new Event("keydown", { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(event, "key", { value: key });
  return event;
}

function createHandler(
  overrides: Partial<ConstructorParameters<typeof SuggestionKeyboardHandler>[0]> = {},
) {
  return new SuggestionKeyboardHandler({
    autocompleteOnSpace: true,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    selectByDigit: true,
    inlineSuggestionEnabled: true,
    handleMissingSpaceAfterAccept: jest.fn(),
    tryUndoLastExtensionEdit: jest.fn(() => false),
    consumeKeyboardEvent: jest.fn(),
    clearSuggestions: jest.fn(),
    isMenuVisible: jest.fn(() => false),
    updateSelectionHighlight: jest.fn(),
    acceptSuggestion: jest.fn(),
    acceptSuggestionAtIndex: jest.fn(),
    requestInlineSuggestion: jest.fn(),
    ...overrides,
  });
}

describe("SuggestionKeyboardHandler", () => {
  test("moves selection on ArrowDown when menu is visible", () => {
    const consumeKeyboardEvent = jest.fn((event: KeyboardEvent) => {
      event.preventDefault();
    });
    const updateSelectionHighlight = jest.fn();
    const handler = createHandler({
      consumeKeyboardEvent,
      isMenuVisible: jest.fn(() => true),
      updateSelectionHighlight,
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
    const handler = createHandler({
      consumeKeyboardEvent,
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

  test("tries unified extension undo on Cmd/Ctrl+Z before native undo", () => {
    const tryUndoLastExtensionEdit = jest.fn(() => true);
    const handler = createHandler({
      tryUndoLastExtensionEdit,
    });
    const entry = createSuggestionEntry();
    const event = createEvent("z");
    Object.defineProperty(event, "ctrlKey", { value: true });

    handler.handle(entry, event);

    expect(tryUndoLastExtensionEdit).toHaveBeenCalledTimes(1);
  });

  test("ignores Backspace when there is no menu action to handle", () => {
    const tryUndoLastExtensionEdit = jest.fn(() => false);
    const handler = createHandler({
      tryUndoLastExtensionEdit,
    });

    handler.handle(createSuggestionEntry(), createEvent("Backspace"));

    expect(tryUndoLastExtensionEdit).not.toHaveBeenCalled();
  });
});
