import { EARLY_TAB_ACCEPT_VISIBLE_ATTR } from "./EarlyTabAcceptBridgeProtocol";
import { isSuggestionMenuHostVisible } from "./SuggestionMenuHost";
import { resolveSuggestionStateHost } from "./SuggestionStateHost";
import { SuggestionPositioningService } from "./SuggestionPositioningService";
import { SuggestionMenuView } from "./SuggestionMenuView";
import type { SuggestionElement } from "./types";

export interface SuggestionMenuRenderModel {
  menuId: number;
  menu: HTMLDivElement;
  list: HTMLUListElement;
  target: SuggestionElement;
  suggestions: string[];
  selectedIndex: number;
  showShortcutDigits: boolean;
  menuHeader: string | null;
  mentionText: string;
}

export class SuggestionMenuPresenter {
  private readonly positioningService: SuggestionPositioningService;

  constructor(
    positioningService: SuggestionPositioningService = new SuggestionPositioningService(),
  ) {
    this.positioningService = positioningService;
  }

  public render(model: SuggestionMenuRenderModel): boolean {
    model.list.innerHTML = "";
    const header = SuggestionMenuView.resolveHeader(model.menu);
    const panel = SuggestionMenuView.resolvePanel(model.menu);

    if (header) {
      if (model.menuHeader) {
        header.textContent = model.menuHeader;
        header.hidden = false;
      } else {
        header.textContent = "";
        header.hidden = true;
      }
    } else if (model.menuHeader) {
      const fallbackHeader = document.createElement("div");
      fallbackHeader.className = SuggestionMenuView.HEADER_CLASS;
      fallbackHeader.textContent = model.menuHeader;
      model.menu.insertBefore(fallbackHeader, model.list);
    }

    model.suggestions.forEach((suggestion, index) => {
      const li = document.createElement("li");
      li.id = `ft-suggestion-option-${model.menuId}-${index}`;
      li.innerHTML = this.buildSuggestionMenuItemHtml({
        mentionText: model.mentionText,
        suggestion,
        shortcutDigit: model.showShortcutDigits ? this.formatShortcutDigit(index) : null,
      });
      li.setAttribute("data-index", String(index));
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", index === model.selectedIndex ? "true" : "false");
      if (model.showShortcutDigits) {
        li.classList.add("has-shortcut");
        li.setAttribute("data-shortcut", this.formatShortcutDigit(index));
      }
      if (index === model.selectedIndex) {
        li.classList.add("highlight");
      }
      model.list.appendChild(li);
    });

    if (model.suggestions.length === 0) {
      this.hide(model.menu, model.list, model.target);
      if (panel !== model.menu) {
        panel.setAttribute("aria-hidden", "true");
      }
      return false;
    }

    model.menu.style.setProperty("display", "block", "important");
    model.menu.style.setProperty("visibility", "hidden", "important");
    this.positioningService.syncMenuTypography(model.menu, model.target);
    if (!this.positioningService.positionMenu(model.menu, model.target)) {
      this.hide(model.menu, model.list, model.target);
      if (panel !== model.menu) {
        panel.setAttribute("aria-hidden", "true");
      }
      return false;
    }

    panel.setAttribute("aria-hidden", "false");
    panel.setAttribute(
      "aria-activedescendant",
      `ft-suggestion-option-${model.menuId}-${model.selectedIndex}`,
    );
    model.menu.style.setProperty("display", "block", "important");
    model.menu.style.setProperty("visibility", "visible", "important");
    resolveSuggestionStateHost(model.target).setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "true");
    return true;
  }

  public hide(menu: HTMLDivElement, list: HTMLUListElement, target?: SuggestionElement): void {
    const header = SuggestionMenuView.resolveHeader(menu);
    const panel = SuggestionMenuView.resolvePanel(menu);
    menu.style.setProperty("display", "none", "important");
    menu.style.setProperty("visibility", "visible", "important");
    if (target) {
      resolveSuggestionStateHost(target).setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "false");
    }
    if (header) {
      header.textContent = "";
      header.hidden = true;
    }
    panel.setAttribute("aria-hidden", "true");
    panel.removeAttribute("aria-activedescendant");
    list.innerHTML = "";
  }

  public isVisible(menu: HTMLDivElement, suggestionCount: number): boolean {
    return suggestionCount > 0 && isSuggestionMenuHostVisible(menu);
  }

  public updateHighlight(list: HTMLUListElement, selectedIndex: number): void {
    const items = Array.from(list.querySelectorAll("li"));
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add("highlight");
        item.setAttribute("aria-selected", "true");
        list.parentElement?.setAttribute("aria-activedescendant", item.id);
        if (typeof item.scrollIntoView === "function") {
          item.scrollIntoView({ block: "nearest" });
        }
      } else {
        item.classList.remove("highlight");
        item.setAttribute("aria-selected", "false");
      }
    });
  }

  private formatShortcutDigit(index: number): string {
    return index === 9 ? "0" : String(index + 1);
  }

  private buildSuggestionMenuItemHtml(args: {
    mentionText: string;
    suggestion: string;
    shortcutDigit: string | null;
  }): string {
    const shortcutMarkup = args.shortcutDigit
      ? `<span class="ft-suggestion-shortcut" aria-hidden="true">${args.shortcutDigit}</span>`
      : "";
    const labelMarkup = `<span class="ft-suggestion-label">${this.buildSuggestionLabelHtml(
      args.mentionText,
      args.suggestion,
    )}</span>`;
    return `${shortcutMarkup}${labelMarkup}`;
  }

  private buildSuggestionLabelHtml(mentionText: string, suggestion: string): string {
    const safeSuggestion = this.escapeHtml(suggestion);
    const mention = (mentionText || "").trim();
    if (!mention) {
      return safeSuggestion;
    }

    const lowerSuggestion = suggestion.toLowerCase();
    const lowerMention = mention.toLowerCase();
    const matchIndex = lowerSuggestion.indexOf(lowerMention);
    if (matchIndex < 0) {
      return safeSuggestion;
    }

    const before = this.escapeHtml(suggestion.slice(0, matchIndex));
    const match = this.escapeHtml(suggestion.slice(matchIndex, matchIndex + mention.length));
    const after = this.escapeHtml(suggestion.slice(matchIndex + mention.length));
    return `${before}<span class="ft-suggestion-match">${match}</span>${after}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
