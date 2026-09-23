import type { PostEditFingerprint } from "./types";

export type TextTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface TextCursorSnapshot {
  beforeCursor: string;
  afterCursor: string;
  cursorOffset: number;
}

export function rangeInsideTarget(range: Range, target: Node): boolean {
  const inside = (node: Node) => node === target || target.contains(node);
  return inside(range.startContainer) && inside(range.endContainer);
}

function wholeTextSnapshot(target: TextTarget): TextCursorSnapshot {
  const text = target.textContent ?? "";
  return { beforeCursor: text, afterCursor: "", cursorOffset: text.length };
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

  static findBackingTextValueTarget(elem: Element): HTMLInputElement | HTMLTextAreaElement | null {
    if (TextTargetAdapter.isTextValue(elem)) {
      return elem;
    }
    if (!(elem instanceof HTMLElement)) {
      return null;
    }
    const codeMirrorRoot = elem.closest(".CodeMirror");
    if (!(codeMirrorRoot instanceof HTMLElement)) {
      return null;
    }
    const candidate = codeMirrorRoot.previousElementSibling;
    const view = candidate?.ownerDocument?.defaultView;
    const InputCtor = view?.HTMLInputElement;
    const TextAreaCtor = view?.HTMLTextAreaElement;
    if (
      candidate &&
      ((typeof InputCtor === "function" && candidate instanceof InputCtor) ||
        (typeof TextAreaCtor === "function" && candidate instanceof TextAreaCtor))
    ) {
      return candidate;
    }
    return null;
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

    if (!rangeInsideTarget(selection.getRangeAt(0), target)) {
      return true;
    }

    return selection.isCollapsed;
  }

  static snapshot(target: TextTarget): TextCursorSnapshot {
    if (TextTargetAdapter.isTextValue(target)) {
      const value = target.value ?? "";
      const cursorOffset = target.selectionStart ?? value.length;
      return {
        beforeCursor: value.slice(0, cursorOffset),
        afterCursor: value.slice(cursorOffset),
        cursorOffset,
      };
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return wholeTextSnapshot(target);
    }

    const range = selection.getRangeAt(0);
    if (!rangeInsideTarget(range, target)) {
      return wholeTextSnapshot(target);
    }

    try {
      const preRange = range.cloneRange();
      preRange.selectNodeContents(target);
      preRange.setEnd(range.startContainer, range.startOffset);
      const beforeCursor = preRange.toString();

      const postRange = range.cloneRange();
      postRange.selectNodeContents(target);
      postRange.setStart(range.endContainer, range.endOffset);
      const afterCursor = postRange.toString();

      return {
        beforeCursor,
        afterCursor,
        cursorOffset: beforeCursor.length,
      };
    } catch {
      return wholeTextSnapshot(target);
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
