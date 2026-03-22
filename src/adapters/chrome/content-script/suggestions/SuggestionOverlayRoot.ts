export function resolveSuggestionOverlayRoot(doc: Document = document): HTMLElement {
  return doc.documentElement ?? doc.body;
}
