import { createLogger } from "@core/application/logging/Logger";
import type { GrammarEdit } from "@core/domain/grammar/types";
import { SPACING_RULES, Spacing } from "@core/domain/spacingRules";
import { ContentEditableAdapter, type ContentEditableEditResult } from "./ContentEditableAdapter";
import { HostEditorAdapterResolver, type HostEditorSession } from "./HostEditorAdapterResolver";
import { CURSOR_MOVE_COUNT_ATTR, CURSOR_MOVE_EVENT } from "./HostEditorBridgeProtocol";
import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import { buildCaretTrace, clipTraceText, collapseTraceWhitespace } from "./traceUtils";
import type {
  ManualAutoFixSuppressionSnapshot,
  SuggestionEntry,
  SuggestionElement,
  SuggestionSnapshot,
} from "./types";

const logger = createLogger("SuggestionTextEditService");
const TRACE_TEXT_LIMIT = 48;
const TRACE_HTML_LIMIT = 220;

/** Strip zero-width filler characters that rich editors inject into the DOM. */
const FILLER_CHARS_REGEX = /\u200B|\u200C|\u200D|\u2060|\uFEFF/g;
function stripFillerChars(value: string): string {
  return value.replace(FILLER_CHARS_REGEX, "");
}

function buildElementSnapshot(
  element: HTMLElement | null,
  beforeCursor: string,
  afterCursor: string,
): Record<string, unknown> | null {
  if (!element) {
    return null;
  }
  const className =
    typeof element.className === "string" ? collapseTraceWhitespace(element.className) : "";
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    className: className || null,
    textLength: (element.textContent ?? "").length,
    caretTrace: buildCaretTrace(beforeCursor, afterCursor, TRACE_TEXT_LIMIT),
    textPreview: clipTraceText(
      collapseTraceWhitespace(element.textContent ?? ""),
      TRACE_TEXT_LIMIT,
    ),
    htmlPreview: clipTraceText(
      collapseTraceWhitespace(element.outerHTML),
      TRACE_HTML_LIMIT,
      "start",
    ),
  };
}

export interface TextEditApplyResult {
  applied: boolean;
  didDispatchInput: boolean;
  suppressedByManualRevert?: boolean;
}

interface AcceptedSuggestionEditResult {
  triggerText: string;
  insertedText: string;
  cursorAfter: number;
  cursorAfterIsBlockLocal: boolean;
}

export interface GrammarEditApplyContext {
  snapshot?: SuggestionSnapshot;
  contentEditableContext?: {
    beforeCursor: string;
    afterCursor: string;
    useFullTextOffsets: boolean;
  } | null;
}

type GrammarEditInput = GrammarEdit & {
  replacementText?: string;
  replaceBackwardCount?: number;
};

export class SuggestionTextEditService {
  private readonly findMentionToken: (beforeCursor: string) => { token: string; start: number };
  private readonly isSeparator: (value: string) => boolean;
  private readonly contentEditableAdapter: ContentEditableAdapter;
  private readonly hostEditorAdapterResolver: HostEditorAdapterResolver;
  private readonly domPreferredGrammarTargets = new WeakSet<HTMLElement>();

  constructor({
    findMentionToken,
    isSeparator,
    contentEditableAdapter = new ContentEditableAdapter(),
    hostEditorAdapterResolver = new HostEditorAdapterResolver(),
  }: {
    findMentionToken: (beforeCursor: string) => { token: string; start: number };
    isSeparator: (value: string) => boolean;
    contentEditableAdapter?: ContentEditableAdapter;
    hostEditorAdapterResolver?: HostEditorAdapterResolver;
  }) {
    this.findMentionToken = findMentionToken;
    this.isSeparator = isSeparator;
    this.contentEditableAdapter = contentEditableAdapter;
    this.hostEditorAdapterResolver = hostEditorAdapterResolver;
  }

  public acceptSuggestion(
    entry: SuggestionEntry,
    suggestion: string,
  ): AcceptedSuggestionEditResult | null {
    entry.pendingExtensionEdit = null;
    entry.manualAutoFixSuppression = null;
    const isTextValueTarget = TextTargetAdapter.isTextValue(entry.elem);
    const blockContext = isTextValueTarget
      ? null
      : this.contentEditableAdapter.getBlockContext(entry.elem);
    const blockTokenInfo = blockContext ? this.findMentionToken(blockContext.beforeCursor) : null;
    if (!isTextValueTarget && blockContext && blockTokenInfo && blockTokenInfo.token.length > 0) {
      return this.acceptContentEditableSuggestion(entry, suggestion, blockContext, blockTokenInfo);
    }

    let snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const tokenInfo = this.findMentionToken(snapshot.beforeCursor);
    const triggerText = tokenInfo.token || entry.latestMentionText;

    if (!isTextValueTarget && triggerText && snapshot.beforeCursor.length === 0) {
      const fullText = entry.elem.textContent ?? "";
      if (fullText.endsWith(triggerText)) {
        snapshot = {
          beforeCursor: fullText,
          afterCursor: "",
          cursorOffset: fullText.length,
        };
      }
    }

    const currentFullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const beforeBlockBoundary =
      !isTextValueTarget &&
      this.contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(entry.elem);
    let replaceEnd = snapshot.beforeCursor.length;
    if (!isTextValueTarget && tokenInfo.token.length === 0) {
      while (replaceEnd > 0 && this.isSeparator(snapshot.beforeCursor.charAt(replaceEnd - 1))) {
        replaceEnd -= 1;
      }
    }
    let replaceStart = Math.max(0, replaceEnd - triggerText.length);

    if (
      !isTextValueTarget &&
      tokenInfo.token.length === 0 &&
      triggerText.length > 0 &&
      entry.latestMentionStart >= 0
    ) {
      const storedStart = entry.latestMentionStart;
      const storedEnd = storedStart + triggerText.length;
      const storedRangeNearCaret = Math.abs(storedEnd - replaceEnd) <= 2;
      if (
        storedRangeNearCaret &&
        storedEnd <= currentFullText.length &&
        storedStart <= replaceEnd &&
        currentFullText.slice(storedStart, storedEnd).toLowerCase() === triggerText.toLowerCase()
      ) {
        replaceStart = storedStart;
        replaceEnd = storedEnd;
      }
    }

    if (!isTextValueTarget && triggerText.length > 0) {
      const selectedTrigger = currentFullText.slice(replaceStart, replaceEnd);
      if (selectedTrigger.toLowerCase() !== triggerText.toLowerCase()) {
        return null;
      }
    }

    const trailingTokenText = beforeBlockBoundary
      ? ""
      : this.findTrailingToken(blockContext?.afterCursor ?? currentFullText.slice(replaceEnd));
    const replacedTokenText = `${triggerText}${trailingTokenText}`;
    const baseReplaceEnd = Math.min(currentFullText.length, replaceEnd + trailingTokenText.length);
    const extraWhitespaceToConsume = this.shouldConsumeFollowingSpace(
      suggestion,
      currentFullText.charAt(baseReplaceEnd),
    )
      ? 1
      : 0;
    const finalReplaceEnd = Math.min(
      currentFullText.length,
      baseReplaceEnd + extraWhitespaceToConsume,
    );
    const consumedTrailingWhitespace = currentFullText.slice(baseReplaceEnd, finalReplaceEnd);
    const replacementText = this.normalizeContentEditableTrailingSpace(entry.elem, suggestion, {
      beforeBlockBoundary,
      endsAtBlockBoundary: finalReplaceEnd >= currentFullText.length,
      hostOwned: false,
    });

    const cursorAfter = replaceStart + replacementText.length;
    const originalText = `${replacedTokenText}${consumedTrailingWhitespace}`;
    logger.debug("Accepting suggestion in text target", {
      suggestionId: entry.id,
      replaceStart,
      replaceEnd: finalReplaceEnd,
      cursorAfter,
      beforeBlockBoundary,
      triggerLength: triggerText.length,
      suggestionLength: suggestion.length,
      replacementLength: replacementText.length,
      consumedTrailingWhitespaceLength: consumedTrailingWhitespace.length,
    });

    entry.pendingExtensionEdit = {
      replaceStart,
      originalText,
      replacementText,
      cursorBefore: snapshot.cursorOffset,
      cursorAfter,
      postEditFingerprint: {
        fullText: `${currentFullText.slice(0, replaceStart)}${replacementText}${currentFullText.slice(finalReplaceEnd)}`,
        cursorOffset: cursorAfter,
        selectionCollapsed: true,
      },
      source: "suggestion",
    };

    const applyResult = this.replaceTextByOffsets(
      entry.elem,
      currentFullText,
      replaceStart,
      finalReplaceEnd,
      replacementText,
      cursorAfter,
    );
    if (!applyResult.didMutateDom) {
      entry.pendingExtensionEdit = null;
      return null;
    }
    const postEditSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);

