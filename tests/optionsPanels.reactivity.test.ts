import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Store } from "../src/core/application/storage/Store.js";
import type { SettingsRegistry } from "../src/ui/settings-engine/SettingsEngine.js";
import { LanguageSettingsPanel } from "../src/ui/options/LanguageSettingsPanel.js";
import { SiteManagementPanel } from "../src/ui/options/SiteManagementPanel.js";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";
import {
  KEY_DISPLAY_LANG_HEADER,
  KEY_DOMAIN_LIST_MODE,
  KEY_ENABLED_LANGUAGES,
  KEY_EXTENSION_LANGUAGE,
  KEY_FALLBACK_LANGUAGE,
  KEY_INLINE_SUGGESTION,
  KEY_LANGUAGE,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
} from "../src/core/domain/constants";
import { acquireDomGlobalLock } from "./support/domGlobalLock";

type SettingsMap = Record<string, unknown>;
const baseChrome = (globalThis as unknown as { chrome: unknown }).chrome;
let releaseDomGlobalLock: (() => void) | null = null;

class MockControl {
  readonly rootElement: HTMLElement;
  readonly element: HTMLElement;
  private readonly handlers: Array<(value: unknown) => void> = [];
  private value: unknown;

  constructor(value?: unknown, label = "") {
    this.value = value;
    this.rootElement = document.createElement("div");
    this.rootElement.className = "field";
    this.rootElement.textContent = label;
    this.element = this.rootElement;
  }

  addEvent(type: string, fn: (value: unknown) => void): void {
    if (type === "action") {
      this.handlers.push(fn);
    }
  }

  get(): unknown {
    return this.value;
  }

  set(value: unknown): this {
    this.value = value;
    this.handlers.forEach((handler) => handler(value));
    return this;
  }
}

function createStore(values: SettingsMap): Store {
  return {
    get(name: string) {
      return Promise.resolve(values[name]);
    },
    set(name: string, value: unknown) {
      values[name] = value;
      return Promise.resolve();
    },
  } as Store;
}

