import { describe, expect, jest, test } from "bun:test";
import { SuggestionMenuPresenter } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuPresenter";
import type { SuggestionPositioningService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPositioningService";

describe("SuggestionMenuPresenter", () => {
  test("renders suggestions with header and highlight", () => {
    const positioning = {
      syncMenuTypography: jest.fn(),
      positionMenu: jest.fn(() => true),
    } as unknown as SuggestionPositioningService;
    const presenter = new SuggestionMenuPresenter(positioning);
    const menu = document.createElement("div");
    const list = document.createElement("ul");
    const target = document.createElement("input");
    menu.appendChild(list);

    const rendered = presenter.render({
      menu,
      list,
      target,
      suggestions: ["hello", "hey"],
      selectedIndex: 1,
      showShortcutDigits: true,
      menuHeader: "Lang: English",
      mentionText: "he",
    });

    expect(rendered).toBe(true);
    expect(list.querySelector("lh")?.textContent).toBe("Lang: English");
    expect(list.querySelectorAll("li").length).toBe(2);
    expect(list.querySelector("li")?.getAttribute("data-shortcut")).toBe("1");
    expect(list.querySelector("li .ft-suggestion-shortcut")?.textContent).toBe("1");
    expect(list.querySelector("li.highlight")?.getAttribute("data-index")).toBe("1");
    expect(list.querySelector("li .ft-suggestion-label")?.innerHTML).toContain(
      '<span class="ft-suggestion-match">he</span>',
    );
  });

  test("hides menu when positioning fails", () => {
    const positioning = {
      syncMenuTypography: jest.fn(),
      positionMenu: jest.fn(() => false),
    } as unknown as SuggestionPositioningService;
    const presenter = new SuggestionMenuPresenter(positioning);
    const menu = document.createElement("div");
    const list = document.createElement("ul");
    const target = document.createElement("input");
    menu.appendChild(list);

    const rendered = presenter.render({
      menu,
      list,
      target,
      suggestions: ["hello"],
      selectedIndex: 0,
      showShortcutDigits: false,
      menuHeader: null,
      mentionText: "",
    });

    expect(rendered).toBe(false);
    expect(menu.style.display).toBe("none");
    expect(list.innerHTML).toBe("");
  });
});
