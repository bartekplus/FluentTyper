interface ContentEditableTextPosition {
  node: Text;
  offset: number;
}

export class ContentEditableAdapter {
  public replaceTextByOffsets(
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
    this.dispatchReplacementBeforeInput(elem, range, replacementText);

    if ((elem.textContent ?? "") === beforeText) {
      range.deleteContents();
      if (replacementText.length > 0) {
        const replacementNode = document.createTextNode(replacementText);
        range.insertNode(replacementNode);
        replacementNode.parentNode?.normalize();
      }
    }

    this.setCaret(elem, cursorAfter);
  }

  public getBlockContext(elem: HTMLElement): { beforeCursor: string; afterCursor: string } | null {
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

    const block = this.resolveBlock(range.startContainer, elem);
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

  private resolveBlock(node: Node, root: HTMLElement): HTMLElement {
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

  private dispatchReplacementBeforeInput(
    elem: HTMLElement,
    range: Range,
    replacementText: string,
  ): void {
    const beforeInputEvent = this.createInputEvent("beforeinput", {
      inputType: "insertReplacementText",
      data: replacementText,
      cancelable: true,
      targetRange: range,
    });
    elem.dispatchEvent(beforeInputEvent);
  }

  private createInputEvent(
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

  private setCaret(elem: HTMLElement, cursorOffset: number): void {
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
}
