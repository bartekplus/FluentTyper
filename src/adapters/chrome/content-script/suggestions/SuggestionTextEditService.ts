import { createLogger } from "@core/application/logging/Logger";
import { SPACING_RULES, Spacing } from "@core/domain/spacingRules";
import type { TextEditOperation } from "@core/domain/messageTypes";
import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type { SuggestionEntry, SuggestionElement, SuggestionSnapshot } from "./types";

const logger = createLogger("SuggestionTextEditService");

interface ContentEditableTextPosition {
  node: Text;
  offset: number;
}

export class SuggestionTextEditService {
  private readonly findMentionToken: (beforeCursor: string) => { token: string; start: number };
  private readonly isSeparator: (value: string) => boolean;

  constructor({
    findMentionToken,
    isSeparator,
  }: {
    findMentionToken: (beforeCursor: string) => { token: string; start: number };
    isSeparator: (value: string) => boolean;
  }) {
    this.findMentionToken = findMentionToken;
    this.isSeparator = isSeparator;
  }

  public acceptSuggestion(
    entry: SuggestionEntry,
    suggestion: string,
  ): { triggerText: string; insertedText: string } | null {
    let snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const blockContext = this.isTextValueElement(entry.elem)
      ? null
      : this.getContentEditableBlockContext(entry.elem);
    const tokenSource = blockContext?.beforeCursor ?? snapshot.beforeCursor;
    const tokenInfo = this.findMentionToken(tokenSource);
    const triggerText = tokenInfo.token || entry.latestMentionText;

    if (!this.isTextValueElement(entry.elem) && triggerText && snapshot.beforeCursor.length === 0) {
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
    const globalTokenInfo = this.findMentionToken(snapshot.beforeCursor);
    if (!this.isTextValueElement(entry.elem) && globalTokenInfo.token.length === 0) {
      while (replaceEnd > 0 && this.isSeparator(snapshot.beforeCursor.charAt(replaceEnd - 1))) {
        replaceEnd -= 1;
      }
    }
    let replaceStart = Math.max(0, replaceEnd - triggerText.length);

    if (
      !this.isTextValueElement(entry.elem) &&
      tokenInfo.token.length === 0 &&
      triggerText.length > 0 &&
      entry.latestMentionStart >= 0
    ) {
      const storedStart = entry.latestMentionStart;
      const storedEnd = storedStart + triggerText.length;
      if (
        storedEnd <= currentFullText.length &&
        storedStart <= replaceEnd &&
        currentFullText.slice(storedStart, storedEnd).toLowerCase() === triggerText.toLowerCase()
      ) {
        replaceStart = storedStart;
        replaceEnd = storedEnd;
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
    this.dispatchInputEvent(entry.elem);

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
    this.dispatchInputEvent(entry.elem);

    entry.lastReplacement = null;
    clearSuggestions();
    return true;
  }

  public applyTextEdit(entry: SuggestionEntry, textEdit: TextEditOperation): void {
    const snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;

    const evaluatedLength = Number.isFinite(textEdit.evaluatedTextLength)
      ? Math.max(0, textEdit.evaluatedTextLength)
      : fullText.length;
    const replaceBackwardCount = Math.max(0, textEdit.replaceBackwardCount);

    const replaceStart = Math.max(
      0,
      Math.min(fullText.length, evaluatedLength - replaceBackwardCount),
    );
    const replaceEnd = Math.max(
      replaceStart,
      Math.min(fullText.length, replaceStart + replaceBackwardCount),
    );

    if (fullText.length > evaluatedLength && this.isTrailingSpaceEdit(textEdit)) {
      return;
    }

    if (textEdit.expectedReplacedText !== undefined) {
      const currentSubstring = fullText.slice(replaceStart, replaceEnd);
      if (currentSubstring !== textEdit.expectedReplacedText) {
        logger.debug("Skipping textEdit due to replaced text mismatch", {
          expected: textEdit.expectedReplacedText,
          actual: currentSubstring,
        });
        return;
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
        return;
      }
    }

    const cursorAfter = replaceStart + textEdit.replacementText.length;
    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      textEdit.replacementText,
      cursorAfter,
    );
    this.dispatchInputEvent(entry.elem);
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
    const replacementText = `\xA0${key}`;
    const cursorAfter = replaceStart + replacementText.length;

    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
    );
    this.dispatchInputEvent(entry.elem);
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
    return textEdit.replacementText.endsWith("\xA0");
  }

  private replaceTextByOffsets(
    elem: SuggestionElement,
    fullText: string,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ): void {
    const boundedStart = Math.max(0, Math.min(fullText.length, replaceStart));
    const boundedEnd = Math.max(boundedStart, Math.min(fullText.length, replaceEnd));
    const updatedText = `${fullText.slice(0, boundedStart)}${replacementText}${fullText.slice(boundedEnd)}`;

    if (this.isTextValueElement(elem)) {
      elem.value = updatedText;
      elem.selectionStart = cursorAfter;
      elem.selectionEnd = cursorAfter;
      return;
    }

    this.replaceContentEditableTextByOffsets(
      elem,
      boundedStart,
      boundedEnd,
      replacementText,
      cursorAfter,
    );
  }

  private replaceContentEditableTextByOffsets(
    elem: HTMLElement,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ): void {
    const startPosition = this.resolveContentEditablePosition(elem, replaceStart);
    const endPosition = this.resolveContentEditablePosition(elem, replaceEnd);

    elem.focus();

    const range = document.createRange();
    range.setStart(startPosition.node, startPosition.offset);
    range.setEnd(endPosition.node, endPosition.offset);

    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    selection.removeAllRanges();
    selection.addRange(range);

    const beforeText = elem.textContent ?? "";
    this.dispatchContentEditableInputSequence(elem, range, replacementText);

    if ((elem.textContent ?? "") === beforeText) {
      range.deleteContents();
      if (replacementText.length > 0) {
        const replacementNode = document.createTextNode(replacementText);
        range.insertNode(replacementNode);
        replacementNode.parentNode?.normalize();
      }
    }

    this.setContentEditableCaret(elem, cursorAfter);
  }

  private getContentEditableBlockContext(
    elem: HTMLElement,
  ): { beforeCursor: string; afterCursor: string } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const targetNode = elem as Node;
    const startInside =
      range.startContainer === targetNode || targetNode.contains(range.startContainer);
    const endInside = range.endContainer === targetNode || targetNode.contains(range.endContainer);
    if (!startInside || !endInside) {
      return null;
    }

    const block = this.resolveContentEditableBlock(range.startContainer, elem);
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(block);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    const afterRange = range.cloneRange();
    afterRange.selectNodeContents(block);
    afterRange.setStart(range.endContainer, range.endOffset);

    return {
      beforeCursor: beforeRange.toString(),
      afterCursor: afterRange.toString(),
    };
  }

