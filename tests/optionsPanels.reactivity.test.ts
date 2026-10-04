import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LanguageSettingsPanel } from "../src/ui/options/LanguageSettingsPanel.js";
import { SiteManagementPanel } from "../src/ui/options/SiteManagementPanel.js";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";
import {
  KEY_SHOW_SUGGESTION_FOOTER,
  KEY_CODE_MODE,
  KEY_DOMAIN_LIST_MODE,
  KEY_ENABLED_LANGUAGES,
  KEY_EXTENSION_LANGUAGE,
  KEY_FALLBACK_LANGUAGE,
  KEY_INLINE_SUGGESTION,
  KEY_LANGUAGE,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
} from "../src/core/domain/constants";
import { memorySettings } from "./support/fakeSettings";
import {
  fakeRegistry,
  findButtonByText,
  flushAsyncWork,
  type SettingsMap,
} from "./support/settingsFakes";

const baseChrome: unknown = { runtime: {} };

/** Answers each runtime message with reply(), in the callback form and in the promise form. */
function replyToMessages(reply: () => Promise<unknown>): void {
  (globalThis.chrome as unknown as { runtime: Record<string, unknown> }).runtime.sendMessage = (
    _message: unknown,
    callback?: (response: unknown) => void,
  ) => {
    const response = reply();
    void response.then(callback);
    return response;
  };
}

