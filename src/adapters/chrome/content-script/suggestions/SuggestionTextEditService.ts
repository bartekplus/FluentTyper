import { isGutenbergField } from "./GutenbergEnvironment";
import { createLogger } from "@core/application/logging/Logger";
import type { GrammarEdit } from "@core/domain/grammar/types";
import { SPACING_RULES, Spacing, ZERO_WIDTH_FILLER_CHARS } from "@core/domain/spacingRules";
import { ContentEditableAdapter, type ContentEditableEditResult } from "./ContentEditableAdapter";
import { HOST_MODEL_EDITOR_SELECTOR } from "./EditorCapabilities";
import { HostEditorAdapterResolver, type HostEditorSession } from "./HostEditorAdapterResolver";
import type { LineEditorBlockContext } from "./HostEditorControllerUtils";
import { getDeepActiveElement } from "@core/application/dom-utils";
import { commonAffixes, isGraphemeBoundary } from "@core/domain/grammar/review/textRanges";
import { CURSOR_MOVE_COUNT_ATTR, CURSOR_MOVE_EVENT } from "./HostEditorBridgeProtocol";
import {
  clearAcceptedSuggestionSpaceState,
  resolveLiveBlockScopedEdit,
} from "./SuggestionAcceptedState";
import { hasOtherFocusedEditor, TextTargetAdapter } from "./TextTargetAdapter";
import type {
  ExtensionEditSnapshot,
  ManualAutoFixSuppressionSnapshot,
  SuggestionEntry,
  SuggestionElement,
  SuggestionSnapshot,
} from "./types";

const logger = createLogger("SuggestionTextEditService");

/** Strip zero-width filler characters that rich editors inject into the DOM. */
const FILLER_CHARS_REGEX = new RegExp(ZERO_WIDTH_FILLER_CHARS.join("|"), "g");
function stripFillerChars(value: string): string {
  return value.replace(FILLER_CHARS_REGEX, "");
}

/** The replacement and delete counts of `edit`, with bad values set to safe defaults. */
export function normalizeGrammarEdit(edit: GrammarEdit): {
  replacement: string;
  deleteBackwards: number;
  deleteForwards: number;
} {
  return {
    replacement: typeof edit.replacement === "string" ? edit.replacement : "",
    deleteBackwards: Number.isFinite(edit.deleteBackwards) ? Math.max(0, edit.deleteBackwards) : 0,
    deleteForwards: Number.isFinite(edit.deleteForwards) ? Math.max(0, edit.deleteForwards) : 0,
  };
}

type DomEditResult = {
  nativeUndo?: boolean;
  didMutateDom: boolean;
  didDispatchInput: boolean;
  unverified?: boolean;
};
type EditResult = (ContentEditableEditResult | DomEditResult) & { unverified?: boolean };

interface TextEditApplyResult {
  applied: boolean;
  didDispatchInput: boolean;
  suppressedByManualRevert?: boolean;
  unverified?: boolean;
}

interface AcceptedSuggestionEditResult {
  triggerText: string;
  insertedText: string;
  cursorAfter: number;
  cursorAfterIsBlockLocal: boolean;
  unverified?: boolean;
}

interface GrammarEditApplyContext {
  snapshot?: SuggestionSnapshot;
  contentEditableContext?: {
    beforeCursor: string;
    afterCursor: string;
    useFullTextOffsets: boolean;
  } | null;
}

interface UndoOptions {
  consumeEvent: (event: Event) => void;
  clearSuggestions: () => void;
  onSuccessfulUndo?: (edit: ExtensionEditSnapshot) => void;
}

export class SuggestionTextEditService {
  private readonly canEdit: (
    entry: SuggestionEntry,
    automatic: boolean,
    edit?: GrammarEdit,
  ) => boolean;
  private readonly findMentionToken: (beforeCursor: string) => { token: string; start: number };
  private readonly isSeparator: (value: string) => boolean;
  private readonly contentEditableAdapter: ContentEditableAdapter;
  private readonly hostEditorAdapterResolver: HostEditorAdapterResolver;

