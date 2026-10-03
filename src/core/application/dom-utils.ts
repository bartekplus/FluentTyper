/**
 * Walk through open shadow roots to find the deepest currently focused element.
 * document.activeElement returns the shadow host when focus is inside a shadow
 * root; this helper pierces that boundary so callers get the real element.
 */
export function getDeepActiveElement(doc: Document): Element | null {
  let active: Element | null = doc.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/** The parent of `node`, or the host when `node` is a shadow root. */
export function composedParent(node: Node): Node | null {
  return node.parentNode ?? (node.nodeType === 11 ? ((node as ShadowRoot).host ?? null) : null);
}

/** True when the element is in this document, also through shadow roots. */
export function isInDocument(element: Element): boolean {
  return element.isConnected && element.ownerDocument === document;
}
