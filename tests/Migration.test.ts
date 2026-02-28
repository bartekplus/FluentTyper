import { jest, mock } from "bun:test";
import { KEY_SITE_PROFILES } from "../src/core/domain/constants";

const settingsGet = jest.fn<(key: string) => Promise<unknown>>();
const settingsSet =
  jest.fn<(key: string, value: unknown) => Promise<unknown>>();
const settingsManagerCtor = jest.fn().mockImplementation(() => ({
  get: settingsGet,
  set: settingsSet,
}));
let importNonce = 0;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_migration=${importNonce}`;
}

jest.unstable_mockModule("../src/core/application/settingsManager", () => ({
  SettingsManager: settingsManagerCtor,
}));

describe("migrateToLocalStore", () => {
  let migrateToLocalStore: (lastVersion?: string) => Promise<void>;

  beforeEach(async () => {
    jest.clearAllMocks();
    settingsGet.mockResolvedValue(undefined);
    (globalThis as { chrome: unknown }).chrome = {
      runtime: {
        getManifest: jest.fn(() => ({ version: "2026.2.1" })),
      },
      storage: {
        sync: {
          get: jest.fn((_: unknown, callback: (result: unknown) => void) =>
            callback({ key: "value" }),
          ),
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

    expect(global.chrome.storage.sync.get).toHaveBeenCalledWith(
      null,
      expect.any(Function),
    );
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
      key: "value",
    });
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
      lastVersion: "2026.2.1",
    });
    expect(settingsSet).toHaveBeenCalledWith(KEY_SITE_PROFILES, {});
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
  });

  test("skips sync migration for new versions and still normalizes site profiles", async () => {
    settingsGet
      .mockResolvedValueOnce(["en_US", "de_DE"])
      .mockResolvedValueOnce({
        "example.com": {
          language: "fr_FR",
          numSuggestions: 8,
        },
      });

    await migrateToLocalStore("2026.03.01");

    expect(global.chrome.storage.sync.get).not.toHaveBeenCalled();
    expect(settingsManagerCtor).toHaveBeenCalled();
    expect(settingsSet).toHaveBeenCalledWith(KEY_SITE_PROFILES, {});
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
      lastVersion: "2026.2.1",
    });
  });
});
