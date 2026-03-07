import type { PostEditFingerprint } from "./types";

export type TextTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

export interface TextCursorSnapshot {
  beforeCursor: string;
  afterCursor: string;
  cursorOffset: number;
}

export class TextTargetAdapter {
  static isInput(elem: Element): elem is HTMLInputElement {
    return elem.tagName === "INPUT";
  }

  static isTextArea(elem: Element): elem is HTMLTextAreaElement {
    return elem.tagName === "TEXTAREA";
  }

  static isTextValue(elem: Element): elem is HTMLInputElement | HTMLTextAreaElement {
    return TextTargetAdapter.isInput(elem) || TextTargetAdapter.isTextArea(elem);
  }

  static hasCollapsedSelection(target: TextTarget): boolean {
    if (TextTargetAdapter.isTextValue(target)) {
      if (target.selectionStart === null || target.selectionEnd === null) {
        return true;
      }
      return target.selectionStart === target.selectionEnd;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return true;
    }

    const targetNode = target as Node;
    const range = selection.getRangeAt(0);
    const startInsideTarget =
      range.startContainer === targetNode || targetNode.contains(range.startContainer);
    const endInsideTarget =
      range.endContainer === targetNode || targetNode.contains(range.endContainer);
    if (!startInsideTarget || !endInsideTarget) {
      return true;
    }

    return selection.isCollapsed;
  }

  static snapshot(target: TextTarget): TextCursorSnapshot {
    if (TextTargetAdapter.isTextValue(target)) {
      const textTarget = target;
      const value = textTarget.value ?? "";
      const cursorOffset = textTarget.selectionStart ?? value.length;
      return {
        beforeCursor: value.slice(0, cursorOffset),
        afterCursor: value.slice(cursorOffset),
        cursorOffset,
      };
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      const text = target.textContent ?? "";
      return {
        beforeCursor: text,
        afterCursor: "",
        cursorOffset: text.length,
      };
    }

    const range = selection.getRangeAt(0);
    const targetNode = target as Node;
    const startInsideTarget =
      range.startContainer === targetNode || targetNode.contains(range.startContainer);
    const endInsideTarget =
      range.endContainer === targetNode || targetNode.contains(range.endContainer);

    if (!startInsideTarget || !endInsideTarget) {
      const text = target.textContent ?? "";
      return {
        beforeCursor: text,
        afterCursor: "",
        cursorOffset: text.length,
      };
    }

    try {
      const clonedRange = range.cloneRange();
      const preRange = clonedRange.cloneRange();
      preRange.selectNodeContents(target);
      preRange.setEnd(clonedRange.startContainer, clonedRange.startOffset);
      const beforeCursor = preRange.toString();

      const postRange = clonedRange.cloneRange();
      postRange.selectNodeContents(target);
      postRange.setStart(clonedRange.endContainer, clonedRange.endOffset);
      const afterCursor = postRange.toString();

      return {
        beforeCursor,
        afterCursor,
        cursorOffset: beforeCursor.length,
      };
    } catch {
      const text = target.textContent ?? "";
      return {
        beforeCursor: text,
        afterCursor: "",
        cursorOffset: text.length,
      };
    }
  }

  static createPostEditFingerprint(
    target: TextTarget,
    snapshotOverride?: TextCursorSnapshot,
  ): PostEditFingerprint {
    const snapshot = snapshotOverride ?? TextTargetAdapter.snapshot(target);
    return {
      fullText: `${snapshot.beforeCursor}${snapshot.afterCursor}`,
      cursorOffset: snapshot.cursorOffset,
      selectionCollapsed: TextTargetAdapter.hasCollapsedSelection(target),
    };
  }

  static matchesPostEditFingerprint(
    target: TextTarget,
    expected: PostEditFingerprint,
    snapshotOverride?: TextCursorSnapshot,
  ): boolean {
    const actual = TextTargetAdapter.createPostEditFingerprint(target, snapshotOverride);
    return (
      actual.fullText === expected.fullText &&
      actual.cursorOffset === expected.cursorOffset &&
      actual.selectionCollapsed === expected.selectionCollapsed
    );
  }
}