function mountPanels(seed: SettingsMap) {
  const store = memorySettings({
    [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE"],
    [KEY_LANGUAGE]: "en_US",
    [KEY_FALLBACK_LANGUAGE]: "en_US",
    [KEY_SITE_PROFILES]: {},
    [KEY_DOMAIN_LIST_MODE]: "blackList",
    domainBlackList: [],
    [KEY_CODE_MODE]: false,
    ...seed,
  });
  const registry = fakeRegistry(store.store, LABELS);
  const languageRoot = document.createElement("div");
  const sitesRoot = document.createElement("div");
  document.body.append(languageRoot, sitesRoot);
  const language = new LanguageSettingsPanel(languageRoot, registry, store as never);
  new SiteManagementPanel(sitesRoot, registry, store as never, () => {});
  return { store, registry, language, languageRoot, sitesRoot };
}

const LABELS = {
  [KEY_LANGUAGE]: "",
  [KEY_ENABLED_LANGUAGES]: "",
  [KEY_FALLBACK_LANGUAGE]: "",
  [KEY_SITE_PROFILES]: "",
  [KEY_EXTENSION_LANGUAGE]: "Extension Language",
  [KEY_SHOW_SUGGESTION_FOOTER]: "Show language of prediction",
  [KEY_DOMAIN_LIST_MODE]: "",
  domainBlackList: "",
  [KEY_NUM_SUGGESTIONS]: "",
  [KEY_INLINE_SUGGESTION]: "",
};

describe("options panel reactivity", () => {
  beforeEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = baseChrome;
    i18n.lang = "en";
    replyToMessages(() => Promise.resolve({ status: null }));
  });

  afterEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = baseChrome;
  });

  test("language warnings refresh when site profiles change", async () => {
    const store = memorySettings({
      [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE"],
      [KEY_LANGUAGE]: "en_US",
      [KEY_FALLBACK_LANGUAGE]: "en_US",
      [KEY_SITE_PROFILES]: {},
    });
    const values = store.store;
    const registry = fakeRegistry(values, LABELS);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new LanguageSettingsPanel(root, registry, store as never);
    await flushAsyncWork();

    const germanCardBefore = findButtonByText(root, "German");
    expect(germanCardBefore.textContent).toContain(i18n.get("language_panel_site_available"));
    expect(germanCardBefore.textContent).not.toContain(
      i18n.get("language_panel_site_override_warning"),
    );

    values[KEY_SITE_PROFILES] = {
      "docs.example": {
        language: "de_DE",
      },
    };
    registry[KEY_SITE_PROFILES].set(values[KEY_SITE_PROFILES], true);
    await flushAsyncWork();

    const germanCardAfter = findButtonByText(root, "German");
    expect(germanCardAfter.textContent).toContain("Site profiles: 1");
    expect(germanCardAfter.textContent).toContain(i18n.get("language_panel_site_override_warning"));
  });

  test("language summary only mentions fallback when auto-detect is active", async () => {
    const store = memorySettings({
      [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE", "fr_FR"],
      [KEY_LANGUAGE]: "en_US",
      [KEY_FALLBACK_LANGUAGE]: "de_DE",
      [KEY_SITE_PROFILES]: {},
    });
    const values = store.store;
    const registry = fakeRegistry(values, LABELS);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new LanguageSettingsPanel(root, registry, store as never);
    await flushAsyncWork();

    const summaryText = root.querySelector(".language-panel-summary p")?.textContent || "";
    expect(summaryText).toContain("3 writing languages enabled. Primary behavior: English (US).");
    expect(summaryText).not.toContain("Fallback:");

    values[KEY_LANGUAGE] = "auto_detect";
    replyToMessages(() =>
      Promise.resolve({
        status: {
          language: "de_DE",
          locked: true,
        },
      }),
    );
    registry[KEY_LANGUAGE].set(values[KEY_LANGUAGE], true);
    await flushAsyncWork();

    const autoDetectSummary = root.querySelector(".language-panel-summary p")?.textContent || "";
    expect(autoDetectSummary).toContain("Primary behavior: Auto-detect.");
    expect(autoDetectSummary).toContain("Fallback: German.");
    expect(root.textContent).toContain("Auto-detect currently using German.");
    expect(root.textContent).toContain("Session lock is active.");
  });

  test("language summary shows waiting copy when no live website session exists", async () => {
    const store = memorySettings({
      [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE", "fr_FR"],
      [KEY_LANGUAGE]: "auto_detect",
      [KEY_FALLBACK_LANGUAGE]: "fr_FR",
      [KEY_SITE_PROFILES]: {},
    });
    const values = store.store;
    const registry = fakeRegistry(values, LABELS);
    const root = document.createElement("div");
    document.body.appendChild(root);

    replyToMessages(() => Promise.resolve({ status: null }));

    new LanguageSettingsPanel(root, registry, store as never);
    await flushAsyncWork();

    expect(root.textContent).toContain(
      "Waiting for a live website typing session. Fallback: French.",
    );
  });

  test("language workspace keeps the language grid full-width, without the popup footer setting", async () => {
    const store = memorySettings({
      [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE"],
      [KEY_LANGUAGE]: "en_US",
      [KEY_FALLBACK_LANGUAGE]: "en_US",
      [KEY_EXTENSION_LANGUAGE]: "auto_detect",
      [KEY_SHOW_SUGGESTION_FOOTER]: true,
      [KEY_SITE_PROFILES]: {},
    });
    const values = store.store;
    const registry = fakeRegistry(values, LABELS);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new LanguageSettingsPanel(root, registry, store as never);
    await flushAsyncWork();

    expect(root.querySelector(".workspace-top-grid")).not.toBeNull();
    const fullWidthCards = root.querySelectorAll(".workspace-main-grid > .workspace-span-full");
    expect(fullWidthCards.length).toBeGreaterThanOrEqual(1);
    // It controls the whole popup footer now, in General.
    expect(root.textContent).not.toContain(i18n.get("show_suggestion_footer_label"));
  });

  test.each([
    ["a language card", "language", (root: HTMLElement) => findButtonByText(root, "German")],
    [
      "the add-site button",
      "sites",
      (root: HTMLElement) => {
        root.querySelector<HTMLInputElement>(
          ".text-assets-toolbar input:not([type=search])",
        )!.value = "example.com";
        return findButtonByText(root, i18n.get("site_management_block_site"));
      },
    ],
  ] as const)(
    "%s keeps the keyboard focus after its click renders the panel",
    async (_label, panel, target) => {
      const { languageRoot, sitesRoot } = mountPanels({});
      await flushAsyncWork();
      const root = panel === "language" ? languageRoot : sitesRoot;
      const button = target(root);
      const text = button.textContent;
      button.focus();

      button.click();
      await flushAsyncWork();
      await flushAsyncWork();

      const active = document.activeElement as HTMLElement;
      expect(active).not.toBe(button);
      expect(root.contains(active)).toBe(true);
      expect(active.textContent).toBe(text);
    },
  );

  test("both language selects have an accessible name", async () => {
    const { languageRoot } = mountPanels({ [KEY_LANGUAGE]: "auto_detect" });
    await flushAsyncWork();

    const [primary, fallback] = languageRoot.querySelectorAll("select");
    expect(languageRoot.querySelector(`label[for="${primary.id}"]`)?.textContent).toBe(
      i18n.get("primary_lang_label"),
    );
    expect(fallback.getAttribute("aria-label")).toBe(i18n.get("fallback_lang_label"));
  });

  test("a slow auto-detect render does not replace a newer render", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    replyToMessages(() => gate.then(() => ({ status: null })));
    const { store, language, languageRoot } = mountPanels({ [KEY_LANGUAGE]: "auto_detect" });
    store.store[KEY_LANGUAGE] = "en_US";

    await language.render();
    release();
    await flushAsyncWork();

    expect(languageRoot.querySelector("select")!.value).toBe("en_US");
  });

  test("a saved site profile updates the language cards", async () => {
    const { languageRoot, sitesRoot } = mountPanels({});
    await flushAsyncWork();
    expect(languageRoot.textContent).not.toContain(
      i18n.get("language_panel_site_override_warning"),
    );

    sitesRoot.querySelector<HTMLInputElement>(".site-profiles-editor input")!.value =
      "docs.example";
    sitesRoot.querySelector<HTMLSelectElement>("#siteProfileLanguageSelect")!.value = "de_DE";
    findButtonByText(sitesRoot, i18n.get("site_profiles_add_btn")).click();
    await flushAsyncWork();
    await flushAsyncWork();

    expect(findButtonByText(languageRoot, "German").textContent).toContain(
      i18n.get("language_panel_site_override_warning"),
    );
  });

  test("a global code mode change updates the site profile inherit label", async () => {
    const { registry, sitesRoot } = mountPanels({});
    await flushAsyncWork();
    const codeModeInherit = () =>
      sitesRoot.querySelectorAll<HTMLSelectElement>(".site-profiles-form-grid select")[4].options[0]
        .textContent;
    expect(codeModeInherit()).toContain(i18n.get("site_profile_off"));

    registry[KEY_CODE_MODE].set(true);
    await flushAsyncWork();

    expect(codeModeInherit()).toContain(i18n.get("site_profile_on"));
  });

  test("sites UI refreshes immediately when enabled languages change", async () => {
    const store = memorySettings({
      [KEY_DOMAIN_LIST_MODE]: "blackList",
      domainBlackList: [],
      [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE"],
      [KEY_SITE_PROFILES]: {
        "docs.example": {
          language: "de_DE",
        },
      },
      [KEY_NUM_SUGGESTIONS]: 4,
      [KEY_INLINE_SUGGESTION]: false,
    });
    const values = store.store;
    const registry = fakeRegistry(values, LABELS);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new SiteManagementPanel(root, registry, store as never, () => {});
    await flushAsyncWork();

    const languageSelectBefore = root.querySelector("#siteProfileLanguageSelect");
    expect(languageSelectBefore?.textContent).toContain("German");
    expect(root.querySelectorAll("#siteProfilesTableBody .site-profile-row")).toHaveLength(1);

    values[KEY_ENABLED_LANGUAGES] = ["en_US"];
    registry[KEY_ENABLED_LANGUAGES].set(values[KEY_ENABLED_LANGUAGES], true);
    await flushAsyncWork();

    const languageSelectAfter = root.querySelector("#siteProfileLanguageSelect");
    expect(languageSelectAfter?.textContent).not.toContain("German");
    expect(root.querySelectorAll("#siteProfilesTableBody .site-profile-row")).toHaveLength(0);
    expect(root.textContent).toContain(i18n.get("site_profiles_empty_workspace"));
  });
});
