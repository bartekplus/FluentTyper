import { afterEach, describe, expect, jest, test } from "bun:test";
import { SettingsEngine } from "../src/ui/settings-engine/SettingsEngine.js";
import type { ManifestDefinition } from "../src/ui/settings-engine/types.js";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function createManifest(): ManifestDefinition {
  return {
    tabs: [
      { id: "core_settings", label: "Essentials" },
      { id: "advanced_tab", label: "Data" },
      { id: "about_support_tab", label: "About" },
    ],
    settings: [
      {
        tab: "core_settings",
        group: "General",
        name: "a",
        type: "description",
        text: "Essentials body",
      },
      {
        tab: "advanced_tab",
        group: "General",
        name: "b",
        type: "description",
        text: "Advanced body",
      },
      {
        tab: "about_support_tab",
        group: "General",
        name: "c",
        type: "description",
        text: "About body",
      },
    ],
  };
}

function createEngineElements() {
  const tabs = document.createElement("ul");
  const main = document.createElement("main");
  main.className = "options-main";
  const content = document.createElement("div");
  const mobileTabs = document.createElement("select");
  const searchInput = document.createElement("input");
  main.append(mobileTabs, searchInput, content);
  document.body.append(tabs, main);
  return { tabs, main, content, mobileTabs, searchInput };
}

function build(manifest: ManifestDefinition = createManifest()) {
  const elements = createEngineElements();
  new SettingsEngine({ container: elements }).buildFromManifest(manifest);
  return elements;
}

