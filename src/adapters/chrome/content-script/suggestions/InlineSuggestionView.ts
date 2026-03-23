import { resolveSuggestionOverlayRoot } from "./SuggestionOverlayRoot";
import { TextTargetAdapter } from "./TextTargetAdapter";

const ENTRY_ID_ATTR = "data-ft-suggestion-entry-id";

/** Properties copied from the target to the mirror div for pixel-perfect overlay. */
const MIRROR_PROPERTIES = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
] as const;

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

export class InlineSuggestionView {
  static readonly CLASS_NAME = "ft-suggestion-inline";
  static readonly OWNED_ATTR = "data-ft-suggestion-owned";
  static readonly ROLE_ATTR = "data-ft-suggestion-role";
  static readonly INLINE_ROLE = "inline";

  static render({
    target,
    text,
    caretRect,
    entryId,
    doc = document,
  }: {
    target: HTMLElement;
    text: string;
    caretRect: DOMRect;
    entryId?: number;
    doc?: Document;
  }): HTMLDivElement | null {
    InlineSuggestionView.removeForEntry(entryId, doc);

    const ghost = doc.createElement("div");
    ghost.className = InlineSuggestionView.CLASS_NAME;
    ghost.setAttribute(InlineSuggestionView.OWNED_ATTR, "true");
    ghost.setAttribute(InlineSuggestionView.ROLE_ATTR, InlineSuggestionView.INLINE_ROLE);
    if (entryId !== undefined) {
      ghost.setAttribute(ENTRY_ID_ATTR, String(entryId));
    }
    ghost.textContent = text;

    const styleTarget = InlineSuggestionView.resolveCaretElement(target, doc) ?? target;
    const computedStyle = window.getComputedStyle(styleTarget);

    InlineSuggestionView.applyFontStyles(ghost, computedStyle);

    // The computed lineHeight may be larger than the caretRect height because
    // it includes CSS leading.  Shift the ghost up by half the difference so
    // the first-line baseline aligns with the actual text.  This avoids
    // clamping height/overflow which would truncate multi-line wrapping
    // suggestions.
    const lineHeightPx = parseFloat(computedStyle.lineHeight);
    const leadingOffset =
      caretRect.height > 0 && lineHeightPx > caretRect.height
        ? (lineHeightPx - caretRect.height) / 2
        : 0;

    ghost.style.color = computedStyle.color;
    ghost.style.opacity = "0.5";
    ghost.style.position = "fixed";
    ghost.style.left = `${caretRect.left}px`;
    ghost.style.top = `${caretRect.top - leadingOffset}px`;
    ghost.style.pointerEvents = "none";
    ghost.style.whiteSpace = "pre-wrap";
    ghost.style.zIndex = "10000";

    const targetRect = target.getBoundingClientRect();
    const maxWidth = Math.max(0, targetRect.right - caretRect.left);
    if (maxWidth > 0) {
      ghost.style.maxWidth = `${maxWidth}px`;
    }

    resolveSuggestionOverlayRoot(doc).appendChild(ghost);
    return ghost;
  }

  /**
   * Render a replace-preview ghost for mid-text suggestions.
   *
   * Instead of appending a suffix at the caret (which overlaps following text),
   * this overlays the full suggested word over the current word position with a
   * background colour so the suggestion is always readable.
   */
  static renderReplacePreview({
    target,
    fullWord,
    typedPrefix,
    caretRect,
    entryId,
    doc = document,
  }: {
    target: HTMLElement;
    fullWord: string;
    typedPrefix: string;
    caretRect: DOMRect;
    entryId?: number;
    doc?: Document;
  }): HTMLDivElement | null {
    InlineSuggestionView.removeForEntry(entryId, doc);

    const suffix = fullWord.slice(typedPrefix.length);
    if (!suffix) {
      return null;
    }

    const ghost = doc.createElement("div");
    ghost.className = InlineSuggestionView.CLASS_NAME;
    ghost.setAttribute(InlineSuggestionView.OWNED_ATTR, "true");
    ghost.setAttribute(InlineSuggestionView.ROLE_ATTR, InlineSuggestionView.INLINE_ROLE);
    if (entryId !== undefined) {
      ghost.setAttribute(ENTRY_ID_ATTR, String(entryId));
    }

    const styleTarget = InlineSuggestionView.resolveCaretElement(target, doc) ?? target;
    const computedStyle = window.getComputedStyle(styleTarget);

    InlineSuggestionView.applyFontStyles(ghost, computedStyle);

    const prefixSpan = doc.createElement("span");
    prefixSpan.textContent = typedPrefix;

    const suffixSpan = doc.createElement("span");
    suffixSpan.style.opacity = "0.5";
    suffixSpan.textContent = suffix;

    ghost.appendChild(prefixSpan);
    ghost.appendChild(suffixSpan);

    const lineHeightPx = parseFloat(computedStyle.lineHeight);
    const leadingOffset =
      caretRect.height > 0 && lineHeightPx > caretRect.height
        ? (lineHeightPx - caretRect.height) / 2
        : 0;

    const prefixWidth = InlineSuggestionView.measureTextWidth(typedPrefix, computedStyle, doc);
    const wordStartLeft = caretRect.left - prefixWidth;

    ghost.style.color = computedStyle.color;
    ghost.style.backgroundColor = InlineSuggestionView.resolveBackgroundColor(target);
    ghost.style.position = "fixed";
    ghost.style.left = `${wordStartLeft}px`;
    ghost.style.top = `${caretRect.top - leadingOffset}px`;
    ghost.style.pointerEvents = "none";
    ghost.style.whiteSpace = "pre";
    ghost.style.zIndex = "10000";
    ghost.style.overflow = "hidden";

    const targetRect = target.getBoundingClientRect();
    const maxWidth = Math.max(0, targetRect.right - wordStartLeft);
    if (maxWidth > 0) {
      ghost.style.maxWidth = `${maxWidth}px`;
    }

    resolveSuggestionOverlayRoot(doc).appendChild(ghost);
    return ghost;
  }

