import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SuggestionMenuPresenter } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuPresenter";
import type { SuggestionPositioningService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPositioningService";
import { SuggestionMenuView } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuView";

describe("SuggestionMenuView", () => {
  test("keeps the public container class inside the shadow root", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const { menu, list } = SuggestionMenuView.ensureMenu(mount);

    expect(menu.parentElement).toBe(mount);
    expect(menu.classList.contains(SuggestionMenuView.CONTAINER_CLASS)).toBe(false);
    expect(menu.getAttribute("data-ft-suggestion-owned")).toBe("true");
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
      // List and footer share a flex column, so the footer can go above a bottom-up list.
      expect(list.parentElement?.classList.contains("ft-suggestion-fallback-panel")).toBe(true);
      expect(SuggestionMenuView.resolveFooter(menu)?.parentElement).toBe(list.parentElement);

      // Keyboard selection moves aria-activedescendant on the menu, as render() set it.
      const presenter = new SuggestionMenuPresenter({
        syncMenuTypography: () => undefined,
        positionMenu: () => true,
      } as unknown as SuggestionPositioningService);
      presenter.render({
        menuId: 7,
        menu,
        list,
        target: document.createElement("input"),
        suggestions: ["one", "two"],
        selectedIndex: 0,
        showShortcutDigits: false,
        menuHeader: null,
        mentionText: "",
      });
      presenter.updateHighlight(list, 1);
      expect(menu.getAttribute("aria-activedescendant")).toBe("ft-suggestion-option-7-1");
      expect(list.parentElement?.hasAttribute("aria-activedescendant")).toBe(false);
      expect(menu.shadowRoot).toBeNull();
    } finally {
      Object.defineProperty(HTMLElement.prototype, "attachShadow", {
        value: originalAttachShadow,
        configurable: true,
      });
    }
  });

  test("the light-DOM fallback stylesheet mirrors the bottom-up and row layouts", () => {
    const css = readFileSync(
      path.resolve(import.meta.dir, "../public/suggestions/suggestions.css"),
      "utf8",
    );
    // Arrow keys reverse on data-ft-placement="above", so the list must be drawn bottom-up too.
    expect(css).toMatch(
      /\[data-ft-placement="above"\]:not\(\s*\[data-ft-layout="horizontal"\]\s*\)\s+ul\s*\{\s*flex-direction:\s*column-reverse/,
    );
    expect(css).toMatch(/\[data-ft-layout="horizontal"\]\s+ul\s*\{\s*flex-direction:\s*row/);
    expect(css).toMatch(
      /\[data-ft-placement="above"\]\s+\.ft-suggestion-footer:not\(\[hidden\]\)\s*\{\s*order:\s*-1/,
    );
    // The readable accents computed for the user's theme, as in the shadow popup.
    expect(css).toContain("var(--ft-theme-suggestion-accent-light");
    expect(css).toContain("--ft-theme-suggestion-highlight-accent-dark");
    // Rows follow the sizes computed from the page and Appearance settings.
    expect(css).toContain("min-height: var(--ft-row-height, 32px)");
    expect(css).toContain("calc(var(--ft-row-height, 32px) + 4px)");
  });
});
