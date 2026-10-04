import { afterEach, describe, expect, test } from "bun:test";
import { Store } from "../src/core/application/storage/Store.js";
import {
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
  KEY_SITE_PROFILES,
} from "../src/core/domain/constants";
import { SUPPORTED_LANGUAGES } from "../src/core/domain/lang";
import { formatTranslation, i18n } from "../src/ui/options/fluenttyperI18n.js";
import { SiteProfilesManager } from "../src/ui/options/siteProfiles.js";
import { installChromeStorageMock } from "./support/chromeStorage";
import { memorySettings } from "./support/fakeSettings";
import { findButtonByText, flushAsyncWork } from "./support/settingsFakes";

async function mountManager() {
  i18n.lang = "en";
  const store = memorySettings({
    [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE"],
    [KEY_SITE_PROFILES]: { "docs.example": { language: "en_US" } },
    [KEY_NUM_SUGGESTIONS]: 4,
    [KEY_INLINE_SUGGESTION]: false,
    [KEY_PREFER_NATIVE_AUTOCOMPLETE]: true,
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  const manager = new SiteProfilesManager(root, store as never);
  await flushAsyncWork();
  return { root, manager, values: store.store };
}

const originalChrome = (globalThis as { chrome?: unknown }).chrome;
const originalEnglishLabel = SUPPORTED_LANGUAGES.en_US;

afterEach(() => {
  (globalThis as { chrome?: unknown }).chrome = originalChrome;
  SUPPORTED_LANGUAGES.en_US = originalEnglishLabel;
});

describe("SiteProfilesManager", () => {
  test("renders site profile values as text instead of html", async () => {
    SUPPORTED_LANGUAGES.en_US = "English (US)<img src=x onerror=alert(1)>";

    installChromeStorageMock({
      initialState: {
        [`store.settings.${KEY_ENABLED_LANGUAGES}`]: JSON.stringify(["en_US"]),
        [`store.settings.${KEY_SITE_PROFILES}`]: JSON.stringify({
          "evil.example": {
            language: "en_US",
            numSuggestions: 3,
            inline_suggestion: true,
            preferNativeAutocomplete: false,
          },
        }),
        [`store.settings.${KEY_NUM_SUGGESTIONS}`]: JSON.stringify(4),
        [`store.settings.${KEY_INLINE_SUGGESTION}`]: JSON.stringify(false),
        [`store.settings.${KEY_PREFER_NATIVE_AUTOCOMPLETE}`]: JSON.stringify(true),
      },
    });

    const root = document.createElement("div");
    root.id = "siteProfilesEditorRoot";
    document.body.appendChild(root);

    new SiteProfilesManager(root, new Store("settings"));

    await flushAsyncWork();

    expect(root.querySelector("#siteProfilesTableBody img")).toBeNull();
    expect(root.querySelector(".site-profile-row-domain")?.textContent ?? "").toContain(
      "evil.example",
    );
    expect(root.querySelector(".site-profile-row")?.textContent ?? "").toContain(
      "English (US)<img src=x onerror=alert(1)>",
    );
    const actionButtons = Array.from(
      root.querySelectorAll<HTMLButtonElement>("#siteProfilesTableBody button[data-domain]"),
    );
    expect(actionButtons).toHaveLength(2);
    actionButtons.forEach((button) => {
      expect(button.dataset.domain).toBe("evil.example");
    });
  });

  test("requires a confirmation click before removing a site profile", async () => {
    i18n.lang = "en";
    const store = memorySettings({
      [KEY_ENABLED_LANGUAGES]: ["en_US"],
      [KEY_SITE_PROFILES]: {
        "docs.example": {
          language: "en_US",
        },
      },
      [KEY_NUM_SUGGESTIONS]: 4,
      [KEY_INLINE_SUGGESTION]: false,
      [KEY_PREFER_NATIVE_AUTOCOMPLETE]: true,
    });
    const values = store.store;

    const root = document.createElement("div");
    document.body.appendChild(root);

    new SiteProfilesManager(root, store as never);

    await flushAsyncWork();

    const removeButton = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button[data-action='remove']"),
    )[0];
    removeButton.click();
    await flushAsyncWork();

    expect(Object.keys(values[KEY_SITE_PROFILES] as Record<string, unknown>)).toHaveLength(1);
    expect(root.textContent).toContain(
      "Click Remove again to delete the profile for docs.example.",
    );

    const confirmedRemoveButton = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button[data-action='remove']"),
    )[0];
    confirmedRemoveButton.click();
    await flushAsyncWork();

    expect(values[KEY_SITE_PROFILES]).toEqual({});
    expect(root.textContent).toContain(i18n.get("site_profiles_removed_status"));
  });

  test.each<[string, (root: HTMLElement, manager: SiteProfilesManager) => Promise<void> | void]>([
    [
      "typing in the search box",
      (root) => {
        const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
        search.value = "zzz";
        search.dispatchEvent(new Event("input"));
      },
    ],
    ["the first Remove click", (root) => findButtonByText(root, i18n.get("remove")).click()],
    ["a render after a global setting change", (_root, manager) => manager.render()],
  ])("%s keeps the unsaved editor input", async (_label, action) => {
    const { root, manager } = await mountManager();
    const domain = root.querySelector<HTMLInputElement>(".site-profiles-editor input")!;
    const selects = root.querySelectorAll<HTMLSelectElement>(".site-profiles-form-grid select");
    domain.value = "draft.example";
    selects[0].value = "de_DE";
    selects[4].value = "on";

    await action(root, manager);
    await flushAsyncWork();

    expect([domain.value, selects[0].value, selects[4].value]).toEqual([
      "draft.example",
      "de_DE",
      "on",
    ]);
  });

  test("Edit shows the editing text one time", async () => {
    const { root } = await mountManager();

    findButtonByText(root, i18n.get("site_profiles_edit_btn")).click();
    await flushAsyncWork();

    const editing = formatTranslation("site_profiles_update_status", { domain: "docs.example" });
    const hits = Array.from(root.querySelectorAll("p")).filter((p) => p.textContent === editing);
    expect(hits).toHaveLength(1);
  });
});
