import type { SuggestionElement } from "./types";

export interface SuggestionElementDiscoveryOptions {
  selectors: string;
  isStructurallyEligibleElement: (elem: HTMLElement) => elem is SuggestionElement;
  onShadowRootDiscovered?: (root: ShadowRoot) => void;
}

export class SuggestionElementDiscovery {
  private readonly selectors: string;
  private readonly isStructurallyEligibleElement: (elem: HTMLElement) => elem is SuggestionElement;
  private readonly onShadowRootDiscovered?: (root: ShadowRoot) => void;

  constructor(options: SuggestionElementDiscoveryOptions) {
    this.selectors = options.selectors;
    this.isStructurallyEligibleElement = options.isStructurallyEligibleElement;
    this.onShadowRootDiscovered = options.onShadowRootDiscovered;
  }

  public queryCandidates(root?: Element): SuggestionElement[] {
    let elements: Element[];
    if (root instanceof Element && root.matches(this.selectors)) {
      elements = [root, ...this.deepQuerySelectorAll(root)];
    } else {
      const queryRoot: Element | ShadowRoot | Document =
        root instanceof Element && root.shadowRoot ? root.shadowRoot : (root ?? document);
      elements = this.deepQuerySelectorAll(queryRoot);
    }
    return elements.filter((elem): elem is SuggestionElement => this.isEligibleElement(elem));
  }

  private deepQuerySelectorAll(root: Element | ShadowRoot | Document): Element[] {
    const results: Element[] = Array.from(root.querySelectorAll(this.selectors));
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.shadowRoot) {
        this.onShadowRootDiscovered?.(el.shadowRoot);
        results.push(...this.deepQuerySelectorAll(el.shadowRoot));
      }
    }
    return results;
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
