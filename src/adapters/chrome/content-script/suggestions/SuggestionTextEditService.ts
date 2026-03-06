import { createLogger } from "@core/application/logging/Logger";
import type { GrammarEdit } from "@core/domain/grammar/types";
import { SPACING_RULES, Spacing } from "@core/domain/spacingRules";
import { ContentEditableAdapter, type ContentEditableEditResult } from "./ContentEditableAdapter";
import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type {
  ManualAutoFixSuppressionSnapshot,
  SuggestionEntry,
  SuggestionElement,
  SuggestionSnapshot,
} from "./types";

const logger = createLogger("SuggestionTextEditService");

export interface TextEditApplyResult {
  applied: boolean;
  didDispatchInput: boolean;
}

export interface GrammarEditApplyContext {
  snapshot?: SuggestionSnapshot;
  contentEditableContext?: {
    beforeCursor: string;
    afterCursor: string;
    useFullTextOffsets: boolean;
  } | null;
}

export class SuggestionTextEditService {
  private readonly findMentionToken: (beforeCursor: string) => { token: string; start: number };
  private readonly isSeparator: (value: string) => boolean;
  private readonly contentEditableAdapter: ContentEditableAdapter;

  constructor({
    findMentionToken,
    isSeparator,
    contentEditableAdapter = new ContentEditableAdapter(),
  }: {
    findMentionToken: (beforeCursor: string) => { token: string; start: number };
    isSeparator: (value: string) => boolean;
    contentEditableAdapter?: ContentEditableAdapter;
  }) {
    this.findMentionToken = findMentionToken;
    this.isSeparator = isSeparator;
    this.contentEditableAdapter = contentEditableAdapter;
  }

  public acceptSuggestion(
    entry: SuggestionEntry,
    suggestion: string,
  ): { triggerText: string; insertedText: string } | null {
    entry.pendingExtensionEdit = null;
    entry.manualAutoFixSuppression = null;
    const isTextValueTarget = this.isTextValueElement(entry.elem);
    let snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const blockContext = isTextValueTarget
      ? null
      : this.contentEditableAdapter.getBlockContext(entry.elem);
    const tokenSource = blockContext?.beforeCursor ?? snapshot.beforeCursor;
    const tokenInfo = this.findMentionToken(tokenSource);
    const cursorTokenInfo = this.findMentionToken(snapshot.beforeCursor);
    const triggerText = isTextValueTarget
      ? tokenInfo.token || cursorTokenInfo.token || entry.latestMentionText
      : tokenInfo.token || entry.latestMentionText;

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
    const replacementText = this.normalizeContentEditableTrailingSpace(
      entry.elem,
      suggestion,
      beforeBlockBoundary,
    );

    const cursorAfter = replaceStart + replacementText.length;
    const originalText = `${replacedTokenText}${consumedTrailingWhitespace}`;

    this.replaceTextByOffsets(
      entry.elem,
      currentFullText,
      replaceStart,
      finalReplaceEnd,
      replacementText,
      cursorAfter,
    );
    const postEditSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);

    entry.pendingExtensionEdit = {
      replaceStart,
      originalText,
      replacementText,
      cursorBefore: snapshot.cursorOffset,
      cursorAfter: postEditSnapshot.cursorOffset,
      postEditFingerprint: TextTargetAdapter.createPostEditFingerprint(
        entry.elem as TextTarget,
        postEditSnapshot,
      ),
      source: "suggestion",
    };

