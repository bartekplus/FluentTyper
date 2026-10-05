/**
 * Notion has one contenteditable root over the page. Each text block has its
 * own nested contenteditable leaf. Focus and the events stay on the root; the
 * selection tells which leaf the user edits. Notion has no in-page editor API.
 */
export const NOTION_ROOT_SELECTOR = "[data-content-editable-root]";
export const NOTION_LEAF_SELECTOR = '.notion-page-content [data-content-editable-leaf="true"]';

export function isNotionRoot(element: Element): boolean {
  return element.matches(NOTION_ROOT_SELECTOR) && !!element.querySelector(".notion-page-content");
}

/** The Notion root of a block leaf, or null when `element` is no leaf of a Notion page. */
export function notionRootOf(element: Element): HTMLElement | null {
  if (!element.matches(NOTION_LEAF_SELECTOR)) return null;
  const root = element.parentElement?.closest<HTMLElement>(NOTION_ROOT_SELECTOR);
  return root?.contains(element.closest(".notion-page-content")) ? root : null;
}

/** A live probe saw Notion revert an unsettled write within 1 s. */
const NOTION_REVERT_WINDOW_MS = 1000;

/**
 * Resolves false when Notion reverts a write in `leaf`: within the window the
 * leaf leaves the page or holds its text from before the write again.
 * ponytail: a fixed window from one live probe; a later revert stays unseen.
 */
export function notionWriteKept(leaf: HTMLElement, before: string): Promise<boolean> {
  return new Promise((resolve) => {
    let kept = true;
    const check = () => {
      if (!leaf.isConnected || leaf.textContent === before) kept = false;
    };
    const observer = new MutationObserver(check);
    observer.observe(leaf, { subtree: true, childList: true, characterData: true });
    setTimeout(() => {
      observer.disconnect();
      check();
      resolve(kept);
    }, NOTION_REVERT_WINDOW_MS);
  });
}

/**
 * True when Notion can take a write in `leaf` now: its root has focus and the
 * whole selection is already in the leaf. A write right after the selection
 * moved into the leaf is reverted by Notion (live probe), so no writer moves
 * it there and writes at once.
 */
export function notionSelectionSettledIn(leaf: HTMLElement): boolean {
  const root = notionRootOf(leaf);
  const selection = leaf.ownerDocument.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  return (
    !!root &&
    !!range &&
    leaf.ownerDocument.activeElement === root &&
    leaf.contains(range.startContainer) &&
    leaf.contains(range.endContainer)
  );
}
