export class SuggestionMenuView {
  static readonly CONTAINER_CLASS = "tribute-container";

  static ensureMenu(container: HTMLElement = document.body): HTMLDivElement {
    const menu = document.createElement("div");
    menu.className = `${SuggestionMenuView.CONTAINER_CLASS} suggestion-container`;
    menu.setAttribute("tabindex", "0");
    menu.style.display = "none";
    menu.appendChild(document.createElement("ul"));
    container.appendChild(menu);
    return menu;
  }
}
