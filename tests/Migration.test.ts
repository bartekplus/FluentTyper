import { jest, mock } from "bun:test";
import { KEY_SITE_PROFILES } from "../src/core/domain/constants";

const settingsGet = jest.fn<(key: string) => Promise<unknown>>();
const settingsSet = jest.fn<(key: string, value: unknown) => Promise<unknown>>();
const settingsRemoveRaw = jest.fn<(key: string) => Promise<unknown>>();
const settingsManagerCtor = jest.fn().mockImplementation(() => ({
  get: settingsGet,
  getRaw: settingsGet,
  set: settingsSet,
  setRaw: settingsSet,
  removeRaw: settingsRemoveRaw,
}));
let importNonce = 0;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_migration=${importNonce}`;
}

function installMigrationModuleMocks(): void {
  mock.module("../src/core/application/settingsManager", () => ({
    SettingsManager: settingsManagerCtor,
  }));
}

describe("migrateToLocalStore", () => {
  const baseChrome = globalThis.chrome;
  let migrateToLocalStore: (lastVersion?: string) => Promise<void>;

  beforeEach(async () => {
    mock.restore();
    installMigrationModuleMocks();
    jest.clearAllMocks();
    settingsGet.mockResolvedValue(undefined);
    settingsRemoveRaw.mockResolvedValue(undefined);
    (globalThis as { chrome: unknown }).chrome = {
      runtime: {
        getManifest: jest.fn(() => ({ version: "2026.2.1" })),
      },
      storage: {
        sync: {
          // The real API answers later, by promise or by callback.
          get: jest.fn((_: unknown, callback?: (result: unknown) => void) => {
            const result = new Promise((resolve) => setTimeout(() => resolve({ key: "value" }), 5));
            if (callback) void result.then(callback);
            return result;
          }),
        },
        local: {
          set: jest.fn(),
        },
      },
    };

    ({ migrateToLocalStore } = await import(
      freshModulePath("../src/adapters/chrome/background/Migration")
    ));
  });

  afterEach(() => {
    globalThis.chrome = baseChrome;
  });

  afterAll(() => {
    mock.restore();
  });

  test("migrates sync storage to local storage for older versions", async () => {
    settingsGet
      .mockResolvedValueOnce("en")
      .mockResolvedValueOnce("en")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await migrateToLocalStore("2023.01.01");

    const localSet = global.chrome.storage.local.set as unknown as jest.Mock;
    const copy = localSet.mock.calls.findIndex(([items]) => items.key === "value");
    // The copy ends before the language migration writes.
    expect(copy).toBeGreaterThanOrEqual(0);
    expect(localSet.mock.invocationCallOrder[copy]).toBeLessThan(
      settingsSet.mock.invocationCallOrder[0],
    );
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
      lastVersion: "2026.2.1",
    });
    expect(settingsSet).toHaveBeenCalledWith(KEY_SITE_PROFILES, {});
    expect(settingsRemoveRaw).toHaveBeenCalledWith("revertOnBackspace");
  });

  test("updates language and fallbackLanguage to full supported keys", async () => {
    settingsGet
      .mockResolvedValueOnce("en")
      .mockResolvedValueOnce("fr")
      .mockResolvedValueOnce(["en_US", "fr_FR"])
      .mockResolvedValueOnce({
        "https://example.com": {
          language: "fr_FR",
          numSuggestions: 2,
        },
      });

    await migrateToLocalStore("2024.01.01");

    expect(settingsSet).toHaveBeenCalledWith("language", "en_US");
    expect(settingsSet).toHaveBeenCalledWith("fallbackLanguage", "fr_FR");
    expect(settingsSet).toHaveBeenCalledWith(KEY_SITE_PROFILES, {
      "example.com": {
        language: "fr_FR",
        numSuggestions: 2,
      },
    });
    expect(settingsRemoveRaw).toHaveBeenCalledWith("revertOnBackspace");
  });

  test("skips sync migration for new versions and still normalizes site profiles", async () => {
    settingsGet.mockResolvedValueOnce(["en_US", "de_DE"]).mockResolvedValueOnce({
      "example.com": {
        language: "fr_FR",
        numSuggestions: 8,
      },
    });

    await migrateToLocalStore("2026.03.01");

    expect(global.chrome.storage.sync.get).not.toHaveBeenCalled();
    expect(settingsManagerCtor).toHaveBeenCalled();
    expect(settingsSet).toHaveBeenCalledWith(KEY_SITE_PROFILES, {});
    expect(settingsRemoveRaw).toHaveBeenCalledWith("revertOnBackspace");
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
      lastVersion: "2026.2.1",
    });
  });
});