afterEach(() => {
  window.location.hash = "";
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

describe("SettingsEngine navigation", () => {
  test("activates the tab from the initial hash", () => {
    window.location.hash = "#advanced_tab";
    const elements = build();

    expect(elements.tabs.querySelector("li.is-active a")?.getAttribute("href")).toBe(
      "#advanced_tab",
    );
    expect(elements.mobileTabs.value).toBe("advanced_tab");
  });

  test("responds to hashchange events by activating the matching section", () => {
    const elements = build();
    window.location.hash = "#about_support_tab";
    window.dispatchEvent(new Event("hashchange"));

    expect(elements.tabs.querySelector("li.is-active a")?.getAttribute("href")).toBe(
      "#about_support_tab",
    );
  });

  test("mobile section switcher updates active section and hash", () => {
    const elements = build();
    elements.mobileTabs.value = "advanced_tab";
    elements.mobileTabs.dispatchEvent(new Event("change", { bubbles: true }));

    expect(window.location.hash).toBe("#advanced_tab");
    expect(elements.tabs.querySelector("li.is-active a")?.getAttribute("href")).toBe(
      "#advanced_tab",
    );
  });

  test("sidebar tab clicks reset scroll and update the active section", () => {
    const elements = build();
    document.documentElement.scrollTop = 360;
    elements.main.scrollTop = 180;

    const aboutTabLink = Array.from(elements.tabs.querySelectorAll<HTMLAnchorElement>("a")).find(
      (link) => link.getAttribute("href") === "#about_support_tab",
    );
    aboutTabLink?.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(window.location.hash).toBe("#about_support_tab");
    expect(document.documentElement.scrollTop).toBe(0);
    expect(elements.main.scrollTop).toBe(0);
    expect(elements.content.querySelector(".content-tab.is-active")?.id).toBe("about_support_tab");
  });

  test("tab changes reset the shared scroll position to the active section", () => {
    const elements = build();
    document.documentElement.scrollTop = 480;
    elements.main.scrollTop = 240;
    elements.mobileTabs.value = "about_support_tab";
    elements.mobileTabs.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.documentElement.scrollTop).toBe(0);
    expect(elements.main.scrollTop).toBe(0);
    expect(elements.content.querySelector(".content-tab.is-active")?.id).toBe("about_support_tab");
  });

  test("value-only controls do not render empty visible groups", () => {
    // Stored manifest data can still carry a group on a value-only field.
    const hiddenThemeValue = {
      tab: "theming_tab",
      group: "Light Theme Colors",
      name: "hiddenThemeValue",
      type: "valueOnly" as const,
      default: "#ffffff",
    };
    const elements = build({
      tabs: [{ id: "theming_tab", label: "Appearance" }],
      settings: [
        {
          tab: "theming_tab",
          group: "Studio",
          name: "appearanceStudioPanel",
          type: "customPanel",
          label: "Appearance studio",
          description: "Preview and tune the popup.",
        },
        hiddenThemeValue,
      ],
    });

    const groups = elements.content.querySelectorAll(".settings-group");
    expect(groups).toHaveLength(1);
    expect(elements.content.textContent || "").not.toContain("Light Theme Colors");
    expect(elements.content.querySelector("#appearanceStudioPanelPanelRoot")).not.toBeNull();
  });

  test.each([
    [
      "dataDiagnosticsPanel",
      {
        id: "advanced_tab",
        label: "Data & Diagnostics",
        shortDescription: "Backups, import/export, and productivity stats.",
      },
      {
        group: "Data & Diagnostics",
        label: "Data & Diagnostics",
        description: "Backups, import/export, and productivity stats.",
      },
    ],
    [
      "languagePreferencesPanel",
      { id: "language_tab", label: "Languages" },
      {
        group: "Writing setup",
        label: "Writing setup",
        description: "Choose writing languages and detection behavior.",
      },
    ],
  ])(
    "custom panel %s collapses the group shell and does not repeat its heading",
    (name, tab, panel) => {
      const elements = build({
        tabs: [tab],
        settings: [{ tab: tab.id, name, type: "customPanel", ...panel }],
      });

      const panelGroup = elements.content.querySelector(".settings-group");
      expect(panelGroup?.classList.contains("settings-group-panel-only")).toBe(true);
      expect(elements.content.querySelector(".settings-custom-panel-label")).toBeNull();
      expect(elements.content.querySelector(".settings-custom-panel-description")).toBeNull();
      expect(elements.content.querySelector(`#${name}PanelRoot`)).not.toBeNull();
      expect(elements.content.querySelector(".settings-section-title")?.textContent?.trim()).toBe(
        tab.label,
      );
    },
  );

  test("lists tabs in manifest order even when settings mention a later tab first", () => {
    const manifest = createManifest();
    manifest.settings.reverse();
    const elements = build(manifest);

    expect(
      Array.from(elements.tabs.querySelectorAll("a")).map((link) => link.getAttribute("href")),
    ).toEqual(["#core_settings", "#advanced_tab", "#about_support_tab"]);
    expect(Array.from(elements.content.children).map((tab) => tab.id)).toEqual([
      "core_settings",
      "advanced_tab",
      "about_support_tab",
    ]);
  });

  test("search opens a collapsed section that holds the match", () => {
    const elements = build();
    const tab = elements.content.querySelector<HTMLElement>("#core_settings")!;
    const matching = document.createElement("details");
    matching.textContent = "Prefix-only mode";
    const other = document.createElement("details");
    other.textContent = "Code mode";
    tab.append(matching, other);

    elements.searchInput.value = "prefix";
    elements.searchInput.dispatchEvent(new Event("input"));

    expect(matching.open).toBe(true);
    expect(other.open).toBe(false);
  });

  test("search activates the first matching tab and scrolls to the first match", () => {
    const scrollSpy = jest.fn();
    HTMLElement.prototype.scrollIntoView = scrollSpy;
    const elements = build();

    elements.searchInput.value = "advanced body";
    elements.searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(elements.tabs.querySelector("li.is-active a")?.getAttribute("href")).toBe(
      "#advanced_tab",
    );
    expect(scrollSpy).toHaveBeenCalled();
  });

  test("search does not match a control by its internal tab id", () => {
    const elements = build();
    elements.searchInput.value = "settings";
    elements.searchInput.dispatchEvent(new Event("input"));

    // "core_settings" is the tab id of the first control, not its text.
    const visible = Array.from(
      elements.content.querySelectorAll<HTMLElement>("[data-search-text]"),
    ).filter((control) => !control.classList.contains("is-search-hidden"));
    expect(visible).toHaveLength(0);
  });

  test("search scrolls to the match in the active tab, not to a match in a hidden tab", () => {
    const scrolled: HTMLElement[] = [];
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this);
    };
    window.location.hash = "#advanced_tab";
    const elements = build();

    elements.searchInput.value = "body";
    elements.searchInput.dispatchEvent(new Event("input"));

    expect(scrolled).toHaveLength(1);
    expect(elements.content.querySelector("#advanced_tab")!.contains(scrolled[0])).toBe(true);
  });
});
