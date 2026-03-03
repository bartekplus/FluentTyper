export interface SuggestionMenuRenderModel {
  list: HTMLUListElement;
  suggestions: string[];
  selectedIndex: number;
  menuHeader: string | null;
  mentionText: string;
}

export class SuggestionMenuPresenter {
  public render(model: SuggestionMenuRenderModel): boolean {
    model.list.innerHTML = "";

    if (model.menuHeader) {
      const header = document.createElement("lh");
      header.textContent = model.menuHeader;
      model.list.appendChild(header);
    }

    model.suggestions.forEach((suggestion, index) => {
      const li = document.createElement("li");
      li.innerHTML = this.buildSuggestionMenuItemHtml(model.mentionText, suggestion);
      li.setAttribute("data-index", String(index));
      if (index === model.selectedIndex) {
        li.classList.add("highlight");
      }
      model.list.appendChild(li);
    });

    return model.suggestions.length > 0;
  }

  public hide(menu: HTMLDivElement, list: HTMLUListElement): void {
    menu.style.display = "none";
    list.innerHTML = "";
  }

  public isVisible(menu: HTMLDivElement, suggestionCount: number): boolean {
    return menu.style.display !== "none" && suggestionCount > 0;
  }

  public updateHighlight(list: HTMLUListElement, selectedIndex: number): void {
    const items = Array.from(list.querySelectorAll("li"));
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add("highlight");
      } else {
        item.classList.remove("highlight");
      }
    });
  }

  private buildSuggestionMenuItemHtml(mentionText: string, suggestion: string): string {
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
    return `${before}<span>${match}</span>${after}`;
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
