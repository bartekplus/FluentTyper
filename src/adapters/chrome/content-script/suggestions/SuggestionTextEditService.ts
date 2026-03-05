import { createLogger } from "@core/application/logging/Logger";
import { SPACING_RULES, Spacing } from "@core/domain/spacingRules";
import type { TextEditOperation } from "@core/domain/messageTypes";
import { ContentEditableAdapter, type ContentEditableEditResult } from "./ContentEditableAdapter";
import { isOnlyFillers, trimTrailingFillers } from "./editorFillers";
import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type { SuggestionEntry, SuggestionElement, SuggestionSnapshot } from "./types";

const logger = createLogger("SuggestionTextEditService");

export interface TextEditApplyResult {
  applied: boolean;
  didDispatchInput: boolean;
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
    entry.lastAutoFixReplacement = null;
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

    const trailingTokenText = this.findTrailingToken(
      blockContext?.afterCursor ?? currentFullText.slice(replaceEnd),
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

    const cursorAfter = replaceStart + suggestion.length;

    this.replaceTextByOffsets(
      entry.elem,
      currentFullText,
      replaceStart,
      finalReplaceEnd,
      suggestion,
      cursorAfter,
    );

    entry.lastReplacement = {
      triggerText: `${replacedTokenText}${consumedTrailingWhitespace}`,
      insertedText: suggestion,
      cursorAfter,
    };

    return {
      triggerText,
      insertedText: suggestion,
    };
  }

  public tryRevertLastReplacement(
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
    if (!entry.lastReplacement) {
      return false;
    }

    const snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const { triggerText, insertedText, cursorAfter } = entry.lastReplacement;

    if (snapshot.cursorOffset !== cursorAfter || !snapshot.beforeCursor.endsWith(insertedText)) {
      return false;
    }

    consumeKeyboardEvent(event);

    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceEnd = snapshot.beforeCursor.length;
    const replaceStart = Math.max(0, replaceEnd - insertedText.length);
    const nextCursor = replaceStart + triggerText.length;

    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      triggerText,
      nextCursor,
    );

