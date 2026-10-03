import type { PredictionInputAction } from "@core/domain/messageTypes";
import type { ContentEditableAdapter } from "./ContentEditableAdapter";
import { TextTargetAdapter } from "./TextTargetAdapter";
import type { SuggestionEntry, SuggestionSnapshot } from "./types";

type SuggestionEntryCursorContextSource = Pick<
  SuggestionEntry,
  "elem" | "pendingExtensionEdit" | "hasMultipleBlockDescendants"
>;

type CursorContextBlock = {
  beforeCursor: string;
  afterCursor: string;
};

interface EditableCursorContextApplyContext extends CursorContextBlock {
  useFullTextOffsets: boolean;
}

interface EditableCursorContext {
  beforeCursor: string;
  afterCursor: string;
  snapshot: SuggestionSnapshot;
  applyContext: EditableCursorContextApplyContext | null;
  safeForGrammar: boolean;
}

/** The contenteditable adapter methods that cursor-context resolution uses. */
export type SuggestionEntrySessionContentEditableAdapter = Pick<
  ContentEditableAdapter,
  | "getBlockContext"
  | "getBlockContextBySelection"
  | "isCollapsedSelectionBeforeBlockBoundary"
  | "getPreviousBlockTextBySelection"
>;

function createEmptySnapshot(): SuggestionSnapshot {
  return {
    beforeCursor: "",
    afterCursor: "",
    cursorOffset: 0,
  };
}

/**
 * Resolves the cursor context used for prediction and grammar processing:
 * - text-value snapshots pass through unchanged
 * - empty contenteditable blocks can fall back to the previous block text
 *   while preserving full-text offsets for edits
 * - typed keys can seed empty contenteditable blocks when the leading
 *   character matches the typed character
 * - pending grammar replacements can seed contenteditable contexts
 */
