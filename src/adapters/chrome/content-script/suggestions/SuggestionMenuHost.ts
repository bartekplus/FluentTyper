const SUGGESTION_MENU_HOST_ID_PREFIX = "ft-menu-";

export function resolveSuggestionMenuHostId(entryId: number | string): string {
  return `${SUGGESTION_MENU_HOST_ID_PREFIX}${entryId}`;
}

export function resolveSuggestionMenuHost(
  doc: Document,
  entryId: number | string,
): HTMLElement | null {
  const menu = doc.getElementById(resolveSuggestionMenuHostId(entryId));
  return menu instanceof HTMLElement ? menu : null;
}

export function isSuggestionMenuHostVisible(menu: HTMLElement | null): boolean {
  if (!(menu instanceof HTMLElement) || !menu.isConnected) {
    return false;
  }

  const win = menu.ownerDocument?.defaultView;
  if (!win) {
    return false;
  }

  const computed = win.getComputedStyle(menu);
  return (
    computed.display !== "none" &&
    computed.visibility !== "hidden" &&
    computed.visibility !== "collapse"
  );
}

/** "above" | "below": which way the list grows from its first suggestion. */
export const SUGGESTION_MENU_PLACEMENT_ATTR = "data-ft-placement";
/** Caret line the placement was chosen for; the side is kept while it matches. */
export const SUGGESTION_MENU_PLACEMENT_LINE_ATTR = "data-ft-placement-line";
/** "true" when the menu sits beside the caret on its line, not above or below it. */
export const SUGGESTION_MENU_BESIDE_ATTR = "data-ft-beside";
/** "horizontal" lays the suggestions out in a single row. */
export const SUGGESTION_MENU_LAYOUT_ATTR = "data-ft-layout";

/**
 * A vertical menu growing upward is drawn bottom-up, so the first suggestion
 * stays next to the caret; arrow keys then move the other way.
 */
export function isSuggestionMenuReversed(menu: HTMLElement | null): boolean {
  return (
    menu?.getAttribute(SUGGESTION_MENU_PLACEMENT_ATTR) === "above" &&
    menu.getAttribute(SUGGESTION_MENU_LAYOUT_ATTR) !== "horizontal"
  );
}