    if (entry.pendingExtensionEdit) {
      entry.pendingExtensionEdit.cursorAfter = postEditSnapshot.cursorOffset;
      entry.pendingExtensionEdit.postEditFingerprint = TextTargetAdapter.createPostEditFingerprint(
        entry.elem as TextTarget,
        postEditSnapshot,
      );
    }

    return {
      triggerText,
      insertedText: replacementText,
      cursorAfter: postEditSnapshot.cursorOffset,
      cursorAfterIsBlockLocal: false,
    };
  }

  public tryUndoLastExtensionEdit(
    entry: SuggestionEntry,
    event: KeyboardEvent,
    {
      consumeKeyboardEvent,
      clearSuggestions,
    }: {
      consumeKeyboardEvent: (event: KeyboardEvent) => void;
      clearSuggestions: () => void;
    },
  ): boolean {
    return this.tryUndoPendingExtensionEdit(entry, event, {
      consumeEvent: (undoEvent) => consumeKeyboardEvent(undoEvent as KeyboardEvent),
      clearSuggestions,
    });
  }

  public tryUndoLastExtensionEditOnBeforeInput(
    entry: SuggestionEntry,
    event: InputEvent,
    {
      consumeInputEvent,
      clearSuggestions,
    }: {
      consumeInputEvent: (event: InputEvent) => void;
      clearSuggestions: () => void;
    },
  ): boolean {
    if (event.inputType !== "historyUndo") {
      return false;
    }
    return this.tryUndoPendingExtensionEdit(entry, event, {
      consumeEvent: (undoEvent) => consumeInputEvent(undoEvent as InputEvent),
      clearSuggestions,
    });
  }

  private tryUndoPendingExtensionEdit(
    entry: SuggestionEntry,
    event: Event,
    {
      consumeEvent,
      clearSuggestions,
    }: {
      consumeEvent: (event: Event) => void;
      clearSuggestions: () => void;
    },
  ): boolean {
    if (!entry.pendingExtensionEdit) {
      return false;
    }

    if (
      entry.pendingExtensionEdit.blockScoped &&
      !TextTargetAdapter.isTextValue(entry.elem) &&
      (entry.elem as HTMLElement).isContentEditable
    ) {
      return this.tryUndoBlockScopedExtensionEdit(entry, event, {
        consumeEvent,
        clearSuggestions,
      });
    }

    const snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const {
      replaceStart,
      originalText,
      replacementText,
      cursorBefore,
      postEditFingerprint,
      source,
      sourceRuleId,
    } = entry.pendingExtensionEdit;
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceEnd = replaceStart + replacementText.length;

    const isContentEditableGrammar =
      source === "grammar" &&
      "isContentEditable" in entry.elem &&
      (entry.elem as HTMLElement).isContentEditable &&
      TextTargetAdapter.hasCollapsedSelection(entry.elem as TextTarget);

    const fingerprintMatch = isContentEditableGrammar
      ? (() => {
          const actual = TextTargetAdapter.createPostEditFingerprint(
            entry.elem as TextTarget,
            snapshot,
          );
          return (
            actual.fullText === postEditFingerprint.fullText &&
            actual.selectionCollapsed === postEditFingerprint.selectionCollapsed &&
            snapshot.cursorOffset >= replaceStart &&
            snapshot.cursorOffset <= replaceStart + replacementText.length
          );
        })()
      : TextTargetAdapter.matchesPostEditFingerprint(
          entry.elem as TextTarget,
          postEditFingerprint,
          snapshot,
        );

    if (!fingerprintMatch) {
      entry.pendingExtensionEdit = null;
      return false;
    }
    if (
      replaceEnd > fullText.length ||
      fullText.slice(replaceStart, replaceEnd) !== replacementText
    ) {
      entry.pendingExtensionEdit = null;
      return false;
    }

    const manualAutoFixSuppression =
      source === "grammar"
        ? this.createManualAutoFixSuppression({
            ruleKey: this.resolveAutoFixRuleKey(sourceRuleId, originalText, replacementText),
            replaceStart,
            fullText: `${fullText.slice(0, replaceStart)}${originalText}${fullText.slice(replaceEnd)}`,
            cursorOffset: cursorBefore,
          })
        : null;

    entry.pendingExtensionEdit = null;
    entry.manualAutoFixSuppression = manualAutoFixSuppression;

    consumeEvent(event);

    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      originalText,
      cursorBefore,
    );

    clearSuggestions();
    return true;
  }

  private tryUndoBlockScopedExtensionEdit(
    entry: SuggestionEntry,
    event: Event,
    {
      consumeEvent,
      clearSuggestions,
    }: {
      consumeEvent: (event: Event) => void;
      clearSuggestions: () => void;
    },
  ): boolean {
    const pendingEdit = entry.pendingExtensionEdit;
    if (!pendingEdit?.blockScoped) {
      return false;
    }

    const activeBlock = this.contentEditableAdapter.getActiveBlockElement(
      entry.elem as HTMLElement,
    );
    const blockContext = this.contentEditableAdapter.getBlockContext(entry.elem as HTMLElement);
    if (
      !activeBlock ||
      !blockContext ||
      !TextTargetAdapter.hasCollapsedSelection(entry.elem as TextTarget) ||
      activeBlock !== (pendingEdit.blockElement ?? null)
    ) {
      entry.pendingExtensionEdit = null;
      return false;
    }

    const blockFullText = `${blockContext.beforeCursor}${blockContext.afterCursor}`;
    const replaceEnd = pendingEdit.replaceStart + pendingEdit.replacementText.length;
    if (
      (pendingEdit.postEditBlockText ?? "") !== blockFullText ||
      blockContext.beforeCursor.length < pendingEdit.replaceStart ||
      blockContext.beforeCursor.length > pendingEdit.cursorAfter
    ) {
      entry.pendingExtensionEdit = null;
      return false;
    }
    if (
      replaceEnd > blockFullText.length ||
      blockFullText.slice(pendingEdit.replaceStart, replaceEnd) !== pendingEdit.replacementText
    ) {
      entry.pendingExtensionEdit = null;
      return false;
    }

    entry.pendingExtensionEdit = null;

    consumeEvent(event);

    this.replaceTextByOffsets(
      entry.elem,
      blockFullText,
      pendingEdit.replaceStart,
      replaceEnd,
      pendingEdit.originalText,
      pendingEdit.cursorBefore,
      { scopeRoot: activeBlock },
    );

    clearSuggestions();
    return true;
  }

  public syncManualAutoFixSuppression(
    entry: SuggestionEntry,
    snapshotOverride?: SuggestionSnapshot,
  ): void {
    if (!entry.manualAutoFixSuppression) {
      return;
    }
    const snapshot = snapshotOverride ?? TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const tokenContext = this.resolveTokenContext(fullText, snapshot.cursorOffset);
    if (
      tokenContext.tokenStart !== entry.manualAutoFixSuppression.tokenStart ||
      tokenContext.tokenText !== entry.manualAutoFixSuppression.tokenText
    ) {
      entry.manualAutoFixSuppression = null;
    }
  }

  public applyGrammarEdit(
    entry: SuggestionEntry,
    edit: GrammarEditInput,
    context: GrammarEditApplyContext = {},
  ): TextEditApplyResult {
    const replacement =
      typeof edit.replacement === "string"
        ? edit.replacement
        : typeof edit.replacementText === "string"
          ? edit.replacementText
          : "";
    const deleteBackwards =
      typeof edit.deleteBackwards === "number" && Number.isFinite(edit.deleteBackwards)
        ? Math.max(0, edit.deleteBackwards)
        : typeof edit.replaceBackwardCount === "number" &&
            Number.isFinite(edit.replaceBackwardCount)
          ? Math.max(0, edit.replaceBackwardCount)
          : 0;
    const deleteForwards =
      typeof edit.deleteForwards === "number" && Number.isFinite(edit.deleteForwards)
        ? Math.max(0, edit.deleteForwards)
        : 0;
    const snapshot: SuggestionSnapshot =
      context.snapshot ?? TextTargetAdapter.snapshot(entry.elem as TextTarget);
    this.syncManualAutoFixSuppression(entry, snapshot);
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;

    let replaceStart = Math.max(0, snapshot.beforeCursor.length - deleteBackwards);
    let replaceEnd = Math.max(
      replaceStart,
      Math.min(fullText.length, snapshot.beforeCursor.length + deleteForwards),
    );
    let blockReplaceStart: number | null = null;
    let blockReplaceEnd: number | null = null;
    let blockCursorAfter: number | null = null;
    let blockSourceText: string | null = null;
    let expectedBlockText: string | null = null;
    let expectedBlockCursorAfter: number | null = null;
    let activeBlock: HTMLElement | null = null;

    if (!TextTargetAdapter.isTextValue(entry.elem)) {
      const providedContentEditableContext = context.contentEditableContext;
      const blockContext =
        providedContentEditableContext ?? this.contentEditableAdapter.getBlockContext(entry.elem);
      const useFullTextOffsets =
        providedContentEditableContext?.useFullTextOffsets ??
        (blockContext !== null &&
          blockContext.beforeCursor.length === 0 &&
          blockContext.afterCursor.length === 0 &&
          this.contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(entry.elem));
      if (!blockContext) {
        return { applied: false, didDispatchInput: false };
      }
      if (!useFullTextOffsets) {
        const blockStart = snapshot.beforeCursor.length - blockContext.beforeCursor.length;
        const blockCursor = blockContext.beforeCursor.length;
        const blockEnd =
          blockStart + blockContext.beforeCursor.length + blockContext.afterCursor.length;
        if (blockStart < 0 || blockEnd > fullText.length) {
          return { applied: false, didDispatchInput: false };
        }

        blockReplaceStart = Math.max(0, blockCursor - deleteBackwards);
        blockReplaceEnd = Math.max(
          blockReplaceStart,
          Math.min(
            blockContext.beforeCursor.length + blockContext.afterCursor.length,
            blockCursor + deleteForwards,
          ),
        );
        blockSourceText = `${blockContext.beforeCursor}${blockContext.afterCursor}`;
        expectedBlockText = blockSourceText;
        expectedBlockText = `${expectedBlockText.slice(0, blockReplaceStart)}${replacement}${expectedBlockText.slice(blockReplaceEnd)}`;
        expectedBlockCursorAfter =
          edit.cursorOffset !== undefined
            ? blockReplaceStart + Math.max(0, Math.min(replacement.length, edit.cursorOffset))
            : this.resolveCursorAfterTextEdit(
                blockCursor,
                blockReplaceStart,
                blockReplaceEnd,
                replacement,
              );
        blockCursorAfter = expectedBlockCursorAfter;

        replaceStart = Math.max(0, blockStart + blockCursor - deleteBackwards);
        replaceEnd = Math.max(
          replaceStart,
          Math.min(fullText.length, blockStart + blockCursor + deleteForwards),
        );
        activeBlock = this.contentEditableAdapter.getActiveBlockElement(entry.elem as HTMLElement);
      }
    }
    const expectedFullText = `${fullText.slice(0, replaceStart)}${replacement}${fullText.slice(replaceEnd)}`;

    const originalText = fullText.slice(replaceStart, replaceEnd);
    const sourceRuleKey = this.resolveAutoFixRuleKey(edit.sourceRuleId, originalText, replacement);
    if (
      entry.manualAutoFixSuppression &&
      entry.manualAutoFixSuppression.ruleKey === sourceRuleKey &&
      entry.manualAutoFixSuppression.replaceStart === replaceStart
    ) {
      logger.debug("Skipping textEdit due to manual revert suppression lock", {
        sourceRuleKey,
        replaceStart,
      });
      return { applied: false, didDispatchInput: false, suppressedByManualRevert: true };
    }

    const cursorAfter =
      edit.cursorOffset !== undefined
        ? replaceStart + Math.max(0, Math.min(replacement.length, edit.cursorOffset))
        : this.resolveCursorAfterTextEdit(
            snapshot.cursorOffset,
            replaceStart,
            replaceEnd,
            replacement,
          );
    let applyResult:
      | ContentEditableEditResult
      | { didMutateDom: boolean; didDispatchInput: boolean }
      | null = null;
    if (
      !TextTargetAdapter.isTextValue(entry.elem) &&
      activeBlock !== null &&
      blockReplaceStart !== null &&
      blockReplaceEnd !== null &&
      blockCursorAfter !== null &&
      blockSourceText !== null
    ) {
      const blockContext =
        context.contentEditableContext ??
        this.contentEditableAdapter.getBlockContext(entry.elem as HTMLElement);
      if (blockContext) {
        const hostEditorSession = this.resolveHostEditorSession(entry.elem as HTMLElement, {
          beforeCursor: blockContext.beforeCursor,
          afterCursor: blockContext.afterCursor,
          blockText: blockSourceText,
        });
        if (hostEditorSession) {
          const hostResult = hostEditorSession.applyBlockReplacement({
            replaceStart: blockReplaceStart,
            replaceEnd: blockReplaceEnd,
            replacementText: replacement,
            cursorAfter: blockCursorAfter,
          });
          if (hostResult.applied) {
            applyResult = {
              didMutateDom: true,
              didDispatchInput: hostResult.didDispatchInput,
            };
          }
        }
        if (applyResult === null) {
          applyResult = this.tryHostGrammarEditWithMissingLeadingRange(
            entry.elem as HTMLElement,
            blockSourceText,
            blockReplaceStart,
            blockReplaceEnd,
            replacement,
            blockCursorAfter,
          );
        }
        if (applyResult === null) {
          applyResult = this.tryHostGrammarEditWithMatchingBlockText(
            entry.elem as HTMLElement,
            blockSourceText,
            blockReplaceStart,
            blockReplaceEnd,
            replacement,
            blockCursorAfter,
          );
        }
        if (applyResult === null) {
          // The primary match may fail when getBlockContext returns a
          // BR-separated line but the host editor (e.g. CKEditor-5) uses
          // the full paragraph block.  Translate local offsets into the
          // host's full-block coordinate space and retry.
          applyResult = this.tryHostGrammarEditWithFullBlockOffsets(
            entry.elem as HTMLElement,
            blockSourceText,
            blockReplaceStart,
            blockReplaceEnd,
            replacement,
            blockCursorAfter,
          );
        }
      }
    }
    if (applyResult === null) {
      applyResult =
        !TextTargetAdapter.isTextValue(entry.elem) &&
        activeBlock !== null &&
        blockReplaceStart !== null &&
        blockReplaceEnd !== null &&
        blockCursorAfter !== null
          ? this.replaceTextByOffsets(
              entry.elem,
              blockSourceText ?? "",
              blockReplaceStart,
              blockReplaceEnd,
              replacement,
              blockCursorAfter,
              {
                preferDomMutation: this.shouldPreferDomMutationForGrammar(entry.elem),
                scopeRoot: activeBlock,
              },
            )
          : this.replaceTextByOffsets(
              entry.elem,
              fullText,
              replaceStart,
              replaceEnd,
              replacement,
              cursorAfter,
              { preferDomMutation: this.shouldPreferDomMutationForGrammar(entry.elem) },
            );
    }
    // For edits with cursorOffset on contenteditable, schedule deferred cursor
    // repositioning BEFORE the didMutateDom check. React-based editors (Lexical,
    // Slate) handle beforeinput by calling preventDefault() and reconciling the
    // DOM asynchronously via microtask. This means didMutateDom is false at check
    // time even though the edit WILL be applied. The deferred callback validates
    // that the expected text appeared before moving the cursor.
    if (edit.cursorOffset !== undefined && !TextTargetAdapter.isTextValue(entry.elem)) {
      const moveBackCount = replacement.length - edit.cursorOffset;
      if (moveBackCount > 0) {
        const targetElem = entry.elem as HTMLElement;
        // React-based editors (Lexical, Slate) reconcile the DOM asynchronously
        // and override cursor positions set via setCaret. Dispatch a bridge event
        // to the main-world script which calls Selection.modify() there. Running
        // in the main world triggers native selectionchange events that host
        // editors detect and use to sync their internal selection state.
        let applied = false;
        const applyModify = () => {
          if (applied || !targetElem.isConnected) {
            return;
          }
          // Validate that the replacement text actually appeared in the DOM
          // before moving the cursor. This distinguishes async host reconciliation
          // (Lexical) from true edit rejection.
          const currentText = targetElem.textContent ?? "";
          if (!currentText.includes(replacement)) {
            return;
          }
          applied = true;
          targetElem.setAttribute(CURSOR_MOVE_COUNT_ATTR, String(moveBackCount));
          targetElem.dispatchEvent(
            new CustomEvent(CURSOR_MOVE_EVENT, { bubbles: true, composed: true }),
          );
          targetElem.removeAttribute(CURSOR_MOVE_COUNT_ATTR);
        };
        // Schedule at multiple timing points to cover different editor
        // reconciliation strategies. Only the first successful one applies.
        requestAnimationFrame(applyModify);
        setTimeout(applyModify, 30);
      }
    }

    if (!applyResult.didMutateDom) {
      return {
        applied: false,
        didDispatchInput: false,
      };
    }

    let postEditSnapshot: SuggestionSnapshot | null =
      !TextTargetAdapter.isTextValue(entry.elem) &&
      activeBlock !== null &&
      expectedBlockText !== null &&
      (activeBlock.textContent ?? "") === expectedBlockText
        ? {
            beforeCursor: expectedFullText.slice(0, cursorAfter),
            afterCursor: expectedFullText.slice(cursorAfter),
            cursorOffset: cursorAfter,
          }
        : null;
    if (postEditSnapshot === null) {
      postEditSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    }
    let finalApplyResult = applyResult;

    if (
      !TextTargetAdapter.isTextValue(entry.elem) &&
      !this.shouldPreferDomMutationForGrammar(entry.elem) &&
      !this.matchesExpectedGrammarResult(postEditSnapshot, expectedFullText, cursorAfter)
    ) {
      const corrected = this.correctContentEditableGrammarMismatch(entry, {
        expectedFullText,
        expectedCursorAfter: cursorAfter,
        expectedBlockText,
        expectedBlockCursorAfter,
      });
      if (corrected) {
        this.domPreferredGrammarTargets.add(entry.elem as HTMLElement);
        finalApplyResult = corrected.applyResult;
        postEditSnapshot = corrected.postEditSnapshot;
      }
    }

    entry.pendingExtensionEdit = {
      replaceStart,
      originalText,
      replacementText: replacement,
      cursorBefore: snapshot.cursorOffset,
      cursorAfter: postEditSnapshot.cursorOffset,
      postEditFingerprint: TextTargetAdapter.createPostEditFingerprint(
        entry.elem as TextTarget,
        postEditSnapshot,
      ),
      source: "grammar",
      sourceRuleId: edit.sourceRuleId,
    };
    return {
      applied: true,
      didDispatchInput: finalApplyResult.didDispatchInput,
    };
  }

  public handleMissingSpaceAfterAccept(
    entry: SuggestionEntry,
    event: KeyboardEvent,
    consumeKeyboardEvent: (event: KeyboardEvent) => void,
  ): void {
    if (!entry.missingTrailingSpace) {
      return;
    }

    const key = event.key;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Escape"].includes(key)) {
      return;
    }

    const isTextValueTarget = TextTargetAdapter.isTextValue(entry.elem);
    const activeBlock =
      !isTextValueTarget && entry.expectedCursorPosIsBlockLocal
        ? this.contentEditableAdapter.getActiveBlockElement(entry.elem as HTMLElement)
        : null;
    const blockContext =
      activeBlock !== null
        ? this.contentEditableAdapter.getBlockContext(entry.elem as HTMLElement)
        : null;
    const snapshot =
      isTextValueTarget || !entry.expectedCursorPosIsBlockLocal
        ? TextTargetAdapter.snapshot(entry.elem as TextTarget)
        : null;
    const currentCursorOffset =
      blockContext !== null ? blockContext.beforeCursor.length : (snapshot?.cursorOffset ?? -1);
    const blockStateMatches =
      !entry.expectedCursorPosIsBlockLocal ||
      (activeBlock !== null &&
        activeBlock === entry.expectedCursorPosBlockElement &&
        `${blockContext?.beforeCursor ?? ""}${blockContext?.afterCursor ?? ""}` ===
          (entry.expectedCursorPosBlockText ?? ""));

    logger.debug("Evaluating delayed post-accept spacing", {
      suggestionId: entry.id,
      key,
      expectedCursorPos: entry.expectedCursorPos,
      expectedCursorPosIsBlockLocal: entry.expectedCursorPosIsBlockLocal,
      currentCursorOffset,
      blockStateMatches,
      beforeCursorLength: (blockContext?.beforeCursor ?? snapshot?.beforeCursor ?? "").length,
      afterCursorLength: (blockContext?.afterCursor ?? snapshot?.afterCursor ?? "").length,
      hasActiveBlock: activeBlock !== null,
    });

    if (!blockStateMatches || currentCursorOffset !== entry.expectedCursorPos || key.length > 1) {
      logger.debug("Clearing delayed post-accept spacing state", {
        suggestionId: entry.id,
        reason: !blockStateMatches
          ? "block_state_mismatch"
          : currentCursorOffset !== entry.expectedCursorPos
            ? "cursor_mismatch"
            : "non_character_key",
        key,
      });
      this.clearMissingTrailingSpaceState(entry);
      return;
    }

    if (!(key.length === 1 && key.trim().length > 0)) {
      if (key.length === 1) {
        this.clearMissingTrailingSpaceState(entry);
      }
      return;
    }

    this.clearMissingTrailingSpaceState(entry);

    const beforeCursor = blockContext?.beforeCursor ?? snapshot?.beforeCursor ?? "";
    const afterCursor = blockContext?.afterCursor ?? snapshot?.afterCursor ?? "";
    const charBeforeCursor = beforeCursor.charAt(beforeCursor.length - 1) || "";
    if (!charBeforeCursor || /\s/.test(charBeforeCursor)) {
      return;
    }

    const spacingRule = SPACING_RULES[key];
    if (
      spacingRule &&
      (spacingRule.spaceBefore === Spacing.REMOVE_SPACE ||
        spacingRule.spaceBefore === Spacing.NO_CHANGE)
    ) {
      return;
    }

    const fullText = `${beforeCursor}${afterCursor}`;
    const replaceStart = beforeCursor.length;
    const replaceEnd = replaceStart;
    const replacementText = ` ${key}`;
    const cursorAfter = replaceStart + replacementText.length;
    const hostEditorSession =
      activeBlock !== null
        ? this.resolveHostEditorSession(entry.elem as HTMLElement, {
            beforeCursor,
            afterCursor,
            blockText: fullText,
          })
        : null;

    consumeKeyboardEvent(event);
    logger.debug("Applying delayed post-accept spacing", {
      suggestionId: entry.id,
      key,
      replaceStart,
      replaceEnd,
      cursorAfter,
      replacementLength: replacementText.length,
      isBlockLocal: activeBlock !== null,
    });

    if (hostEditorSession) {
      const result = hostEditorSession.applyBlockReplacement({
        replaceStart,
        replaceEnd,
        replacementText,
        cursorAfter,
      });
      if (result.applied) {
        return;
      }
    }

    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
      {
        scopeRoot: activeBlock,
      },
    );
  }

  private clearMissingTrailingSpaceState(entry: SuggestionEntry): void {
    entry.missingTrailingSpace = false;
    entry.expectedCursorPos = 0;
    entry.expectedCursorPosIsBlockLocal = false;
    entry.expectedCursorPosBlockElement = null;
    entry.expectedCursorPosBlockText = null;
  }

  private findTrailingToken(afterCursor: string): string {
    let end = 0;
    while (end < afterCursor.length) {
      const current = afterCursor.charAt(end);
      if (this.isSeparator(current)) {
        break;
      }
      end += 1;
    }
    return afterCursor.slice(0, end);
  }

  private shouldConsumeFollowingSpace(insertedSuggestion: string, nextChar: string): boolean {
    if (!insertedSuggestion || !nextChar) {
      return false;
    }
    const endsWithSpace = /[ \xA0]$/.test(insertedSuggestion);
    const nextIsSpace = /[ \xA0]/.test(nextChar);
    return endsWithSpace && nextIsSpace;
  }

  private createManualAutoFixSuppression({
    ruleKey,
    replaceStart,
    fullText,
    cursorOffset,
  }: {
    ruleKey: string;
    replaceStart: number;
    fullText: string;
    cursorOffset: number;
  }): ManualAutoFixSuppressionSnapshot {
    const tokenContext = this.resolveTokenContext(fullText, cursorOffset);
    return {
      ruleKey,
      replaceStart,
      tokenStart: tokenContext.tokenStart,
      tokenText: tokenContext.tokenText,
    };
  }

  private resolveTokenContext(
    fullText: string,
    cursorOffset: number,
  ): { tokenStart: number; tokenText: string } {
    const boundedCursor = Math.max(0, Math.min(fullText.length, cursorOffset));
    let anchor = boundedCursor;
    while (anchor > 0 && this.isSeparator(fullText.charAt(anchor - 1))) {
      anchor -= 1;
    }
    let tokenStart = anchor;
    while (tokenStart > 0 && !this.isSeparator(fullText.charAt(tokenStart - 1))) {
      tokenStart -= 1;
    }
    let tokenEnd = anchor;
    while (tokenEnd < fullText.length && !this.isSeparator(fullText.charAt(tokenEnd))) {
      tokenEnd += 1;
    }
    return {
      tokenStart,
      tokenText: fullText.slice(tokenStart, tokenEnd),
    };
  }

  private resolveAutoFixRuleKey(
    sourceRuleId: string | undefined,
    originalText: string,
    replacementText: string,
  ): string {
    if (typeof sourceRuleId === "string" && sourceRuleId.trim().length > 0) {
      return sourceRuleId;
    }
    return `fallback:${originalText}->${replacementText}`;
  }

  private resolveCursorAfterTextEdit(
    currentCursorOffset: number,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
  ): number {
    if (currentCursorOffset <= replaceEnd) {
      return replaceStart + replacementText.length;
    }

    const replacedLength = Math.max(0, replaceEnd - replaceStart);
    const delta = replacementText.length - replacedLength;
    return Math.max(replaceStart + replacementText.length, currentCursorOffset + delta);
  }

  private normalizeComparableBlockText(value: string): string {
    return value.replaceAll("\xA0", " ");
  }

  private replaceTextByOffsets(
    elem: SuggestionElement,
    fullText: string,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
    options: { preferDomMutation?: boolean; scopeRoot?: HTMLElement | null } = {},
  ): ContentEditableEditResult | { didMutateDom: boolean; didDispatchInput: boolean } {
    const boundedStart = Math.max(0, Math.min(fullText.length, replaceStart));
    const boundedEnd = Math.max(boundedStart, Math.min(fullText.length, replaceEnd));
    const updatedText = `${fullText.slice(0, boundedStart)}${replacementText}${fullText.slice(boundedEnd)}`;

    if (TextTargetAdapter.isTextValue(elem)) {
      const beforeValue = elem.value ?? "";
      if (updatedText === beforeValue) {
        return {
          didMutateDom: false,
          didDispatchInput: false,
        };
      }
      try {
        elem.setRangeText(replacementText, boundedStart, boundedEnd, "end");
        elem.setSelectionRange(cursorAfter, cursorAfter);
      } catch {
        elem.value = updatedText;
        elem.selectionStart = cursorAfter;
        elem.selectionEnd = cursorAfter;
      }
      this.dispatchInputEvent(elem);
      return {
        didMutateDom: true,
        didDispatchInput: true,
      };
    }

    return this.contentEditableAdapter.replaceTextByOffsets(
      elem,
      boundedStart,
      boundedEnd,
      replacementText,
      cursorAfter,
      options,
    );
  }

  private normalizeContentEditableTrailingSpace(
    elem: SuggestionElement,
    replacementText: string,
    {
      beforeBlockBoundary,
      endsAtBlockBoundary,
      hostOwned,
    }: {
      beforeBlockBoundary: boolean;
      endsAtBlockBoundary: boolean;
      hostOwned: boolean;
    },
  ): string {
    if (
      TextTargetAdapter.isTextValue(elem) ||
      hostOwned ||
      !/ $/.test(replacementText) ||
      (!beforeBlockBoundary && !endsAtBlockBoundary)
    ) {
      return replacementText;
    }

    // Rich editors can drop a plain trailing space when an insertion lands
    // immediately before a nested block or at the end of a block. NBSP
    // preserves the visible gap and keeps the next typed character separated.
    return `${replacementText.slice(0, -1)}\xA0`;
  }

  private shouldPreferDomMutationForGrammar(elem: SuggestionElement): boolean {
    if (TextTargetAdapter.isTextValue(elem)) {
      return false;
    }
    return this.domPreferredGrammarTargets.has(elem as HTMLElement);
  }

  private matchesExpectedGrammarResult(
    snapshot: SuggestionSnapshot,
    expectedFullText: string,
    expectedCursorAfter: number,
  ): boolean {
    return (
      `${snapshot.beforeCursor}${snapshot.afterCursor}` === expectedFullText &&
      snapshot.cursorOffset === expectedCursorAfter
    );
  }

  /**
   * Fallback for grammar edits when the primary host session match fails.
   *
   * This handles editors like CKEditor-5 whose model block spans the entire
   * paragraph while FluentTyper returns a BR-separated line context.  We
   * resolve the host session without a parity check, locate where the
   * BR-separated line sits inside the host's full block text, translate the
   * local offsets, and apply via the host API.
   */
  private tryHostGrammarEditWithFullBlockOffsets(
    elem: HTMLElement,
    brLineText: string,
    localReplaceStart: number,
    localReplaceEnd: number,
    replacementText: string,
    localCursorAfter: number,
  ): { didMutateDom: boolean; didDispatchInput: boolean } | null {
    const session = this.hostEditorAdapterResolver.resolve(elem);
    if (!session) {
      return null;
    }
    const hostBlockContext = session.getBlockContextAtSelection();
    if (!hostBlockContext) {
      return null;
    }
    const hostBlockText = hostBlockContext.blockText;
    // Strip zero-width filler characters that CKEditor-5 inserts in the DOM
    // but that don't exist in its model text.
    const cleanBrLineText = stripFillerChars(brLineText);
    if (hostBlockText === cleanBrLineText) {
      return null;
    }
    // The BR-separated line should appear as a substring of the host's full
    // block text.  We locate it by anchoring on the cursor position: the host
    // reports beforeCursor whose suffix must match the BR-line beforeCursor.
    const cleanBrBefore = stripFillerChars(brLineText.slice(0, localReplaceEnd));
    const hostBefore = this.normalizeComparableBlockText(hostBlockContext.beforeCursor);
    if (!hostBefore.endsWith(this.normalizeComparableBlockText(cleanBrBefore))) {
      return null;
    }
    const lineOffset = hostBefore.length - cleanBrBefore.length;
    // Recompute local offsets in terms of the clean (filler-stripped) text
    // by counting only the filler characters that precede each position.
    const fillersBeforeOffset = (offset: number): number =>
      brLineText.slice(0, offset).length - stripFillerChars(brLineText.slice(0, offset)).length;
    const cleanReplaceStart = Math.max(
      0,
      localReplaceStart - fillersBeforeOffset(localReplaceStart),
    );
    const cleanReplaceEnd = Math.max(0, localReplaceEnd - fillersBeforeOffset(localReplaceEnd));
    const cleanCursorAfter = Math.max(0, localCursorAfter - fillersBeforeOffset(localCursorAfter));
    const fullReplaceStart = lineOffset + cleanReplaceStart;
    const fullReplaceEnd = lineOffset + cleanReplaceEnd;
    const fullCursorAfter = lineOffset + cleanCursorAfter;
    if (fullReplaceStart < 0 || fullReplaceEnd > hostBlockText.length || fullCursorAfter < 0) {
      return null;
    }
    // Verify the text at the computed range matches what we expect to replace.
    const textAtRange = hostBlockText.slice(fullReplaceStart, fullReplaceEnd);
    const expectedText = stripFillerChars(brLineText.slice(localReplaceStart, localReplaceEnd));
    if (
      this.normalizeComparableBlockText(textAtRange) !==
      this.normalizeComparableBlockText(expectedText)
    ) {
      return null;
    }
    const hostResult = session.applyBlockReplacement({
      replaceStart: fullReplaceStart,
      replaceEnd: fullReplaceEnd,
      replacementText,
      cursorAfter: fullCursorAfter,
    });
    if (!hostResult.applied) {
      return null;
    }
    return {
      didMutateDom: true,
      didDispatchInput: hostResult.didDispatchInput,
    };
  }

  private tryHostGrammarEditWithMatchingBlockText(
    elem: HTMLElement,
    blockText: string,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ): { didMutateDom: boolean; didDispatchInput: boolean } | null {
    const session = this.hostEditorAdapterResolver.resolve(elem);
    if (!session) {
      return null;
    }
    const hostBlockContext = session.getBlockContextAtSelection();
    if (!hostBlockContext) {
      return null;
    }
    if (
      this.normalizeComparableBlockText(hostBlockContext.blockText) !==
      this.normalizeComparableBlockText(blockText)
    ) {
      return null;
    }

    const hostSlice = hostBlockContext.blockText.slice(replaceStart, replaceEnd);
    const expectedSlice = blockText.slice(replaceStart, replaceEnd);
    if (
      this.normalizeComparableBlockText(hostSlice) !==
      this.normalizeComparableBlockText(expectedSlice)
    ) {
      return null;
    }

    const hostResult = session.applyBlockReplacement({
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
    });
    if (!hostResult.applied) {
      return null;
    }
    return {
      didMutateDom: true,
      didDispatchInput: hostResult.didDispatchInput,
    };
  }

  private tryHostGrammarEditWithMissingLeadingRange(
    elem: HTMLElement,
    blockText: string,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ): { didMutateDom: boolean; didDispatchInput: boolean } | null {
    if (replaceStart !== 0 || blockText.length < 1) {
      return null;
    }

    const session = this.hostEditorAdapterResolver.resolve(elem);
    if (!session) {
      return null;
    }
    const hostBlockContext = session.getBlockContextAtSelection();
    if (!hostBlockContext) {
      return null;
    }

    const hostBlockText = this.normalizeComparableBlockText(hostBlockContext.blockText);
    const expectedTail = this.normalizeComparableBlockText(
      `${blockText.slice(0, replaceStart)}${blockText.slice(replaceEnd)}`,
    );
    if (hostBlockText !== expectedTail) {
      return null;
    }

    const hostResult = session.applyBlockReplacement({
      replaceStart,
      replaceEnd: replaceStart,
      replacementText,
      cursorAfter,
    });
    if (!hostResult.applied) {
      return null;
    }
    return {
      didMutateDom: true,
      didDispatchInput: hostResult.didDispatchInput,
    };
  }

  private resolveHostEditorSession(
    elem: HTMLElement,
    expectedBlockContext: {
      beforeCursor: string;
      afterCursor: string;
      blockText: string;
    },
  ): HostEditorSession | null {
    const session = this.hostEditorAdapterResolver.resolve(elem);
    if (!session) {
      return null;
    }
    const hostBlockContext = session.getBlockContextAtSelection();
    if (!hostBlockContext) {
      return null;
    }
    if (
      this.normalizeComparableBlockText(hostBlockContext.blockText) !==
        this.normalizeComparableBlockText(expectedBlockContext.blockText) ||
      this.normalizeComparableBlockText(hostBlockContext.beforeCursor) !==
        this.normalizeComparableBlockText(expectedBlockContext.beforeCursor) ||
      this.normalizeComparableBlockText(hostBlockContext.afterCursor) !==
        this.normalizeComparableBlockText(expectedBlockContext.afterCursor)
    ) {
      return null;
    }
    return session;
  }

  private applyContentEditableSuggestionEdit({
    elem,
    blockSourceText,
    replaceStart,
    replaceEnd,
    replacementText,
    cursorAfter,
    activeBlock,
    hostEditorSession,
  }: {
    elem: SuggestionElement;
    blockSourceText: string;
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
    cursorAfter: number;
    activeBlock: HTMLElement;
    hostEditorSession: HostEditorSession | null;
  }): ContentEditableEditResult | { didMutateDom: boolean; didDispatchInput: boolean } {
    if (hostEditorSession) {
      const result = hostEditorSession.applyBlockReplacement({
        replaceStart,
        replaceEnd,
        replacementText,
        cursorAfter,
      });
      return {
        didMutateDom: result.applied,
        didDispatchInput: result.didDispatchInput,
      };
    }

    // When the primary host session match failed (e.g. BR-separated line
    // context vs CKEditor-5 full-block), try with translated offsets.
    const fallbackResult = this.tryHostGrammarEditWithFullBlockOffsets(
      elem as HTMLElement,
      blockSourceText,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
    );
    if (fallbackResult) {
      return fallbackResult;
    }

    const initialApplyResult = this.replaceTextByOffsets(
      elem,
      blockSourceText,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
      { scopeRoot: activeBlock },
    );
    return initialApplyResult;
  }

  private acceptContentEditableSuggestion(
    entry: SuggestionEntry,
    suggestion: string,
    blockContext: { beforeCursor: string; afterCursor: string },
    blockTokenInfo: { token: string; start: number },
  ): AcceptedSuggestionEditResult | null {
    const startedAt =
      typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
    const activeBlock = this.contentEditableAdapter.getActiveBlockElement(
      entry.elem as HTMLElement,
    );
    if (!activeBlock) {
      return null;
    }

    const triggerText = blockTokenInfo.token || entry.latestMentionText;
    const beforeBlockBoundary = this.contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(
      entry.elem,
    );
    const blockSourceText = `${blockContext.beforeCursor}${blockContext.afterCursor}`;

    let replaceEnd = blockContext.beforeCursor.length;
    if (blockTokenInfo.token.length === 0) {
      while (replaceEnd > 0 && this.isSeparator(blockContext.beforeCursor.charAt(replaceEnd - 1))) {
        replaceEnd -= 1;
      }
    }
    const replaceStart = Math.max(0, replaceEnd - triggerText.length);

    if (triggerText.length > 0) {
      const selectedTrigger = blockSourceText.slice(replaceStart, replaceEnd);
      if (selectedTrigger.toLowerCase() !== triggerText.toLowerCase()) {
        return null;
      }
    }

    const trailingTokenText = beforeBlockBoundary
      ? ""
      : this.findTrailingToken(blockContext.afterCursor);
    const baseReplaceEnd = Math.min(blockSourceText.length, replaceEnd + trailingTokenText.length);
    const hostEditorSession = this.resolveHostEditorSession(entry.elem as HTMLElement, {
      beforeCursor: blockContext.beforeCursor,
      afterCursor: blockContext.afterCursor,
      blockText: blockSourceText,
    });
    const rawReplacementText = this.normalizeContentEditableTrailingSpace(entry.elem, suggestion, {
      beforeBlockBoundary,
      endsAtBlockBoundary: baseReplaceEnd >= blockSourceText.length,
      hostOwned: hostEditorSession !== null,
    });
    const replacementText =
      trailingTokenText.length > 0 && / $/.test(rawReplacementText)
        ? rawReplacementText.slice(0, -1)
        : rawReplacementText;
    const extraWhitespaceToConsume = this.shouldConsumeFollowingSpace(
      replacementText,
      blockSourceText.charAt(baseReplaceEnd),
    )
      ? 1
      : 0;
    const finalReplaceEnd = Math.min(
      blockSourceText.length,
      baseReplaceEnd + extraWhitespaceToConsume,
    );
    const cursorAfter = replaceStart + replacementText.length;
    const originalText = blockSourceText.slice(replaceStart, finalReplaceEnd);
    const expectedPostEditBlockText = `${blockSourceText.slice(0, replaceStart)}${replacementText}${blockSourceText.slice(finalReplaceEnd)}`;

    logger.debug("Accepting suggestion in contenteditable", {
      suggestionId: entry.id,
      beforeBlockBoundary,
      replaceStart,
      replaceEnd: finalReplaceEnd,
      cursorAfter,
      triggerLength: triggerText.length,
      suggestionLength: suggestion.length,
      replacementLength: replacementText.length,
      blockBeforeCursorLength: blockContext.beforeCursor.length,
      blockAfterCursorLength: blockContext.afterCursor.length,
      expectedPostEditBlockTextLength: expectedPostEditBlockText.length,
      activeBlockSnapshot: buildElementSnapshot(
        activeBlock,
        blockContext.beforeCursor,
        blockContext.afterCursor,
      ),
      caretTraceBeforeEdit: buildCaretTrace(
        blockContext.beforeCursor,
        blockContext.afterCursor,
        TRACE_TEXT_LIMIT,
      ),
      recentInteractionTrail: entry.recentInteractionTrail.slice(),
    });

    entry.pendingExtensionEdit = {
      replaceStart,
      originalText,
      replacementText,
      cursorBefore: blockContext.beforeCursor.length,
      cursorAfter,
      postEditFingerprint: {
        fullText: "",
        cursorOffset: cursorAfter,
        selectionCollapsed: TextTargetAdapter.hasCollapsedSelection(entry.elem as TextTarget),
      },
      source: "suggestion",
      blockScoped: true,
      blockElement: activeBlock,
      postEditBlockText: expectedPostEditBlockText,
    };

    const applyResult = this.applyContentEditableSuggestionEdit({
      elem: entry.elem,
      blockSourceText,
      replaceStart,
      replaceEnd: finalReplaceEnd,
      replacementText,
      cursorAfter,
      activeBlock,
      hostEditorSession,
    });
    const hostAcceptedAsync =
      "appliedBy" in applyResult &&
      applyResult.appliedBy === "host-beforeinput" &&
      !applyResult.didMutateDom;
    const hostEditorApplied = hostEditorSession !== null;
    const shouldAwaitHostInputEcho = hostAcceptedAsync || applyResult.didDispatchInput;
    if (!applyResult.didMutateDom && !hostAcceptedAsync) {
      entry.pendingExtensionEdit = null;
      return null;
    }
    if (hostAcceptedAsync) {
      logger.debug("Treating deferred host contenteditable accept as successful", {
        suggestionId: entry.id,
        replaceStart,
        replaceEnd: finalReplaceEnd,
        cursorAfter,
        replacementLength: replacementText.length,
        expectedPostEditBlockTextLength: expectedPostEditBlockText.length,
      });
    }

    const postEditBlockContext = this.contentEditableAdapter.getBlockContext(
      entry.elem as HTMLElement,
    );
    const hostPostEditBlockContext = hostEditorSession?.getBlockContextAtSelection() ?? null;
    const postEditBlockText = hostAcceptedAsync
      ? expectedPostEditBlockText
      : (hostPostEditBlockContext?.blockText ?? activeBlock.textContent ?? "");
    const postEditCursorAfter = hostAcceptedAsync
      ? cursorAfter
      : (hostPostEditBlockContext?.beforeCursor.length ??
        postEditBlockContext?.beforeCursor.length ??
        cursorAfter);

    if (hostEditorApplied && activeBlock.textContent === postEditBlockText) {
      this.contentEditableAdapter.setCaret(activeBlock, postEditCursorAfter);
    }

    if (entry.pendingExtensionEdit) {
      entry.pendingExtensionEdit.cursorAfter = postEditCursorAfter;
      entry.pendingExtensionEdit.awaitingHostInputEcho = shouldAwaitHostInputEcho;
      entry.pendingExtensionEdit.postEditFingerprint = hostEditorApplied
        ? hostEditorSession.createPostEditFingerprint()
        : {
            fullText: "",
            cursorOffset: postEditCursorAfter,
            selectionCollapsed: TextTargetAdapter.hasCollapsedSelection(entry.elem as TextTarget),
          };
      entry.pendingExtensionEdit.blockElement = activeBlock;
      entry.pendingExtensionEdit.postEditBlockText = postEditBlockText;
    }

    const finishedAt =
      typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
    const durationMs = finishedAt - startedAt;
    logger.debug("Accepted contenteditable suggestion", {
      suggestionLength: suggestion.length,
      replacementLength: replacementText.length,
      blockTextLength: blockSourceText.length,
      durationMs,
      blockScoped: true,
      activeBlockSnapshot: buildElementSnapshot(
        activeBlock,
        postEditBlockText.slice(0, postEditCursorAfter),
        postEditBlockText.slice(postEditCursorAfter),
      ),
      caretTraceAfterEdit: buildCaretTrace(
        postEditBlockText.slice(0, postEditCursorAfter),
        postEditBlockText.slice(postEditCursorAfter),
        TRACE_TEXT_LIMIT,
      ),
      recentInteractionTrail: entry.recentInteractionTrail.slice(),
    });

    return {
      triggerText,
      insertedText: replacementText,
      cursorAfter: postEditCursorAfter,
      cursorAfterIsBlockLocal: true,
    };
  }

  private correctContentEditableGrammarMismatch(
    entry: SuggestionEntry,
    {
      expectedFullText,
      expectedCursorAfter,
      expectedBlockText,
      expectedBlockCursorAfter,
    }: {
      expectedFullText: string;
      expectedCursorAfter: number;
      expectedBlockText: string | null;
      expectedBlockCursorAfter: number | null;
    },
  ): {
    applyResult: ContentEditableEditResult | { didMutateDom: boolean; didDispatchInput: boolean };
    postEditSnapshot: SuggestionSnapshot;
  } | null {
    const currentSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const currentFullText = `${currentSnapshot.beforeCursor}${currentSnapshot.afterCursor}`;
    if (
      currentFullText === expectedFullText &&
      currentSnapshot.cursorOffset === expectedCursorAfter
    ) {
      return {
        applyResult: {
          didMutateDom: false,
          didDispatchInput: false,
        },
        postEditSnapshot: currentSnapshot,
      };
    }

    if (expectedBlockText !== null && expectedBlockCursorAfter !== null) {
      const liveBlockContext = this.contentEditableAdapter.getBlockContext(
        entry.elem as HTMLElement,
      );
      if (liveBlockContext) {
        const liveBlockText = `${liveBlockContext.beforeCursor}${liveBlockContext.afterCursor}`;
        const blockStart =
          currentSnapshot.beforeCursor.length - liveBlockContext.beforeCursor.length;
        const blockCorrection = this.replaceCurrentTextWithExpected(
          entry.elem,
          currentFullText,
          blockStart,
          liveBlockText,
          expectedBlockText,
          blockStart + expectedBlockCursorAfter,
        );
        if (blockCorrection) {
          return blockCorrection;
        }
      }
    }

    return this.replaceCurrentTextWithExpected(
      entry.elem,
      currentFullText,
      0,
      currentFullText,
      expectedFullText,
      expectedCursorAfter,
    );
  }

  private replaceCurrentTextWithExpected(
    elem: SuggestionElement,
    currentFullText: string,
    segmentStart: number,
    currentSegmentText: string,
    expectedSegmentText: string,
    cursorAfter: number,
  ): {
    applyResult: ContentEditableEditResult | { didMutateDom: boolean; didDispatchInput: boolean };
    postEditSnapshot: SuggestionSnapshot;
  } | null {
    if (currentSegmentText === expectedSegmentText) {
      if (!TextTargetAdapter.isTextValue(elem)) {
        this.contentEditableAdapter.setCaret(elem, cursorAfter);
      }
      const postEditSnapshot = TextTargetAdapter.snapshot(elem as TextTarget);
      return {
        applyResult: {
          didMutateDom: false,
          didDispatchInput: false,
        },
        postEditSnapshot,
      };
    }

    let prefixLength = 0;
    const maxPrefix = Math.min(currentSegmentText.length, expectedSegmentText.length);
    while (
      prefixLength < maxPrefix &&
      currentSegmentText.charAt(prefixLength) === expectedSegmentText.charAt(prefixLength)
    ) {
      prefixLength += 1;
    }

    let currentSuffixLength = currentSegmentText.length;
    let expectedSuffixLength = expectedSegmentText.length;
    while (
      currentSuffixLength > prefixLength &&
      expectedSuffixLength > prefixLength &&
      currentSegmentText.charAt(currentSuffixLength - 1) ===
        expectedSegmentText.charAt(expectedSuffixLength - 1)
    ) {
      currentSuffixLength -= 1;
      expectedSuffixLength -= 1;
    }

    const replaceStart = segmentStart + prefixLength;
    const replaceEnd = segmentStart + currentSuffixLength;
    const replacementText = expectedSegmentText.slice(prefixLength, expectedSuffixLength);
    const applyResult = this.replaceTextByOffsets(
      elem,
      currentFullText,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
      { preferDomMutation: true },
    );
    if (!applyResult.didMutateDom) {
      return null;
    }
    return {
      applyResult,
      postEditSnapshot: TextTargetAdapter.snapshot(elem as TextTarget),
    };
  }

  private dispatchInputEvent(elem: SuggestionElement): void {
    elem.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
