import { resolveSuggestionMenuHostId } from "./SuggestionMenuHost";
import { SUGGESTION_POPUP_CLASS } from "@core/domain/suggestionPopup/markup";
import { SUGGESTION_POPUP_SHADOW_CSS } from "@core/domain/suggestionPopup/styles";

interface SuggestionMenuElements {
  menu: HTMLDivElement;
  list: HTMLUListElement;
}

export class SuggestionMenuView {
  static readonly CONTAINER_CLASS = SUGGESTION_POPUP_CLASS.container;
  static readonly OWNED_ATTR = "data-ft-suggestion-owned";
  static readonly ROLE_ATTR = "data-ft-suggestion-role";
  static readonly MENU_ROLE = "menu";
  static readonly PANEL_CLASS = SUGGESTION_POPUP_CLASS.panel;
  static readonly LIST_CLASS = SUGGESTION_POPUP_CLASS.list;
  static readonly FOOTER_CLASS = SUGGESTION_POPUP_CLASS.footer;
  static readonly FALLBACK_PANEL_CLASS = "ft-suggestion-fallback-panel";

  static resolveHostId(entryId: number | string): string {
    return resolveSuggestionMenuHostId(entryId);
  }

  static ensureMenu(
    container: HTMLElement = document.body ?? document.documentElement,
  ): SuggestionMenuElements {
    const doc = container.ownerDocument ?? document;
    const menu = doc.createElement("div");

    const list = doc.createElement("ul");
    list.className = SuggestionMenuView.LIST_CLASS;
    if (typeof menu.attachShadow === "function") {
      this.applyBaseHostStyles(menu, true);
      const shadowRoot = menu.attachShadow({ mode: "open" });
      shadowRoot.appendChild(this.createShadowStyle(doc));
      shadowRoot.appendChild(this.createPanel(doc, list));
    } else {
      this.applyBaseHostStyles(menu, false);
      menu.className = SuggestionMenuView.CONTAINER_CLASS;
      menu.setAttribute(SuggestionMenuView.OWNED_ATTR, "true");
      menu.setAttribute(SuggestionMenuView.ROLE_ATTR, SuggestionMenuView.MENU_ROLE);
      // A flex column (see suggestions.css), so the footer can go above a bottom-up list.
      const panel = doc.createElement("div");
      panel.className = SuggestionMenuView.FALLBACK_PANEL_CLASS;
      panel.append(list, this.createFooter(doc));
      menu.appendChild(panel);
    }

    container.appendChild(menu);
    return { menu, list };
  }

  static resolveFooter(menu: HTMLDivElement): HTMLDivElement | null {
    return (
      menu.shadowRoot?.querySelector<HTMLDivElement>(`.${SuggestionMenuView.FOOTER_CLASS}`) ??
      menu.querySelector<HTMLDivElement>(`.${SuggestionMenuView.FOOTER_CLASS}`)
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

  private static createPanel(doc: Document, list: HTMLUListElement): HTMLDivElement {
    const panel = doc.createElement("div");
    panel.className = `${SuggestionMenuView.PANEL_CLASS} ${SuggestionMenuView.CONTAINER_CLASS}`;
    panel.setAttribute("part", "panel");
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-hidden", "true");

    list.setAttribute("part", "list");

    panel.append(list, this.createFooter(doc));
    return panel;
  }

  /** Key hints (hidden from assistive technology) and the prediction language. */
  private static createFooter(doc: Document): HTMLDivElement {
    const footer = doc.createElement("div");
    footer.className = SuggestionMenuView.FOOTER_CLASS;
    footer.setAttribute("part", "footer");
    footer.hidden = true;
    return footer;
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