  /**
   * Mirror-layer preview for input/textarea mid-text suggestions.
   *
   * Creates a mirror div positioned exactly over the target element,
   * matching its box model.  The mirror contains the full "accepted" text
   * with only the inserted suffix visible (ghost-styled) — surrounding
   * words reflow naturally, eliminating overlap.
   */
  static renderMirrorPreview({
    target,
    suffix,
    cursorOffset,
    entryId,
    doc = document,
  }: {
    target: HTMLInputElement | HTMLTextAreaElement;
    suffix: string;
    cursorOffset: number;
    entryId?: number;
    doc?: Document;
  }): HTMLDivElement | null {
    InlineSuggestionView.removeForEntry(entryId, doc);

    if (!suffix) {
      return null;
    }

    const mirror = doc.createElement("div");
    mirror.className = InlineSuggestionView.CLASS_NAME;
    mirror.setAttribute(InlineSuggestionView.OWNED_ATTR, "true");
    mirror.setAttribute(InlineSuggestionView.ROLE_ATTR, InlineSuggestionView.INLINE_ROLE);
    if (entryId !== undefined) {
      mirror.setAttribute(ENTRY_ID_ATTR, String(entryId));
    }

    const computed = window.getComputedStyle(target);
    const isInput = TextTargetAdapter.isInput(target);

    // Copy all box-model and font properties so the mirror matches exactly.
    for (const prop of MIRROR_PROPERTIES) {
      (mirror.style as unknown as Record<string, string>)[prop] = computed[prop];
    }

    mirror.style.borderColor = "transparent";
    mirror.style.backgroundColor = InlineSuggestionView.resolveBackgroundColor(target);
    mirror.style.overflow = "hidden";
    mirror.style.whiteSpace = isInput ? "pre" : "pre-wrap";
    if (!isInput) {
      mirror.style.wordWrap = "break-word";
    }

    // Build three spans: before (normal) | suffix (ghost) | after (normal).
    // The before and after spans use the real text colour so the mirror
    // fully replaces the input's visual — the user sees the text as it
    // would look after accepting, with only the suffix ghost-styled.
    const value = target.value ?? "";
    const beforeText = value.slice(0, cursorOffset);
    const afterText = value.slice(cursorOffset);
    const textColor = computed.color;

    const beforeSpan = doc.createElement("span");
    beforeSpan.style.color = textColor;
    beforeSpan.textContent = isInput ? beforeText.replace(/\s/g, "\u00A0") : beforeText;

    const suffixSpan = doc.createElement("span");
    suffixSpan.style.color = textColor;
    suffixSpan.style.opacity = "0.5";
    suffixSpan.textContent = isInput ? suffix.replace(/\s/g, "\u00A0") : suffix;

    const afterSpan = doc.createElement("span");
    afterSpan.style.color = textColor;
    afterSpan.textContent = isInput ? afterText.replace(/\s/g, "\u00A0") : afterText;

    mirror.appendChild(beforeSpan);
    mirror.appendChild(suffixSpan);
    mirror.appendChild(afterSpan);

    // Position fixed, exactly over the target element.
    const rect = target.getBoundingClientRect();
    mirror.style.position = "fixed";
    mirror.style.left = `${rect.left}px`;
    mirror.style.top = `${rect.top}px`;
    mirror.style.pointerEvents = "none";
    mirror.style.zIndex = "10000";

    resolveSuggestionOverlayRoot(doc).appendChild(mirror);

    // Sync scroll after appending so the mirror is in the DOM.
    mirror.scrollTop = target.scrollTop;
    mirror.scrollLeft = target.scrollLeft;

    return mirror;
  }

