import type { SuggestionElement } from "./types";

export interface SuggestionElementDiscoveryOptions {
  selectors: string;
  isStructurallyEligibleElement: (elem: HTMLElement) => elem is SuggestionElement;
}

export class SuggestionElementDiscovery {
  private readonly selectors: string;
  private readonly isStructurallyEligibleElement: (elem: HTMLElement) => elem is SuggestionElement;

  constructor(options: SuggestionElementDiscoveryOptions) {
    this.selectors = options.selectors;
    this.isStructurallyEligibleElement = options.isStructurallyEligibleElement;
  }

  public queryCandidates(root?: Element): SuggestionElement[] {
    const elements = root
      ? root.matches(this.selectors)
        ? [root]
        : Array.from(root.querySelectorAll(this.selectors))
      : Array.from(document.querySelectorAll(this.selectors));

    return elements.filter((elem): elem is SuggestionElement => this.isEligibleElement(elem));
  }

  private isEligibleElement(elem: Element): elem is SuggestionElement {
    if (!(elem instanceof HTMLElement)) {
      return false;
    }
    if (!this.isStructurallyEligibleElement(elem)) {
      return false;
    }
    if (!this.isVisiblyInteractive(elem)) {
      return false;
    }
    return true;
  }

  private isVisiblyInteractive(elem: HTMLElement): boolean {
    const style = window.getComputedStyle(elem);
    return style.display !== "none" && style.visibility !== "hidden";
  }
}
