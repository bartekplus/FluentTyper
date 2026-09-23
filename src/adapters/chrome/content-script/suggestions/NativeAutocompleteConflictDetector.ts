import { TextTargetAdapter } from "./TextTargetAdapter";
import type { SuggestionElement } from "./types";

const CONTROLLED_POPUP_ROLES = new Set(["listbox", "grid", "tree", "dialog", "menu"]);
const AUTOCOMPLETE_BLOCKLIST = new Set([
  "username",
  "email",
  "name",
  "honorific-prefix",
  "given-name",
  "additional-name",
  "family-name",
  "honorific-suffix",
  "nickname",
  "street-address",
  "postal-code",
  "one-time-code",
  "current-password",
  "new-password",
  "url",
]);
const AUTOCOMPLETE_BLOCKED_PREFIXES = ["tel", "address-", "cc-"];

export class NativeAutocompleteConflictDetector {
  public isNativeAutocompletePreferred(elem: SuggestionElement): boolean {
    return (
      (TextTargetAdapter.isInput(elem) && elem.hasAttribute("list")) ||
      elem.getAttribute("role") === "combobox" ||
      this.hasTextControlAriaConflict(elem) ||
      this.controlsAutocompletePopup(elem) ||
      (TextTargetAdapter.isInput(elem) && this.hasSemanticAutocompletePurpose(elem))
    );
  }

  private hasTextControlAriaConflict(elem: SuggestionElement): boolean {
    if (!TextTargetAdapter.isTextValue(elem)) {
      return false;
    }
    const ariaAutocomplete = elem.getAttribute("aria-autocomplete");
    return ariaAutocomplete === "list" || ariaAutocomplete === "both";
  }

  private controlsAutocompletePopup(elem: SuggestionElement): boolean {
    if (!TextTargetAdapter.isTextValue(elem)) {
      return false;
    }
    if (elem.getAttribute("aria-expanded") !== "true") {
      return false;
    }
    const rawIds =
      `${elem.getAttribute("aria-controls") || ""} ${elem.getAttribute("aria-owns") || ""}`
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    return rawIds.some((id) => {
      const target = this.findControlledElement(elem, id);
      return target ? CONTROLLED_POPUP_ROLES.has(target.getAttribute("role") || "") : false;
    });
  }

  private findControlledElement(elem: SuggestionElement, id: string): Element | null {
    const rootNode = elem.getRootNode();
    if ("host" in rootNode) {
      const shadowRoot = rootNode as ShadowRoot;
      const shadowMatch = Array.from(shadowRoot.querySelectorAll("[id]")).find(
        (candidate) => candidate.id === id,
      );
      if (shadowMatch) {
        return shadowMatch;
      }
    }
    return elem.ownerDocument.getElementById(id);
  }

  private hasSemanticAutocompletePurpose(input: HTMLInputElement): boolean {
    const autocomplete = input.getAttribute("autocomplete");
    if (!autocomplete) {
      return false;
    }
    const tokens = autocomplete
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0 && token !== "on" && token !== "off");
    return tokens.some(
      (token) =>
        AUTOCOMPLETE_BLOCKLIST.has(token) ||
        AUTOCOMPLETE_BLOCKED_PREFIXES.some((prefix) => token.startsWith(prefix)),
    );
  }
}