  /**
   * Mirror-layer preview for contenteditable mid-text suggestions.
   *
   * Finds the block element (e.g. `<p>`) containing the cursor, extracts
   * the plain text before/after the cursor within that block, and creates
   * a mirror div positioned over the block.  The mirror shows the full
   * "accepted" text with only the suffix ghost-styled.
   */
  static renderContentEditableMirrorPreview({
    target,
    suffix,
    entryId,
    doc = document,
  }: {
    target: HTMLElement;
    suffix: string;
    entryId?: number;
    doc?: Document;
  }): HTMLDivElement | null {
    InlineSuggestionView.removeForEntry(entryId, doc);

    if (!suffix) {
      return null;
    }

    const win = doc.defaultView ?? window;
    const selection = win.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const blockElement = InlineSuggestionView.findContainingBlock(target, selection);
    if (!blockElement) {
      return null;
    }

    // Extract plain text before and after the cursor within this block.
    let beforeText: string;
    let afterText: string;
    try {
      const preRange = doc.createRange();
      preRange.selectNodeContents(blockElement);
      preRange.setEnd(range.startContainer, range.startOffset);
      beforeText = preRange.toString();

      const postRange = doc.createRange();
      postRange.selectNodeContents(blockElement);
      postRange.setStart(range.endContainer, range.endOffset);
      afterText = postRange.toString();
    } catch {
      return null;
    }

    const mirror = doc.createElement("div");
    mirror.className = InlineSuggestionView.CLASS_NAME;
    mirror.setAttribute(InlineSuggestionView.OWNED_ATTR, "true");
    mirror.setAttribute(InlineSuggestionView.ROLE_ATTR, InlineSuggestionView.INLINE_ROLE);
    if (entryId !== undefined) {
      mirror.setAttribute(ENTRY_ID_ATTR, String(entryId));
    }

    const computed = window.getComputedStyle(blockElement);

    // Copy box-model + font properties from the block element.
    for (const prop of MIRROR_PROPERTIES) {
      (mirror.style as unknown as Record<string, string>)[prop] = computed[prop];
    }

    mirror.style.borderColor = "transparent";
    mirror.style.backgroundColor = InlineSuggestionView.resolveBackgroundColor(blockElement);
    mirror.style.overflow = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";

    const textColor = computed.color;

    const beforeSpan = doc.createElement("span");
    beforeSpan.style.color = textColor;
    beforeSpan.textContent = beforeText;

    const suffixSpan = doc.createElement("span");
    suffixSpan.style.color = textColor;
    suffixSpan.style.opacity = "0.5";
    suffixSpan.textContent = suffix;

    const afterSpan = doc.createElement("span");
    afterSpan.style.color = textColor;
    afterSpan.textContent = afterText;

    mirror.appendChild(beforeSpan);
    mirror.appendChild(suffixSpan);
    mirror.appendChild(afterSpan);

    const blockRect = blockElement.getBoundingClientRect();
    mirror.style.position = "fixed";
    mirror.style.left = `${blockRect.left}px`;
    mirror.style.top = `${blockRect.top}px`;
    mirror.style.pointerEvents = "none";
    mirror.style.zIndex = "10000";

    resolveSuggestionOverlayRoot(doc).appendChild(mirror);
    return mirror;
  }

  /**
   * Walk up from the selection anchor to find the nearest block-level
   * element within the contenteditable target.
   */
  private static findContainingBlock(
    target: HTMLElement,
    selection: Selection,
  ): HTMLElement | null {
    let node: Node | null = selection.anchorNode;
    if (!node) {
      return null;
    }

    // If we start on a text node, move to its parent element.
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }

