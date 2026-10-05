import { notionRootOf } from "./NotionEnvironment";
import type { SuggestionElement } from "./types";

export function resolveSuggestionStateHost(target: SuggestionElement): HTMLElement {
  const doc = target.ownerDocument ?? document;
  if (target === doc.body && target.isContentEditable) {
    return doc.documentElement ?? target;
  }
  // Notion's DOM lock removes each foreign attribute of a block leaf at once.
  // Its page root keeps them: there, the state names the leaf that shows the menu.
  return notionRootOf(target) ?? target;
}
