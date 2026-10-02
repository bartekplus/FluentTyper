import { isCredentialField, isLockedField } from "./FieldEligibility";

export type ManualActivationReason = "structured" | "selector" | "browser";
export type FieldEligibility =
  { kind: "blocked" } | { kind: "automatic" } | { kind: "manual"; reason: ManualActivationReason };

const POPUP_SELECTOR =
  '[role="listbox"], [role="grid"], [role="tree"], [role="menu"], [role="dialog"]';
const ITEM_SELECTOR =
  '[role="option"], [role="treeitem"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="gridcell"]';
const STRUCTURED =
  /^(?:username|email|name|honorific-prefix|given-name|additional-name|family-name|honorific-suffix|nickname|street-address|postal-code|url|tel(?:-\w+)?|address-\w+)$/;

export function isSearchField(element: HTMLElement): boolean {
  return (
    element.getAttribute("type")?.toLowerCase() === "search" ||
    element.getAttribute("role") === "searchbox" ||
    !!element.closest('[role="search"], search')
  );
}

function findReference(element: HTMLElement, id: string): Element | null {
  const root = element.getRootNode() as Document | ShadowRoot;
  return (
    ("getElementById" in root ? root.getElementById(id) : null) ??
    element.ownerDocument.getElementById(id)
  );
}

function parentElement(element: Element): Element | null {
  return element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null;
}

function isVisible(element: Element): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  for (let current: Element | null = element; current; current = parentElement(current)) {
    if (
      current.hasAttribute("hidden") ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true" ||
      current.hasAttribute("data-ft-suggestion-owned")
    )
      return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse" ||
      style?.opacity === "0"
    )
      return false;
  }
  return true;
}

function isActionable(element: Element): boolean {
  return !element.closest('[aria-disabled="true"], [disabled]') && isVisible(element);
}

/** DOM-only: also used before the MAIN-world bridge captures Tab. */
export function hasActiveAutocompletePopup(element: HTMLElement): boolean {
  const ids =
    `${element.getAttribute("aria-controls") ?? ""} ${element.getAttribute("aria-owns") ?? ""}`
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const popups = ids
    .map((id) => findReference(element, id))
    .filter((popup): popup is Element => !!popup && popup.matches(POPUP_SELECTOR));
  const activeId = element.getAttribute("aria-activedescendant");
  const active = activeId ? findReference(element, activeId) : null;
  if (active?.matches(ITEM_SELECTOR) && isActionable(active)) {
    const popup = active.closest(POPUP_SELECTOR);
    if (popup) popups.push(popup);
  }
  return popups.some(
    (popup) =>
      isVisible(popup) &&
      ((popup.getAttribute("role") === "dialog" &&
        element.getAttribute("aria-expanded") === "true") ||
        Array.from(popup.querySelectorAll(ITEM_SELECTOR)).some(isActionable)),
  );
}

export function reservesAutocompleteArrow(element: HTMLElement, event: KeyboardEvent): boolean {
  return (
    (element.getAttribute("role") === "combobox" ||
      element.hasAttribute("aria-autocomplete") ||
      element.hasAttribute("aria-haspopup") ||
      element.hasAttribute("list")) &&
    (event.key === "ArrowDown" || (event.altKey && event.key.startsWith("Arrow")))
  );
}

export class NativeAutocompleteConflictDetector {
  public classify(element: HTMLElement): FieldEligibility {
    if (isCredentialField(element) || isLockedField(element)) return { kind: "blocked" };
    if (
      element.tagName === "INPUT" &&
      !["text", "search", "email", "url", "tel"].includes((element as HTMLInputElement).type)
    )
      return { kind: "blocked" };
    if (element.tagName === "INPUT") {
      const input = element as HTMLInputElement;
      if (
        [input.name, input.id].some((value) => /^user[-_]?name$/i.test(value)) ||
        ["email", "url", "tel", "numeric", "decimal"].includes(input.inputMode.toLowerCase())
      )
        return { kind: "manual", reason: "structured" };
    }
    const tokens = (element.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
    if (
      tokens.some((token) => STRUCTURED.test(token)) ||
      (element.tagName === "INPUT" &&
        ["email", "url", "tel"].includes((element as HTMLInputElement).type))
    )
      return { kind: "manual", reason: "structured" };
    if (element.tagName === "INPUT") {
      const list = (element as HTMLInputElement).list;
      if (
        list &&
        Array.from(list.options).some((option) => !option.disabled && option.value.trim())
      )
        return { kind: "manual", reason: "browser" };
    }
    const writing =
      element.tagName === "TEXTAREA" ||
      element.getAttribute("aria-multiline") === "true" ||
      isSearchField(element) ||
      (element.isContentEditable && element.getAttribute("role") !== "combobox");
    if (
      !writing &&
      (element.getAttribute("role") === "combobox" ||
        ["listbox", "tree", "grid"].includes(element.getAttribute("aria-haspopup") ?? ""))
    )
      return { kind: "manual", reason: "selector" };
    return { kind: "automatic" };
  }
}
