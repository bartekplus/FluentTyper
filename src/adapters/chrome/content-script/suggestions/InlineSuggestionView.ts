import { resolveSuggestionOverlayRoot } from "./SuggestionOverlayRoot";

const ENTRY_ID_ATTR = "data-ft-suggestion-entry-id";

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
