import { afterEach, describe, expect, test } from "bun:test";
import { ChromeStorageBackend } from "../src/core/application/storage/ChromeStorageBackend";
import { Store } from "../src/core/application/storage/Store";
import { installChromeStorageMock } from "./support/chromeStorage";

const originalChrome = (globalThis as { chrome?: unknown }).chrome;

afterEach(() => {
  (globalThis as { chrome?: unknown }).chrome = originalChrome;
  localStorage.clear();
});

describe("ChromeStorageBackend.getAll", () => {
  test("returns only keys in the requested namespace", async () => {
    installChromeStorageMock({
      initialState: {
        "store.settings.enable": "true",
        "store.settings.language": '"en"',
        "store.other.enable": "false",
        "extensionState.enabled": "false",
        "extensionState.language": '"pl"',
      },
    });

    const backend = new ChromeStorageBackend(true);

    await expect(backend.getAll("store.settings.")).resolves.toEqual({
      enable: "true",
      language: '"en"',
    });
  });
});

describe("ChromeStorageBackend failures", () => {
  test("rejects a failed browser storage read", async () => {
    installChromeStorageMock({ getError: "read denied" });

    await expect(new ChromeStorageBackend(true).get("key")).rejects.toThrow("read denied");
  });

  test("rejects a failed browser storage removal", async () => {
    installChromeStorageMock({ removeError: "remove denied" });

    await expect(new ChromeStorageBackend(true).remove("key")).rejects.toThrow("remove denied");
  });
});

describe("Store async semantics", () => {
  test("set resolves only after backend callback completes", async () => {
    const { localSet } = installChromeStorageMock({ setDelayMs: 25 });
    const store = new Store("unit", {});

    let resolved = false;
    const writePromise = store.set("language", "en_US").then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(localSet).toHaveBeenCalled();
    expect(resolved).toBe(false);

    await writePromise;
    expect(resolved).toBe(true);
  });

  test("get waits for async default seeding to finish", async () => {
    const { storageState } = installChromeStorageMock({ setDelayMs: 20 });
    const store = new Store("startup", { enabled: true });

    const value = await store.get("enabled");
    expect(value).toBe(true);
    expect(storageState["store.startup.enabled"]).toBe("true");
  });

  test("default seeding ignores unrelated chrome.storage keys", async () => {
    const { storageState } = installChromeStorageMock({
      initialState: {
        "extensionState.enabled": "false",
        "extensionState.language": '"pl"',
      },
    });
    const store = new Store("settings", { enable: true, language: "en" });

    await expect(store.get("enable")).resolves.toBe(true);
    await expect(store.get("language")).resolves.toBe("en");
    expect(storageState["store.settings.enable"]).toBe("true");
    expect(storageState["store.settings.language"]).toBe('"en"');
    expect(storageState["extensionState.enabled"]).toBe("false");
    expect(storageState["extensionState.language"]).toBe('"pl"');
  });

  test("default seeding respects valid legacy keys and repairs invalid stored values", async () => {
    const { storageState } = installChromeStorageMock({
      initialState: {
        "store.settings.enabled": "false",
        "store.settings.tributeFontSize": "{broken",
        "store.settings.language": "{broken",
      },
    });
    const store = new Store("settings", {
      enable: true,
      suggestionFontSize: "14px",
      language: "en",
      numSuggestions: 5,
    });

    await store.get("enable");
    expect(storageState["store.settings.enable"]).toBeUndefined();
    expect(storageState["store.settings.suggestionFontSize"]).toBe('"14px"');
    expect(storageState["store.settings.language"]).toBe('"en"');
    expect(storageState["store.settings.numSuggestions"]).toBe("5");
  });

  test("default seeding ignores unrelated localStorage keys in fallback mode", async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    localStorage.clear();
    localStorage.setItem("extensionState.enabled", "false");
    localStorage.setItem("extensionState.language", '"pl"');
    const store = new Store("settings", { enable: true, language: "en" });

    await expect(store.get("enable")).resolves.toBe(true);
    await expect(store.get("language")).resolves.toBe("en");
    expect(localStorage.getItem("store.settings.enable")).toBe("true");
    expect(localStorage.getItem("store.settings.language")).toBe('"en"');
    expect(localStorage.getItem("extensionState.enabled")).toBe("false");
    expect(localStorage.getItem("extensionState.language")).toBe('"pl"');
  });
});