  private resolveContentEditableBlock(node: Node, root: HTMLElement): HTMLElement {
    const blockTags = new Set([
      "P",
      "DIV",
      "LI",
      "BLOCKQUOTE",
      "PRE",
      "TD",
      "TH",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
    ]);

    let current: HTMLElement | null =
      node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);

    while (current && current !== root) {
      if (blockTags.has(current.tagName)) {
        return current;
      }
      current = current.parentElement;
    }

    return root;
  }

  private dispatchContentEditableInputSequence(
    elem: HTMLElement,
    range: Range,
    replacementText: string,
  ): void {
    const beforeInputEvent = this.createContentEditableInputEvent("beforeinput", {
      inputType: "insertReplacementText",
      data: replacementText,
      cancelable: true,
      targetRange: range,
    });
    elem.dispatchEvent(beforeInputEvent);

    const inputEvent = this.createContentEditableInputEvent("input", {
      inputType: "insertReplacementText",
      data: replacementText,
      cancelable: false,
      targetRange: range,
    });
    elem.dispatchEvent(inputEvent);
  }

  private createContentEditableInputEvent(
    type: "beforeinput" | "input",
    {
      inputType,
      data,
      cancelable,
      targetRange,
    }: {
      inputType: string;
      data: string;
      cancelable: boolean;
      targetRange: Range;
    },
  ): Event {
    const staticRangeCtor = (globalThis as { StaticRange?: typeof StaticRange }).StaticRange;
    const targetRanges =
      typeof staticRangeCtor === "function"
        ? [
            new staticRangeCtor({
              startContainer: targetRange.startContainer,
              startOffset: targetRange.startOffset,
              endContainer: targetRange.endContainer,
              endOffset: targetRange.endOffset,
            }),
          ]
        : undefined;

    if (typeof InputEvent === "function") {
      const init = {
        bubbles: true,
        cancelable,
        inputType,
        data: data || undefined,
        targetRanges,
      } as unknown as InputEventInit;
      return new InputEvent(type, init);
    }

    const event = new Event(type, {
      bubbles: true,
      cancelable,
    }) as Event & { inputType?: string; data?: string };
    event.inputType = inputType;
    event.data = data;
    return event;
  }

  private setContentEditableCaret(elem: HTMLElement, cursorOffset: number): void {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const position = this.resolveContentEditablePosition(elem, cursorOffset);
    const range = document.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
  }

  private resolveContentEditablePosition(
    elem: HTMLElement,
    targetOffset: number,
  ): ContentEditableTextPosition {
    const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode() as Text | null;

    if (!current) {
      const textNode = document.createTextNode("");
      elem.appendChild(textNode);
      return { node: textNode, offset: 0 };
    }

    const clampedTarget = Math.max(0, targetOffset);
    const probeRange = document.createRange();
    probeRange.selectNodeContents(elem);

    let lastNode = current;
    let lastNodeLength = current.textContent?.length ?? 0;

    while (current) {
      lastNode = current;
      lastNodeLength = current.textContent?.length ?? 0;

      probeRange.setEnd(current, 0);
      const nodeStartOffset = probeRange.toString().length;

      probeRange.setEnd(current, lastNodeLength);
      const nodeEndOffset = probeRange.toString().length;

      if (clampedTarget <= nodeEndOffset) {
        const offsetInNode = Math.max(0, Math.min(lastNodeLength, clampedTarget - nodeStartOffset));
        return { node: current, offset: offsetInNode };
      }

      current = walker.nextNode() as Text | null;
    }

    return {
      node: lastNode,
      offset: lastNodeLength,
    };
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
