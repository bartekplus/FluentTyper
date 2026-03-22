import type { ContentEditableAdapter } from "./ContentEditableAdapter";
import { isNativeUndoChord } from "./keyboardShortcuts";
import { TextTargetAdapter } from "./TextTargetAdapter";
import type { SuggestionEntry } from "./types";

/**
 * Narrow contenteditable surface used to validate accepted-suggestion trailing-space state.
 */
export type SuggestionEntrySessionContentEditableAdapter = Pick<
  ContentEditableAdapter,
  "getActiveBlockElement" | "getBlockContext"
>;

type AcceptedSuggestionTransientState = Pick<
  SuggestionEntry,
  | "pendingExtensionEdit"
  | "missingTrailingSpace"
  | "expectedCursorPos"
  | "expectedCursorPosIsBlockLocal"
  | "expectedCursorPosBlockElement"
  | "expectedCursorPosBlockText"
>;

type AcceptedSuggestionSpaceState = Pick<
  SuggestionEntry,
  | "missingTrailingSpace"
  | "expectedCursorPos"
  | "expectedCursorPosIsBlockLocal"
  | "expectedCursorPosBlockElement"
  | "expectedCursorPosBlockText"
>;

/**
 * Clears the transient state armed after a suggestion accept.
 */
export function clearAcceptedSuggestionTransientState(
  state: AcceptedSuggestionTransientState,
): void {
  state.pendingExtensionEdit = null;
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

/**
 * Returns true for keys that should dismiss the suggestion popup.
 */
export function shouldDismissSuggestionsOnKeydown(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">,
): boolean {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
    return true;
  }
  return ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key);
}

/**
 * Returns true when the pending extension edit should be invalidated by the keydown.
 */
export function shouldInvalidatePendingExtensionEditOnKeydown(
  event: Pick<
    KeyboardEvent,
    "defaultPrevented" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "key"
  >,
): boolean {
  if (isNativeUndoChord(event)) {
    return false;
  }
  if (
    [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ].includes(event.key)
  ) {
    return true;
  }
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
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
  contentEditableAdapter: SuggestionEntrySessionContentEditableAdapter,
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
