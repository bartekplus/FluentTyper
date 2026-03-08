import { jest } from "bun:test";

type StorageSnapshot = Record<string, string>;

let importNonce = 0;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_store=${importNonce}`;
}

function installChromeStorageMock(setDelayMs = 0): {
  storageState: StorageSnapshot;
  localSet: jest.Mock<
    (values: Record<string, string>, callback?: (() => void) | undefined) => void
  >;
} {
  const storageState: StorageSnapshot = {};
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

  (globalThis as unknown as { chrome: unknown }).chrome = {
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

  return { storageState, localSet };
}

describe("Store async semantics", () => {
  test("set resolves only after backend callback completes", async () => {
    const { localSet } = installChromeStorageMock(25);
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
    const { storageState } = installChromeStorageMock(20);
    const { Store } = await import(freshModulePath("../src/ui/settings-engine/store/Store.js"));
    const store = new Store("startup", { enabled: true });

    const value = await store.get("enabled");
    expect(value).toBe(true);
    expect(storageState["store.startup.enabled"]).toBe("true");
  });
});
