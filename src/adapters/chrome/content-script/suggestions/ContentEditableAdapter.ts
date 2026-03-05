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

    const nativeReplacementResult = this.tryNativeReplacement(elem, replacementText);
    if (nativeReplacementResult.didMutateDom) {
      return {
        appliedBy: "fallback-dom",
        didMutateDom: true,
        didDispatchInput: nativeReplacementResult.didDispatchInput,
      };
    }

    const hadSelectedContent = !range.collapsed;
    range.deleteContents();
    this.normalizeCollapsedInsertionRange(range, elem);

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

  private normalizeCollapsedInsertionRange(range: Range, root: HTMLElement): void {
    if (!range.collapsed) {
      return;
    }

    const startContainer = range.startContainer;
    if (startContainer.nodeType === Node.TEXT_NODE) {
      return;
    }

    const container =
      startContainer.nodeType === Node.ELEMENT_NODE ? (startContainer as Element) : null;
    if (!container) {
      return;
    }

    const startOffset = range.startOffset;
    const normalized = this.resolveBoundaryInsertionPoint(container, startOffset);
    if (!normalized) {
      return;
    }
    if (normalized.container !== root && !root.contains(normalized.container)) {
      return;
    }

    try {
      range.setStart(normalized.container, normalized.offset);
      range.collapse(true);
    } catch {
      // Keep original range when normalization is not valid for this DOM shape.
    }
  }

  private resolveBoundaryInsertionPoint(
    container: Element,
    offset: number,
  ): ContentEditableDomPosition | null {
    if (offset < container.childNodes.length) {
      const next = container.childNodes[offset];
      return this.resolveNodeStartPosition(next);
    }

    if (offset > 0) {
      const previous = container.childNodes[offset - 1];
      return this.resolveNodeEndPosition(previous);
    }

    return null;
  }

  private resolveNodeStartPosition(node: Node): ContentEditableDomPosition {
    if (node.nodeType === Node.TEXT_NODE) {
      return { container: node, offset: 0 };
    }
    const element = node as Element;
    const firstText = this.findFirstTextNode(element);
    if (firstText) {
      return { container: firstText, offset: 0 };
    }
    return { container: element, offset: 0 };
  }

  private resolveNodeEndPosition(node: Node): ContentEditableDomPosition {
    if (node.nodeType === Node.TEXT_NODE) {
      return { container: node, offset: node.textContent?.length ?? 0 };
    }
    const element = node as Element;
    const lastText = this.findLastTextNode(element);
    if (lastText) {
      return { container: lastText, offset: lastText.textContent?.length ?? 0 };
    }
    return { container: element, offset: element.childNodes.length };
  }

  private findFirstTextNode(root: Node): Text | null {
    const showText =
      (globalThis as { NodeFilter?: { SHOW_TEXT?: number } }).NodeFilter?.SHOW_TEXT ?? 4;
    const walker = document.createTreeWalker(root, showText);
    return (walker.nextNode() as Text | null) ?? null;
  }

  private findLastTextNode(root: Node): Text | null {
    const showText =
      (globalThis as { NodeFilter?: { SHOW_TEXT?: number } }).NodeFilter?.SHOW_TEXT ?? 4;
    const walker = document.createTreeWalker(root, showText);
    let current = walker.nextNode() as Text | null;
    let last: Text | null = null;
    while (current) {
      last = current;
      current = walker.nextNode() as Text | null;
    }
    return last;
  }

  private tryNativeReplacement(
    elem: HTMLElement,
    replacementText: string,
  ): { didMutateDom: boolean; didDispatchInput: boolean } {
    const beforeText = elem.textContent ?? "";
    const commandResult = this.runExecInsertText(replacementText);
    const afterText = elem.textContent ?? "";
    if (afterText !== beforeText) {
      return {
        didMutateDom: true,
        didDispatchInput: false,
      };
    }
    if (!commandResult && replacementText.length === 0 && this.runExecDelete()) {
      const afterDeleteText = elem.textContent ?? "";
      if (afterDeleteText !== beforeText) {
        return {
          didMutateDom: true,
          didDispatchInput: false,
        };
      }
    }
    return {
      didMutateDom: false,
      didDispatchInput: false,
    };
  }

  private runExecInsertText(replacementText: string): boolean {
    if (typeof document.execCommand !== "function") {
      return false;
    }
    try {
      return document.execCommand("insertText", false, replacementText);
    } catch {
      return false;
    }
  }

  private runExecDelete(): boolean {
    if (typeof document.execCommand !== "function") {
      return false;
    }
    try {
      return document.execCommand("delete", false);
    } catch {
      return false;
    }
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

      if (clampedTarget >= nodeStartOffset && clampedTarget <= nodeEndOffset) {
        const offsetInNode = Math.max(0, Math.min(nodeLength, clampedTarget - nodeStartOffset));
        // When the target is at absolute offset zero, rich editors can have
        // leading empty structural nodes that share the same text offset.
        // In that case, using the first text node would skip those blocks.
        if (
          clampedTarget === 0 &&
          offsetInNode === 0 &&
          this.hasPreviousDomSiblingInAncestry(elem, current)
        ) {
          current = walker.nextNode() as Text | null;
          continue;
        }
        return { container: current, offset: offsetInNode };
      }

      current = walker.nextNode() as Text | null;
    }

    return null;
  }

  private hasPreviousDomSiblingInAncestry(root: HTMLElement, node: Node): boolean {
    let current: Node | null = node;
    while (current && current !== root) {
      if (current.previousSibling) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
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
      order: number;
    };

    const candidates: BoundaryCandidate[] = [];
    let order = 0;
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
          order: order++,
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
      if (candidate.order < best.order) {
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
}
