import { describe, expect, test } from "bun:test";
import { SuggestionMenuView } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuView";

describe("SuggestionMenuView", () => {
  test("keeps the public container class inside the shadow root", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const { menu, list } = SuggestionMenuView.ensureMenu(mount);

    expect(menu.parentElement).toBe(mount);
    expect(menu.getAttribute("data-ft-suggestion-owned")).toBe("true");
    expect(menu.getAttribute("tabindex")).toBeNull();

    const shadowRoot = menu.shadowRoot;
    expect(shadowRoot).not.toBeNull();
    expect(list.getRootNode()).toBe(shadowRoot!);

    const panel = shadowRoot?.querySelector(`.${SuggestionMenuView.PANEL_CLASS}`);
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains(SuggestionMenuView.CONTAINER_CLASS)).toBe(true);
  });
});
