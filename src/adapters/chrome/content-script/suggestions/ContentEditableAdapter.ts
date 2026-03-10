import { createLogger } from "@core/application/logging/Logger";

const BLOCK_TAGS = new Set([
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

const SHOW_TEXT =
  (globalThis as { NodeFilter?: { SHOW_TEXT?: number } }).NodeFilter?.SHOW_TEXT ?? 4;
const SHOW_ELEMENT =
  (globalThis as { NodeFilter?: { SHOW_ELEMENT?: number } }).NodeFilter?.SHOW_ELEMENT ?? 1;
const logger = createLogger("ContentEditableAdapter");

interface ContentEditableDomPosition {
  container: Node;
  offset: number;
}

interface SelectionOffsetAnchors {
  startOffset: number;
  endOffset: number;
  startPosition: ContentEditableDomPosition;
  endPosition: ContentEditableDomPosition;
}

interface BoundaryCandidate {
  container: Node;
  offset: number;
  textOffset: number;
  order: number;
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
    {
      preferDomMutation = false,
      scopeRoot = null,
    }: { preferDomMutation?: boolean; scopeRoot?: HTMLElement | null } = {},
  ): ContentEditableEditResult {
    const editScope = scopeRoot ?? elem;
    const selectionAnchors = this.captureSelectionOffsetAnchors(editScope);
    const startPosition = this.resolveContentEditablePosition(
      editScope,
      replaceStart,
      selectionAnchors,
      "start",
    );
    const endPosition = this.resolveContentEditablePosition(
      editScope,
      replaceEnd,
      selectionAnchors,
      "end",
    );

    elem.focus();

    const range = document.createRange();
    range.setStart(startPosition.container, startPosition.offset);
    range.setEnd(endPosition.container, endPosition.offset);

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    if (!preferDomMutation) {
      const beforeText = elem.textContent ?? "";
      logger.debug("Dispatching contenteditable replacement beforeinput", {
        replaceStart,
        replaceEnd,
        replacementText,
        cursorAfter,
        editScopeText: editScope.textContent ?? "",
        editorText: beforeText,
      });
      const beforeInputEvent = this.dispatchReplacementBeforeInput(elem, range, replacementText);
      const textAfterBeforeInput = elem.textContent ?? "";
      const hostHandled = beforeInputEvent.defaultPrevented || textAfterBeforeInput !== beforeText;

      if (hostHandled) {
        logger.debug("Contenteditable replacement handled by host", {
          defaultPrevented: beforeInputEvent.defaultPrevented,
          didMutateDom: textAfterBeforeInput !== beforeText,
          textAfterBeforeInput,
        });
        if (textAfterBeforeInput === beforeText && selectionAnchors && selection) {
          // Host prevented the edit without changing text.  Restore the
          // original selection so the expanded replacement range does not
          // corrupt subsequent cursor‑context resolution.
          try {
            const restoreRange = document.createRange();
            restoreRange.setStart(
              selectionAnchors.startPosition.container,
              selectionAnchors.startPosition.offset,
            );
            restoreRange.setEnd(
              selectionAnchors.endPosition.container,
              selectionAnchors.endPosition.offset,
            );
            selection.removeAllRanges();
            selection.addRange(restoreRange);
          } catch {
            // Best-effort: if the anchors are stale, leave the selection as-is.
          }
        }
        return {
          appliedBy: "host-beforeinput",
          didMutateDom: textAfterBeforeInput !== beforeText,
          didDispatchInput: false,
        };
      }

      const nativeReplacementResult = this.tryNativeReplacement(elem, replacementText);
      if (nativeReplacementResult.didMutateDom) {
        logger.debug("Contenteditable replacement handled by execCommand fallback", {
          didDispatchInput: nativeReplacementResult.didDispatchInput,
          editorText: elem.textContent ?? "",
        });
        return {
          appliedBy: "fallback-dom",
          didMutateDom: true,
          didDispatchInput: nativeReplacementResult.didDispatchInput,
        };
      }
    }

    const hadSelectedContent = !range.collapsed;
    range.deleteContents();
    this.normalizeCollapsedInsertionRange(range, editScope);

    let insertedReplacement = false;
    if (replacementText.length > 0) {
      const replacementNode = document.createTextNode(replacementText);
      range.insertNode(replacementNode);
      replacementNode.parentNode?.normalize();
      insertedReplacement = true;
    }

    this.setCaret(editScope, cursorAfter);
    this.dispatchReplacementInput(elem, range, replacementText);
    logger.debug("Contenteditable replacement applied by DOM fallback", {
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
      editScopeText: editScope.textContent ?? "",
      editorText: elem.textContent ?? "",
    });

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

    const resolvedBlock = this.resolveBlockFromPoint(
      range.startContainer,
      range.startOffset,
      elem,
      true,
    );
    // Always use innermost block so we never use a wrapper's full content (e.g. Lexical root -> div -> p, p).
    const innermost = this.findInnermostBlockContainingRange(elem, range);
    const block =
      innermost && (elem === resolvedBlock || resolvedBlock.contains(innermost))
        ? innermost
        : resolvedBlock;
    const startPoint = this.resolvePointWithinBlock(
      range.startContainer,
      range.startOffset,
      block,
      elem,
    );
    const endPoint = this.resolvePointWithinBlock(range.endContainer, range.endOffset, block, elem);
    if (startPoint && endPoint) {
      const lineContext = this.getBrSeparatedLineContext(block, startPoint, endPoint);
      if (lineContext) {
        return lineContext;
      }

      const beforeRange = range.cloneRange();
      beforeRange.selectNodeContents(block);
      beforeRange.setEnd(startPoint.container, startPoint.offset);

      const afterRange = range.cloneRange();
      afterRange.selectNodeContents(block);
      afterRange.setStart(endPoint.container, endPoint.offset);

      let afterCursor = afterRange.toString();
      // When block is root and cursor is at end of a direct text child whose next sibling is a block
      // (e.g. "asap" then signature div), treat as end-of-block so nextChar is "".
      if (
        block === elem &&
        afterCursor.length > 0 &&
        range.startContainer.nodeType === Node.TEXT_NODE
      ) {
        const textNode = range.startContainer as Text;
        if (
          range.startOffset === (textNode.textContent?.length ?? 0) &&
          elem === textNode.parentNode
        ) {
          const next = textNode.nextSibling;
          if (
            next &&
            next.nodeType === Node.ELEMENT_NODE &&
            BLOCK_TAGS.has((next as Element).tagName)
          ) {
            afterCursor = "";
          }
        }
      }

      return {
        beforeCursor: beforeRange.toString(),
        afterCursor,
      };
    }

    // Fallback when resolvePointWithinBlock fails (e.g. some Lexical/Reddit DOM): find block
    // by walking up from selection and compute text within that block only.
    return this.getBlockContextByWalking(elem, range);
  }

  public getActiveBlockElement(elem: HTMLElement): HTMLElement | null {
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

    return this.resolveActiveBlockForRange(elem, range);
  }

  public hasUnstableSelection(elem: HTMLElement): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return true;
    }

    const range = selection.getRangeAt(0);
    const targetNode = elem as Node;
    const startInside =
      range.startContainer === targetNode || targetNode.contains(range.startContainer);
    const endInside = range.endContainer === targetNode || targetNode.contains(range.endContainer);
    if (!startInside || !endInside) {
      return true;
    }

    if (selection.isCollapsed) {
      return false;
    }

    const startBlock = this.resolveBlockFromPoint(
      range.startContainer,
      range.startOffset,
      elem,
      true,
    );
    const endBlock = this.resolveBlockFromPoint(range.endContainer, range.endOffset, elem, false);

    return startBlock !== endBlock;
  }

  /**
   * Get block-local context using only selection + DOM walk (no resolvePointWithinBlock).
   * Use when getBlockContext returns null so we never fall back to full-root snapshot for prediction.
   */
  public getBlockContextBySelection(
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
    return this.getBlockContextByWalking(elem, range);
  }

  public getPreviousBlockTextBySelection(elem: HTMLElement): string | null {
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

    const currentBlock = this.resolveActiveBlockForRange(elem, range);
    if (!currentBlock || currentBlock === elem) {
      return null;
    }

    const blockElements = this.collectLeafBlockElements(elem);
    const currentBlockIndex = blockElements.indexOf(currentBlock);
    if (currentBlockIndex <= 0) {
      return null;
    }

    for (let index = currentBlockIndex - 1; index >= 0; index -= 1) {
      const previousBlockText = this.extractTrailingLineText(blockElements[index]);
      if (previousBlockText.length > 0) {
        return previousBlockText;
      }
    }

    return null;
  }

  public hasMultipleBlockDescendants(elem: HTMLElement): boolean {
    let blockCount = 0;
    const walker = document.createTreeWalker(elem, SHOW_ELEMENT);
    let current = walker.nextNode() as Element | null;
    while (current) {
      if (current !== elem && BLOCK_TAGS.has(current.tagName)) {
        blockCount += 1;
        if (blockCount > 1) {
          return true;
        }
      }
      current = walker.nextNode() as Element | null;
    }
    return false;
  }

  /**
   * Fallback: find the innermost block element containing the selection by walking up from
   * startContainer, then return before/after cursor text within that block only.
   * Used when the normal path returns null (e.g. Reddit/Lexical DOM).
   * Must use innermost block: when selection is at (wrapperDiv, 1) we use the child <p>, not the wrapper.
   */
  private getBlockContextByWalking(
    root: HTMLElement,
    range: Range,
  ): { beforeCursor: string; afterCursor: string } | null {
    const block = this.resolveActiveBlockForRange(root, range);
    if (!block) {
      return null;
    }
    try {
      const startPosition = this.mapRangeEndpointIntoBlock(
        range.startContainer,
        range.startOffset,
        block,
      );
      const endPosition = this.mapRangeEndpointIntoBlock(
        range.endContainer,
        range.endOffset,
        block,
      );
      const lineContext = this.getBrSeparatedLineContext(block, startPosition, endPosition);
      if (lineContext) {
        return lineContext;
      }
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(block);
      beforeRange.setEnd(startPosition.container, startPosition.offset);
      const afterRange = document.createRange();
      afterRange.selectNodeContents(block);
      afterRange.setStart(endPosition.container, endPosition.offset);
      return {
        beforeCursor: beforeRange.toString(),
        afterCursor: afterRange.toString(),
      };
    } catch {
      return null;
    }
  }

  private resolveActiveBlockForRange(root: HTMLElement, range: Range): HTMLElement | null {
    const resolvedBlock = this.resolveBlockFromPoint(
      range.startContainer,
      range.startOffset,
      root,
      true,
    );
    const innermost = this.findInnermostBlockContainingRange(root, range);
    if (innermost && (root === resolvedBlock || resolvedBlock.contains(innermost))) {
      return innermost;
    }
    return resolvedBlock === root || BLOCK_TAGS.has(resolvedBlock.tagName) ? resolvedBlock : null;
  }

  private collectLeafBlockElements(root: HTMLElement): HTMLElement[] {
    const blocks: HTMLElement[] = [];
    const walker = document.createTreeWalker(root, SHOW_ELEMENT);
    let current = walker.nextNode() as Element | null;
    let lastBlock: HTMLElement | null = null;
    while (current) {
      if (current !== root && BLOCK_TAGS.has(current.tagName)) {
        if (lastBlock && !lastBlock.contains(current)) {
          blocks.push(lastBlock);
        }
        lastBlock = current as HTMLElement;
      }
      current = walker.nextNode() as Element | null;
    }
    if (lastBlock) {
      blocks.push(lastBlock);
    }
    return blocks;
  }

  private extractTrailingLineText(block: HTMLElement): string {
    const blockRange = document.createRange();
    blockRange.selectNodeContents(block);
    const blockText = blockRange.toString();
    const trailingLine = blockText.split(/\r?\n/).at(-1) ?? "";
    return trailingLine.trim();
  }

  private mapRangeEndpointIntoBlock(
    container: Node,
    offset: number,
    block: HTMLElement,
  ): ContentEditableDomPosition {
    if (container === block || block.contains(container)) {
      return { container, offset };
    }
    return this.resolveAncestorEndpointWithinBlock(container, offset, block);
  }

  private resolveAncestorEndpointWithinBlock(
    container: Node,
    offset: number,
    block: HTMLElement,
  ): ContentEditableDomPosition {
    if (!(container instanceof Element) || !container.contains(block)) {
      return { container: block, offset: 0 };
    }

    const blockIndex = this.getBlockChildIndex(container, block);
    if (blockIndex < 0) {
      return { container: block, offset: 0 };
    }

    if (offset <= blockIndex) {
      return { container: block, offset: 0 };
    }

    return { container: block, offset: block.childNodes.length };
  }

  private getBrSeparatedLineContext(
    block: HTMLElement,
    startPosition: ContentEditableDomPosition,
    endPosition: ContentEditableDomPosition,
  ): { beforeCursor: string; afterCursor: string } | null {
    const lineBreaks = Array.from(block.querySelectorAll("br")).filter(
      (lineBreak) => !this.isNestedInsideDescendantBlock(lineBreak, block),
    );
    if (lineBreaks.length === 0) {
      return null;
    }

    let lineStart: ContentEditableDomPosition = { container: block, offset: 0 };
    let lineEnd: ContentEditableDomPosition = { container: block, offset: block.childNodes.length };

    for (const lineBreak of lineBreaks) {
      const breakStart = this.resolveNodeStartPosition(lineBreak);
      // Void elements like <br> have no children, so start/end both collapse to
      // {element, 0}; comparePositions still works because it follows DOM tree order.
      const breakEnd = this.resolveNodeEndPosition(lineBreak);
      if (this.comparePositions(breakEnd, startPosition) <= 0) {
        lineStart = breakEnd;
        continue;
      }
      if (this.comparePositions(endPosition, breakStart) <= 0) {
        lineEnd = breakStart;
        break;
      }
    }

    const beforeRange = document.createRange();
    beforeRange.setStart(lineStart.container, lineStart.offset);
    beforeRange.setEnd(startPosition.container, startPosition.offset);

    const afterRange = document.createRange();
    afterRange.setStart(endPosition.container, endPosition.offset);
    afterRange.setEnd(lineEnd.container, lineEnd.offset);

    return {
      beforeCursor: beforeRange.toString(),
      afterCursor: afterRange.toString(),
    };
  }

  private isNestedInsideDescendantBlock(node: Element, block: HTMLElement): boolean {
    let parent = node.parentElement;
    while (parent && parent !== block) {
      if (BLOCK_TAGS.has(parent.tagName)) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  /**
   * Find the innermost block (P, DIV, etc.) that contains the start of the range.
   * When the cursor is at (wrapperDiv, 1) we return the child block at that offset, not the wrapper.
   */
  private findInnermostBlockContainingRange(root: HTMLElement, range: Range): HTMLElement | null {
    let block: HTMLElement | null = null;
    let current: Node | null = range.startContainer;
    const rootNode = root as Node;
    while (current && current !== rootNode) {
      if (current.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((current as Element).tagName)) {
        block = current as HTMLElement;
        break;
      }
      current = current.parentNode;
    }
    if (!block && range.startContainer === rootNode) {
      const idx =
        range.startOffset < root.childNodes.length
          ? range.startOffset
          : Math.max(0, range.startOffset - 1);
      const child = root.childNodes[idx];
      if (child?.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as Element).tagName)) {
        block = child as HTMLElement;
      }
    }
    if (!block) {
      return null;
    }
    // Descend to the deepest block that still contains the live range start.
    // This handles nested wrappers like root > div > div > p, and also the
    // boundary case where the selection is at (block, offset) pointing at a
    // block child.
    for (;;) {
      const startPosition = this.mapRangeEndpointIntoBlock(
        range.startContainer,
        range.startOffset,
        block,
      );
      let descended = false;
      for (let i = 0; i < block.childNodes.length; i += 1) {
        const child = block.childNodes[i];
        if (
          child.nodeType === Node.ELEMENT_NODE &&
          BLOCK_TAGS.has((child as Element).tagName) &&
          (child === startPosition.container ||
            (child as Element).contains(startPosition.container))
        ) {
          block = child as HTMLElement;
          descended = true;
          break;
        }
      }
      if (!descended && startPosition.container === block) {
        const idx =
          startPosition.offset < block.childNodes.length
            ? startPosition.offset
            : Math.max(0, startPosition.offset - 1);
        const child = block.childNodes[idx];
        if (child?.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as Element).tagName)) {
          block = child as HTMLElement;
          descended = true;
        }
      }
      if (!descended) {
        break;
      }
    }
    return block;
  }

  public isCollapsedSelectionBeforeBlockBoundary(elem: HTMLElement): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const targetNode = elem as Node;
    const startInside =
      range.startContainer === targetNode || targetNode.contains(range.startContainer);
    if (!startInside) {
      return false;
    }

    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text;
      if (range.startOffset < (textNode.textContent?.length ?? 0)) {
        return false;
      }
      const nextSibling = this.findNextSiblingAcrossAncestors(textNode, elem);
      return (
        nextSibling?.nodeType === Node.ELEMENT_NODE && this.isBlockElement(nextSibling as Element)
      );
    }

    const container =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : null;
    if (!container) {
      return false;
    }

    const next = this.pickAdjacentChildAtOffset(container, range.startOffset, true);
    return next?.nodeType === Node.ELEMENT_NODE && this.isBlockElement(next as Element);
  }

  private resolveBlock(node: Node, root: HTMLElement): HTMLElement {
    let current: HTMLElement | null =
      node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);

    while (current && current !== root) {
      if (BLOCK_TAGS.has(current.tagName)) {
        return current;
      }
      current = current.parentElement;
    }

    return root;
  }

  private resolveBlockFromPoint(
    node: Node,
    offset: number,
    root: HTMLElement,
    preferForward: boolean,
  ): HTMLElement {
    const rootNode = root as Node;
    if (node === rootNode) {
      const adjacent = this.pickAdjacentChildAtOffset(root, offset, preferForward);
      if (adjacent) {
        const block = this.resolveBlock(adjacent, root);
        if (block !== root) {
          return block;
        }
      }
    }

    const block = this.resolveBlock(node, root);
    // When the block is a container with block children at this offset, use the
    // innermost block (e.g. Lexical/Reddit: root -> div -> p, p; cursor at (div, 1) must use second p,
    // not the wrapper div, so prediction uses "S" only, not "Wa" + "S").
    if (block !== root && block.nodeType === Node.ELEMENT_NODE) {
      const el = block as Element;
      const childOffset =
        node === block ? offset : this.getOffsetOfNodeInBlock(block, node, offset);
      const adjacent = this.pickAdjacentChildAtOffset(el, childOffset, preferForward);
      if (
        adjacent &&
        adjacent.nodeType === Node.ELEMENT_NODE &&
        this.isBlockElement(adjacent as Element)
      ) {
        const innerOffset = preferForward ? 0 : (adjacent.childNodes?.length ?? 0);
        return this.resolveBlockFromPoint(adjacent, innerOffset, root, preferForward);
      }
    }
    return block;
  }

  /** Child index of block that contains the given node (for resolving innermost block). */
  private getOffsetOfNodeInBlock(block: HTMLElement, node: Node, _offset: number): number {
    if (node === block) {
      return _offset;
    }
    let current: Node | null = node;
    const blockNode = block as Node;
    while (current && current !== blockNode) {
      const parent: Node | null = current.parentNode;
      if (parent === blockNode) {
        return Array.prototype.indexOf.call(block.childNodes, current);
      }
      if (!parent) {
        return 0;
      }
      current = parent;
    }
    return 0;
  }

  private pickAdjacentChildAtOffset(
    container: Element,
    offset: number,
    preferForward: boolean,
  ): Node | null {
    const childCount = container.childNodes.length;
    if (childCount === 0) {
      return null;
    }

    if (preferForward && offset >= 0 && offset < childCount) {
      return container.childNodes[offset];
    }
    if (offset > 0 && offset <= childCount) {
      return container.childNodes[offset - 1];
    }
    if (offset >= 0 && offset < childCount) {
      return container.childNodes[offset];
    }
    return null;
  }

  private resolvePointWithinBlock(
    container: Node,
    offset: number,
    block: HTMLElement,
    root: HTMLElement,
  ): ContentEditableDomPosition | null {
    if (container === block || block.contains(container)) {
      return { container, offset };
    }

    const rootNode = root as Node;
    if (container === rootNode && block.parentNode === rootNode) {
      const blockIndex = Array.prototype.indexOf.call(root.childNodes, block);
      if (blockIndex < 0) {
        return null;
      }
      if (offset <= blockIndex) {
        return { container: block, offset: 0 };
      }
      return { container: block, offset: block.childNodes.length };
    }

    // Container is an ancestor of block (e.g. Lexical wrapper div with block = child <p>).
    if (container.nodeType === Node.ELEMENT_NODE && (container as Element).contains(block)) {
      const containerEl = container as Element;
      const blockIndex = this.getBlockChildIndex(containerEl, block);
      if (blockIndex < 0) {
        return null;
      }
      if (offset <= blockIndex) {
        return { container: block, offset: 0 };
      }
      return { container: block, offset: block.childNodes.length };
    }

    return null;
  }

  /** Index of the direct child of container that contains or is the block. */
  private getBlockChildIndex(container: Element, block: HTMLElement): number {
    for (let i = 0; i < container.childNodes.length; i++) {
      const child = container.childNodes[i];
      if (
        child === block ||
        (child.nodeType === Node.ELEMENT_NODE && (child as Element).contains(block))
      ) {
        return i;
      }
    }
    return -1;
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
    if (container === root && this.shouldPreserveStructuralBoundary(container, startOffset)) {
      return;
    }
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

  private shouldPreserveStructuralBoundary(container: Element, offset: number): boolean {
    const next = offset < container.childNodes.length ? container.childNodes[offset] : null;
    const previous = offset > 0 ? container.childNodes[offset - 1] : null;

    return this.nodeHasMeaningfulText(next) || this.nodeHasMeaningfulText(previous);
  }

  private nodeHasMeaningfulText(node: Node | null): boolean {
    if (!node) {
      return false;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").length > 0;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const textContent = (node.textContent ?? "").replace(/\u00A0/g, " ").trim();
    if (textContent.length > 0) {
      return true;
    }

    return !(node as Element).querySelector("br");
  }

  private findFirstTextNode(root: Node): Text | null {
    const walker = document.createTreeWalker(root, SHOW_TEXT);
    return (walker.nextNode() as Text | null) ?? null;
  }

  private findLastTextNode(root: Node): Text | null {
    const walker = document.createTreeWalker(root, SHOW_TEXT);
    let current = walker.nextNode() as Text | null;
    let last: Text | null = null;
    while (current) {
      last = current;
      current = walker.nextNode() as Text | null;
    }
    return last;
  }

  private findNextSiblingAcrossAncestors(node: Node, root: HTMLElement): Node | null {
    let current: Node | null = node;
    const rootNode = root as Node;
    while (current && current !== rootNode) {
      if (current.nextSibling) {
        return current.nextSibling;
      }
      current = current.parentNode;
    }
    return null;
  }

  private isBlockElement(node: Element): boolean {
    return BLOCK_TAGS.has(node.tagName);
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

  public setCaret(elem: HTMLElement, cursorOffset: number): void {
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
    selectionAnchors?: SelectionOffsetAnchors | null,
    endpoint?: "start" | "end",
  ): ContentEditableDomPosition {
    const probeRange = document.createRange();
    probeRange.selectNodeContents(elem);
    const totalTextLength = probeRange.toString().length;
    const clampedTarget = Math.max(0, Math.min(totalTextLength, targetOffset));

    const anchoredPosition = this.resolveAnchoredSelectionPosition(
      clampedTarget,
      selectionAnchors,
      endpoint,
    );
    if (anchoredPosition) {
      return anchoredPosition;
    }

    const textPosition = this.resolveWithinTextNodes(elem, clampedTarget, probeRange, endpoint);
    if (textPosition) {
      return textPosition;
    }

    return this.resolveBoundaryPosition(
      elem,
      clampedTarget,
      totalTextLength,
      probeRange,
      selectionAnchors,
      endpoint,
    );
  }

  private captureSelectionOffsetAnchors(root: HTMLElement): SelectionOffsetAnchors | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const rootNode = root as Node;
    const startInside =
      range.startContainer === rootNode || rootNode.contains(range.startContainer);
    const endInside = range.endContainer === rootNode || rootNode.contains(range.endContainer);
    if (!startInside || !endInside) {
      return null;
    }

    const probeRange = document.createRange();
    probeRange.selectNodeContents(root);

    try {
      probeRange.setEnd(range.startContainer, range.startOffset);
      const startOffset = probeRange.toString().length;

      probeRange.selectNodeContents(root);
      probeRange.setEnd(range.endContainer, range.endOffset);
      const endOffset = probeRange.toString().length;

      return {
        startOffset,
        endOffset,
        startPosition: {
          container: range.startContainer,
          offset: range.startOffset,
        },
        endPosition: {
          container: range.endContainer,
          offset: range.endOffset,
        },
      };
    } catch {
      return null;
    }
  }

  private resolveAnchoredSelectionPosition(
    clampedTarget: number,
    selectionAnchors?: SelectionOffsetAnchors | null,
    endpoint?: "start" | "end",
  ): ContentEditableDomPosition | null {
    if (!selectionAnchors || !endpoint) {
      return null;
    }
    if (endpoint === "start" && clampedTarget === selectionAnchors.startOffset) {
      return selectionAnchors.startPosition;
    }
    if (endpoint === "end" && clampedTarget === selectionAnchors.endOffset) {
      return selectionAnchors.endPosition;
    }
    return null;
  }

  private resolveWithinTextNodes(
    elem: HTMLElement,
    clampedTarget: number,
    probeRange: Range,
    endpoint?: "start" | "end",
  ): ContentEditableDomPosition | null {
    const walker = document.createTreeWalker(elem, SHOW_TEXT);
    const entries: Array<{ node: Text; start: number; end: number; length: number }> = [];
    let current = walker.nextNode() as Text | null;
    while (current) {
      const length = current.textContent?.length ?? 0;
      probeRange.setEnd(current, 0);
      const start = probeRange.toString().length;
      probeRange.setEnd(current, length);
      const end = probeRange.toString().length;
      entries.push({ node: current, start, end, length });
      current = walker.nextNode() as Text | null;
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (clampedTarget < entry.start || clampedTarget > entry.end) {
        continue;
      }

      const offsetInNode = Math.max(0, Math.min(entry.length, clampedTarget - entry.start));
      // When the target is at absolute offset zero, rich editors can have
      // leading empty structural nodes that share the same text offset.
      // In that case, using the first text node would skip those blocks.
      if (
        clampedTarget === 0 &&
        offsetInNode === 0 &&
        this.hasPreviousDomSiblingInAncestry(elem, entry.node)
      ) {
        continue;
      }

      if (
        endpoint === "start" &&
        clampedTarget === entry.end &&
        offsetInNode === entry.length &&
        index + 1 < entries.length &&
        entries[index + 1].start === clampedTarget
      ) {
        return {
          container: entries[index + 1].node,
          offset: 0,
        };
      }

      if (
        endpoint === "end" &&
        clampedTarget === entry.start &&
        offsetInNode === 0 &&
        index > 0 &&
        entries[index - 1].end === clampedTarget
      ) {
        return {
          container: entries[index - 1].node,
          offset: entries[index - 1].length,
        };
      }

      return { container: entry.node, offset: offsetInNode };
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
    totalTextLength: number,
    probeRange: Range,
    selectionAnchors?: SelectionOffsetAnchors | null,
    endpoint?: "start" | "end",
  ): ContentEditableDomPosition {
    if (clampedTarget === 0) {
      return { container: elem, offset: 0 };
    }
    if (clampedTarget === totalTextLength) {
      return { container: elem, offset: elem.childNodes.length };
    }

    const localCandidate = this.resolveBoundaryPositionNearSelection(
      elem,
      clampedTarget,
      probeRange,
      selectionAnchors,
      endpoint,
    );
    if (localCandidate) {
      return localCandidate;
    }

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
    const elementWalker = document.createTreeWalker(elem, SHOW_ELEMENT);
    let currentElement = elementWalker.nextNode() as Element | null;
    while (currentElement) {
      addBoundaryCandidates(currentElement);
      currentElement = elementWalker.nextNode() as Element | null;
    }

    const best = this.findBestBoundaryCandidate(candidates, clampedTarget);
    if (!best) {
      return { container: elem, offset: 0 };
    }

    return { container: best.container, offset: best.offset };
  }

  private resolveBoundaryPositionNearSelection(
    root: HTMLElement,
    clampedTarget: number,
    probeRange: Range,
    selectionAnchors?: SelectionOffsetAnchors | null,
    endpoint?: "start" | "end",
  ): ContentEditableDomPosition | null {
    if (!selectionAnchors || !endpoint) {
      return null;
    }

    const anchorPosition =
      endpoint === "end" ? selectionAnchors.endPosition : selectionAnchors.startPosition;
    const candidates: BoundaryCandidate[] = [];
    let order = 0;
    const addCandidateOffsets = (container: Element, offsets: number[]): void => {
      for (const candidateOffset of offsets) {
        if (candidateOffset < 0 || candidateOffset > container.childNodes.length) {
          continue;
        }
        const textOffset = this.measureBoundaryTextOffset(
          root,
          container,
          candidateOffset,
          probeRange,
        );
        if (textOffset === null) {
          continue;
        }
        candidates.push({
          container,
          offset: candidateOffset,
          textOffset,
          order: order++,
        });
      }
    };

    if (anchorPosition.container instanceof Element) {
      addCandidateOffsets(anchorPosition.container, [
        anchorPosition.offset - 1,
        anchorPosition.offset,
        anchorPosition.offset + 1,
      ]);
    }

    let current: Node | null = anchorPosition.container;
    while (current && current !== root) {
      const parent: Node | null = current.parentNode;
      if (!(parent instanceof Element) || !(parent === root || root.contains(parent))) {
        break;
      }
      const childIndex = Array.prototype.indexOf.call(parent.childNodes, current);
      if (childIndex >= 0) {
        addCandidateOffsets(parent, [childIndex, childIndex + 1]);
      }
      current = parent;
    }

    const best = this.findBestBoundaryCandidate(candidates, clampedTarget);
    if (!best || best.textOffset !== clampedTarget) {
      return null;
    }

    return { container: best.container, offset: best.offset };
  }

  private findBestBoundaryCandidate(
    candidates: BoundaryCandidate[],
    clampedTarget: number,
  ): BoundaryCandidate | null {
    if (candidates.length === 0) {
      return null;
    }

    let best = candidates[0];
    for (let index = 1; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (this.isPreferredBoundaryCandidate(candidate, best, clampedTarget)) {
        best = candidate;
      }
    }

    return best;
  }

  private comparePositions(
    left: ContentEditableDomPosition,
    right: ContentEditableDomPosition,
  ): number {
    const START_TO_START = 0;
    const leftRange = document.createRange();
    leftRange.setStart(left.container, left.offset);
    leftRange.collapse(true);

    const rightRange = document.createRange();
    rightRange.setStart(right.container, right.offset);
    rightRange.collapse(true);

    return leftRange.compareBoundaryPoints(START_TO_START, rightRange);
  }

  private isPreferredBoundaryCandidate(
    candidate: BoundaryCandidate,
    best: BoundaryCandidate,
    clampedTarget: number,
  ): boolean {
    const bestDistance = Math.abs(best.textOffset - clampedTarget);
    const candidateDistance = Math.abs(candidate.textOffset - clampedTarget);
    if (candidateDistance < bestDistance) {
      return true;
    }
    if (candidateDistance > bestDistance) {
      return false;
    }

    const bestOnOrAfter = best.textOffset >= clampedTarget;
    const candidateOnOrAfter = candidate.textOffset >= clampedTarget;
    if (candidateOnOrAfter !== bestOnOrAfter) {
      return candidateOnOrAfter;
    }

    if (candidateOnOrAfter && candidate.textOffset < best.textOffset) {
      return true;
    }
    if (!candidateOnOrAfter && candidate.textOffset > best.textOffset) {
      return true;
    }
    return candidate.order < best.order;
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
