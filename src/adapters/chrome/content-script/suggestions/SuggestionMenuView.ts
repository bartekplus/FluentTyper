import { SUGGESTION_POPUP_CLASS } from "@core/domain/suggestionPopup/markup";
import { SUGGESTION_POPUP_SHADOW_CSS } from "@core/domain/suggestionPopup/styles";

interface SuggestionMenuElements {
  menu: HTMLDivElement;
  list: HTMLUListElement;
}

export class SuggestionMenuView {
  static readonly CONTAINER_CLASS = SUGGESTION_POPUP_CLASS.container;
  static readonly OWNED_ATTR = "data-ft-suggestion-owned";
  static readonly PANEL_CLASS = SUGGESTION_POPUP_CLASS.panel;
  static readonly LIST_CLASS = SUGGESTION_POPUP_CLASS.list;
  static readonly FOOTER_CLASS = SUGGESTION_POPUP_CLASS.footer;

  static ensureMenu(
    container: HTMLElement = document.body ?? document.documentElement,
  ): SuggestionMenuElements {
    const doc = container.ownerDocument ?? document;
    const menu = doc.createElement("div");

    const list = doc.createElement("ul");
    list.className = SuggestionMenuView.LIST_CLASS;
    this.applyBaseHostStyles(menu);
    // The mutation pipeline skips owned UI, so menu moves do not start a scan.
    menu.setAttribute(SuggestionMenuView.OWNED_ATTR, "true");
    const shadowRoot = menu.attachShadow({ mode: "open" });
    shadowRoot.appendChild(this.createShadowStyle(doc));
    shadowRoot.appendChild(this.createPanel(doc, list));

    container.appendChild(menu);
    return { menu, list };
  }

  static resolveFooter(menu: HTMLDivElement): HTMLDivElement | null {
    return menu.shadowRoot!.querySelector<HTMLDivElement>(`.${SuggestionMenuView.FOOTER_CLASS}`);
  }

  static resolvePanel(menu: HTMLDivElement): HTMLElement {
    return menu.shadowRoot!.querySelector<HTMLElement>(`.${SuggestionMenuView.PANEL_CLASS}`)!;
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

  private static applyBaseHostStyles(menu: HTMLDivElement): void {
    menu.style.setProperty("all", "initial", "important");
    menu.style.setProperty("position", "fixed", "important");
    menu.style.setProperty("top", "0px", "important");
    menu.style.setProperty("left", "0px", "important");
    menu.style.setProperty("display", "none", "important");
    menu.style.setProperty("visibility", "visible", "important");
    menu.style.setProperty("pointer-events", "none", "important");
    menu.style.setProperty("z-index", "2147483647", "important");
  }
}
