import { describe, expect, test } from "bun:test";
import {
  resolveEditableCursorContext,
  resolvePredictionInputAction,
  type SuggestionEntrySessionContentEditableAdapter,
} from "../src/adapters/chrome/content-script/suggestions/SuggestionEntryPredictionContext";
import { createSuggestionEntry } from "./suggestionTestUtils";
import type {
  ExtensionEditSnapshot,
  SuggestionSnapshot,
} from "../src/adapters/chrome/content-script/suggestions/types";

const defaultContentEditableAdapter: SuggestionEntrySessionContentEditableAdapter = {
  getBlockContext: () => null,
  getBlockContextBySelection: () => null,
  isCollapsedSelectionBeforeBlockBoundary: () => false,
  getPreviousBlockTextBySelection: () => null,
};

function createGrammarPendingEdit(overrides: Partial<ExtensionEditSnapshot> = {}) {
  return {
    replaceStart: 0,
    originalText: "",
    replacementText: "",
    cursorBefore: 0,
    cursorAfter: 0,
    postEditFingerprint: {
      fullText: "",
      cursorOffset: 0,
      selectionCollapsed: true,
    },
    source: "grammar" as const,
    ...overrides,
  };
}

function createContentEditableElement(): HTMLDivElement {
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
  return editable;
}

function createContentEditableAdapter(
  overrides: Partial<SuggestionEntrySessionContentEditableAdapter> = {},
): SuggestionEntrySessionContentEditableAdapter {
  return {
    ...defaultContentEditableAdapter,
    ...overrides,
  };
}

describe("resolveEditableCursorContext", () => {
  test("uses the provided text-value snapshot without contenteditable lookups", () => {
    const entry = createSuggestionEntry({ elem: document.createElement("input") });
    const snapshot: SuggestionSnapshot = {
      beforeCursor: "hello",
      afterCursor: "",
      cursorOffset: 5,
    };

    const context = resolveEditableCursorContext({
      entry,
      snapshot,
      contentEditableAdapter: createContentEditableAdapter(),
      hasMultipleBlockDescendants: false,
    });

    expect(context).toEqual({
      beforeCursor: "hello",
      afterCursor: "",
      snapshot,
      applyContext: null,
      safeForGrammar: true,
    });
  });

  test("falls back to previous block text when caret sits on an empty block boundary", () => {
    const entry = createSuggestionEntry({ elem: createContentEditableElement() });
    const snapshot: SuggestionSnapshot = {
      beforeCursor: "Alpha",
      afterCursor: "",
      cursorOffset: 5,
    };

    const context = resolveEditableCursorContext({
      entry,
      snapshot,
      contentEditableAdapter: createContentEditableAdapter({
        getBlockContext: () => ({
          beforeCursor: "",
          afterCursor: "",
        }),
        isCollapsedSelectionBeforeBlockBoundary: () => true,
        getPreviousBlockTextBySelection: () => "Alpha",
      }),
      hasMultipleBlockDescendants: true,
    });

    expect(context).toEqual({
      beforeCursor: "Alpha",
      afterCursor: "",
      snapshot,
      applyContext: {
        beforeCursor: "Alpha",
        afterCursor: "",
        useFullTextOffsets: true,
      },
      safeForGrammar: false,
    });
  });

  test("seeds a typed key into an empty block when the host reports it only after the caret", () => {
    const entry = createSuggestionEntry({ elem: createContentEditableElement() });
    const snapshot: SuggestionSnapshot = {
      beforeCursor: "",
      afterCursor: "A",
      cursorOffset: 0,
    };

    const context = resolveEditableCursorContext({
      entry,
      snapshot,
      contentEditableAdapter: createContentEditableAdapter({
        getBlockContext: () => ({
          beforeCursor: "",
          afterCursor: "A",
        }),
      }),
      hasMultipleBlockDescendants: false,
      inputAction: "insert",
      typedKey: "a",
    });

    expect(context).toEqual({
      beforeCursor: "A",
      afterCursor: "",
      snapshot: {
        beforeCursor: "A",
        afterCursor: "",
        cursorOffset: 1,
      },
      applyContext: {
        beforeCursor: "A",
        afterCursor: "",
        useFullTextOffsets: false,
      },
      safeForGrammar: true,
    });
  });

  test("seeds a pending grammar replacement into block-local prediction context", () => {
    const entry = createSuggestionEntry({ elem: createContentEditableElement() });
    entry.pendingExtensionEdit = createGrammarPendingEdit({
      replaceStart: 6,
      replacementText: "world",
    });
    const snapshot: SuggestionSnapshot = {
      beforeCursor: "hello ",
      afterCursor: "world!",
      cursorOffset: 6,
    };

    const context = resolveEditableCursorContext({
      entry,
      snapshot,
      contentEditableAdapter: createContentEditableAdapter({
        getBlockContext: () => ({
          beforeCursor: "",
          afterCursor: "world!",
        }),
      }),
      hasMultipleBlockDescendants: false,
      inputAction: "insert",
    });

    expect(context).toEqual({
      beforeCursor: "world",
      afterCursor: "!",
      snapshot: {
        beforeCursor: "hello world",
        afterCursor: "!",
        cursorOffset: 11,
      },
      applyContext: {
        beforeCursor: "world",
        afterCursor: "!",
        useFullTextOffsets: false,
      },
      safeForGrammar: true,
    });
  });
});

describe("resolvePredictionInputAction", () => {
  test("prefers event inputType when resolving the prediction action", () => {
    const inputEvent = new Event("input") as Event & { inputType?: string };
    inputEvent.inputType = "deleteContentBackward";
    const action = resolvePredictionInputAction(
      inputEvent,
      "hell",
      {
        lastKeydownKey: null,
        lastBeforeCursorText: "hello",
      },
    );

    expect(action).toBe("delete");
  });

  test("falls back to before-cursor length changes when inputType is unavailable", () => {
    const action = resolvePredictionInputAction(new Event("input"), "hello!", {
      lastKeydownKey: null,
      lastBeforeCursorText: "hello",
    });

    expect(action).toBe("insert");
  });
});
