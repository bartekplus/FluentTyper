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
      inlineSuggestionEnabled: false,
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

  test("moves selection the other way when the menu lists suggestions bottom-up", () => {
    const handler = createHandler({
      inlineSuggestionEnabled: false,
      consumeKeyboardEvent: jest.fn((event: KeyboardEvent) => event.preventDefault()),
      isMenuVisible: jest.fn(() => true),
    });
    const entry = createSuggestionEntry({ suggestions: ["one", "two", "three"], selectedIndex: 0 });
    entry.menu.setAttribute("data-ft-placement", "above");

    // Above the caret the next suggestion is drawn above the first one.
    handler.handle(entry, createEvent("ArrowUp"));
    expect(entry.selectedIndex).toBe(1);
    handler.handle(entry, createEvent("ArrowDown"));
    expect(entry.selectedIndex).toBe(0);

    // A single row is never reversed.
    entry.menu.setAttribute("data-ft-layout", "horizontal");
    handler.handle(entry, createEvent("ArrowDown"));
    expect(entry.selectedIndex).toBe(1);
  });

  test("preserves Tab when an inline suggestion is not visible", () => {
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

    expect(consumeKeyboardEvent).not.toHaveBeenCalled();
    expect(requestInlineSuggestion).not.toHaveBeenCalled();
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

describe("SuggestionKeyboardHandler grammar proposals", () => {
  const proposal = {
    key: "k",
    ruleId: "englishPronounVerbWhitelistAgreement" as const,
    messageKey: "review_msg_pronoun_verb" as const,
    start: 3,
    end: 5,
    original: "is",
    replacement: "are",
  };

  function setup(inlineSuggestionEnabled: boolean, suggestions: string[]) {
    const acceptGrammarProposal = jest.fn(() => true);
    const acceptSuggestionAtIndex = jest.fn(() => true);
    const acceptSuggestion = jest.fn(() => true);
    const consumeKeyboardEvent = jest.fn((event: KeyboardEvent) => event.preventDefault());
    const handler = createHandler({
      inlineSuggestionEnabled,
      isMenuVisible: jest.fn(() => true),
      acceptGrammarProposal,
      acceptSuggestionAtIndex,
      acceptSuggestion,
      consumeKeyboardEvent,
    });
    const entry = createSuggestionEntry({ suggestions, selectedIndex: 0 });
    entry.grammarProposal = proposal;
    entry.grammarProposalSelected = false;
    return { handler, entry, acceptGrammarProposal, acceptSuggestionAtIndex, acceptSuggestion };
  }

  test("an unselected proposal alone leaves Tab, Enter and Space to the page", () => {
    const { handler, entry, acceptGrammarProposal, acceptSuggestionAtIndex } = setup(false, []);
    for (const key of ["Tab", "Enter", " "]) {
      const event = createEvent(key);
      handler.handle(entry, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(acceptGrammarProposal).not.toHaveBeenCalled();
    expect(acceptSuggestionAtIndex).not.toHaveBeenCalled();
  });

  test("the arrow keys reach the proposal; an accept key then applies it", () => {
    const { handler, entry, acceptGrammarProposal } = setup(false, []);
    handler.handle(entry, createEvent("ArrowDown"));
    expect(entry.grammarProposalSelected).toBe(true);
    const event = createEvent("Tab");
    handler.handle(entry, event);
    expect(event.defaultPrevented).toBe(true);
    expect(acceptGrammarProposal).toHaveBeenCalledWith(entry);
  });

  test("the default accept stays with the first suggestion; the proposal is the row after them", () => {
    const { handler, entry, acceptGrammarProposal, acceptSuggestionAtIndex } = setup(false, [
      "one",
      "two",
    ]);
    handler.handle(entry, createEvent("Tab"));
    expect(acceptSuggestionAtIndex).toHaveBeenLastCalledWith(entry, 0);
    expect(acceptGrammarProposal).not.toHaveBeenCalled();

    handler.handle(entry, createEvent("ArrowDown"));
    handler.handle(entry, createEvent("ArrowDown"));
    expect(entry.grammarProposalSelected).toBe(true);
    handler.handle(entry, createEvent("Enter"));
    expect(acceptGrammarProposal).toHaveBeenCalledTimes(1);

    // Moving on wraps back to the first suggestion.
    handler.handle(entry, createEvent("ArrowDown"));
    expect(entry.grammarProposalSelected).toBe(false);
    expect(entry.selectedIndex).toBe(0);
  });

  test("inline Tab applies a selected proposal instead of the inline suggestion", () => {
    const { handler, entry, acceptGrammarProposal, acceptSuggestion } = setup(true, ["one"]);
    entry.inlineSuggestion = "one";
    handler.handle(entry, createEvent("ArrowDown"));
    expect(entry.grammarProposalSelected).toBe(true);
    handler.handle(entry, createEvent("Tab"));
    expect(acceptGrammarProposal).toHaveBeenCalledTimes(1);
    expect(acceptSuggestion).not.toHaveBeenCalled();
  });
});

test.each(["Tab", "Enter", "1"])("a refused visible action preserves %s", (key) => {
  const handler = createHandler({
    inlineSuggestionEnabled: false,
    isMenuVisible: () => true,
    acceptSuggestionAtIndex: () => false,
    consumeKeyboardEvent: (event) => event.preventDefault(),
  });
  const event = createEvent(key);
  handler.handle(createSuggestionEntry({ suggestions: ["hello"] }), event);
  expect(event.defaultPrevented).toBe(false);
});

test.each(["shiftKey", "ctrlKey", "altKey", "metaKey"])(
  "preserves modified Tab: %s",
  (modifier) => {
    const accept = jest.fn(() => true);
    const handler = createHandler({ acceptSuggestion: accept });
    const event = createEvent("Tab");
    Object.defineProperty(event, modifier, { value: true });
    handler.handle(createSuggestionEntry({ inlineSuggestion: "hello" }), event);
    expect(accept).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  },
);
