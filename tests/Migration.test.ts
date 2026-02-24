import { jest } from "@jest/globals";

const settingsGet = jest.fn<(key: string) => Promise<unknown>>();
const settingsSet =
  jest.fn<(key: string, value: unknown) => Promise<unknown>>();
const settingsManagerCtor = jest.fn().mockImplementation(() => ({
  get: settingsGet,
  set: settingsSet,
}));

jest.unstable_mockModule("../src/shared/settingsManager", () => ({
  SettingsManager: settingsManagerCtor,
}));

describe("migrateToLocalStore", () => {
  let migrateToLocalStore: (lastVersion?: string) => Promise<void>;

  beforeAll(async () => {
    ({ migrateToLocalStore } = await import("../src/background/Migration"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
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
  });

  test("migrates sync storage to local storage for older versions", async () => {
    settingsGet.mockResolvedValue("en");

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
  });

  test("updates language and fallbackLanguage to full supported keys", async () => {
    settingsGet.mockResolvedValueOnce("en").mockResolvedValueOnce("fr");

    await migrateToLocalStore("2024.01.01");

    expect(settingsSet).toHaveBeenCalledWith("language", "en_US");
    expect(settingsSet).toHaveBeenCalledWith("fallbackLanguage", "fr_FR");
  });

  test("skips sync migration and language rewrite for new versions", async () => {
    await migrateToLocalStore("2026.03.01");

    expect(global.chrome.storage.sync.get).not.toHaveBeenCalled();
    expect(settingsManagerCtor).not.toHaveBeenCalled();
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
      lastVersion: "2026.2.1",
    });
  });
});