  constructor({
    findMentionToken,
    isSeparator,
    canEdit = () => true,
    contentEditableAdapter = new ContentEditableAdapter(),
    hostEditorAdapterResolver = new HostEditorAdapterResolver(),
  }: {
    canEdit?: (entry: SuggestionEntry, automatic: boolean, edit?: GrammarEdit) => boolean;
    findMentionToken: (beforeCursor: string) => { token: string; start: number };
    isSeparator: (value: string) => boolean;
    contentEditableAdapter?: ContentEditableAdapter;
    hostEditorAdapterResolver?: HostEditorAdapterResolver;
  }) {
    this.canEdit = canEdit;
    this.findMentionToken = findMentionToken;
    this.isSeparator = isSeparator;
    this.contentEditableAdapter = contentEditableAdapter;
    this.hostEditorAdapterResolver = hostEditorAdapterResolver;
  }

  public acceptSuggestion(
    entry: SuggestionEntry,
    suggestion: string,
  ): AcceptedSuggestionEditResult | null {
    if (hasOtherFocusedEditor(entry.elem) || !this.canEdit(entry, false)) return null;
    entry.pendingExtensionEdit = null;
    entry.manualAutoFixSuppression = null;
    const isTextValueTarget = TextTargetAdapter.isTextValue(entry.elem);
    const blockContext = isTextValueTarget
      ? null
      : this.contentEditableAdapter.getBlockContext(entry.elem);
    const blockTriggerText = blockContext
      ? this.findMentionToken(blockContext.beforeCursor).token
      : "";
    if (blockContext && blockTriggerText) {
      return this.acceptContentEditableSuggestion(
        entry,
        suggestion,
        blockContext,
        blockTriggerText,
      );
    }

    let snapshot = TextTargetAdapter.snapshot(entry.elem);
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
    let replaceEnd =
      !isTextValueTarget && tokenInfo.token.length === 0 && triggerText.length > 0
        ? this.trimTrailingSeparators(snapshot.beforeCursor, snapshot.beforeCursor.length)
        : snapshot.beforeCursor.length;
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

    // The block context starts at the caret. When the replacement ends before the caret, read the
    // trailing token from the full text at replaceEnd.
    const trailingTokenText = beforeBlockBoundary
      ? ""
      : this.findTrailingToken(
          replaceEnd === snapshot.beforeCursor.length && blockContext
            ? blockContext.afterCursor
            : currentFullText.slice(replaceEnd),
        );
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
    if (!applyResult.didMutateDom || applyResult.unverified) {
      entry.pendingExtensionEdit = null;
      return null;
    }
    const postEditSnapshot = TextTargetAdapter.snapshot(entry.elem);

    if (entry.pendingExtensionEdit) {
      entry.pendingExtensionEdit.nativeUndo = applyResult.nativeUndo;
      entry.pendingExtensionEdit.cursorAfter = postEditSnapshot.cursorOffset;
      entry.pendingExtensionEdit.postEditFingerprint = TextTargetAdapter.createPostEditFingerprint(
        entry.elem,
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

  public tryUndoLastExtensionEditOnBeforeInput(
    entry: SuggestionEntry,
    event: InputEvent,
    options: UndoOptions,
  ): boolean {
    return (
      event.inputType === "historyUndo" && this.tryUndoLastExtensionEdit(entry, event, options)
    );
  }

  public tryUndoLastExtensionEdit(
    entry: SuggestionEntry,
    event: Event,
    { consumeEvent, clearSuggestions, onSuccessfulUndo }: UndoOptions,
  ): boolean {
    if (!entry.pendingExtensionEdit) {
      return false;
    }

    if (entry.pendingExtensionEdit.nativeUndo || entry.elem.matches(HOST_MODEL_EDITOR_SELECTOR)) {
      // The host owns undo. Keep FluentTyper's suppression/personalization bookkeeping,
      // but let the chord/beforeinput reach its history instead of reversing the DOM.
      const pending = entry.pendingExtensionEdit;
      const snapshot = TextTargetAdapter.snapshot(entry.elem);
      const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
      const block = pending.blockScoped
        ? this.contentEditableAdapter.getBlockContext(entry.elem)
        : null;
      const start =
        pending.replaceStart + (block ? snapshot.cursorOffset - block.beforeCursor.length : 0);
      const end = start + pending.replacementText.length;
      const expected = fullText.slice(0, start) + pending.originalText + fullText.slice(end);
      entry.pendingExtensionEdit = null;
      if (
        fullText.slice(start, end) === pending.replacementText &&
        TextTargetAdapter.matchesPostEditFingerprint(
          entry.elem,
          pending.postEditFingerprint,
          snapshot,
        )
      ) {
        if (pending.source === "grammar")
          entry.manualAutoFixSuppression = this.createManualAutoFixSuppression({
            ruleKey: this.resolveAutoFixRuleKey(
              pending.sourceRuleId,
              pending.originalText,
              pending.replacementText,
            ),
            replaceStart: start,
            fullText: expected,
            cursorOffset: pending.cursorBefore,
          });
        clearSuggestions();
        entry.elem.ownerDocument.defaultView?.requestAnimationFrame(() => {
          if (!entry.elem.isConnected) return;
          const after = TextTargetAdapter.snapshot(entry.elem);
          if (`${after.beforeCursor}${after.afterCursor}` !== expected) return;
          const field = entry.elem;
          // Blink undo restores the temporary replacement selection. Restore
          // the original caret only while that exact selection is still live.
          if (
            TextTargetAdapter.isTextValue(field) &&
            getDeepActiveElement(field.ownerDocument) === field &&
            field.selectionStart === start &&
            field.selectionEnd === start + pending.originalText.length
          ) {
            field.setSelectionRange(pending.cursorBefore, pending.cursorBefore);
          }
          onSuccessfulUndo?.(pending);
        });
      }
      return false;
    }

    if (
      entry.pendingExtensionEdit.blockScoped &&
      !TextTargetAdapter.isTextValue(entry.elem) &&
      entry.elem.isContentEditable
    ) {
      return this.tryUndoBlockScopedExtensionEdit(entry, event, {
        consumeEvent,
        clearSuggestions,
        onSuccessfulUndo,
      });
    }

    const snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem);
    const pendingEdit = entry.pendingExtensionEdit;
    const {
      replaceStart,
      originalText,
      replacementText,
      cursorBefore,
      postEditFingerprint,
      source,
      sourceRuleId,
    } = pendingEdit;
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceEnd = replaceStart + replacementText.length;

    const isContentEditableGrammar =
      source === "grammar" &&
      "isContentEditable" in entry.elem &&
      entry.elem.isContentEditable &&
      TextTargetAdapter.hasCollapsedSelection(entry.elem);

    const fingerprintMatch = isContentEditableGrammar
      ? (() => {
          const actual = TextTargetAdapter.createPostEditFingerprint(entry.elem, snapshot);
          return (
            actual.fullText === postEditFingerprint.fullText &&
            actual.selectionCollapsed === postEditFingerprint.selectionCollapsed &&
            snapshot.cursorOffset >= replaceStart &&
            snapshot.cursorOffset <= replaceStart + replacementText.length
          );
        })()
      : TextTargetAdapter.matchesPostEditFingerprint(entry.elem, postEditFingerprint, snapshot);

    if (
      !fingerprintMatch ||
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
    onSuccessfulUndo?.(pendingEdit);
    return true;
  }

  private tryUndoBlockScopedExtensionEdit(
    entry: SuggestionEntry,
    event: Event,
    {
      consumeEvent,
      clearSuggestions,
      onSuccessfulUndo,
    }: {
      consumeEvent: (event: Event) => void;
      clearSuggestions: () => void;
      onSuccessfulUndo?: (edit: ExtensionEditSnapshot) => void;
    },
  ): boolean {
    const pendingEdit = entry.pendingExtensionEdit;
    if (!pendingEdit?.blockScoped) {
      return false;
    }

    const live = resolveLiveBlockScopedEdit(entry.elem, pendingEdit, this.contentEditableAdapter);
    const replaceEnd = pendingEdit.replaceStart + pendingEdit.replacementText.length;
    if (
      !live ||
      replaceEnd > live.blockFullText.length ||
      live.blockFullText.slice(pendingEdit.replaceStart, replaceEnd) !== pendingEdit.replacementText
    ) {
      entry.pendingExtensionEdit = null;
      return false;
    }
    const { activeBlock, blockFullText } = live;

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
    onSuccessfulUndo?.(pendingEdit);
    return true;
  }

  public syncManualAutoFixSuppression(
    entry: SuggestionEntry,
    snapshotOverride?: SuggestionSnapshot,
  ): void {
    if (!entry.manualAutoFixSuppression) {
      return;
    }
    const snapshot = snapshotOverride ?? TextTargetAdapter.snapshot(entry.elem);
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
    edit: GrammarEdit,
    context: GrammarEditApplyContext = {},
  ): TextEditApplyResult {
    if (hasOtherFocusedEditor(entry.elem) || !this.canEdit(entry, !edit.strict, edit))
      return { applied: false, didDispatchInput: false };
    const normalized = normalizeGrammarEdit(edit);
    let replacement = normalized.replacement;
    const { deleteBackwards, deleteForwards } = normalized;
    const isStrictEdit = edit.strict === true;
    const snapshot: SuggestionSnapshot = context.snapshot ?? TextTargetAdapter.snapshot(entry.elem);
    if (isStrictEdit) {
      const live = TextTargetAdapter.snapshot(entry.elem);
      if (
        !TextTargetAdapter.hasCollapsedSelection(entry.elem) ||
        live.beforeCursor !== snapshot.beforeCursor ||
        live.afterCursor !== snapshot.afterCursor ||
        live.cursorOffset !== snapshot.cursorOffset
      ) {
        return { applied: false, didDispatchInput: false };
      }
    }
    this.syncManualAutoFixSuppression(entry, snapshot);
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;

    let replaceStart = Math.max(0, snapshot.beforeCursor.length - deleteBackwards);
    let replaceEnd = Math.max(
      replaceStart,
      Math.min(fullText.length, snapshot.beforeCursor.length + deleteForwards),
    );
    const cursorAfterFor = (start: number) =>
      start +
      (edit.cursorOffset !== undefined
        ? Math.max(0, Math.min(replacement.length, edit.cursorOffset))
        : replacement.length);
    let block: {
      element: HTMLElement;
      context: { beforeCursor: string; afterCursor: string };
      sourceText: string;
      expectedText: string;
      replaceStart: number;
      replaceEnd: number;
      cursorAfter: number;
    } | null = null;

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

        const blockReplaceStart = Math.max(0, blockCursor - deleteBackwards);
        const blockReplaceEnd = Math.max(
          blockReplaceStart,
          Math.min(
            blockContext.beforeCursor.length + blockContext.afterCursor.length,
            blockCursor + deleteForwards,
          ),
        );
        const blockSourceText = `${blockContext.beforeCursor}${blockContext.afterCursor}`;

        replaceStart = Math.max(0, blockStart + blockCursor - deleteBackwards);
        replaceEnd = Math.max(
          replaceStart,
          Math.min(fullText.length, blockStart + blockCursor + deleteForwards),
        );
        const activeBlock = this.contentEditableAdapter.getActiveBlockElement(entry.elem);
        if (activeBlock) {
          block = {
            element: activeBlock,
            context: blockContext,
            sourceText: blockSourceText,
            expectedText: `${blockSourceText.slice(0, blockReplaceStart)}${replacement}${blockSourceText.slice(blockReplaceEnd)}`,
            replaceStart: blockReplaceStart,
            replaceEnd: blockReplaceEnd,
            cursorAfter: cursorAfterFor(blockReplaceStart),
          };
        }
      }
    }
    const expectedFullText = `${fullText.slice(0, replaceStart)}${replacement}${fullText.slice(replaceEnd)}`;

    const cursorAfter = cursorAfterFor(replaceStart);
    if (isStrictEdit) {
      // Narrow to what actually changed; do not flatten styled nodes around it.
      const { prefix, suffix } = commonAffixes(
        fullText.slice(replaceStart, replaceEnd),
        replacement,
      );
      replaceStart += prefix;
      replaceEnd -= suffix;
      if (block) {
        block.replaceStart += prefix;
        block.replaceEnd -= suffix;
      }
      replacement = replacement.slice(prefix, replacement.length - suffix);
    }
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

    let applyResult: EditResult | null = null;
    if (block) {
      const hostEditorSession = this.resolveHostEditorSession(entry.elem, {
        beforeCursor: block.context.beforeCursor,
        afterCursor: block.context.afterCursor,
        blockText: block.sourceText,
      });
      if (hostEditorSession) {
        applyResult = this.applyHostReplacement(hostEditorSession, {
          replaceStart: block.replaceStart,
          replaceEnd: block.replaceEnd,
          replacementText: replacement,
          cursorAfter: block.cursorAfter,
        });
      }
      if (
        applyResult === null &&
        hostEditorSession &&
        (entry.elem.matches(HOST_MODEL_EDITOR_SELECTOR) || isGutenbergField(entry.elem))
      ) {
        return { applied: false, didDispatchInput: false };
      }
      if (applyResult === null) {
        applyResult = this.tryHostGrammarEditWithMatchingBlockText(
          entry.elem,
          block.sourceText,
          block.replaceStart,
          block.replaceEnd,
          replacement,
          block.cursorAfter,
        );
      }
      if (applyResult === null) {
        // The primary match may fail when getBlockContext returns a
        // BR-separated line but the host editor (e.g. CKEditor-5) uses
        // the full paragraph block.  Translate local offsets into the
        // host's full-block coordinate space and retry.
        applyResult = this.tryHostGrammarEditWithFullBlockOffsets(
          entry.elem,
          block.sourceText,
          block.replaceStart,
          block.replaceEnd,
          replacement,
          block.cursorAfter,
        );
      }
    }
    if (applyResult === null && this.hostEditorAdapterResolver.resolve(entry.elem)) {
      return { applied: false, didDispatchInput: false };
    }
    if (applyResult === null) {
      applyResult = block
        ? this.replaceTextByOffsets(
            entry.elem,
            block.sourceText,
            block.replaceStart,
            block.replaceEnd,
            replacement,
            block.cursorAfter,
            { scopeRoot: block.element },
          )
        : this.replaceTextByOffsets(
            entry.elem,
            fullText,
            replaceStart,
            replaceEnd,
            replacement,
            cursorAfter,
          );
    }
    // For edits with cursorOffset on contenteditable, schedule deferred cursor
    // repositioning BEFORE the didMutateDom check. React-based editors (Lexical,
    // Slate) handle beforeinput by calling preventDefault() and reconciling the
    // DOM asynchronously via microtask. This means didMutateDom is false at check
    // time even though the edit WILL be applied. The deferred callback validates
    // that the expected text appeared before moving the cursor.
    //
    // Plain contenteditable applied via the DOM path ("fallback-dom") already had
    // its caret placed synchronously at the final offset by the adapter, so skip
    // the deferred relative move-back there — running it would double-correct the
    // caret. Only host editors (React via beforeinput, CKEditor via host session)
    // reconcile asynchronously and still need the deferred reposition.
    const caretPlacedSynchronously =
      "appliedBy" in applyResult && applyResult.appliedBy === "fallback-dom";
    if (
      edit.cursorOffset !== undefined &&
      !applyResult.unverified &&
      !TextTargetAdapter.isTextValue(entry.elem) &&
      !caretPlacedSynchronously
    ) {
      const moveBackCount = replacement.length - edit.cursorOffset;
      if (moveBackCount > 0) {
        const targetElem = entry.elem;
        // React-based editors (Lexical, Slate) reconcile the DOM asynchronously
        // and override cursor positions set via setCaret. Dispatch a bridge event
        // to the main-world script which calls Selection.modify() there. Running
        // in the main world triggers native selectionchange events that host
        // editors detect and use to sync their internal selection state.
        let applied = false;
        const applyModify = () => {
          if (
            applied ||
            !targetElem.isConnected ||
            !this.canEdit(entry, !edit.strict, edit) ||
            getDeepActiveElement(targetElem.ownerDocument) !== targetElem
          ) {
            return;
          }
          // Validate that the replacement text actually appeared in the DOM
          // before moving the cursor. This distinguishes async host reconciliation
          // (Lexical) from true edit rejection.
          const current = TextTargetAdapter.snapshot(targetElem);
          if (
            `${current.beforeCursor}${current.afterCursor}` !== expectedFullText ||
            current.cursorOffset !== replaceStart + replacement.length ||
            !TextTargetAdapter.hasCollapsedSelection(targetElem)
          ) {
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

    if (applyResult.unverified) {
      entry.pendingExtensionEdit = null;
      return { applied: false, didDispatchInput: applyResult.didDispatchInput, unverified: true };
    }
    if (!applyResult.didMutateDom) {
      return {
        applied: false,
        didDispatchInput: false,
      };
    }

    const postEditSnapshot: SuggestionSnapshot =
      block !== null && (block.element.textContent ?? "") === block.expectedText
        ? {
            beforeCursor: expectedFullText.slice(0, cursorAfter),
            afterCursor: expectedFullText.slice(cursorAfter),
            cursorOffset: cursorAfter,
          }
        : TextTargetAdapter.snapshot(entry.elem);
    // FT-INV-5: a host mismatch is evidence to stop, never permission to
    // repair the page from our private pre-edit snapshot.
    if (
      `${postEditSnapshot.beforeCursor}${postEditSnapshot.afterCursor}` !== expectedFullText ||
      postEditSnapshot.cursorOffset !== cursorAfter
    ) {
      entry.pendingExtensionEdit = null;
      return { applied: false, didDispatchInput: applyResult.didDispatchInput, unverified: true };
    }

    entry.pendingExtensionEdit = {
      replaceStart,
      originalText,
      replacementText: replacement,
      cursorBefore: snapshot.cursorOffset,
      cursorAfter: postEditSnapshot.cursorOffset,
      postEditFingerprint: TextTargetAdapter.createPostEditFingerprint(
        entry.elem,
        postEditSnapshot,
      ),
      source: "grammar",
      nativeUndo: applyResult.nativeUndo,
      sourceRuleId: edit.sourceRuleId,
    };
    return { applied: true, didDispatchInput: applyResult.didDispatchInput };
  }

  public handleMissingSpaceAfterAccept(
    entry: SuggestionEntry,
    event: KeyboardEvent,
    consumeKeyboardEvent: (event: KeyboardEvent) => void,
  ): void {
    if (!this.canEdit(entry, true) || !entry.missingTrailingSpace) {
      return;
    }

    const key = event.key;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Escape"].includes(key)) {
      return;
    }

    const isTextValueTarget = TextTargetAdapter.isTextValue(entry.elem);
    const activeBlock =
      !isTextValueTarget && entry.expectedCursorPosIsBlockLocal
        ? this.contentEditableAdapter.getActiveBlockElement(entry.elem)
        : null;
    const blockContext =
      activeBlock !== null ? this.contentEditableAdapter.getBlockContext(entry.elem) : null;
    const snapshot =
      isTextValueTarget || !entry.expectedCursorPosIsBlockLocal
        ? TextTargetAdapter.snapshot(entry.elem)
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

    const mismatch = !blockStateMatches
      ? "block_state_mismatch"
      : currentCursorOffset !== entry.expectedCursorPos
        ? "cursor_mismatch"
        : key.length > 1
          ? "non_character_key"
          : null;
    if (mismatch) {
      logger.debug("Clearing delayed post-accept spacing state", {
        suggestionId: entry.id,
        reason: mismatch,
        key,
      });
    }
    clearAcceptedSuggestionSpaceState(entry);
    if (mismatch || !key.trim()) {
      return;
    }

    const beforeCursor = blockContext?.beforeCursor ?? snapshot?.beforeCursor ?? "";
    const afterCursor = blockContext?.afterCursor ?? snapshot?.afterCursor ?? "";
    const charBeforeCursor = beforeCursor.charAt(beforeCursor.length - 1);
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
        ? this.resolveHostEditorSession(entry.elem, {
            beforeCursor,
            afterCursor,
            blockText: fullText,
          })
        : null;

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
      if (result.applied || result.unverified) {
        consumeKeyboardEvent(event);
        return;
      }
    }

    const result = this.replaceTextByOffsets(
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
    if (result.didMutateDom || ("appliedBy" in result && result.appliedBy === "host-beforeinput"))
      consumeKeyboardEvent(event);
  }

  public findTrailingToken(afterCursor: string): string {
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
    return /[ \xA0]$/.test(insertedSuggestion) && /[ \xA0]/.test(nextChar);
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
    return { ruleKey, replaceStart, ...this.resolveTokenContext(fullText, cursorOffset) };
  }

  private resolveTokenContext(
    fullText: string,
    cursorOffset: number,
  ): { tokenStart: number; tokenText: string } {
    const anchor = this.trimTrailingSeparators(
      fullText,
      Math.max(0, Math.min(fullText.length, cursorOffset)),
    );
    const tokenStart = this.findMentionToken(fullText.slice(0, anchor)).start;
    return {
      tokenStart,
      tokenText: fullText.slice(
        tokenStart,
        anchor + this.findTrailingToken(fullText.slice(anchor)).length,
      ),
    };
  }

  private trimTrailingSeparators(text: string, end: number): number {
    while (end > 0 && this.isSeparator(text.charAt(end - 1))) {
      end -= 1;
    }
    return end;
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
    options: { scopeRoot?: HTMLElement | null } = {},
  ): EditResult {
    const refused = { didMutateDom: false, didDispatchInput: false };
    // FT-INV-1: all typing, expansion, spacing and undo callers share this gate.
    if (
      !isGraphemeBoundary(fullText, replaceStart) ||
      !isGraphemeBoundary(fullText, replaceEnd) ||
      replaceEnd < replaceStart
    )
      return refused;
    const updatedText = `${fullText.slice(0, replaceStart)}${replacementText}${fullText.slice(replaceEnd)}`;

    if (TextTargetAdapter.isTextValue(elem)) {
      if (elem.value !== fullText || updatedText === fullText) return refused;
      if (elem.maxLength >= 0 && updatedText.length > elem.maxLength) return refused;
      const doc = elem.ownerDocument;
      if (typeof doc.execCommand !== "function") return refused;
      elem.focus({ preventScroll: true });
      if (getDeepActiveElement(doc) !== elem || elem.value !== fullText) return refused;
      const selectionBefore = {
        start: elem.selectionStart,
        end: elem.selectionEnd,
        direction: elem.selectionDirection,
      };
      elem.setSelectionRange(replaceStart, replaceEnd);
      // Native edits keep undo and bypass framework value trackers just as typing does.
      try {
        if (replacementText) doc.execCommand("insertText", false, replacementText);
        else doc.execCommand("delete", false);
      } catch {
        /* Readback decides whether the native operation changed text. */
      }
      if (elem.value !== fullText) {
        if (elem.value !== updatedText) return { ...refused, didMutateDom: true, unverified: true };
        if (
          getDeepActiveElement(doc) === elem &&
          elem.selectionStart === replaceStart + replacementText.length &&
          elem.selectionEnd === elem.selectionStart
        )
          elem.setSelectionRange(cursorAfter, cursorAfter);
        return { didMutateDom: true, didDispatchInput: false, nativeUndo: true };
      }
      if (
        getDeepActiveElement(doc) === elem &&
        elem.selectionStart === replaceStart &&
        elem.selectionEnd === replaceEnd
      )
        elem.setSelectionRange(
          selectionBefore.start,
          selectionBefore.end,
          selectionBefore.direction ?? "none",
        );
      return refused;
    }
    const current = options.scopeRoot
      ? this.contentEditableAdapter.getBlockContext(elem)
      : TextTargetAdapter.snapshot(elem);
    if (!current || `${current.beforeCursor}${current.afterCursor}` !== fullText) return refused;

    return this.contentEditableAdapter.replaceTextByOffsets(
      elem,
      replaceStart,
      replaceEnd,
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
  ): DomEditResult | null {
    const host = this.hostBlockAtSelection(elem);
    if (!host) {
      return null;
    }
    const { session, context: hostBlockContext } = host;
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
    const fullReplaceStart =
      lineOffset + localReplaceStart - fillersBeforeOffset(localReplaceStart);
    const fullReplaceEnd = lineOffset + localReplaceEnd - fillersBeforeOffset(localReplaceEnd);
    const fullCursorAfter = lineOffset + localCursorAfter - fillersBeforeOffset(localCursorAfter);
    if (fullReplaceEnd > hostBlockText.length) {
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
    return this.applyHostReplacement(session, {
      replaceStart: fullReplaceStart,
      replaceEnd: fullReplaceEnd,
      replacementText,
      cursorAfter: fullCursorAfter,
    });
  }

  private tryHostGrammarEditWithMatchingBlockText(
    elem: HTMLElement,
    blockText: string,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ): DomEditResult | null {
    const host = this.hostBlockAtSelection(elem);
    if (
      !host ||
      this.normalizeComparableBlockText(host.context.blockText) !==
        this.normalizeComparableBlockText(blockText)
    ) {
      return null;
    }

    return this.applyHostReplacement(host.session, {
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
    });
  }

  private hostBlockAtSelection(
    elem: HTMLElement,
  ): { session: HostEditorSession; context: LineEditorBlockContext } | null {
    const session = this.hostEditorAdapterResolver.resolve(elem);
    const context = session?.getBlockContextAtSelection();
    return session && context ? { session, context } : null;
  }

  private applyHostReplacement(
    session: HostEditorSession,
    request: Parameters<HostEditorSession["applyBlockReplacement"]>[0],
  ): DomEditResult | null {
    const hostResult = session.applyBlockReplacement(request);
    if (hostResult.unverified)
      return {
        didMutateDom: true,
        didDispatchInput: hostResult.didDispatchInput,
        unverified: true,
      };
    return hostResult.applied
      ? { didMutateDom: true, didDispatchInput: hostResult.didDispatchInput, nativeUndo: true }
      : null;
  }

  private resolveHostEditorSession(
    elem: HTMLElement,
    expectedBlockContext: {
      beforeCursor: string;
      afterCursor: string;
      blockText: string;
    },
  ): HostEditorSession | null {
    const host = this.hostBlockAtSelection(elem);
    if (!host) {
      return null;
    }
    const { session, context: hostBlockContext } = host;
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
  }): EditResult {
    if (hostEditorSession) {
      return (
        this.applyHostReplacement(hostEditorSession, {
          replaceStart,
          replaceEnd,
          replacementText,
          cursorAfter,
        }) ?? { didMutateDom: false, didDispatchInput: false }
      );
    }

    // When the primary host session match failed (e.g. BR-separated line
    // context vs CKEditor-5 full-block), try with translated offsets.
    const fallbackResult = this.tryHostGrammarEditWithFullBlockOffsets(
      elem,
      blockSourceText,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
    );
    if (fallbackResult) {
      return fallbackResult;
    }

    if (this.hostEditorAdapterResolver.resolve(elem))
      return { didMutateDom: false, didDispatchInput: false };

    return this.replaceTextByOffsets(
      elem,
      blockSourceText,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
      { scopeRoot: activeBlock },
    );
  }

  private acceptContentEditableSuggestion(
    entry: SuggestionEntry,
    suggestion: string,
    blockContext: { beforeCursor: string; afterCursor: string },
    triggerText: string,
  ): AcceptedSuggestionEditResult | null {
    const startedAt = performance.now();
    const activeBlock = this.contentEditableAdapter.getActiveBlockElement(entry.elem);
    if (!activeBlock) {
      return null;
    }

    const beforeBlockBoundary = this.contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(
      entry.elem,
    );
    const blockSourceText = `${blockContext.beforeCursor}${blockContext.afterCursor}`;

    const replaceEnd = blockContext.beforeCursor.length;
    const replaceStart = Math.max(0, replaceEnd - triggerText.length);

    const trailingTokenText = beforeBlockBoundary
      ? ""
      : this.findTrailingToken(blockContext.afterCursor);
    const baseReplaceEnd = Math.min(blockSourceText.length, replaceEnd + trailingTokenText.length);
    const hostEditorSession = this.resolveHostEditorSession(entry.elem, {
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
        selectionCollapsed: TextTargetAdapter.hasCollapsedSelection(entry.elem),
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
    if (applyResult.unverified) {
      entry.pendingExtensionEdit = null;
      return {
        triggerText,
        insertedText: replacementText,
        cursorAfter,
        cursorAfterIsBlockLocal: true,
        unverified: true,
      };
    }
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

    const postEditBlockContext = this.contentEditableAdapter.getBlockContext(entry.elem);
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
      entry.pendingExtensionEdit.nativeUndo = applyResult.nativeUndo;
      entry.pendingExtensionEdit.cursorAfter = postEditCursorAfter;
      entry.pendingExtensionEdit.awaitingHostInputEcho = shouldAwaitHostInputEcho;
      entry.pendingExtensionEdit.postEditFingerprint = hostEditorApplied
        ? hostEditorSession.createPostEditFingerprint()
        : {
            fullText: "",
            cursorOffset: postEditCursorAfter,
            selectionCollapsed: TextTargetAdapter.hasCollapsedSelection(entry.elem),
          };
      entry.pendingExtensionEdit.blockElement = activeBlock;
      entry.pendingExtensionEdit.postEditBlockText = postEditBlockText;
    }

    logger.debug("Accepted contenteditable suggestion", {
      suggestionLength: suggestion.length,
      replacementLength: replacementText.length,
      blockTextLength: blockSourceText.length,
      durationMs: performance.now() - startedAt,
      blockScoped: true,
    });

    return {
      triggerText,
      insertedText: replacementText,
      cursorAfter: postEditCursorAfter,
      cursorAfterIsBlockLocal: true,
      // Deferred host acceptance is not proof of a write. The input echo must
      // match the pending fingerprint; never learn before that reconciliation.
      ...(hostAcceptedAsync ? { unverified: true } : {}),
    };
  }
}
