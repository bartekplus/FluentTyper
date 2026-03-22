import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearAcceptedSuggestionTransientState,
  resolveAcceptedSuggestionSpaceState,
  shouldDismissSuggestionsOnKeydown,
  shouldInvalidatePendingExtensionEditOnKeydown,
  shouldReleaseAcceptedSuggestionSuppressionOnKeydown,
  syncAcceptedSuggestionTrailingSpaceState,
  type SuggestionEntrySessionContentEditableAdapter,
} from "../src/adapters/chrome/content-script/suggestions/SuggestionAcceptedState";
import type {
  ExtensionEditSnapshot,
  SuggestionEntry,
} from "../src/adapters/chrome/content-script/suggestions/types";

function createEntry(
  elem: SuggestionEntry["elem"],
): SuggestionEntry & { lastAcceptedSuggestion: string | null } {
  return {
    id: 1,
    elem,
    inputEventTarget: null,
    menu: document.createElement("div"),
    list: document.createElement("ul"),
    requestId: 0,
    suggestions: [],
    selectedIndex: 0,
    menuHeader: null,
    latestMentionText: "",
    latestMentionStart: 0,
    visibleSuggestionBeforeCursorText: null,
    visibleSuggestionFullText: null,
    inlineSuggestion: null,
    pendingInlineAccept: false,
    missingTrailingSpace: false,
    expectedCursorPos: 0,
    expectedCursorPosIsBlockLocal: false,
    expectedCursorPosBlockElement: null,
    expectedCursorPosBlockText: null,
    pendingExtensionEdit: null,
    suppressNextSuggestionInputPrediction: false,
    lastAcceptedSuggestion: null,
  } as SuggestionEntry & { lastAcceptedSuggestion: string | null };
}

function createPendingEdit(overrides: Partial<ExtensionEditSnapshot> = {}) {
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
    source: "suggestion" as const,
    ...overrides,
  };
}

function createContentEditableAdapter(
  overrides: Partial<SuggestionEntrySessionContentEditableAdapter> = {},
): SuggestionEntrySessionContentEditableAdapter {
  return {
    getActiveBlockElement: () => null,
    getBlockContext: () => null,
    ...overrides,
  };
}