    entry.lastReplacement = null;
    entry.lastAutoFixReplacement = null;
    clearSuggestions();
    return true;
  }

  public tryRevertLastAutoFix(
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
    if (!entry.lastAutoFixReplacement) {
      return false;
    }

    const snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const { replaceStart, originalText, replacementText, cursorBefore, cursorAfter } =
      entry.lastAutoFixReplacement;
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceEnd = replaceStart + replacementText.length;

    if (snapshot.cursorOffset !== cursorAfter) {
      entry.lastAutoFixReplacement = null;
      return false;
    }
    if (replaceEnd > fullText.length) {
      entry.lastAutoFixReplacement = null;
      return false;
    }
    if (fullText.slice(replaceStart, replaceEnd) !== replacementText) {
      entry.lastAutoFixReplacement = null;
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

    entry.lastAutoFixReplacement = null;
    clearSuggestions();
    return true;
  }

  public applyTextEdit(entry: SuggestionEntry, textEdit: TextEditOperation): TextEditApplyResult {
    const snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;

    const replaceBackwardCount = Math.max(0, textEdit.replaceBackwardCount);
    let evaluatedLength = Number.isFinite(textEdit.evaluatedTextLength)
      ? Math.max(0, textEdit.evaluatedTextLength)
      : fullText.length;
    let beforeCursorLength = snapshot.beforeCursor.length;
    let replaceStart = Math.max(
      0,
      Math.min(fullText.length, evaluatedLength - replaceBackwardCount),
    );
    let replaceEnd = Math.max(
      replaceStart,
      Math.min(fullText.length, replaceStart + replaceBackwardCount),
    );

    const blockMappedRange = this.resolveContentEditableBlockTextEditRange(
      entry.elem,
      snapshot,
      fullText,
      textEdit,
      replaceBackwardCount,
    );
    if (blockMappedRange) {
      evaluatedLength = blockMappedRange.evaluatedLength;
      beforeCursorLength = blockMappedRange.beforeCursorLength;
      replaceStart = blockMappedRange.replaceStart;
      replaceEnd = blockMappedRange.replaceEnd;
    }

    if (beforeCursorLength > evaluatedLength && this.isTrailingSpaceEdit(textEdit)) {
      return { applied: false, didDispatchInput: false };
    }

    if (textEdit.expectedReplacedText !== undefined) {
      const currentSubstring = fullText.slice(replaceStart, replaceEnd);
      if (currentSubstring !== textEdit.expectedReplacedText) {
        logger.debug("Skipping textEdit due to replaced text mismatch", {
          expected: textEdit.expectedReplacedText,
          actual: currentSubstring,
        });
        return { applied: false, didDispatchInput: false };
      }
    }

    if (textEdit.expectedPrefixToken !== undefined) {
      const tokenStart = Math.max(0, replaceStart - textEdit.expectedPrefixToken.length);
      const actualToken = fullText.slice(tokenStart, replaceStart);
      if (actualToken !== textEdit.expectedPrefixToken) {
        logger.debug("Skipping textEdit due to prefix token mismatch", {
          expected: textEdit.expectedPrefixToken,
          actual: actualToken,
        });
        return { applied: false, didDispatchInput: false };
      }
    }

    const cursorAfter = replaceStart + textEdit.replacementText.length;
    const originalText = fullText.slice(replaceStart, replaceEnd);
    const applyResult = this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      textEdit.replacementText,
      cursorAfter,
    );
    entry.lastAutoFixReplacement = {
      replaceStart,
      originalText,
      replacementText: textEdit.replacementText,
      cursorBefore: snapshot.cursorOffset,
      cursorAfter,
    };
    return {
      applied: true,
      didDispatchInput: applyResult.didDispatchInput,
    };
  }

  private resolveContentEditableBlockTextEditRange(
    elem: SuggestionElement,
    snapshot: SuggestionSnapshot,
    fullText: string,
    textEdit: TextEditOperation,
    replaceBackwardCount: number,
  ): {
    evaluatedLength: number;
    beforeCursorLength: number;
    replaceStart: number;
    replaceEnd: number;
  } | null {
    if (this.isTextValueElement(elem)) {
      return null;
    }

    const blockContext = this.contentEditableAdapter.getBlockContext(elem);
    if (!blockContext) {
      return null;
    }

    const blockBeforeCursor = blockContext.beforeCursor;
    const blockAfterCursor = blockContext.afterCursor;
    const blockText = `${blockBeforeCursor}${blockAfterCursor}`;
    const blockStart = snapshot.beforeCursor.length - blockBeforeCursor.length;
    const blockEnd = blockStart + blockText.length;

    if (blockStart < 0 || blockEnd > fullText.length) {
      return null;
    }

    const evaluatedLength = Number.isFinite(textEdit.evaluatedTextLength)
      ? Math.max(0, Math.min(blockText.length, textEdit.evaluatedTextLength))
      : blockBeforeCursor.length;
    const localReplaceStart = Math.max(
      0,
      Math.min(blockText.length, evaluatedLength - replaceBackwardCount),
    );
    const localReplaceEnd = Math.max(
      localReplaceStart,
      Math.min(blockText.length, localReplaceStart + replaceBackwardCount),
    );

    return {
      evaluatedLength,
      beforeCursorLength: blockBeforeCursor.length,
      replaceStart: blockStart + localReplaceStart,
      replaceEnd: blockStart + localReplaceEnd,
    };
  }

  public tryDeleteTrailingPunctuationSpace(
    entry: SuggestionEntry,
    event: KeyboardEvent,
    consumeKeyboardEvent: (event: KeyboardEvent) => void,
  ): boolean {
    if (event.key !== "Backspace") {
      return false;
    }

    const snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    if (!isOnlyFillers(snapshot.afterCursor)) {
      return false;
    }
    const normalizedBeforeCursor = trimTrailingFillers(snapshot.beforeCursor);
    if (normalizedBeforeCursor.length < 2) {
      return false;
    }

    const trailingChar = normalizedBeforeCursor.charAt(normalizedBeforeCursor.length - 1);
    if (!/[ \xA0]/.test(trailingChar)) {
      return false;
    }

    const punctuationChar = normalizedBeforeCursor.charAt(normalizedBeforeCursor.length - 2);
    const spacingRule = SPACING_RULES[punctuationChar];
    if (!spacingRule || spacingRule.spaceAfter !== Spacing.INSERT_SPACE) {
      return false;
    }

    consumeKeyboardEvent(event);

    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceEnd = normalizedBeforeCursor.length;
    const replaceStart = replaceEnd - 1;

    this.replaceTextByOffsets(entry.elem, fullText, replaceStart, replaceEnd, "", replaceStart);
    entry.lastAutoFixReplacement = null;
    return true;
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

  private isTrailingSpaceEdit(textEdit: TextEditOperation): boolean {
    if (typeof textEdit.replacementText !== "string") {
      return false;
    }
    return /[ \xA0]$/.test(textEdit.replacementText);
  }

  private replaceTextByOffsets(
    elem: SuggestionElement,
    fullText: string,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ): ContentEditableEditResult | { didDispatchInput: true } {
    const boundedStart = Math.max(0, Math.min(fullText.length, replaceStart));
    const boundedEnd = Math.max(boundedStart, Math.min(fullText.length, replaceEnd));
    const updatedText = `${fullText.slice(0, boundedStart)}${replacementText}${fullText.slice(boundedEnd)}`;

    if (this.isTextValueElement(elem)) {
      elem.value = updatedText;
      elem.selectionStart = cursorAfter;
      elem.selectionEnd = cursorAfter;
      this.dispatchInputEvent(elem);
      return { didDispatchInput: true };
    }

    return this.contentEditableAdapter.replaceTextByOffsets(
      elem,
      boundedStart,
      boundedEnd,
      replacementText,
      cursorAfter,
    );
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
