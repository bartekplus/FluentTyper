export type TextTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

export interface TextCursorSnapshot {
  beforeCursor: string;
  afterCursor: string;
  cursorOffset: number;
}

export class TextTargetAdapter {
  static snapshot(target: TextTarget): TextCursorSnapshot {
    const tagName = (target as Element).tagName?.toUpperCase();
    if (tagName === "INPUT" || tagName === "TEXTAREA") {
      const textTarget = target as HTMLInputElement | HTMLTextAreaElement;
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

    const range = selection.getRangeAt(0).cloneRange();
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
  }
}
