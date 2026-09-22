import { describe, expect, jest, test } from "bun:test";
import { createHandler, createSuggestionEntry } from "./suggestionTestUtils";

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

  test("requests inline suggestion on Tab when suggestions exist but inline is null", () => {
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
      suggestions: ["function"],
    });

    handler.handle(entry, createEvent("Tab"));

    expect(consumeKeyboardEvent).toHaveBeenCalledTimes(1);
    expect(requestInlineSuggestion).toHaveBeenCalledWith(entry);
  });

  test("does not consume Tab when suggestions have been dismissed", () => {
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
      suggestions: [],
    });

    handler.handle(entry, createEvent("Tab"));

    expect(consumeKeyboardEvent).not.toHaveBeenCalled();
    expect(requestInlineSuggestion).not.toHaveBeenCalled();
  });

  test("lets Tab through when the renderer rejected the current suggestions", () => {
    const requestInlineSuggestion = jest.fn();
    const consumeKeyboardEvent = jest.fn((event: KeyboardEvent) => {
      event.preventDefault();
    });
    const handler = createHandler({
      autocompleteOnTab: false,
      consumeKeyboardEvent,
      requestInlineSuggestion,
    });
    const entry = createSuggestionEntry({
      inlineSuggestion: null,
      latestMentionText: "fu",
      suggestions: ["function"],
    });
    entry.inlineRenderRejected = true;
    const event = createEvent("Tab");

    handler.handle(entry, event);

    expect(event.defaultPrevented).toBe(false);
    expect(consumeKeyboardEvent).not.toHaveBeenCalled();
    expect(requestInlineSuggestion).not.toHaveBeenCalled();
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
