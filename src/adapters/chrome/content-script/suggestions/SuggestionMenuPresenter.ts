import { resolveCodeContext } from "./CodeContextResolver";
import {
  EARLY_TAB_ACCEPT_CONTEXT_ATTR,
  EARLY_TAB_ACCEPT_ENTRY_ID_ATTR,
  EARLY_TAB_ACCEPT_VISIBLE_ATTR,
} from "./EarlyTabAcceptBridgeProtocol";
import { SUGGESTION_MENU_LAYOUT_ATTR, isSuggestionMenuHostVisible } from "./SuggestionMenuHost";
import { resolveSuggestionStateHost } from "./SuggestionStateHost";
import { SuggestionPositioningService } from "./SuggestionPositioningService";
import { SuggestionMenuView } from "./SuggestionMenuView";
import { buildSuggestionKeyHints } from "@core/domain/suggestionPopup/keyHints";
import {
  SUGGESTION_POPUP_LANGUAGE_ID,
  buildProposalRowHtml,
  buildSuggestionFooterHtml,
  buildSuggestionRowHtml,
  formatShortcutDigit,
} from "@core/domain/suggestionPopup/markup";
import type { SuggestionElement } from "./types";

interface SuggestionMenuRenderModel {
  menuId: number;
  menu: HTMLDivElement;
  list: HTMLUListElement;
  target: SuggestionElement;
  suggestions: string[];
  snippetShortcuts?: Array<string | null>;
  /** Highlighted row; `suggestions.length` is the proposal row, -1 none. */
  selectedIndex: number;
  /** A grammar proposal, shown as the last row. */
  proposal?: { original: string; replacement: string; explanation: string } | null;
  showShortcutDigits: boolean;
  menuHeader: string | null;
  mentionText: string;
  /** Single row of suggestions instead of a list. */
  horizontal?: boolean;
  /** Keys that insert the selected suggestion; given, a key-hint footer is shown. */
  acceptKeys?: string[];
  /** Locale for the key hints; the browser's when not given. */
  uiLanguage?: string;
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
      li.innerHTML = buildSuggestionRowHtml({
        mentionText: model.mentionText,
        suggestion,
        snippetShortcut,
        shortcutDigit: model.showShortcutDigits ? formatShortcutDigit(index) : null,
      });
      li.setAttribute("data-index", String(index));
      li.setAttribute("role", "option");
      // Per-item base direction: Arabic with trailing digits/punctuation in an LTR page.
      li.setAttribute("dir", "auto");
      li.setAttribute("aria-selected", index === model.selectedIndex ? "true" : "false");
      if (index === model.selectedIndex) {
        li.classList.add("highlight");
      }
      model.list.appendChild(li);
    });

    const proposalIndex = model.suggestions.length;
    if (model.proposal) {
      const li = document.createElement("li");
      li.id = `ft-suggestion-option-${model.menuId}-${proposalIndex}`;
      li.innerHTML = buildProposalRowHtml(model.proposal);
      li.title = model.proposal.explanation;
      li.setAttribute("data-proposal", "true");
      li.setAttribute("role", "option");
      li.setAttribute("dir", "auto");
      const selected = model.selectedIndex === proposalIndex;
      li.setAttribute("aria-selected", String(selected));
      li.classList.toggle("highlight", selected);
      model.list.appendChild(li);
    }

    if (model.list.childElementCount === 0) {
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
    if (model.selectedIndex >= 0) {
      panel.setAttribute(
        "aria-activedescendant",
        `ft-suggestion-option-${model.menuId}-${model.selectedIndex}`,
      );
    } else {
      panel.removeAttribute("aria-activedescendant");
    }
    model.menu.style.setProperty("display", "block", "important");
    model.menu.style.setProperty("visibility", "visible", "important");
    const stateHost = resolveSuggestionStateHost(model.target);
    // A shared host (a Notion page root for all its leaves) names the entry that shows the menu.
    const entryId = String(model.menuId);
    if (
      stateHost !== model.target &&
      stateHost.getAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR) !== entryId
    )
      stateHost.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, entryId);
    stateHost.setAttribute(EARLY_TAB_ACCEPT_CONTEXT_ATTR, resolveCodeContext(model.target));
    // Tab is claimed only when it has a row to accept: an unselected proposal leaves it alone.
    stateHost.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, String(model.selectedIndex >= 0));
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
    // The shadow panel that render() describes.
    const panel = list.parentElement;
    list.querySelectorAll("li").forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add("highlight");
        item.setAttribute("aria-selected", "true");
        panel?.setAttribute("aria-activedescendant", item.id);
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
    const hints = model.acceptKeys
      ? buildSuggestionKeyHints({
          acceptKeys: model.acceptKeys,
          // Digit keys reach the first nine suggestions ("0" is the tenth, not hinted).
          digitCount: model.showShortcutDigits ? Math.min(model.suggestions.length, 9) : 0,
          language: model.uiLanguage || navigator.language || "en",
        })
      : [];
    footer.innerHTML = buildSuggestionFooterHtml(hints, model.menuHeader);
    footer.hidden = footer.childElementCount === 0;
    // The listbox is described by the prediction language, when shown.
    const panel = SuggestionMenuView.resolvePanel(model.menu);
    if (model.menuHeader) {
      panel.setAttribute("aria-describedby", SUGGESTION_POPUP_LANGUAGE_ID);
    } else {
      panel.removeAttribute("aria-describedby");
    }
  }
}
