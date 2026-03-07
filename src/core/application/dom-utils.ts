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