describe("SuggestionAcceptedState", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("transient state", () => {
    test("tracks a missing trailing space from block-local accepted text", () => {
      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
      const block = document.createElement("p");
      editable.appendChild(block);
      const entry = createEntry(editable);
      entry.pendingExtensionEdit = createPendingEdit({
        blockScoped: true,
        blockElement: block,
        postEditBlockText: "hello!",
        postEditFingerprint: {
          fullText: "hello!",
          cursorOffset: 5,
          selectionCollapsed: true,
        },
      });

      const state = resolveAcceptedSuggestionSpaceState({
        entry,
        insertSpaceAfterAutocomplete: true,
        insertedText: "hello",
        cursorAfter: 5,
        cursorAfterIsBlockLocal: true,
      });

      expect(state).toEqual({
        missingTrailingSpace: true,
        expectedCursorPos: 5,
        expectedCursorPosIsBlockLocal: true,
        expectedCursorPosBlockElement: block,
        expectedCursorPosBlockText: "hello!",
      });
    });

    test("does not expect another space when the following character is already whitespace", () => {
      const input = document.createElement("input");
      const entry = createEntry(input);
      entry.pendingExtensionEdit = createPendingEdit({
        postEditFingerprint: {
          fullText: "hello world",
          cursorOffset: 5,
          selectionCollapsed: true,
        },
      });

      const state = resolveAcceptedSuggestionSpaceState({
        entry,
        insertSpaceAfterAutocomplete: true,
        insertedText: "hello",
        cursorAfter: 5,
        cursorAfterIsBlockLocal: false,
      });

      expect(state).toEqual({
        missingTrailingSpace: false,
        expectedCursorPos: 0,
        expectedCursorPosIsBlockLocal: false,
        expectedCursorPosBlockElement: null,
        expectedCursorPosBlockText: null,
      });
    });

    test("clears block-local trailing-space state when the caret leaves the expected block", () => {
      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
      const expectedBlock = document.createElement("p");
      editable.appendChild(expectedBlock);
      const entry = createEntry(editable);
      entry.missingTrailingSpace = true;
      entry.expectedCursorPos = 5;
      entry.expectedCursorPosIsBlockLocal = true;
      entry.expectedCursorPosBlockElement = expectedBlock;
      entry.expectedCursorPosBlockText = "hello!";

      syncAcceptedSuggestionTrailingSpaceState(
        entry,
        createContentEditableAdapter({
          getActiveBlockElement: () => document.createElement("p"),
          getBlockContext: () => ({
            beforeCursor: "hello",
            afterCursor: "!",
          }),
        }),
      );

      expect(entry.missingTrailingSpace).toBe(false);
      expect(entry.expectedCursorPos).toBe(0);
      expect(entry.expectedCursorPosBlockElement).toBeNull();
      expect(entry.expectedCursorPosBlockText).toBeNull();
    });

    test("resets all accepted-suggestion transient fields in one place", () => {
      const input = document.createElement("input");
      const entry = createEntry(input);
      entry.pendingExtensionEdit = createPendingEdit();
      entry.missingTrailingSpace = true;
      entry.expectedCursorPos = 4;
      entry.expectedCursorPosIsBlockLocal = true;
      entry.expectedCursorPosBlockElement = document.createElement("div");
      entry.expectedCursorPosBlockText = "text";

      clearAcceptedSuggestionTransientState(entry);

      expect(entry.pendingExtensionEdit).toBeNull();
      expect(entry.missingTrailingSpace).toBe(false);
      expect(entry.expectedCursorPos).toBe(0);
      expect(entry.expectedCursorPosIsBlockLocal).toBe(false);
      expect(entry.expectedCursorPosBlockElement).toBeNull();
      expect(entry.expectedCursorPosBlockText).toBeNull();
    });
  });

  describe("keyboard policy", () => {
    test("releases the accepted-suggestion suppression only for literal whitespace input", () => {
      const event: Pick<
        KeyboardEvent,
        "key" | "metaKey" | "ctrlKey" | "altKey" | "isComposing"
      > = {
        key: " ",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
      };

      expect(
        shouldReleaseAcceptedSuggestionSuppressionOnKeydown({
          suppressNextSuggestionInputPrediction: true,
          missingTrailingSpace: true,
          awaitingHostInputEcho: false,
          event,
        }),
      ).toBe(true);
      expect(
        shouldReleaseAcceptedSuggestionSuppressionOnKeydown({
          suppressNextSuggestionInputPrediction: true,
          missingTrailingSpace: true,
          awaitingHostInputEcho: false,
          event: {
            ...event,
            ctrlKey: true,
          },
        }),
      ).toBe(false);
      expect(
        shouldReleaseAcceptedSuggestionSuppressionOnKeydown({
          suppressNextSuggestionInputPrediction: true,
          missingTrailingSpace: true,
          awaitingHostInputEcho: true,
          event,
        }),
      ).toBe(false);
    });

    test("keeps native undo chords but invalidates navigation-based pending edits", () => {
      const undoChord: Pick<
        KeyboardEvent,
        "defaultPrevented" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "key"
      > = {
        key: "z",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        defaultPrevented: false,
      };
      const arrowLeft: Pick<
        KeyboardEvent,
        "defaultPrevented" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "key"
      > = {
        key: "ArrowLeft",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        defaultPrevented: false,
      };
      const home: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey"> = {
        key: "Home",
        metaKey: false,
        ctrlKey: false,
      };

      expect(
        shouldInvalidatePendingExtensionEditOnKeydown(undoChord),
      ).toBe(false);
      expect(
        shouldInvalidatePendingExtensionEditOnKeydown(arrowLeft),
      ).toBe(true);
      expect(shouldDismissSuggestionsOnKeydown(home)).toBe(true);
    });
  });
});
