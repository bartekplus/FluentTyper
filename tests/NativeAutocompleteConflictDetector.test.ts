import { describe, expect, test } from "bun:test";
import { isSensitiveField } from "../src/adapters/chrome/content-script/suggestions/FieldEligibility";
import {
  hasActiveAutocompletePopup,
  reservesAutocompleteArrow,
  classifyField,
} from "../src/adapters/chrome/content-script/suggestions/NativeAutocompleteConflictDetector";

function field(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}
function visible(element: Element): void {
  element.getClientRects = () =>
    [
      { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 },
    ] as unknown as DOMRectList;
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
  test.each([
    '<input list="missing">',
    '<input list="empty"><datalist id="empty"></datalist>',
    '<input aria-autocomplete="list">',
    '<input role="combobox" aria-expanded="true" aria-haspopup="listbox">',
    '<input id="project_name">',
    '<input id="compassion">',
    '<input name="passage">',
    '<input id="footpath">',
    '<input id="snapshotpreview">',
    '<textarea role="combobox"></textarea>',
    '<input type="search" role="combobox">',
  ])("automatically enables writing fields: %s", (html) => {
    expect(classifyField(field(html))).toEqual({ kind: "automatic" });
  });
  test("only usable datalist options hold a field", () => {
    const input = field(
      '<input list="choices"><datalist id="choices"><option disabled value="Paris"></option><option value=""></option></datalist>',
    );
    expect(classifyField(input).kind).toBe("automatic");
    document.querySelector("option")!.disabled = false;
    expect(classifyField(input)).toEqual({ kind: "manual", reason: "browser" });
  });
  test.each([
    '<input list="missing">',
    '<input list="choices"><datalist id="choices"><option disabled value="Paris"></option><option value=""></option></datalist>',
    '<input aria-autocomplete="list" aria-controls="missing">',
    '<input aria-autocomplete="inline">',
    '<input aria-haspopup="false">',
  ])("does not reserve opening arrows for unusable metadata: %s", (html) => {
    const input = field(html);
    for (const init of [
      { key: "ArrowDown" },
      { key: "ArrowUp" },
      { key: "ArrowUp", altKey: true },
    ]) {
      expect(reservesAutocompleteArrow(input, new window.KeyboardEvent("keydown", init))).toBe(
        false,
      );
    }
  });
  test("reserves opening arrows for usable datalists and closed website widgets", () => {
    const arrow = new window.KeyboardEvent("keydown", { key: "ArrowDown" });
    const input = field(
      '<input list="choices"><datalist id="choices"><option value="Paris"></option></datalist>',
    );
    expect(reservesAutocompleteArrow(input, arrow)).toBe(true);
    document.querySelector("option")!.disabled = true;
    expect(reservesAutocompleteArrow(input, arrow)).toBe(false);
    input.setAttribute("role", "combobox");
    expect(reservesAutocompleteArrow(input, arrow)).toBe(true);
    input.removeAttribute("role");
    document.querySelector("datalist")!.remove();
    input.setAttribute("aria-controls", "choices");
    const list = popup();
    list.hidden = true;
    expect(reservesAutocompleteArrow(input, arrow)).toBe(true);
    list.firstElementChild!.setAttribute("aria-disabled", "true");
    expect(reservesAutocompleteArrow(input, arrow)).toBe(false);
    list.remove();
    expect(reservesAutocompleteArrow(input, arrow)).toBe(false);
  });
  test.each([
    '<input list="choices"><datalist id="choices"><option value="Paris"></option></datalist>',
    '<input type="search" role="combobox">',
    '<input aria-controls="choices"><div id="choices" role="listbox" hidden><div role="option">Choice</div></div>',
  ])("reserves plain ArrowUp for autocomplete widgets: %s", (html) => {
    expect(
      reservesAutocompleteArrow(
        field(html),
        new window.KeyboardEvent("keydown", { key: "ArrowUp" }),
      ),
    ).toBe(true);
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
    expect(classifyField(input)).toEqual({ kind: "manual", reason: "structured" });
  });
  test.each([
    '<input type="password">',
    '<input name="pass">',
    '<input name="passcode">',
    '<input id="login_passphrase">',
    '<input name="login_pass">',
    '<input id="passInput">',
    '<input id="otp">',
    '<input id="login_otp">',
    '<input id="totp">',
    '<input id="hotp">',
    '<input id="otp1">',
    '<input id="OTPInput">',
    '<input id="otpinput">',
    '<input id="pwdinput">',
    '<input id="cvvfield">',
    '<input id="otpcode">',
    '<input id="inputotp">',
    '<input id="pwdInput">',
    '<input id="payment_cvc">',
    '<input id="payment_cvv">',
    '<input id="payment_csc">',
    '<input autocomplete="one-time-code">',
    '<input autocomplete="cc-number">',
    '<input id="verification-code">',
    "<input readonly>",
    "<input disabled>",
    '<div role="combobox"></div>',
  ])("cannot activate protected or locked controls: %s", (html) => {
    expect(classifyField(field(html)).kind).toBe("blocked");
  });
  test.each([
    '<input name="username">',
    '<input name="login_username">',
    '<input id="account-username-field">',
    '<input id="usernameInput">',
    '<input name="login_user-name">',
    '<input inputmode="numeric">',
    '<input inputmode="tel">',
  ])("structured account and input-mode hints stay manual: %s", (html) => {
    expect(classifyField(field(html))).toEqual({ kind: "manual", reason: "structured" });
  });
  test.each(["toolbar", "menubar", "menu", "spinbutton"])(
    "blocks non-writing controls through ancestors and shadow roots: %s",
    (role) => {
      const wrapper = field(`<div role="${role}"><input role="combobox"></div>`);
      const input = wrapper.firstElementChild as HTMLInputElement;
      expect(classifyField(input)).toEqual({ kind: "blocked" });
      expect(isSensitiveField(input)).toBe(true);
      const host = document.createElement("div");
      wrapper.append(host);
      host.attachShadow({ mode: "open" }).append(input);
      expect(classifyField(input)).toEqual({ kind: "blocked" });
      wrapper.removeAttribute("role");
      input.setAttribute("role", role);
      expect(classifyField(input)).toEqual({ kind: "blocked" });
    },
  );
  test("blocks Word floating formatting controls without toolbar roles", () => {
    const group = field(
      '<div id="FontFormattingGroup"><input role="combobox" aria-label="Font Size"></div>',
    );
    const input = group.firstElementChild as HTMLInputElement;
    expect(classifyField(input)).toEqual({ kind: "blocked" });
    expect(isSensitiveField(input)).toBe(true);
  });
  test("a selector role alone does not suppress prose", () => {
    expect(classifyField(field('<input role="combobox">'))).toEqual({
      kind: "automatic",
    });
  });
  test("Review and formatting retain their existing pass exclusions", () => {
    expect(isSensitiveField(field('<input id="passage">'))).toBe(true);
    expect(isSensitiveField(field('<input id="footpath">'))).toBe(true);
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
  test.each(["aria-controls", "aria-owns"])(
    "detects Google-style listboxes inside a linked presentation wrapper: %s",
    (attribute) => {
      const input = field('<textarea role="combobox" aria-autocomplete="both"></textarea>');
      input.setAttribute(attribute, "google-choices");
      const wrapper = document.createElement("div");
      wrapper.id = "google-choices";
      wrapper.setAttribute("role", "presentation");
      document.body.append(wrapper);
      const list = popup();
      wrapper.append(list);
      expect(classifyField(input)).toEqual({ kind: "automatic" });
      expect(hasActiveAutocompletePopup(input)).toBe(true);
      wrapper.hidden = true;
      expect(hasActiveAutocompletePopup(input)).toBe(false);
      expect(
        reservesAutocompleteArrow(input, new window.KeyboardEvent("keydown", { key: "ArrowDown" })),
      ).toBe(true);
      wrapper.hidden = false;
      list.firstElementChild!.setAttribute("aria-disabled", "true");
      expect(hasActiveAutocompletePopup(input)).toBe(false);
      list.replaceChildren();
      expect(hasActiveAutocompletePopup(input)).toBe(false);
      wrapper.removeAttribute("id");
      list.innerHTML = '<div role="option">Unrelated choice</div>';
      visible(list.firstElementChild!);
      expect(hasActiveAutocompletePopup(input)).toBe(false);
    },
  );
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
  test("off-screen rectangles do not create an active conflict", () => {
    const input = field('<input aria-controls="choices">');
    const list = popup();
    list.getClientRects = () =>
      [{ left: -10000, right: -9900, top: 10, bottom: 30 }] as unknown as DOMRectList;
    expect(hasActiveAutocompletePopup(input)).toBe(false);
  });
});
