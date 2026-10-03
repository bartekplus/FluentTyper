import { isGutenbergContainer } from "./GutenbergEnvironment";
import { isNonWritingControl, isWordInputProxy } from "./CodeContextResolver";
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
  if (!element.isConnected) return false;
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
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const root = element.getRootNode() as Document | ShadowRoot;
  return Array.from(element.getClientRects()).some((rect) => {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(view.innerWidth, rect.right);
    const bottom = Math.min(view.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return false;
    if (!root.elementsFromPoint) return true;
    // ponytail: five hit-test samples handle collapsed/clipped widgets; a native
    // synchronous painted-visibility API would remove the narrow-sliver ceiling.
    return [
      [0.5, 0.5],
      [0.1, 0.1],
      [0.9, 0.1],
      [0.1, 0.9],
      [0.9, 0.9],
    ].some(([x, y]) =>
      root
        .elementsFromPoint(left + (right - left) * x, top + (bottom - top) * y)
        .some((hit) => element === hit || element.contains(hit)),
    );
  });
}

function isActionable(element: Element): boolean {
  return !element.closest('[aria-disabled="true"], [disabled]') && isVisible(element);
}

function linkedAutocompletePopups(element: HTMLElement): Element[] {
  const ids =
    `${element.getAttribute("aria-controls") ?? ""} ${element.getAttribute("aria-owns") ?? ""}`
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const popups = ids
    .map((id) => findReference(element, id))
    .filter((popup): popup is Element => !!popup)
    .flatMap((popup) =>
      popup.matches(POPUP_SELECTOR) ? [popup] : Array.from(popup.querySelectorAll(POPUP_SELECTOR)),
    );
  const activeId = element.getAttribute("aria-activedescendant");
  const active = activeId ? findReference(element, activeId) : null;
  if (active?.matches(ITEM_SELECTOR) && isActionable(active)) {
    const popup = active.closest(POPUP_SELECTOR);
    if (popup) popups.push(popup);
  }
  return popups;
}

/** DOM-only: also used before the MAIN-world bridge captures Tab. */
export function hasActiveAutocompletePopup(element: HTMLElement): boolean {
  return linkedAutocompletePopups(element).some(
    (popup) =>
      isVisible(popup) &&
      ((popup.getAttribute("role") === "dialog" &&
        element.getAttribute("aria-expanded") === "true") ||
        Array.from(popup.querySelectorAll(ITEM_SELECTOR)).some(isActionable)),
  );
}

function hasUsableDatalist(element: HTMLElement): boolean {
  const list = element.tagName === "INPUT" ? (element as HTMLInputElement).list : null;
  return (
    !!list && Array.from(list.options).some((option) => !option.disabled && !!option.value.trim())
  );
}

export function reservesAutocompleteArrow(element: HTMLElement, event: KeyboardEvent): boolean {
  if (
    event.key !== "ArrowDown" &&
    event.key !== "ArrowUp" &&
    !(event.altKey && event.key.startsWith("Arrow"))
  )
    return false;
  return (
    hasUsableDatalist(element) ||
    // Explicit comboboxes may populate their popup only after the opening gesture.
    element.getAttribute("role") === "combobox" ||
    linkedAutocompletePopups(element).some((popup) =>
      Array.from(popup.querySelectorAll(ITEM_SELECTOR)).some(
        (item) => !item.closest('[aria-disabled="true"], [disabled], [data-ft-suggestion-owned]'),
      ),
    )
  );
}

export class NativeAutocompleteConflictDetector {
  public classify(element: HTMLElement): FieldEligibility {
    if (
      isGutenbergContainer(element) ||
      isCredentialField(element) ||
      isLockedField(element) ||
      isNonWritingControl(element) ||
      isWordInputProxy(element)
    )
      return { kind: "blocked" };
    if (
      element.tagName === "INPUT" &&
      !["text", "search", "email", "url", "tel"].includes((element as HTMLInputElement).type)
    )
      return { kind: "blocked" };
    if (element.tagName === "INPUT") {
      const input = element as HTMLInputElement;
      if (
        [input.name, input.id].some((value) => /user[-_]?name/i.test(value)) ||
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
    if (hasUsableDatalist(element)) return { kind: "manual", reason: "browser" };
    return { kind: "automatic" };
  }
}
