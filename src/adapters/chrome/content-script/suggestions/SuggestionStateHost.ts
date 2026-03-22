import type { SuggestionElement } from "./types";

export function resolveSuggestionStateHost(target: SuggestionElement): HTMLElement {
  const doc = target.ownerDocument ?? document;
  if (target === doc.body && target.isContentEditable) {
    return doc.documentElement ?? target;
  }
  return target;
}
