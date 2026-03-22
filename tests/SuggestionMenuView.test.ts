import { describe, expect, test } from "bun:test";
import { SuggestionMenuView } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuView";

describe("SuggestionMenuView", () => {
  test("keeps the public container class inside the shadow root", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const { menu, list } = SuggestionMenuView.ensureMenu(mount);

    expect(menu.parentElement).toBe(mount);
    expect(menu.classList.contains(SuggestionMenuView.CONTAINER_CLASS)).toBe(false);
    expect(menu.getAttribute("data-ft-suggestion-owned")).toBeNull();
    expect(menu.getAttribute("data-ft-suggestion-role")).toBeNull();
    expect(menu.getAttribute("data-ft-suggestion-shadow")).toBeNull();
    expect(menu.getAttribute("tabindex")).toBeNull();
    expect(document.querySelector(`.${SuggestionMenuView.CONTAINER_CLASS}`)).toBeNull();

    const shadowRoot = menu.shadowRoot;
    expect(shadowRoot).not.toBeNull();
    expect(list.getRootNode()).toBe(shadowRoot);

    const panel = shadowRoot?.querySelector(`.${SuggestionMenuView.PANEL_CLASS}`);
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains(SuggestionMenuView.CONTAINER_CLASS)).toBe(true);
  });

  test("keeps styling hooks on the light-DOM fallback host when shadow DOM is unavailable", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const originalAttachShadow = HTMLElement.prototype.attachShadow;
    Object.defineProperty(HTMLElement.prototype, "attachShadow", {
      value: undefined,
      configurable: true,
    });

    try {
      const { menu, list } = SuggestionMenuView.ensureMenu(mount);

      expect(menu.parentElement).toBe(mount);
      expect(menu.classList.contains(SuggestionMenuView.CONTAINER_CLASS)).toBe(true);
      expect(menu.getAttribute("data-ft-suggestion-owned")).toBe("true");
      expect(menu.getAttribute("data-ft-suggestion-role")).toBe("menu");
      expect(list.getRootNode()).toBe(document);
      expect(menu.shadowRoot).toBeNull();
    } finally {
      Object.defineProperty(HTMLElement.prototype, "attachShadow", {
        value: originalAttachShadow,
        configurable: true,
      });
    }
  });
});
