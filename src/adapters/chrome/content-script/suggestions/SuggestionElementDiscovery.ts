import type { SuggestionElement } from "./types";

export function isVisiblyInteractive(elem: HTMLElement): boolean {
  const style = window.getComputedStyle(elem);
  return style.display !== "none" && style.visibility !== "hidden";
}

interface SuggestionElementDiscoveryOptions {
  selectors: string;
  isCandidateElement: (elem: HTMLElement) => elem is SuggestionElement;
  onShadowRootDiscovered?: (root: ShadowRoot) => void;
}

export class SuggestionElementDiscovery {
  constructor(private readonly options: SuggestionElementDiscoveryOptions) {}

  public queryCandidates(root?: Element): SuggestionElement[] {
    let elements: Element[];
    if (root instanceof Element && root.matches(this.options.selectors)) {
      elements = [root, ...this.deepQuerySelectorAll(root)];
    } else {
      elements = this.deepQuerySelectorAll(root ?? document);
    }
    return elements.filter((elem): elem is SuggestionElement => this.isEligibleElement(elem));
  }

  private deepQuerySelectorAll(root: Element | ShadowRoot | Document): Element[] {
    const results: Element[] = Array.from(root.querySelectorAll(this.options.selectors));
    if (root instanceof Element && root.shadowRoot) {
      this.options.onShadowRootDiscovered?.(root.shadowRoot);
      results.push(...this.deepQuerySelectorAll(root.shadowRoot));
    }
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.shadowRoot) {
        this.options.onShadowRootDiscovered?.(el.shadowRoot);
        results.push(...this.deepQuerySelectorAll(el.shadowRoot));
      }
    }
    return results;
  }

  private isEligibleElement(elem: Element): elem is SuggestionElement {
    return (
      elem instanceof HTMLElement &&
      this.options.isCandidateElement(elem) &&
      isVisiblyInteractive(elem)
    );
  }
}
