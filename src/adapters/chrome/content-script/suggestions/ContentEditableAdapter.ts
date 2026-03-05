interface ContentEditableDomPosition {
  container: Node;
  offset: number;
}

export type ContentEditableApplySource = "host-beforeinput" | "fallback-dom";

export interface ContentEditableEditResult {
  appliedBy: ContentEditableApplySource;
  didMutateDom: boolean;
  didDispatchInput: boolean;
}

export class ContentEditableAdapter {
  public replaceTextByOffsets(
    elem: HTMLElement,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ): ContentEditableEditResult {
    const startPosition = this.resolveContentEditablePosition(elem, replaceStart);
    const endPosition = this.resolveContentEditablePosition(elem, replaceEnd);

    elem.focus();

    const range = document.createRange();
    range.setStart(startPosition.container, startPosition.offset);
    range.setEnd(endPosition.container, endPosition.offset);

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const beforeText = elem.textContent ?? "";
    const beforeInputEvent = this.dispatchReplacementBeforeInput(elem, range, replacementText);
    const textAfterBeforeInput = elem.textContent ?? "";
    const hostHandled = beforeInputEvent.defaultPrevented || textAfterBeforeInput !== beforeText;

    if (hostHandled) {
      return {
        appliedBy: "host-beforeinput",
        didMutateDom: textAfterBeforeInput !== beforeText,
        didDispatchInput: false,
      };
    }

    const hadSelectedContent = !range.collapsed;
    range.deleteContents();

    let insertedReplacement = false;
    if (replacementText.length > 0) {
      const replacementNode = document.createTextNode(replacementText);
      range.insertNode(replacementNode);
      replacementNode.parentNode?.normalize();
      insertedReplacement = true;
    }

    this.setCaret(elem, cursorAfter);
    this.dispatchReplacementInput(elem, range, replacementText);

    return {
      appliedBy: "fallback-dom",
      didMutateDom: hadSelectedContent || insertedReplacement,
      didDispatchInput: true,
    };
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
  ): Event {
    const beforeInputEvent = this.createInputEvent("beforeinput", {
      inputType: "insertReplacementText",
      data: replacementText,
      cancelable: true,
      targetRange: range,
    });
    elem.dispatchEvent(beforeInputEvent);
    return beforeInputEvent;
  }

  private dispatchReplacementInput(elem: HTMLElement, range: Range, replacementText: string): void {
    const inputEvent = this.createInputEvent("input", {
      inputType: "insertReplacementText",
      data: replacementText,
      cancelable: false,
      targetRange: range,
    });
    elem.dispatchEvent(inputEvent);
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
    range.setStart(position.container, position.offset);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
  }

  private resolveContentEditablePosition(
    elem: HTMLElement,
    targetOffset: number,
  ): ContentEditableDomPosition {
    const probeRange = document.createRange();
    probeRange.selectNodeContents(elem);
    const totalTextLength = probeRange.toString().length;
    const clampedTarget = Math.max(0, Math.min(totalTextLength, targetOffset));

    const textPosition = this.resolveWithinTextNodes(elem, clampedTarget, probeRange);
    if (textPosition) {
      return textPosition;
    }

    return this.resolveBoundaryPosition(elem, clampedTarget, probeRange);
  }

  private resolveWithinTextNodes(
    elem: HTMLElement,
    clampedTarget: number,
    probeRange: Range,
  ): ContentEditableDomPosition | null {
    const showText =
      (globalThis as { NodeFilter?: { SHOW_TEXT?: number } }).NodeFilter?.SHOW_TEXT ?? 4;
    const walker = document.createTreeWalker(elem, showText);
    let current = walker.nextNode() as Text | null;

    while (current) {
      const nodeLength = current.textContent?.length ?? 0;

      probeRange.setEnd(current, 0);
      const nodeStartOffset = probeRange.toString().length;

      probeRange.setEnd(current, nodeLength);
      const nodeEndOffset = probeRange.toString().length;

      if (clampedTarget <= nodeEndOffset) {
        const offsetInNode = Math.max(0, Math.min(nodeLength, clampedTarget - nodeStartOffset));
        return { container: current, offset: offsetInNode };
      }

      current = walker.nextNode() as Text | null;
    }

    return null;
  }

  private resolveBoundaryPosition(
    elem: HTMLElement,
    clampedTarget: number,
    probeRange: Range,
  ): ContentEditableDomPosition {
    type BoundaryCandidate = {
      container: Node;
      offset: number;
      textOffset: number;
      depth: number;
    };

    const candidates: BoundaryCandidate[] = [];
    const addBoundaryCandidates = (container: Element): void => {
      for (let offset = 0; offset <= container.childNodes.length; offset += 1) {
        const textOffset = this.measureBoundaryTextOffset(elem, container, offset, probeRange);
        if (textOffset === null) {
          continue;
        }
        candidates.push({
          container,
          offset,
          textOffset,
          depth: this.getNodeDepthWithinRoot(elem, container),
        });
      }
    };

    addBoundaryCandidates(elem);
    const showElement =
      (globalThis as { NodeFilter?: { SHOW_ELEMENT?: number } }).NodeFilter?.SHOW_ELEMENT ?? 1;
    const elementWalker = document.createTreeWalker(elem, showElement);
    let currentElement = elementWalker.nextNode() as Element | null;
    while (currentElement) {
      addBoundaryCandidates(currentElement);
      currentElement = elementWalker.nextNode() as Element | null;
    }

    if (candidates.length === 0) {
      return { container: elem, offset: 0 };
    }

    let best = candidates[0];
    for (const candidate of candidates.slice(1)) {
      const bestDistance = Math.abs(best.textOffset - clampedTarget);
      const candidateDistance = Math.abs(candidate.textOffset - clampedTarget);
      if (candidateDistance < bestDistance) {
        best = candidate;
        continue;
      }
      if (candidateDistance > bestDistance) {
        continue;
      }

      const bestOnOrAfter = best.textOffset >= clampedTarget;
      const candidateOnOrAfter = candidate.textOffset >= clampedTarget;
      if (candidateOnOrAfter !== bestOnOrAfter) {
        if (candidateOnOrAfter) {
          best = candidate;
        }
        continue;
      }

      if (candidateOnOrAfter && candidate.textOffset < best.textOffset) {
        best = candidate;
        continue;
      }
      if (!candidateOnOrAfter && candidate.textOffset > best.textOffset) {
        best = candidate;
        continue;
      }
      if (candidate.depth > best.depth) {
        best = candidate;
      }
    }

    return { container: best.container, offset: best.offset };
  }

  private measureBoundaryTextOffset(
    root: HTMLElement,
    container: Node,
    offset: number,
    probeRange: Range,
  ): number | null {
    try {
      probeRange.selectNodeContents(root);
      probeRange.setEnd(container, offset);
      return probeRange.toString().length;
    } catch {
      return null;
    }
  }

  private getNodeDepthWithinRoot(root: HTMLElement, node: Node): number {
    let depth = 0;
    let current: Node | null = node;
    while (current && current !== root) {
      current = current.parentNode;
      depth += 1;
    }
    return depth;
  }
}
