import { beforeEach, describe, expect, test } from "bun:test";
import {
  hasActiveAutocompletePopup,
  NativeAutocompleteConflictDetector,
} from "../src/adapters/chrome/content-script/suggestions/NativeAutocompleteConflictDetector";

const detector = new NativeAutocompleteConflictDetector();
function field(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}
function visible(element: Element): void {
  element.getClientRects = () => [{ width: 100, height: 20 }] as unknown as DOMRectList;
}
function popup(): HTMLElement {
  const node = document.createElement("div");
  node.id = "choices";
  node.setAttribute("role", "listbox");
  node.innerHTML = '<div role="option">Choice</div>';
  visible(node);
  visible(node.firstElementChild!);
  document.body.append(node);
  return node;
}

describe("native field eligibility and interaction evidence", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  test.each([
    '<input list="missing">',
    '<input list="empty"><datalist id="empty"></datalist>',
    '<input aria-autocomplete="list">',
    '<input id="project_name">',
    '<textarea role="combobox"></textarea>',
    '<input type="search" role="combobox">',
  ])("automatically enables writing fields: %s", (html) => {
    expect(detector.classify(field(html))).toEqual({ kind: "automatic" });
  });
  test("only usable datalist options hold a field", () => {
    const input = field(
      '<input list="choices"><datalist id="choices"><option disabled value="Paris"></option><option value=""></option></datalist>',
    );
    expect(detector.classify(input).kind).toBe("automatic");
    document.querySelector("option")!.disabled = false;
    expect(detector.classify(input)).toEqual({ kind: "manual", reason: "browser" });
  });
  test.each([
    "name",
    "given-name",
    "email",
    "street-address",
    "url",
    "tel-national",
    "section-checkout shipping family-name",
  ])("structured purpose remains manual: %s", (purpose) => {
    const input = field("<input>");
    input.setAttribute("autocomplete", purpose);
    expect(detector.classify(input)).toEqual({ kind: "manual", reason: "structured" });
  });
  test.each([
    '<input type="password">',
    '<input autocomplete="one-time-code">',
    '<input autocomplete="cc-number">',
    '<input id="verification-code">',
    "<input readonly>",
    "<input disabled>",
    '<div role="combobox"></div>',
  ])("cannot activate protected or locked controls: %s", (html) => {
    expect(detector.classify(field(html)).kind).toBe("blocked");
  });
  test.each(['<input name="username">', '<input inputmode="numeric">', '<input inputmode="tel">'])(
    "structured account and input-mode hints stay manual: %s",
    (html) => {
      expect(detector.classify(field(html))).toEqual({ kind: "manual", reason: "structured" });
    },
  );
  test("ambiguous selectors are manual", () => {
    expect(detector.classify(field('<input role="combobox">'))).toEqual({
      kind: "manual",
      reason: "selector",
    });
  });
  test("linked actionable visibility outranks stale ARIA; unrelated and empty UI is ignored", () => {
    const input = field('<input type="search" aria-controls="choices" aria-expanded="false">');
    const list = popup();
    expect(hasActiveAutocompletePopup(input)).toBe(true);
    list.hidden = true;
    input.setAttribute("aria-expanded", "true");
    expect(hasActiveAutocompletePopup(input)).toBe(false);
    list.hidden = false;
    list.firstElementChild!.setAttribute("aria-disabled", "true");
    expect(hasActiveAutocompletePopup(input)).toBe(false);
    list.innerHTML = "No results";
    expect(hasActiveAutocompletePopup(input)).toBe(false);
    list.remove();
    popup();
    input.removeAttribute("aria-controls");
    expect(hasActiveAutocompletePopup(input)).toBe(false);
  });
  test("ancestor hiding, owned UI, active descendants and shadow-local references", () => {
    const input = field('<input aria-activedescendant="choice">');
    const list = popup();
    list.firstElementChild!.id = "choice";
    expect(hasActiveAutocompletePopup(input)).toBe(true);
    list.setAttribute("data-ft-suggestion-owned", "true");
    expect(hasActiveAutocompletePopup(input)).toBe(false);
    list.removeAttribute("data-ft-suggestion-owned");
    const host = document.createElement("section");
    host.id = "editor";
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(input, list);
    expect(hasActiveAutocompletePopup(input)).toBe(true);
    host.style.display = "none";
    expect(hasActiveAutocompletePopup(input)).toBe(false);
  });
});
