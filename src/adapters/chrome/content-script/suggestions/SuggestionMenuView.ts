import { SUGGESTION_POPUP_SHADOW_CSS } from "./SuggestionPopupShadowStyles";

export interface SuggestionMenuElements {
  menu: HTMLDivElement;
  list: HTMLUListElement;
}

export class SuggestionMenuView {
  static readonly CONTAINER_CLASS = "ft-suggestion-container";
  static readonly OWNED_ATTR = "data-ft-suggestion-owned";
  static readonly ROLE_ATTR = "data-ft-suggestion-role";
  static readonly MENU_ROLE = "menu";
  static readonly SHADOW_ATTR = "data-ft-suggestion-shadow";
  static readonly PANEL_CLASS = "ft-suggestion-panel";
  static readonly HEADER_CLASS = "ft-suggestion-header";
  static readonly LIST_CLASS = "ft-suggestion-list";

  static ensureMenu(
    container: HTMLElement = document.body ?? document.documentElement,
  ): SuggestionMenuElements {
    const doc = container.ownerDocument ?? document;
    const menu = doc.createElement("div");
    menu.className = SuggestionMenuView.CONTAINER_CLASS;
    menu.setAttribute(SuggestionMenuView.OWNED_ATTR, "true");
    menu.setAttribute(SuggestionMenuView.ROLE_ATTR, SuggestionMenuView.MENU_ROLE);
    menu.setAttribute("tabindex", "-1");

    let list!: HTMLUListElement;
    if (typeof menu.attachShadow === "function") {
      this.applyBaseHostStyles(menu, true);
      menu.setAttribute(SuggestionMenuView.SHADOW_ATTR, "true");
      const shadowRoot = menu.attachShadow({ mode: "open" });
      shadowRoot.appendChild(this.createShadowStyle(doc));
      shadowRoot.appendChild(
        this.createPanel(doc, (createdList) => {
          list = createdList;
        }),
      );
    } else {
      this.applyBaseHostStyles(menu, false);
      list = doc.createElement("ul");
      list.className = SuggestionMenuView.LIST_CLASS;
      menu.appendChild(this.createHeader(doc));
      menu.appendChild(list);
    }

    container.appendChild(menu);
    return { menu, list };
  }

  static resolveHeader(menu: HTMLDivElement): HTMLDivElement | null {
    return (
      menu.shadowRoot?.querySelector<HTMLDivElement>(`.${SuggestionMenuView.HEADER_CLASS}`) ??
      menu.querySelector<HTMLDivElement>(`.${SuggestionMenuView.HEADER_CLASS}`)
    );
  }

  static resolvePanel(menu: HTMLDivElement): HTMLElement {
    return (
      menu.shadowRoot?.querySelector<HTMLElement>(`.${SuggestionMenuView.PANEL_CLASS}`) ?? menu
    );
  }

  private static createShadowStyle(doc: Document): HTMLStyleElement {
    const style = doc.createElement("style");
    style.textContent = SUGGESTION_POPUP_SHADOW_CSS;
    return style;
  }

  private static createPanel(
    doc: Document,
    onListCreated: (list: HTMLUListElement) => void,
  ): HTMLDivElement {
    const panel = doc.createElement("div");
    panel.className = SuggestionMenuView.PANEL_CLASS;
    panel.setAttribute("part", "panel");
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-hidden", "true");

    const header = this.createHeader(doc);
    const list = doc.createElement("ul");
    list.className = SuggestionMenuView.LIST_CLASS;
    list.setAttribute("part", "list");
    onListCreated(list);

    panel.append(header, list);
    return panel;
  }

  private static createHeader(doc: Document): HTMLDivElement {
    const header = doc.createElement("div");
    header.className = SuggestionMenuView.HEADER_CLASS;
    header.setAttribute("part", "header");
    header.hidden = true;
    return header;
  }

  private static applyBaseHostStyles(menu: HTMLDivElement, shadowEnabled: boolean): void {
    if (shadowEnabled) {
      menu.style.setProperty("all", "initial", "important");
    }
    menu.style.setProperty("position", "fixed", "important");
    menu.style.setProperty("top", "0px", "important");
    menu.style.setProperty("left", "0px", "important");
    menu.style.setProperty("display", "none", "important");
    menu.style.setProperty("visibility", "visible", "important");
    menu.style.setProperty("pointer-events", shadowEnabled ? "none" : "auto", "important");
    menu.style.setProperty("z-index", "2147483647", "important");
  }
}
