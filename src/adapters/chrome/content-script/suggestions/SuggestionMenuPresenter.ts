import { EARLY_TAB_ACCEPT_VISIBLE_ATTR } from "./EarlyTabAcceptBridgeProtocol";
import { SUGGESTION_MENU_LAYOUT_ATTR, isSuggestionMenuHostVisible } from "./SuggestionMenuHost";
import { resolveSuggestionStateHost } from "./SuggestionStateHost";
import { SuggestionPositioningService } from "./SuggestionPositioningService";
import { SuggestionMenuView } from "./SuggestionMenuView";
import { buildSuggestionKeyHints } from "./SuggestionMenuHints";
import type { SuggestionElement } from "./types";

interface SuggestionMenuRenderModel {
  menuId: number;
  menu: HTMLDivElement;
  list: HTMLUListElement;
  target: SuggestionElement;
  suggestions: string[];
  snippetShortcuts?: Array<string | null>;
  selectedIndex: number;
  showShortcutDigits: boolean;
  menuHeader: string | null;
  mentionText: string;
  /** Single row of suggestions instead of a list. */
  horizontal?: boolean;
  /** Keys that insert the selected suggestion; given, a key-hint footer is shown. */
  acceptKeys?: string[];
}

export class SuggestionMenuPresenter {
  constructor(
    private readonly positioningService: SuggestionPositioningService = new SuggestionPositioningService(),
  ) {}

  public render(model: SuggestionMenuRenderModel): boolean {
    model.list.innerHTML = "";
    const panel = SuggestionMenuView.resolvePanel(model.menu);

    model.suggestions.forEach((suggestion, index) => {
      const li = document.createElement("li");
      li.id = `ft-suggestion-option-${model.menuId}-${index}`;
      const snippetShortcut = model.snippetShortcuts?.[index] ?? null;
      li.innerHTML = this.buildSuggestionMenuItemHtml({
        mentionText: model.mentionText,
        suggestion,
        snippetShortcut,
        shortcutDigit: model.showShortcutDigits ? this.formatShortcutDigit(index) : null,
      });
      li.setAttribute("data-index", String(index));
      li.setAttribute("role", "option");
      // Per-item base direction: Arabic with trailing digits/punctuation in an LTR page.
      li.setAttribute("dir", "auto");
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
      return false;
    }
    this.renderFooter(model);

    if (model.horizontal) {
      model.menu.setAttribute(SUGGESTION_MENU_LAYOUT_ATTR, "horizontal");
    } else {
      model.menu.removeAttribute(SUGGESTION_MENU_LAYOUT_ATTR);
    }
    model.menu.style.setProperty("display", "block", "important");
    model.menu.style.setProperty("visibility", "hidden", "important");
    this.positioningService.syncMenuTypography(model.menu, model.target);
    if (!this.positioningService.positionMenu(model.menu, model.target)) {
      this.hide(model.menu, model.list, model.target);
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
    const panel = SuggestionMenuView.resolvePanel(menu);
    menu.style.setProperty("display", "none", "important");
    menu.style.setProperty("visibility", "visible", "important");
    if (target) {
      resolveSuggestionStateHost(target).setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "false");
    }
    const footer = SuggestionMenuView.resolveFooter(menu);
    if (footer) {
      footer.replaceChildren();
      footer.hidden = true;
    }
    panel.setAttribute("aria-hidden", "true");
    panel.removeAttribute("aria-activedescendant");
    list.innerHTML = "";
  }

  public isVisible(menu: HTMLDivElement, suggestionCount: number): boolean {
    return suggestionCount > 0 && isSuggestionMenuHostVisible(menu);
  }

  public updateHighlight(list: HTMLUListElement, selectedIndex: number): void {
    list.querySelectorAll("li").forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add("highlight");
        item.setAttribute("aria-selected", "true");
        list.parentElement?.setAttribute("aria-activedescendant", item.id);
        if (typeof item.scrollIntoView === "function") {
          item.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      } else {
        item.classList.remove("highlight");
        item.setAttribute("aria-selected", "false");
      }
    });
  }

  /** Key hints, and the prediction language at the end of the same line. */
  private renderFooter(model: SuggestionMenuRenderModel): void {
    const footer = SuggestionMenuView.resolveFooter(model.menu);
    if (!footer) {
      return;
    }
    const doc = footer.ownerDocument;
    const hints = model.acceptKeys
      ? buildSuggestionKeyHints({
          acceptKeys: model.acceptKeys,
          // Digit keys reach the first nine suggestions ("0" is the tenth, not hinted).
          digitCount: model.showShortcutDigits ? Math.min(model.suggestions.length, 9) : 0,
        })
      : [];
    const items: HTMLElement[] = hints.map(({ keys, label }) => {
      const hint = doc.createElement("span");
      hint.className = "ft-suggestion-hint";
      const kbd = doc.createElement("kbd");
      kbd.textContent = keys;
      hint.append(kbd, ` ${label}`);
      return hint;
    });
    if (model.menuHeader) {
      const lang = doc.createElement("span");
      lang.className = "ft-suggestion-lang";
      lang.textContent = model.menuHeader;
      items.push(lang);
    }
    footer.replaceChildren(...items);
    footer.hidden = items.length === 0;
  }

  private formatShortcutDigit(index: number): string {
    return index === 9 ? "0" : String(index + 1);
  }

  /** Row: [number] label [snippet shortcut], as in the popup design. */
  private buildSuggestionMenuItemHtml(args: {
    mentionText: string;
    suggestion: string;
    snippetShortcut: string | null;
    shortcutDigit: string | null;
  }): string {
    const shortcutMarkup = args.shortcutDigit
      ? `<span class="ft-suggestion-shortcut" aria-hidden="true">${args.shortcutDigit}</span>`
      : "";
    // A snippet shows its expansion, and on the right the shortcut it expands,
    // with the typed text highlighted, so fuzzy matches explain themselves.
    const label = args.snippetShortcut
      ? this.escapeHtml(args.suggestion)
      : this.buildSuggestionLabelHtml(args.mentionText, args.suggestion);
    const labelMarkup = `<span class="ft-suggestion-label">${label}</span>`;
    const detailMarkup = args.snippetShortcut
      ? `<span class="ft-suggestion-detail">${this.buildSuggestionLabelHtml(
          args.mentionText,
          args.snippetShortcut,
        )}</span>`
      : "";
    return `${shortcutMarkup}${labelMarkup}${detailMarkup}`;
  }

  private buildSuggestionLabelHtml(mentionText: string, suggestion: string): string {
    const safeSuggestion = this.escapeHtml(suggestion);
    const mention = (mentionText || "").trim();
    if (!mention) {
      return safeSuggestion;
    }

    const matchIndex = suggestion.toLowerCase().indexOf(mention.toLowerCase());
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
