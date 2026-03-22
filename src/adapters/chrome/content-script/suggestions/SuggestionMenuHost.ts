export const SUGGESTION_MENU_HOST_ID_PREFIX = "ft-menu-";

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
