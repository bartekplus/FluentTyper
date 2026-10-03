import type { ContentEditableAdapter } from "./ContentEditableAdapter";
import { isNativeUndoChord } from "./keyboardShortcuts";
import { TextTargetAdapter } from "./TextTargetAdapter";
import type { ExtensionEditSnapshot, SuggestionEntry } from "./types";

/**
 * Narrow contenteditable surface used to validate accepted-suggestion trailing-space state.
 */
export type AcceptedSuggestionContentEditableAdapter = Pick<
  ContentEditableAdapter,
  "getActiveBlockElement" | "getBlockContext"
>;

type AcceptedSuggestionSpaceState = Pick<
  SuggestionEntry,
  | "missingTrailingSpace"
  | "expectedCursorPos"
  | "expectedCursorPosIsBlockLocal"
  | "expectedCursorPosBlockElement"
  | "expectedCursorPosBlockText"
>;

type AcceptedSuggestionTransientState = AcceptedSuggestionSpaceState &
  Pick<SuggestionEntry, "pendingExtensionEdit">;

export function clearAcceptedSuggestionTransientState(
  state: AcceptedSuggestionTransientState,
): void {
  state.pendingExtensionEdit = null;
  clearAcceptedSuggestionSpaceState(state);
}

export function clearAcceptedSuggestionSpaceState(state: AcceptedSuggestionSpaceState): void {
  state.missingTrailingSpace = false;
  state.expectedCursorPos = 0;
  state.expectedCursorPosIsBlockLocal = false;
  state.expectedCursorPosBlockElement = null;
  state.expectedCursorPosBlockText = null;
}

/**
 * Resolves the accepted-suggestion trailing-space expectation from the inserted text and the
 * character that follows the accepted edit in the host document.
 */
export function resolveAcceptedSuggestionSpaceState(args: {
  entry: Pick<SuggestionEntry, "pendingExtensionEdit">;
  insertSpaceAfterAutocomplete: boolean;
  insertedText: string;
  cursorAfter: number;
  cursorAfterIsBlockLocal: boolean;
}): AcceptedSuggestionSpaceState {
  const trailingCharAfterAccept = resolveTrailingCharAfterAcceptedSuggestion(
    args.cursorAfter,
    args.cursorAfterIsBlockLocal,
    args.entry.pendingExtensionEdit,
  );
  const shouldExpectTrailingSpace =
    args.insertSpaceAfterAutocomplete &&
    !/[ \xA0]$/.test(args.insertedText) &&
    !/[ \xA0]/.test(trailingCharAfterAccept);

  return {
    missingTrailingSpace: shouldExpectTrailingSpace,
    expectedCursorPos: shouldExpectTrailingSpace ? args.cursorAfter : 0,
    expectedCursorPosIsBlockLocal: shouldExpectTrailingSpace && args.cursorAfterIsBlockLocal,
    expectedCursorPosBlockElement:
      shouldExpectTrailingSpace && args.cursorAfterIsBlockLocal
        ? (args.entry.pendingExtensionEdit?.blockElement ?? null)
        : null,
    expectedCursorPosBlockText:
      shouldExpectTrailingSpace && args.cursorAfterIsBlockLocal
        ? (args.entry.pendingExtensionEdit?.postEditBlockText ?? null)
        : null,
  };
}

// ArrowUp and ArrowDown are not here: they move the selection in the suggestion menu.
const CARET_MOVE_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];

function isSelectAll(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
}

export function shouldDismissSuggestionsOnKeydown(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">,
): boolean {
  return isSelectAll(event) || CARET_MOVE_KEYS.includes(event.key);
}

export function shouldInvalidatePendingExtensionEditOnKeydown(
  event: Pick<
    KeyboardEvent,
    "defaultPrevented" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "key"
  >,
): boolean {
  if (isNativeUndoChord(event)) {
    return false;
  }
  return (
    CARET_MOVE_KEYS.includes(event.key) ||
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    isSelectAll(event)
  );
}

/**
 * Returns true when the post-accept suppression can be released by a literal whitespace key.
 */
export function shouldReleaseAcceptedSuggestionSuppressionOnKeydown(args: {
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "isComposing" | "key">;
  suppressNextSuggestionInputPrediction: boolean;
  missingTrailingSpace: boolean;
  awaitingHostInputEcho: boolean;
}): boolean {
  if (
    !args.suppressNextSuggestionInputPrediction ||
    !args.missingTrailingSpace ||
    args.awaitingHostInputEcho
  ) {
    return false;
  }
  if (args.event.metaKey || args.event.ctrlKey || args.event.altKey || args.event.isComposing) {
    return false;
  }
  return args.event.key.length === 1 && /^\s$/u.test(args.event.key);
}

/**
 * Clears block-local trailing-space state once the active block/caret no longer matches.
 */
export function syncAcceptedSuggestionTrailingSpaceState(
  entry: SuggestionEntry,
  contentEditableAdapter: AcceptedSuggestionContentEditableAdapter,
): void {
  if (!entry.missingTrailingSpace || !entry.expectedCursorPosIsBlockLocal) {
    return;
  }
  if (TextTargetAdapter.isTextValue(entry.elem)) {
    return;
  }

  const activeBlock = contentEditableAdapter.getActiveBlockElement(entry.elem);
  const blockContext = contentEditableAdapter.getBlockContext(entry.elem);
  if (
    !activeBlock ||
    !blockContext ||
    activeBlock !== entry.expectedCursorPosBlockElement ||
    `${blockContext.beforeCursor}${blockContext.afterCursor}` !==
      (entry.expectedCursorPosBlockText ?? "") ||
    blockContext.beforeCursor.length !== entry.expectedCursorPos
  ) {
    clearAcceptedSuggestionTransientState(entry);
  }
}

/**
 * The caret block and its text when the caret is still collapsed in the unchanged
 * block of a block-scoped pending edit, between the edit start and the caret after it.
 * Else null.
 */
export function resolveLiveBlockScopedEdit(
  elem: SuggestionEntry["elem"],
  pendingEdit: ExtensionEditSnapshot,
  contentEditableAdapter: AcceptedSuggestionContentEditableAdapter,
): { activeBlock: HTMLElement; blockFullText: string } | null {
  const activeBlock = contentEditableAdapter.getActiveBlockElement(elem);
  const blockContext = contentEditableAdapter.getBlockContext(elem);
  if (
    !activeBlock ||
    !blockContext ||
    !TextTargetAdapter.hasCollapsedSelection(elem) ||
    activeBlock !== (pendingEdit.blockElement ?? null)
  ) {
    return null;
  }
  const blockFullText = `${blockContext.beforeCursor}${blockContext.afterCursor}`;
  return blockFullText === (pendingEdit.postEditBlockText ?? "") &&
    blockContext.beforeCursor.length >= pendingEdit.replaceStart &&
    blockContext.beforeCursor.length <= pendingEdit.cursorAfter
    ? { activeBlock, blockFullText }
    : null;
}

function resolveTrailingCharAfterAcceptedSuggestion(
  cursorAfter: number,
  cursorAfterIsBlockLocal: boolean,
  pendingExtensionEdit: SuggestionEntry["pendingExtensionEdit"],
): string {
  if (!pendingExtensionEdit) {
    return "";
  }
  if (cursorAfterIsBlockLocal && pendingExtensionEdit.blockScoped) {
    return (pendingExtensionEdit.postEditBlockText ?? "").charAt(cursorAfter);
  }
  return pendingExtensionEdit.postEditFingerprint.fullText.charAt(cursorAfter);
}
