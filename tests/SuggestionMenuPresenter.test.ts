import { describe, expect, jest, test } from "bun:test";
import { SuggestionMenuPresenter } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuPresenter";
import { SuggestionMenuView } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuView";
import type { SuggestionPositioningService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPositioningService";

describe("SuggestionMenuPresenter", () => {
  test("renders suggestions with the language and highlight", () => {
    const positioning = {
      syncMenuTypography: jest.fn(),
      positionMenu: jest.fn(() => true),
    } as unknown as SuggestionPositioningService;
    const presenter = new SuggestionMenuPresenter(positioning);
    const { menu, list } = SuggestionMenuView.ensureMenu();
    const target = document.createElement("input");

    const rendered = presenter.render({
      menuId: 1,
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
    // The language sits at the end of the footer line.
    const footer = SuggestionMenuView.resolveFooter(menu);
    expect(footer?.hidden).toBe(false);
    expect(footer?.querySelector(".ft-suggestion-lang")?.textContent).toBe("Lang: English");
    // Screen readers get the language (it describes the listbox), not the key hints.
    expect(footer?.getAttribute("aria-hidden")).toBeNull();
    const panel = SuggestionMenuView.resolvePanel(menu);
    expect(panel.getAttribute("aria-describedby")).toBe(
      footer?.querySelector(".ft-suggestion-lang")?.id,
    );
    expect(list.querySelectorAll("li").length).toBe(2);
    // Each item resolves its own base direction (Arabic with trailing digits in an LTR page).
    expect(
      Array.from(list.querySelectorAll("li")).every((li) => li.getAttribute("dir") === "auto"),
    ).toBe(true);
    expect(list.querySelector("li .ft-suggestion-shortcut")?.textContent).toBe("1");
    expect(list.querySelector("li.highlight")?.getAttribute("data-index")).toBe("1");
    expect(list.querySelector("li .ft-suggestion-label")?.innerHTML).toContain(
      '<span class="ft-suggestion-match">he</span>',
    );
  });

  test("shows a grammar proposal as the last row and claims Tab only once it is selected", () => {
    const positioning = {
      syncMenuTypography: jest.fn(),
      positionMenu: jest.fn(() => true),
    } as unknown as SuggestionPositioningService;
    const presenter = new SuggestionMenuPresenter(positioning);
    const { menu, list } = SuggestionMenuView.ensureMenu();
    const target = document.createElement("textarea");
    const model = {
      menuId: 1,
      menu,
      list,
      target,
      showShortcutDigits: true,
      menuHeader: null,
      mentionText: "",
      proposal: { original: "is", replacement: "are", explanation: "Use <are> here." },
    };

    // Alone and unselected: shown, but Tab is left to the page.
    expect(presenter.render({ ...model, suggestions: [], selectedIndex: -1 })).toBe(true);
    const row = list.querySelector<HTMLElement>("li[data-proposal]");
    expect(row?.querySelector(".ft-suggestion-label")?.textContent).toBe("is → are");
    expect(row?.querySelector(".ft-suggestion-detail")?.textContent).toBe("Use <are> here.");
    expect(row?.hasAttribute("data-index")).toBe(false);
    expect(row?.classList.contains("highlight")).toBe(false);
    expect(target.getAttribute("data-ft-suggestion-visible")).toBe("false");

    // After the suggestions; highlighted when selected.
    presenter.render({ ...model, suggestions: ["alpha"], selectedIndex: 1 });
    expect(Array.from(list.querySelectorAll("li")).map((li) => li.dataset.proposal)).toEqual([
      undefined,
      "true",
    ]);
    expect(list.querySelector("li[data-proposal]")?.classList.contains("highlight")).toBe(true);
    expect(target.getAttribute("data-ft-suggestion-visible")).toBe("true");
  });

  test("marks the menu horizontal before positioning it, and clears the mark again", () => {
    const { menu, list } = SuggestionMenuView.ensureMenu();
    const layoutWhenPositioned: Array<string | null> = [];
    const positioning = {
      syncMenuTypography: jest.fn(),
      positionMenu: jest.fn(() => {
        layoutWhenPositioned.push(menu.getAttribute("data-ft-layout"));
        return true;
      }),
    } as unknown as SuggestionPositioningService;
    const presenter = new SuggestionMenuPresenter(positioning);
    const model = {
      menuId: 1,
      menu,
      list,
      target: document.createElement("input"),
      suggestions: ["hello"],
      selectedIndex: 0,
      showShortcutDigits: false,
      menuHeader: null,
      mentionText: "he",
    };

    presenter.render({ ...model, horizontal: true });
    presenter.render({ ...model, horizontal: false });

    // Measured with the row layout applied, so its size is the row's.
    expect(layoutWhenPositioned).toEqual(["horizontal", null]);
  });

  test("labels snippet suggestions with their shortcut", () => {
    const positioning = {
      syncMenuTypography: jest.fn(),
      positionMenu: jest.fn(() => true),
    } as unknown as SuggestionPositioningService;
    const presenter = new SuggestionMenuPresenter(positioning);
    const { menu, list } = SuggestionMenuView.ensureMenu();

    presenter.render({
      menuId: 1,
      menu,
      list,
      target: document.createElement("input"),
      suggestions: ["add", "1 <Main> St"],
      snippetShortcuts: [null, "address"],
      selectedIndex: 0,
      showShortcutDigits: false,
      menuHeader: null,
      mentionText: "ad",
    });

    const [word, snippet] = Array.from(list.querySelectorAll("li"));
    expect(word.querySelector(".ft-suggestion-detail")).toBeNull();
    // A snippet shows its expansion, with the shortcut (typed text highlighted) on the right.
    expect(snippet.querySelector(".ft-suggestion-label")?.textContent).toBe("1 <Main> St");
    expect(snippet.querySelector(".ft-suggestion-detail")?.innerHTML).toBe(
      '<span class="ft-suggestion-match">ad</span>dress',
    );
  });

  test("shows the keys that work in a footer, and none without accept keys", () => {
    const positioning = {
      syncMenuTypography: jest.fn(),
      positionMenu: jest.fn(() => true),
    } as unknown as SuggestionPositioningService;
    const presenter = new SuggestionMenuPresenter(positioning);
    const { menu, list } = SuggestionMenuView.ensureMenu();
    const model = {
      menuId: 1,
      menu,
      list,
      target: document.createElement("input"),
      suggestions: ["hello", "help", "helm"],
      selectedIndex: 0,
      showShortcutDigits: true,
      menuHeader: null,
      mentionText: "he",
    };
    const footer = () => SuggestionMenuView.resolveFooter(menu)!;

    presenter.render({ ...model, acceptKeys: ["Tab", "⏎"] });
    expect(footer().hidden).toBe(false);
    expect(
      Array.from(footer().querySelectorAll(".ft-suggestion-hint"), (hint) =>
        hint.getAttribute("aria-hidden"),
      ),
    ).toEqual(["true", "true", "true", "true"]);
    expect(Array.from(footer().querySelectorAll("kbd"), (kbd) => kbd.textContent)).toEqual([
      "↑↓",
      "Tab ⏎",
      "1–3",
      "Esc",
    ]);

    // The hints follow the "Extension UI Language" passed in, not the browser's.
    presenter.render({ ...model, acceptKeys: ["Tab"], uiLanguage: "de_DE" });
    expect(footer().textContent).toContain("übernehmen");

    presenter.render(model);
    expect(footer().hidden).toBe(true);
    menu.remove();
  });

  test("hides menu when positioning fails", () => {
    const positioning = {
      syncMenuTypography: jest.fn(),
      positionMenu: jest.fn(() => false),
    } as unknown as SuggestionPositioningService;
    const presenter = new SuggestionMenuPresenter(positioning);
    const { menu, list } = SuggestionMenuView.ensureMenu();
    const target = document.createElement("input");

    const rendered = presenter.render({
      menuId: 1,
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
