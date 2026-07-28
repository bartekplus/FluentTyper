import type { PredictionInputAction } from "@core/domain/messageTypes";
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

/**
 * Minimal contenteditable adapter surface needed by cursor-context resolution.
 * The helper keeps this separate from the full adapter class so callers can
 * pass a narrow mock in tests or reuse existing adapters without extra wiring.
 */
export interface SuggestionEntrySessionContentEditableAdapter {
  getBlockContext(elem: HTMLElement): CursorContextBlock | null;
  getBlockContextBySelection(elem: HTMLElement): CursorContextBlock | null;
  isCollapsedSelectionBeforeBlockBoundary(elem: HTMLElement): boolean;
  getPreviousBlockTextBySelection(elem: HTMLElement): string | null;
}

function createEmptySnapshot(): SuggestionSnapshot {
  return {
    beforeCursor: "",
    afterCursor: "",
    cursorOffset: 0,
  };
}

function resolveBlockContext(
  entry: SuggestionEntryCursorContextSource,
  contentEditableAdapter: SuggestionEntrySessionContentEditableAdapter,
): CursorContextBlock | null {
  const blockContext = contentEditableAdapter.getBlockContext(entry.elem as HTMLElement);
  return (
    blockContext ?? contentEditableAdapter.getBlockContextBySelection(entry.elem as HTMLElement)
  );
}

/**
 * Resolves the cursor context used for prediction and grammar processing.
 *
 * The result mirrors SuggestionEntrySession behavior:
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

  const blockContext = resolveBlockContext(entry, contentEditableAdapter);
  if (!blockContext) {
    return {
      beforeCursor: "",
      afterCursor: "",
      snapshot: snapshot ?? createEmptySnapshot(),
      applyContext: {
        beforeCursor: snapshot?.beforeCursor ?? "",
        afterCursor: snapshot?.afterCursor ?? "",
        useFullTextOffsets: true,
      },
      safeForGrammar: false,
    };
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
    return {
      beforeCursor: previousBlockFallback ?? "",
      afterCursor: "",
      snapshot: snapshot ?? createEmptySnapshot(),
      applyContext: {
        beforeCursor: snapshot?.beforeCursor ?? "",
        afterCursor: snapshot?.afterCursor ?? "",
        useFullTextOffsets: true,
      },
      safeForGrammar: false,
    };
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
    return {
      beforeCursor: pendingEdit.replacementText,
      afterCursor: rawAfterCursor.startsWith(pendingEdit.replacementText)
        ? rawAfterCursor.slice(pendingEdit.replacementText.length)
        : rawAfterCursor.length > 0
          ? rawAfterCursor
          : resolvedAfterCursor,
      snapshot: {
        beforeCursor: `${resolvedSnapshot.beforeCursor}${pendingEdit.replacementText}`,
        afterCursor: resolvedSnapshot.afterCursor.slice(pendingEdit.replacementText.length),
        cursorOffset: resolvedSnapshot.cursorOffset + pendingEdit.replacementText.length,
      },
      applyContext: {
        beforeCursor: pendingEdit.replacementText,
        afterCursor: rawAfterCursor.slice(pendingEdit.replacementText.length),
        useFullTextOffsets: false,
      },
      safeForGrammar: true,
    };
  }

  const typedKeyLooksMergedIntoPreviousBlock =
    inputAction !== "delete" &&
    hasMultipleBlockDescendants &&
    beforeBlockBoundary &&
    typeof typedKey === "string" &&
    typedKey.length === 1 &&
    blockContext.beforeCursor === resolvedSnapshot.beforeCursor &&
    (resolvedSnapshot.beforeCursor.endsWith(typedKey) ||
      resolvedSnapshot.beforeCursor.endsWith(typedKey.toLocaleUpperCase()));
  if (typedKeyLooksMergedIntoPreviousBlock) {
    const trailingChar = resolvedSnapshot.beforeCursor.charAt(
      resolvedSnapshot.beforeCursor.length - 1,
    );
    return {
      beforeCursor: trailingChar,
      afterCursor: "",
      snapshot: resolvedSnapshot,
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

/**
 * Resolves the input action used for prediction and grammar scheduling.
 *
 * Resolution order matches SuggestionEntrySession:
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
  const inputEvent = event as Event & { inputType?: unknown };
  const inputType = typeof inputEvent.inputType === "string" ? inputEvent.inputType : "";
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
