export class SuggestionMenuView {
  static readonly CONTAINER_CLASS = "ft-suggestion-container";
  static readonly OWNED_ATTR = "data-ft-suggestion-owned";
  static readonly ROLE_ATTR = "data-ft-suggestion-role";
  static readonly MENU_ROLE = "menu";

  static ensureMenu(container: HTMLElement = document.body): HTMLDivElement {
    const menu = document.createElement("div");
    menu.className = SuggestionMenuView.CONTAINER_CLASS;
    menu.setAttribute(SuggestionMenuView.OWNED_ATTR, "true");
    menu.setAttribute(SuggestionMenuView.ROLE_ATTR, SuggestionMenuView.MENU_ROLE);
    menu.setAttribute("tabindex", "0");
    menu.style.display = "none";
    menu.appendChild(document.createElement("ul"));
    container.appendChild(menu);
    return menu;
  }
}
