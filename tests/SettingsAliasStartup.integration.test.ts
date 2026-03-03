import { describe, expect, test } from "bun:test";

type StorageSnapshot = Record<string, string>;

let importNonce = 0;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_settings_alias_startup=${importNonce}`;
}

function installChromeStorageMock(seed: StorageSnapshot = {}): { storageState: StorageSnapshot } {
  const storageState: StorageSnapshot = { ...seed };

  const localGet = (
    key: string | string[] | null,
    callback: (result: Record<string, string>) => void,
  ): void => {
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
  };

  const localSet = (values: Record<string, string>, callback?: () => void): void => {
    setTimeout(() => {
      Object.assign(storageState, values);
      callback?.();
    }, 0);
  };

  const localRemove = (key: string, callback?: () => void): void => {
    setTimeout(() => {
      delete storageState[key];
      callback?.();
    }, 0);
  };

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      getManifest: () => ({ version: "test-version" }),
      lastError: undefined,
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

  return { storageState };
}

async function loadSettingsModules() {
  const [{ SettingsManager }, { migrateSettingsV3 }, { CoreSettingsRepository }] =
    await Promise.all([
      import(freshModulePath("../src/core/application/settingsManager")),
      import(freshModulePath("../src/core/application/settings/SettingsMigrationV3")),
      import(freshModulePath("../src/core/application/repositories/CoreSettingsRepository")),
    ]);
  return { SettingsManager, migrateSettingsV3, CoreSettingsRepository };
}

describe("settings alias startup integration", () => {
  test("does not seed canonical defaults over alias-only values", async () => {
    const { storageState } = installChromeStorageMock({
      "store.settings.enabled": "false",
    });
    const { SettingsManager } = await loadSettingsModules();
    const settings = new SettingsManager();

    expect(await settings.get("enabled")).toBe(false);
    expect(storageState["store.settings.enable"]).toBeUndefined();
  });

  test("migrates alias-only startup state to canonical keys and preserves values", async () => {
    installChromeStorageMock({
      "store.settings.enabled": "false",
      "store.settings.tributeBgLight": '"#abc123"',
    });
    const { SettingsManager, migrateSettingsV3, CoreSettingsRepository } =
      await loadSettingsModules();
    const settings = new SettingsManager();

    await migrateSettingsV3(settings);

    const coreSettings = new CoreSettingsRepository(settings);
    expect(await coreSettings.isEnabled()).toBe(false);
    const theme = await coreSettings.getThemeSettings();
    expect(theme.suggestionBgLight).toBe("#abc123");

    expect(await settings.getRaw("enable")).toBe(false);
    expect(await settings.getRaw("suggestionBgLight")).toBe("#abc123");
    expect(await settings.getRaw("enabled")).toBeUndefined();
    expect(await settings.getRaw("tributeBgLight")).toBeUndefined();
  });
});
