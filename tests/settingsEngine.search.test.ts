import "./setup";
import { afterEach, describe, expect, jest, test } from "bun:test";
import { SettingsEngine } from "../src/ui/settings-engine/SettingsEngine.js";
import type { ManifestDefinition } from "../src/ui/settings-engine/types.js";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

afterEach(() => {
  document.body.replaceChildren();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

describe("SettingsEngine search", () => {
  test("search activates the first matching tab and scrolls to the first match", () => {
    const scrollSpy = jest.fn();
    HTMLElement.prototype.scrollIntoView = scrollSpy;

    const tabs = document.createElement("ul");
    const content = document.createElement("div");
    const searchInput = document.createElement("input");
    document.body.append(tabs, content, searchInput);
    (globalThis as { location?: Location }).location = window.location;

    const engine = new SettingsEngine({
      container: {
        tabs,
        content,
        searchInput,
      },
    });

    const manifest: ManifestDefinition = {
      name: "Test",
      icon: "/icon.png",
      tabs: [
        { id: "first_tab", label: "First" },
        { id: "second_tab", label: "Second" },
      ],
      settings: [
        {
          tab: "first_tab",
          group: "General",
          name: "intro",
          type: "description",
          text: "Alpha workspace",
        },
        {
          tab: "second_tab",
          group: "General",
          name: "target",
          type: "description",
          text: "Beta match target",
        },
      ],
    };

    engine.buildFromManifest(manifest);

    searchInput.value = "beta match";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(tabs.querySelector("li.is-active a")?.getAttribute("href")).toBe("#second_tab");
    expect(scrollSpy).toHaveBeenCalled();
  });
});
