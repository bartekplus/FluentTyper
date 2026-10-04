import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "../src/core/domain/themeDefaults";
import { installChromeStorageMock } from "./support/chromeStorage";

const originalChrome = (globalThis as { chrome?: unknown }).chrome;

let importNonce = 0;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_settings_alias_startup=${importNonce}`;
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
  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  });

  test("returns default theme settings on fresh install without seeding storage", async () => {
    const { storageState } = installChromeStorageMock();
    const { SettingsManager, CoreSettingsRepository } = await loadSettingsModules();
    const settings = new SettingsManager();
    const coreSettings = new CoreSettingsRepository(settings);

    expect(await coreSettings.getThemeSettings()).toEqual(DEFAULT_SUGGESTION_THEME_SETTINGS);
    expect(storageState["store.settings.suggestionBgLight"]).toBeUndefined();
    expect(storageState["store.settings.suggestionBgDark"]).toBeUndefined();
  });

  test("does not seed canonical defaults over alias-only values", async () => {
    const { storageState } = installChromeStorageMock({
      initialState: {
        "store.settings.enabled": "false",
      },
    });
    const { SettingsManager } = await loadSettingsModules();
    const settings = new SettingsManager();

    expect(await settings.get("enabled")).toBe(false);
    expect(storageState["store.settings.enable"]).toBeUndefined();
  });

  test("get prefers canonical value over alias and returns undefined when neither exists", async () => {
    installChromeStorageMock({
      initialState: {
        "store.settings.enable": "true",
        "store.settings.enabled": "false",
        "store.settings.tributeBgLight": '"#abc123"',
      },
    });
    const { SettingsManager } = await loadSettingsModules();
    const settings = new SettingsManager();

    expect(await settings.get("enabled")).toBe(true);
    expect(await settings.get("suggestionBgLight")).toBe("#abc123");
    expect(await settings.get("tributeBgLight")).toBe("#abc123");
    expect(await settings.get("suggestionBgDark")).toBeUndefined();
  });

  test("migrates alias-only startup state to canonical keys and preserves values", async () => {
    installChromeStorageMock({
      initialState: {
        "store.settings.enabled": "false",
        "store.settings.tributeBgLight": '"#abc123"',
      },
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