    return {
      triggerText,
      insertedText: replacementText,
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
    if (!entry.pendingExtensionEdit) {
      return false;
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

    if (
      !TextTargetAdapter.matchesPostEditFingerprint(
        entry.elem as TextTarget,
        postEditFingerprint,
        snapshot,
      )
    ) {
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

    consumeKeyboardEvent(event);

    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      originalText,
      cursorBefore,
    );

    if (source === "grammar") {
      const revertedFullText = `${fullText.slice(0, replaceStart)}${originalText}${fullText.slice(replaceEnd)}`;
      entry.manualAutoFixSuppression = this.createManualAutoFixSuppression({
        ruleKey: this.resolveAutoFixRuleKey(sourceRuleId, originalText, replacementText),
        replaceStart,
        fullText: revertedFullText,
        cursorOffset: cursorBefore,
      });
    } else {
      entry.manualAutoFixSuppression = null;
    }
    entry.pendingExtensionEdit = null;
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
    edit: GrammarEdit & Record<string, unknown>,
    context: GrammarEditApplyContext = {},
  ): TextEditApplyResult {
    const replacement =
      typeof edit.replacement === "string"
        ? edit.replacement
        : typeof edit.replacementText === "string"
          ? edit.replacementText
          : "";
    const deleteBackwards = Number.isFinite(edit.deleteBackwards)
      ? Math.max(0, edit.deleteBackwards)
      : Number.isFinite(edit.replaceBackwardCount)
        ? Math.max(0, edit.replaceBackwardCount)
        : 0;
    const deleteForwards = Number.isFinite(edit.deleteForwards)
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

    if (!this.isTextValueElement(entry.elem)) {
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
        const blockEnd = blockStart + blockContext.beforeCursor.length + blockContext.afterCursor.length;
        if (blockStart < 0 || blockEnd > fullText.length) {
          return { applied: false, didDispatchInput: false };
        }

        replaceStart = Math.max(0, blockStart + blockCursor - deleteBackwards);
        replaceEnd = Math.max(
          replaceStart,
          Math.min(fullText.length, blockStart + blockCursor + deleteForwards),
        );
      }
    }

    const originalText = fullText.slice(replaceStart, replaceEnd);
    const sourceRuleKey = this.resolveAutoFixRuleKey(
      edit.sourceRuleId,
      originalText,
      replacement,
    );
    if (
      entry.manualAutoFixSuppression &&
      entry.manualAutoFixSuppression.ruleKey === sourceRuleKey &&
      entry.manualAutoFixSuppression.replaceStart === replaceStart
    ) {
      logger.debug("Skipping textEdit due to manual revert suppression lock", {
        sourceRuleKey,
        replaceStart,
      });
      return { applied: false, didDispatchInput: false };
    }

    const cursorAfter = this.resolveCursorAfterTextEdit(
      snapshot.cursorOffset,
      replaceStart,
      replaceEnd,
      replacement,
    );
    const applyResult = this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      replacement,
      cursorAfter,
      { preferDomMutation: this.shouldPreferDomMutationForGrammar(entry.elem) },
    );
    if (!applyResult.didMutateDom) {
      return {
        applied: false,
        didDispatchInput: false,
      };
    }
    const postEditSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);

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
      didDispatchInput: applyResult.didDispatchInput,
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

    const snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    if (snapshot.cursorOffset !== entry.expectedCursorPos || key.length > 1) {
      entry.missingTrailingSpace = false;
      return;
    }

    if (!(key.length === 1 && key.trim().length > 0)) {
      return;
    }

    entry.missingTrailingSpace = false;

    const charBeforeCursor = snapshot.beforeCursor.charAt(snapshot.beforeCursor.length - 1) || "";
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

    consumeKeyboardEvent(event);

    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceStart = snapshot.beforeCursor.length;
    const replaceEnd = replaceStart;
    const replacementText = ` ${key}`;
    const cursorAfter = replaceStart + replacementText.length;

    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
    );
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

  private replaceTextByOffsets(
    elem: SuggestionElement,
    fullText: string,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
    options: { preferDomMutation?: boolean } = {},
  ): ContentEditableEditResult | { didMutateDom: boolean; didDispatchInput: boolean } {
    const boundedStart = Math.max(0, Math.min(fullText.length, replaceStart));
    const boundedEnd = Math.max(boundedStart, Math.min(fullText.length, replaceEnd));
    const updatedText = `${fullText.slice(0, boundedStart)}${replacementText}${fullText.slice(boundedEnd)}`;

    if (this.isTextValueElement(elem)) {
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
    beforeBlockBoundary: boolean,
  ): string {
    if (this.isTextValueElement(elem) || !beforeBlockBoundary || !/ $/.test(replacementText)) {
      return replacementText;
    }

    // Rich editors can drop a plain trailing space when an insertion lands
    // immediately before a nested block. NBSP preserves the visible gap.
    return `${replacementText.slice(0, -1)}\xA0`;
  }

  private shouldPreferDomMutationForGrammar(elem: SuggestionElement): boolean {
    if (this.isTextValueElement(elem)) {
      return false;
    }
    return elem.classList.contains("ql-editor") || elem.closest(".ql-editor") !== null;
  }

  private dispatchInputEvent(elem: SuggestionElement): void {
    elem.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private isInputElement(elem: Element): elem is HTMLInputElement {
    return elem.tagName === "INPUT";
  }

  private isTextAreaElement(elem: Element): elem is HTMLTextAreaElement {
    return elem.tagName === "TEXTAREA";
  }

  private isTextValueElement(elem: Element): elem is HTMLInputElement | HTMLTextAreaElement {
    return this.isInputElement(elem) || this.isTextAreaElement(elem);
  }
}
