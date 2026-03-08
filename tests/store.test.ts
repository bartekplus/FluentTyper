import { afterEach, describe, expect, jest, test } from "bun:test";

type StorageSnapshot = Record<string, string>;
type ChromeStorageMockOptions = {
  initialState?: StorageSnapshot;
  setDelayMs?: number;
};

let importNonce = 0;
const originalChrome = (globalThis as { chrome?: unknown }).chrome;
const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_store=${importNonce}`;
}

function setGlobalProperty(name: "chrome" | "localStorage", value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
}

function installChromeStorageMock(options: ChromeStorageMockOptions = {}): {
  storageState: StorageSnapshot;
  localSet: jest.Mock<
    (values: Record<string, string>, callback?: (() => void) | undefined) => void
  >;
} {
  const { initialState = {}, setDelayMs = 0 } = options;
  const storageState: StorageSnapshot = { ...initialState };
  const localSet = jest.fn(
    (values: Record<string, string>, callback?: (() => void) | undefined): void => {
      setTimeout(() => {
        Object.assign(storageState, values);
        callback?.();
      }, setDelayMs);
    },
  );

  const localGet = jest.fn(
    (key: string | string[] | null, callback: (result: Record<string, string>) => void): void => {
      setTimeout(() => {
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
      }, 0);
    },
  );

  const localRemove = jest.fn((key: string, callback?: (() => void) | undefined): void => {
    setTimeout(() => {
      delete storageState[key];
      callback?.();
    }, 0);
  });

  setGlobalProperty("chrome", {
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
  });

  return { storageState, localSet };
}

function installLocalStorageMock(initialState: StorageSnapshot = {}): { storageState: StorageSnapshot } {
  const storageState: StorageSnapshot = { ...initialState };
  const localStorageMock = {
    get length(): number {
      return Object.keys(storageState).length;
    },
    clear(): void {
      Object.keys(storageState).forEach((key) => {
        delete storageState[key];
      });
    },
    getItem(key: string): string | null {
      return storageState[key] ?? null;
    },
    key(index: number): string | null {
      return Object.keys(storageState)[index] ?? null;
    },
    removeItem(key: string): void {
      delete storageState[key];
    },
    setItem(key: string, value: string): void {
      storageState[key] = value;
    },
  };

  setGlobalProperty("localStorage", localStorageMock);
  return { storageState };
}

afterEach(() => {
  if (originalChrome === undefined) {
    delete (globalThis as { chrome?: unknown }).chrome;
  } else {
    setGlobalProperty("chrome", originalChrome);
  }

  if (originalLocalStorage === undefined) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  } else {
    setGlobalProperty("localStorage", originalLocalStorage);
  }
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

    const { ChromeStorageBackend } = await import(
      freshModulePath("../src/core/application/storage/ChromeStorageBackend.js")
    );
    const backend = new ChromeStorageBackend(true);

    await expect(backend.getAll("store.settings.")).resolves.toEqual({
      enable: "true",
      language: '"en"',
    });
  });
});

describe("Store async semantics", () => {
  test("set resolves only after backend callback completes", async () => {
    const { localSet } = installChromeStorageMock({ setDelayMs: 25 });
    const { Store } = await import(freshModulePath("../src/ui/settings-engine/store/Store.js"));
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
    const { Store } = await import(freshModulePath("../src/ui/settings-engine/store/Store.js"));
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
    const { Store } = await import(freshModulePath("../src/ui/settings-engine/store/Store.js"));
    const store = new Store("settings", { enable: true, language: "en" });

    await expect(store.getAll()).resolves.toEqual({
      enable: true,
      language: "en",
    });
    expect(storageState["store.settings.enable"]).toBe("true");
    expect(storageState["store.settings.language"]).toBe('"en"');
    expect(storageState["extensionState.enabled"]).toBe("false");
    expect(storageState["extensionState.language"]).toBe('"pl"');
  });

  test("default seeding ignores unrelated localStorage keys in fallback mode", async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    const { storageState } = installLocalStorageMock({
      "extensionState.enabled": "false",
      "extensionState.language": '"pl"',
    });
    const { Store } = await import(freshModulePath("../src/ui/settings-engine/store/Store.js"));
    const store = new Store("settings", { enable: true, language: "en" });

    await expect(store.getAll()).resolves.toEqual({
      enable: true,
      language: "en",
    });
    expect(storageState["store.settings.enable"]).toBe("true");
    expect(storageState["store.settings.language"]).toBe('"en"');
    expect(storageState["extensionState.enabled"]).toBe("false");
    expect(storageState["extensionState.language"]).toBe('"pl"');
  });
});
