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

export function isInDocument(element: Element): boolean {
  // Walk up the shadow host chain. We avoid `instanceof ShadowRoot` because
  // that global is absent in some test environments; instead we detect a
  // shadow root by the presence of its characteristic `host` property.
  let root = element.getRootNode();
  while (root !== document && "host" in root) {
    root = (root as ShadowRoot).host.getRootNode();
  }
  return root === document;
}
