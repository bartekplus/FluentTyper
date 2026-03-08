import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { SettingsEngine } from "../src/ui/settings-engine/SettingsEngine.js";
import type { ManifestDefinition } from "../src/ui/settings-engine/types.js";
const originalWindowScrollTo = window.scrollTo;

function createManifest(): ManifestDefinition {
  return {
    name: "Test",
    icon: "/icon.png",
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
  (globalThis as { location?: Location }).location = window.location;
  window.history.replaceState = ((_data, _unused, url) => {
    if (typeof url === "string" && url.startsWith("#")) {
      window.location.hash = url;
    }
  }) as History["replaceState"];
  (globalThis as { history?: History }).history = window.history;
  return { tabs, main, content, mobileTabs, searchInput };
}

afterEach(() => {
  document.body.replaceChildren();
  window.location.hash = "";
  window.scrollTo = originalWindowScrollTo;
});

describe("SettingsEngine navigation", () => {
  test("activates the tab from the initial hash", () => {
    window.location.hash = "#advanced_tab";
    const elements = createEngineElements();
    const engine = new SettingsEngine({
      container: elements,
    });

    engine.buildFromManifest(createManifest());

    expect(elements.tabs.querySelector("li.is-active a")?.getAttribute("href")).toBe(
      "#advanced_tab",
    );
    expect(elements.mobileTabs.value).toBe("advanced_tab");
  });

  test("responds to hashchange events by activating the matching section", () => {
    const elements = createEngineElements();
    const engine = new SettingsEngine({
      container: elements,
    });

    engine.buildFromManifest(createManifest());
    window.location.hash = "#about_support_tab";
    window.dispatchEvent(new Event("hashchange"));

    expect(elements.tabs.querySelector("li.is-active a")?.getAttribute("href")).toBe(
      "#about_support_tab",
    );
  });

  test("mobile section switcher updates active section and hash", () => {
    const elements = createEngineElements();
    const engine = new SettingsEngine({
      container: elements,
    });

    engine.buildFromManifest(createManifest());
    elements.mobileTabs.value = "advanced_tab";
    elements.mobileTabs.dispatchEvent(new Event("change", { bubbles: true }));

    expect(window.location.hash).toBe("#advanced_tab");
    expect(elements.tabs.querySelector("li.is-active a")?.getAttribute("href")).toBe(
      "#advanced_tab",
    );
  });

  test("sidebar tab clicks reset scroll and update the active section", () => {
    const elements = createEngineElements();
    const engine = new SettingsEngine({
      container: elements,
    });
    document.documentElement.scrollTop = 360;
    elements.main.scrollTop = 180;

    engine.buildFromManifest(createManifest());

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
    const elements = createEngineElements();
    const engine = new SettingsEngine({
      container: elements,
    });
    document.documentElement.scrollTop = 480;
    elements.main.scrollTop = 240;

    engine.buildFromManifest(createManifest());
    elements.mobileTabs.value = "about_support_tab";
    elements.mobileTabs.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.documentElement.scrollTop).toBe(0);
    expect(elements.main.scrollTop).toBe(0);
    expect(elements.content.querySelector(".content-tab.is-active")?.id).toBe("about_support_tab");
  });

  test("value-only controls do not render empty visible groups", () => {
    const elements = createEngineElements();
    const engine = new SettingsEngine({
      container: elements,
    });

    engine.buildFromManifest({
      name: "Test",
      icon: "/icon.png",
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
        {
          tab: "theming_tab",
          group: "Light Theme Colors",
          name: "hiddenThemeValue",
          type: "valueOnly",
          default: "#ffffff",
        },
      ],
    });

    const groups = elements.content.querySelectorAll(".settings-group");
    expect(groups).toHaveLength(1);
    expect(elements.content.textContent || "").not.toContain("Light Theme Colors");
    expect(elements.content.querySelector("#appearanceStudioPanelPanelRoot")).not.toBeNull();
  });
});