export function resolveEditableCursorContext({
  entry,
  contentEditableAdapter,
  snapshot,
  hasMultipleBlockDescendants,
  inputAction,
  typedKey,
}: {
  entry: SuggestionEntryCursorContextSource;
  contentEditableAdapter: SuggestionEntrySessionContentEditableAdapter;
  snapshot: SuggestionSnapshot | null;
  hasMultipleBlockDescendants: boolean;
  inputAction?: PredictionInputAction;
  typedKey?: string | null;
}): EditableCursorContext {
  if (TextTargetAdapter.isTextValue(entry.elem)) {
    const resolvedSnapshot = snapshot ?? TextTargetAdapter.snapshot(entry.elem);
    return {
      beforeCursor: resolvedSnapshot.beforeCursor,
      afterCursor: resolvedSnapshot.afterCursor,
      snapshot: resolvedSnapshot,
      applyContext: null,
      safeForGrammar: true,
    };
  }

  // No usable block-local context: predict from `beforeCursor` but edit with full-text offsets.
  const fullTextOffsetsContext = (beforeCursor: string): EditableCursorContext => ({
    beforeCursor,
    afterCursor: "",
    snapshot: snapshot ?? createEmptySnapshot(),
    applyContext: {
      beforeCursor: snapshot?.beforeCursor ?? "",
      afterCursor: snapshot?.afterCursor ?? "",
      useFullTextOffsets: true,
    },
    safeForGrammar: false,
  });
  const blockContext =
    contentEditableAdapter.getBlockContext(entry.elem) ??
    contentEditableAdapter.getBlockContextBySelection(entry.elem);
  if (!blockContext) {
    return fullTextOffsetsContext("");
  }

  const beforeBlockBoundary = contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(
    entry.elem,
  );
  const useFullTextOffsets =
    blockContext.beforeCursor.length === 0 &&
    blockContext.afterCursor.length === 0 &&
    beforeBlockBoundary;
  if (useFullTextOffsets) {
    const previousBlockFallback = hasMultipleBlockDescendants
      ? contentEditableAdapter.getPreviousBlockTextBySelection(entry.elem)
      : null;
    return fullTextOffsetsContext(previousBlockFallback ?? "");
  }

  const rawAfterCursor = blockContext.afterCursor;
  const resolvedAfterCursor = beforeBlockBoundary ? "" : rawAfterCursor;
  const resolvedSnapshot =
    snapshot ??
    ({
      beforeCursor: blockContext.beforeCursor,
      afterCursor: resolvedAfterCursor,
      cursorOffset: blockContext.beforeCursor.length,
    } satisfies SuggestionSnapshot);
  const resolvedLeadingChar = rawAfterCursor.charAt(0);
  const snapshotLeadingChar = resolvedSnapshot.afterCursor.charAt(0);
  const typedKeyIsLower =
    typeof typedKey === "string" &&
    typedKey.length === 1 &&
    typedKey !== typedKey.toLocaleUpperCase() &&
    typedKey === typedKey.toLocaleLowerCase();
  const exactKeyMatch = resolvedLeadingChar === typedKey && snapshotLeadingChar === typedKey;
  const capitalizedKeyMatch =
    typedKeyIsLower &&
    resolvedLeadingChar === typedKey.toLocaleUpperCase() &&
    snapshotLeadingChar === typedKey.toLocaleUpperCase();
  const shouldSeedTypedKey =
    inputAction !== "delete" &&
    blockContext.beforeCursor.length === 0 &&
    typeof typedKey === "string" &&
    typedKey.length === 1 &&
    typedKey.trim().length > 0 &&
    resolvedLeadingChar.length === 1 &&
    snapshotLeadingChar.length === 1 &&
    (exactKeyMatch || capitalizedKeyMatch);
  if (shouldSeedTypedKey) {
    return {
      beforeCursor: resolvedLeadingChar,
      afterCursor: rawAfterCursor.slice(resolvedLeadingChar.length),
      snapshot: {
        beforeCursor: `${resolvedSnapshot.beforeCursor}${resolvedLeadingChar}`,
        afterCursor: resolvedSnapshot.afterCursor.slice(snapshotLeadingChar.length),
        cursorOffset: resolvedSnapshot.cursorOffset + resolvedLeadingChar.length,
      },
      applyContext: {
        beforeCursor: resolvedLeadingChar,
        afterCursor: rawAfterCursor.slice(resolvedLeadingChar.length),
        useFullTextOffsets: false,
      },
      safeForGrammar: true,
    };
  }

  const pendingEdit = entry.pendingExtensionEdit;
  const shouldSeedPendingGrammarEdit =
    inputAction !== "delete" &&
    typeof typedKey !== "string" &&
    pendingEdit?.source === "grammar" &&
    blockContext.beforeCursor.length === 0 &&
    pendingEdit.replaceStart === resolvedSnapshot.beforeCursor.length &&
    pendingEdit.replacementText.length > 0 &&
    resolvedAfterCursor.startsWith(pendingEdit.replacementText) &&
    resolvedSnapshot.afterCursor.startsWith(pendingEdit.replacementText);
  const shouldSeedPendingGrammarEditFromMergedSnapshot =
    inputAction !== "delete" &&
    pendingEdit?.source === "grammar" &&
    pendingEdit.replacementText.length > 0 &&
    beforeBlockBoundary &&
    blockContext.beforeCursor === resolvedSnapshot.beforeCursor &&
    resolvedSnapshot.beforeCursor.endsWith(pendingEdit.replacementText);
  if (shouldSeedPendingGrammarEdit || shouldSeedPendingGrammarEditFromMergedSnapshot) {
    const afterCursor = rawAfterCursor.startsWith(pendingEdit.replacementText)
      ? rawAfterCursor.slice(pendingEdit.replacementText.length)
      : rawAfterCursor.length > 0
        ? rawAfterCursor
        : resolvedAfterCursor;
    return {
      beforeCursor: pendingEdit.replacementText,
      afterCursor,
      // A merged snapshot already ends with the replacement.
      snapshot: shouldSeedPendingGrammarEdit
        ? {
            beforeCursor: `${resolvedSnapshot.beforeCursor}${pendingEdit.replacementText}`,
            afterCursor: resolvedSnapshot.afterCursor.slice(pendingEdit.replacementText.length),
            cursorOffset: resolvedSnapshot.cursorOffset + pendingEdit.replacementText.length,
          }
        : resolvedSnapshot,
      applyContext: {
        beforeCursor: pendingEdit.replacementText,
        afterCursor,
        useFullTextOffsets: false,
      },
      safeForGrammar: true,
    };
  }

  const mayBeTypedKeyMergedIntoPreviousBlock =
    inputAction !== "delete" &&
    hasMultipleBlockDescendants &&
    beforeBlockBoundary &&
    typeof typedKey === "string" &&
    typedKey.length === 1;
  // The merge check compares against the whole editor, so it needs a real
  // snapshot: one synthesized from the block always matches the block and
  // drops the text after it (callers such as the input path pass null).
  const fullSnapshot = mayBeTypedKeyMergedIntoPreviousBlock
    ? (snapshot ?? TextTargetAdapter.snapshot(entry.elem))
    : resolvedSnapshot;
  const typedKeyLooksMergedIntoPreviousBlock =
    mayBeTypedKeyMergedIntoPreviousBlock &&
    blockContext.beforeCursor === fullSnapshot.beforeCursor &&
    // A key that leaked out of a freshly split empty block leaves nothing after
    // the caret. Text there (e.g. a signature below the line) means the user
    // is simply typing at the end of this block.
    fullSnapshot.afterCursor.trim().length === 0 &&
    (fullSnapshot.beforeCursor.endsWith(typedKey) ||
      fullSnapshot.beforeCursor.endsWith(typedKey.toLocaleUpperCase()));
  if (typedKeyLooksMergedIntoPreviousBlock) {
    const trailingChar = fullSnapshot.beforeCursor.charAt(fullSnapshot.beforeCursor.length - 1);
    return {
      beforeCursor: trailingChar,
      afterCursor: "",
      snapshot: fullSnapshot,
      applyContext: {
        beforeCursor: trailingChar,
        afterCursor: "",
        useFullTextOffsets: false,
      },
      safeForGrammar: false,
    };
  }

  return {
    beforeCursor: blockContext.beforeCursor,
    afterCursor: resolvedAfterCursor,
    snapshot: resolvedSnapshot,
    applyContext: {
      beforeCursor: blockContext.beforeCursor,
      afterCursor: resolvedAfterCursor,
      useFullTextOffsets: false,
    },
    safeForGrammar: true,
  };
}

export function inputTypeOf(event: Event | undefined): string {
  const inputType = (event as InputEvent | undefined)?.inputType;
  return typeof inputType === "string" ? inputType : "";
}

/**
 * Resolves the input action used for prediction and grammar scheduling, in this order:
 * - event.inputType when available
 * - the last keydown intent
 * - before-cursor length comparison against the previous snapshot
 */
export function resolvePredictionInputAction(
  event: Event,
  currentBeforeCursor: string,
  {
    lastKeydownKey,
    lastBeforeCursorText,
  }: {
    lastKeydownKey: string | null;
    lastBeforeCursorText: string | null;
  },
): PredictionInputAction {
  const inputType = inputTypeOf(event);
  if (inputType.startsWith("delete")) {
    return "delete";
  }
  if (inputType.startsWith("insert")) {
    return "insert";
  }
  if (lastKeydownKey === "Backspace" || lastKeydownKey === "Delete") {
    return "delete";
  }
  if (typeof lastBeforeCursorText === "string") {
    if (currentBeforeCursor.length < lastBeforeCursorText.length) {
      return "delete";
    }
    if (currentBeforeCursor.length > lastBeforeCursorText.length) {
      return "insert";
    }
  }
  return "other";
}
