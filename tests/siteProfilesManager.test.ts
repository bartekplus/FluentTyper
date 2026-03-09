import "./setup";
import { afterEach, describe, expect, jest, test } from "bun:test";
import { Store } from "../src/core/application/storage/Store.js";
import {
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
  KEY_SITE_PROFILES,
} from "../src/core/domain/constants";
import { SUPPORTED_LANGUAGES } from "../src/core/domain/lang";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";
import { SiteProfilesManager } from "../src/ui/options/siteProfiles.js";

type StorageSnapshot = Record<string, string>;

const originalChrome = (globalThis as { chrome?: unknown }).chrome;
const originalEnglishLabel = SUPPORTED_LANGUAGES.en_US;

function setChromeStorageState(storageState: StorageSnapshot): void {
  const localGet = jest.fn(
    (key: string | string[] | null, callback: (result: Record<string, string>) => void): void => {
      if (typeof key === "string") {
        callback({ [key]: storageState[key] });
        return;
      }
      if (Array.isArray(key)) {
        const result: Record<string, string> = {};
        key.forEach((entry) => {
          if (storageState[entry] !== undefined) {
            result[entry] = storageState[entry];
          }
        });
        callback(result);
        return;
      }
      callback({ ...storageState });
    },
  );

  const localSet = jest.fn();
  const localRemove = jest.fn();

  (globalThis as { chrome?: unknown }).chrome = {
    ...(typeof originalChrome === "object" && originalChrome !== null ? originalChrome : {}),
    runtime: {
      getManifest: () => ({ version: "test-version" }),
    },
    i18n: {
      getMessage: (key: string) => key,
    },
    storage: {
      local: {
        get: localGet,
        set: localSet,
        remove: localRemove,
      },
      sync: {
        get: localGet,
        set: localSet,
        remove: localRemove,
      },
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
  (globalThis as { chrome?: unknown }).chrome = originalChrome;
  SUPPORTED_LANGUAGES.en_US = originalEnglishLabel;
});

function createStore(values: Record<string, unknown>): Store {
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

describe("SiteProfilesManager", () => {
  test("renders site profile values as text instead of html", async () => {
    SUPPORTED_LANGUAGES.en_US = "English (US)<img src=x onerror=alert(1)>";

    setChromeStorageState({
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
    });

    const root = document.createElement("div");
    root.id = "siteProfilesEditorRoot";
    document.body.appendChild(root);

    new SiteProfilesManager(
      {
        siteProfilesEditor: {
          rootElement: root,
        },
      },
      new Store("settings"),
    );

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
    const values = {
      [KEY_ENABLED_LANGUAGES]: ["en_US"],
      [KEY_SITE_PROFILES]: {
        "docs.example": {
          language: "en_US",
        },
      },
      [KEY_NUM_SUGGESTIONS]: 4,
      [KEY_INLINE_SUGGESTION]: false,
      [KEY_PREFER_NATIVE_AUTOCOMPLETE]: true,
    };

    const root = document.createElement("div");
    document.body.appendChild(root);

    new SiteProfilesManager(
      {
        siteProfilesEditor: {
          rootElement: root,
        },
      },
      createStore(values),
    );

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
});
