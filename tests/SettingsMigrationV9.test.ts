import { describe, expect, test } from "bun:test";
import { migrateSettingsV9 } from "../src/core/application/settings/SettingsMigrationV9";
import { KEY_SUGGESTION_THEME_V2_MIGRATED } from "../src/core/domain/constants";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "../src/core/domain/themeDefaults";
import { memorySettings } from "./support/fakeSettings";

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
    const settings = memorySettings({ ...PREVIOUS_LIGHT, ...PREVIOUS_DARK });

    await migrateSettingsV9(settings);

    for (const field of [...Object.keys(PREVIOUS_LIGHT), ...Object.keys(PREVIOUS_DARK)]) {
      expect(settings.store[field]).toBe(
        DEFAULT_SUGGESTION_THEME_SETTINGS[field as keyof typeof DEFAULT_SUGGESTION_THEME_SETTINGS],
      );
    }
    expect(settings.store[KEY_SUGGESTION_THEME_V2_MIGRATED]).toBe(true);
  });

  test("keeps a color mode with any customized color, and migrates the other", async () => {
    const settings = memorySettings({
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

  test("a customized mode keeps the previous defaults for colors never saved", async () => {
    // Only one light color was ever saved; the others fall back to defaults.
    const settings = memorySettings({ suggestionHighlightBgLight: "#7c3aed" });

    await migrateSettingsV9(settings);

    expect(settings.store.suggestionHighlightBgLight).toBe("#7c3aed");
    expect(settings.store.suggestionBgLight).toBe(PREVIOUS_LIGHT.suggestionBgLight);
    expect(settings.store.suggestionTextLight).toBe(PREVIOUS_LIGHT.suggestionTextLight);
    // The untouched dark mode moves to the redesign.
    expect(settings.store.suggestionBgDark).toBe(
      DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgDark,
    );
  });

  test("finishes a mode that a failed earlier run left half migrated", async () => {
    const settings = memorySettings({
      ...PREVIOUS_DARK,
      suggestionBgDark: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgDark,
      suggestionTextDark: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionTextDark,
    });

    await migrateSettingsV9(settings);

    expect(settings.store.suggestionHighlightBgDark).toBe(
      DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightBgDark,
    );
    expect(settings.store.suggestionBorderDark).toBe(
      DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBorderDark,
    );
  });

  test("runs once", async () => {
    const settings = memorySettings({
      ...PREVIOUS_DARK,
      [KEY_SUGGESTION_THEME_V2_MIGRATED]: true,
    });

    await migrateSettingsV9(settings);

    expect(settings.store.suggestionBgDark).toBe("#0f172a");
  });
});
