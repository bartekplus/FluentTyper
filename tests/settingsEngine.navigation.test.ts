import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { SettingsEngine } from "../src/ui/settings-engine/SettingsEngine.js";
import type { ManifestDefinition } from "../src/ui/settings-engine/types.js";

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
  const content = document.createElement("div");
  const mobileTabs = document.createElement("select");
  const searchInput = document.createElement("input");
  document.body.append(tabs, mobileTabs, searchInput, content);
  (globalThis as { location?: Location }).location = window.location;
  window.history.replaceState = ((_data, _unused, url) => {
    if (typeof url === "string" && url.startsWith("#")) {
      window.location.hash = url;
    }
  }) as History["replaceState"];
  (globalThis as { history?: History }).history = window.history;
  return { tabs, content, mobileTabs, searchInput };
}

afterEach(() => {
  document.body.replaceChildren();
  window.location.hash = "";
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
});
