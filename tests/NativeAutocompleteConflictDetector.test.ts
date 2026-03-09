import { beforeEach, describe, expect, test } from "bun:test";
import { NativeAutocompleteConflictDetector } from "../src/adapters/chrome/content-script/suggestions/NativeAutocompleteConflictDetector";

describe("NativeAutocompleteConflictDetector", () => {
  const detector = new NativeAutocompleteConflictDetector();

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("blocks datalist-backed inputs", () => {
    const list = document.createElement("datalist");
    list.id = "cities";
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("list", "cities");
    document.body.append(list, input);

    expect(detector.isNativeAutocompletePreferred(input)).toBe(true);
  });

  test("blocks combobox widgets and aria list autocomplete", () => {
    const combobox = document.createElement("input");
    combobox.type = "text";
    combobox.setAttribute("role", "combobox");

    const ariaAutocomplete = document.createElement("input");
    ariaAutocomplete.type = "text";
    ariaAutocomplete.setAttribute("aria-autocomplete", "both");

    expect(detector.isNativeAutocompletePreferred(combobox)).toBe(true);
    expect(detector.isNativeAutocompletePreferred(ariaAutocomplete)).toBe(true);
  });

  test("blocks expanded controls wired to a popup listbox", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "city-list");
    const listbox = document.createElement("div");
    listbox.id = "city-list";
    listbox.setAttribute("role", "listbox");
    document.body.append(input, listbox);

    expect(detector.isNativeAutocompletePreferred(input)).toBe(true);
  });

  test.each([
    "username",
    "email",
    "name",
    "name-family",
    "tel",
    "tel-national",
    "street-address",
    "address-line1",
    "postal-code",
    "cc-number",
    "one-time-code",
    "current-password",
    "new-password",
    "url",
  ])('blocks semantic autocomplete token "%s"', (token) => {
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("autocomplete", token);

    expect(detector.isNativeAutocompletePreferred(input)).toBe(true);
  });

  test("ignores plain on/off autocomplete and generic text fields", () => {
    const onInput = document.createElement("input");
    onInput.type = "text";
    onInput.setAttribute("autocomplete", "on");

    const offInput = document.createElement("input");
    offInput.type = "search";
    offInput.setAttribute("autocomplete", "off");

    const textarea = document.createElement("textarea");

    expect(detector.isNativeAutocompletePreferred(onInput)).toBe(false);
    expect(detector.isNativeAutocompletePreferred(offInput)).toBe(false);
    expect(detector.isNativeAutocompletePreferred(textarea)).toBe(false);
  });
});