function createRegistry(initialValues: SettingsMap): SettingsRegistry {
  return {
    [KEY_LANGUAGE]: new MockControl(initialValues[KEY_LANGUAGE]),
    [KEY_ENABLED_LANGUAGES]: new MockControl(initialValues[KEY_ENABLED_LANGUAGES]),
    [KEY_FALLBACK_LANGUAGE]: new MockControl(initialValues[KEY_FALLBACK_LANGUAGE]),
    [KEY_SITE_PROFILES]: new MockControl(initialValues[KEY_SITE_PROFILES]),
    [KEY_EXTENSION_LANGUAGE]: new MockControl(
      initialValues[KEY_EXTENSION_LANGUAGE],
      "Extension Language",
    ),
    [KEY_DISPLAY_LANG_HEADER]: new MockControl(
      initialValues[KEY_DISPLAY_LANG_HEADER],
      "Show language of prediction",
    ),
    [KEY_DOMAIN_LIST_MODE]: new MockControl(initialValues[KEY_DOMAIN_LIST_MODE]),
    domainBlackList: new MockControl(initialValues.domainBlackList),
    [KEY_NUM_SUGGESTIONS]: new MockControl(initialValues[KEY_NUM_SUGGESTIONS]),
    [KEY_INLINE_SUGGESTION]: new MockControl(initialValues[KEY_INLINE_SUGGESTION]),
  } as unknown as SettingsRegistry;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function findButtonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Button with text "${text}" not found`);
  }
  return button;
}

describe.serial("options panel reactivity", () => {
  beforeEach(async () => {
    releaseDomGlobalLock = await acquireDomGlobalLock();
    i18n.lang = "en";
    (
      globalThis.chrome as typeof chrome & {
        runtime: typeof chrome.runtime & { sendMessage: (message: unknown) => Promise<unknown> };
      }
    ).runtime.sendMessage = () => Promise.resolve({ status: null });
  });

  afterEach(() => {
    document.body.replaceChildren();
    (globalThis as unknown as { chrome: unknown }).chrome = baseChrome;
    releaseDomGlobalLock?.();
    releaseDomGlobalLock = null;
  });

  test("language warnings refresh when site profiles change", async () => {
    const values: SettingsMap = {
      [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE"],
      [KEY_LANGUAGE]: "en_US",
      [KEY_FALLBACK_LANGUAGE]: "en_US",
      [KEY_SITE_PROFILES]: {},
    };
    const store = createStore(values);
    const registry = createRegistry(values);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new LanguageSettingsPanel(root, registry, store);
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
    const values: SettingsMap = {
      [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE", "fr_FR"],
      [KEY_LANGUAGE]: "en_US",
      [KEY_FALLBACK_LANGUAGE]: "de_DE",
      [KEY_SITE_PROFILES]: {},
    };
    const store = createStore(values);
    const registry = createRegistry(values);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new LanguageSettingsPanel(root, registry, store);
    await flushAsyncWork();

    const summaryText = root.querySelector(".language-panel-summary p")?.textContent || "";
    expect(summaryText).toContain("3 writing languages enabled. Primary behavior: English (US).");
    expect(summaryText).not.toContain("Fallback:");

    values[KEY_LANGUAGE] = "auto_detect";
    (
      globalThis.chrome as typeof chrome & {
        runtime: typeof chrome.runtime & { sendMessage: (message: unknown) => Promise<unknown> };
      }
    ).runtime.sendMessage = () =>
      Promise.resolve({
        status: {
          language: "de_DE",
          locked: true,
        },
      });
    registry[KEY_LANGUAGE].set(values[KEY_LANGUAGE], true);
    await flushAsyncWork();

    const autoDetectSummary = root.querySelector(".language-panel-summary p")?.textContent || "";
    expect(autoDetectSummary).toContain("Primary behavior: Auto-detect.");
    expect(autoDetectSummary).toContain("Fallback: German.");
    expect(root.textContent).toContain("Auto-detect currently using German.");
    expect(root.textContent).toContain("Session lock is active.");
  });

  test("language summary shows waiting copy when no live website session exists", async () => {
    const values: SettingsMap = {
      [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE", "fr_FR"],
      [KEY_LANGUAGE]: "auto_detect",
      [KEY_FALLBACK_LANGUAGE]: "fr_FR",
      [KEY_SITE_PROFILES]: {},
    };
    const store = createStore(values);
    const registry = createRegistry(values);
    const root = document.createElement("div");
    document.body.appendChild(root);

    (
      globalThis.chrome as typeof chrome & {
        runtime: typeof chrome.runtime & { sendMessage: (message: unknown) => Promise<unknown> };
      }
    ).runtime.sendMessage = () => Promise.resolve({ status: null });

    new LanguageSettingsPanel(root, registry, store);
    await flushAsyncWork();

    expect(root.textContent).toContain(
      "Waiting for a live website typing session. Fallback: French.",
    );
  });

  test("language workspace moves prediction language display into a full-width row", async () => {
    const values: SettingsMap = {
      [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE"],
      [KEY_LANGUAGE]: "en_US",
      [KEY_FALLBACK_LANGUAGE]: "en_US",
      [KEY_EXTENSION_LANGUAGE]: "auto_detect",
      [KEY_DISPLAY_LANG_HEADER]: true,
      [KEY_SITE_PROFILES]: {},
    };
    const store = createStore(values);
    const registry = createRegistry(values);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new LanguageSettingsPanel(root, registry, store);
    await flushAsyncWork();

    expect(root.querySelector(".workspace-top-grid")).not.toBeNull();
    const fullWidthCards = root.querySelectorAll(".workspace-main-grid > .workspace-span-full");
    expect(fullWidthCards.length).toBeGreaterThanOrEqual(2);
    expect(root.textContent).toContain(i18n.get("language_display"));
    expect(root.textContent).toContain(i18n.get("show_lang_header_label"));
  });

  test("sites UI refreshes immediately when enabled languages change", async () => {
    const values: SettingsMap = {
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
    };
    const store = createStore(values);
    const registry = createRegistry(values);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new SiteManagementPanel(root, registry, store, () => {});
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