    while (node && node !== target) {
      if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName)) {
        return node as HTMLElement;
      }
      node = node.parentNode;
    }

    // No block found inside target — use target itself.
    return target;
  }

  private static applyFontStyles(ghost: HTMLElement, computedStyle: CSSStyleDeclaration): void {
    ghost.style.font = computedStyle.font;
    ghost.style.fontFamily = computedStyle.fontFamily;
    ghost.style.fontSize = computedStyle.fontSize;
    ghost.style.fontWeight = computedStyle.fontWeight;
    ghost.style.fontStyle = computedStyle.fontStyle;
    ghost.style.fontVariant = computedStyle.fontVariant;
    ghost.style.letterSpacing = computedStyle.letterSpacing;
    ghost.style.wordSpacing = computedStyle.wordSpacing;
    ghost.style.textTransform = computedStyle.textTransform;
    ghost.style.lineHeight = computedStyle.lineHeight;
    ghost.style.direction = computedStyle.direction;
    ghost.style.fontFeatureSettings = computedStyle.fontFeatureSettings;
    ghost.style.fontKerning = computedStyle.fontKerning;
    ghost.style.textAlign = computedStyle.textAlign;
  }

  private static measureTextWidth(
    text: string,
    computedStyle: CSSStyleDeclaration,
    doc: Document,
  ): number {
    const span = doc.createElement("span");
    span.style.position = "absolute";
    span.style.visibility = "hidden";
    span.style.whiteSpace = "pre";
    span.style.font = computedStyle.font;
    span.style.fontFamily = computedStyle.fontFamily;
    span.style.fontSize = computedStyle.fontSize;
    span.style.fontWeight = computedStyle.fontWeight;
    span.style.fontStyle = computedStyle.fontStyle;
    span.style.fontVariant = computedStyle.fontVariant;
    span.style.letterSpacing = computedStyle.letterSpacing;
    span.style.wordSpacing = computedStyle.wordSpacing;
    span.style.textTransform = computedStyle.textTransform;
    span.style.fontFeatureSettings = computedStyle.fontFeatureSettings;
    span.style.fontKerning = computedStyle.fontKerning;
    span.textContent = text;
    doc.body.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return width;
  }

  private static resolveBackgroundColor(target: HTMLElement): string {
    let el: HTMLElement | null = target;
    while (el) {
      const bg = window.getComputedStyle(el).backgroundColor;
      if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
        return bg;
      }
      el = el.parentElement;
    }
    return "#ffffff";
  }

  /**
   * For contenteditable elements, resolve the element closest to the caret
   * so we copy the right computed font (e.g. `<p>` or `<span>` inside a
   * TinyMCE body rather than the outer `<body>` / `<div>` container).
   *
   * Handles wrapper-boundary selections where the caret is at
   * (wrapperDiv, offset) by descending into the child block at that offset,
   * matching the logic in ContentEditableAdapter.findInnermostBlockContainingRange.
   */
  private static resolveCaretElement(target: HTMLElement, doc: Document): HTMLElement | null {
    if (!target.isContentEditable) {
      return null;
    }

    const win = doc.defaultView ?? window;
    const selection = win.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const anchor = selection.anchorNode;
    if (!anchor) {
      return null;
    }

    let elem: HTMLElement | null;

    if (anchor.nodeType === Node.TEXT_NODE) {
      // Text node – its parent is the element we want styles from.
      elem = anchor.parentElement;
    } else {
      // Element node – the caret may be at (wrapper, offset) pointing between
      // child blocks (Lexical/Reddit pattern).  Descend into the block child
      // at the anchor offset so we read its styles, not the wrapper's.
      const container = anchor as HTMLElement;
      const child =
        selection.anchorOffset < container.childNodes.length
          ? container.childNodes[selection.anchorOffset]
          : container.childNodes[container.childNodes.length - 1];
      if (
        child &&
        child.nodeType === Node.ELEMENT_NODE &&
        BLOCK_TAGS.has((child as Element).tagName)
      ) {
        elem = child as HTMLElement;
      } else {
        elem = container;
      }
    }

    if (!elem || elem === target) {
      return null;
    }

    // Only use the resolved element if it lives inside our target.
    if (!target.contains(elem)) {
      return null;
    }

    return elem;
  }

  static removeAll(doc: Document = document): void {
    const nodes = doc.querySelectorAll(
      `[${InlineSuggestionView.OWNED_ATTR}="true"][${InlineSuggestionView.ROLE_ATTR}="${InlineSuggestionView.INLINE_ROLE}"]`,
    );
    nodes.forEach((node) => node.remove());
  }

  static removeForEntry(entryId: number | undefined, doc: Document = document): void {
    if (entryId === undefined) {
      InlineSuggestionView.removeAll(doc);
      return;
    }
    const nodes = doc.querySelectorAll(
      `[${InlineSuggestionView.OWNED_ATTR}="true"][${InlineSuggestionView.ROLE_ATTR}="${InlineSuggestionView.INLINE_ROLE}"][${ENTRY_ID_ATTR}="${entryId}"]`,
    );
    nodes.forEach((node) => node.remove());
  }
}
