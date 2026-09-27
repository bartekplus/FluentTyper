import { describe, expect, test } from "bun:test";
import { migrateSettingsV9 } from "../src/core/application/settings/SettingsMigrationV9";
import type { SettingsManager } from "../src/core/application/settingsManager";
import { KEY_SUGGESTION_THEME_V2_MIGRATED } from "../src/core/domain/constants";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "../src/core/domain/themeDefaults";

function createMockSettingsManager(
  seed: Record<string, unknown>,
): SettingsManager & { store: Record<string, unknown> } {
  const store = { ...seed };
  return {
    store,
    getRaw: async (key: string) => store[key] as never,
    setRaw: async (key: string, value: unknown) => {
      store[key] = value;
    },
  } as unknown as SettingsManager & { store: Record<string, unknown> };
}

const PREVIOUS_LIGHT = {
  suggestionBgLight: "#ffffff",
  suggestionTextLight: "#2d3748",
  suggestionHighlightBgLight: "#0f172a",
  suggestionHighlightTextLight: "#FFFFFF",
  suggestionBorderLight: "#e2e8f0",
};
const PREVIOUS_DARK = {
  suggestionBgDark: "#0f172a",
  suggestionTextDark: "#e2e8f0",
  suggestionHighlightBgDark: "#1e293b",
  suggestionHighlightTextDark: "#f8fafc",
  suggestionBorderDark: "#334155",
};

describe("migrateSettingsV9", () => {
  test("moves the previous default palette to the redesigned one", async () => {
    const settings = createMockSettingsManager({ ...PREVIOUS_LIGHT, ...PREVIOUS_DARK });

    await migrateSettingsV9(settings);

    for (const field of [...Object.keys(PREVIOUS_LIGHT), ...Object.keys(PREVIOUS_DARK)]) {
      expect(settings.store[field]).toBe(
        DEFAULT_SUGGESTION_THEME_SETTINGS[field as keyof typeof DEFAULT_SUGGESTION_THEME_SETTINGS],
      );
    }
    expect(settings.store[KEY_SUGGESTION_THEME_V2_MIGRATED]).toBe(true);
  });

  test("keeps a color mode with any customized color, and migrates the other", async () => {
    const settings = createMockSettingsManager({
      ...PREVIOUS_LIGHT,
      suggestionHighlightBgLight: "#7c3aed",
      ...PREVIOUS_DARK,
    });

    await migrateSettingsV9(settings);

    expect(settings.store.suggestionHighlightBgLight).toBe("#7c3aed");
    expect(settings.store.suggestionTextLight).toBe("#2d3748");
    expect(settings.store.suggestionBgDark).toBe(
      DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgDark,
    );
  });

  test("runs once", async () => {
    const settings = createMockSettingsManager({
      ...PREVIOUS_DARK,
      [KEY_SUGGESTION_THEME_V2_MIGRATED]: true,
    });

    await migrateSettingsV9(settings);

    expect(settings.store.suggestionBgDark).toBe("#0f172a");
  });
});
