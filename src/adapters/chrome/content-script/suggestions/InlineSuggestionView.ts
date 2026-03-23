import { resolveSuggestionOverlayRoot } from "./SuggestionOverlayRoot";

const ENTRY_ID_ATTR = "data-ft-suggestion-entry-id";

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

    const computedStyle = window.getComputedStyle(target);
    ghost.style.color = computedStyle.color;
    ghost.style.opacity = "0.5";
    ghost.style.position = "fixed";
    ghost.style.left = `${caretRect.left}px`;
    ghost.style.top = `${caretRect.top}px`;
    ghost.style.pointerEvents = "none";
    ghost.style.whiteSpace = "pre-wrap";
    ghost.style.zIndex = "10000";

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

    const targetRect = target.getBoundingClientRect();
    const maxWidth = Math.max(0, targetRect.right - caretRect.left);
    if (maxWidth > 0) {
      ghost.style.maxWidth = `${maxWidth}px`;
    }

    resolveSuggestionOverlayRoot(doc).appendChild(ghost);
    return ghost;
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
