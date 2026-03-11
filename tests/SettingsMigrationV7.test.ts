import { describe, expect, test } from "bun:test";
import { migrateSettingsV7 } from "../src/core/application/settings/SettingsMigrationV7";
import type { SettingsManager } from "../src/core/application/settingsManager";
import {
  KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
  KEY_SUGGESTION_THEME_V1_MIGRATED,
} from "../src/core/domain/constants";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "../src/core/domain/themeDefaults";

function createMockSettingsManager(
  seed: Record<string, unknown>,
): SettingsManager & { store: Record<string, unknown> } {
  const store = { ...seed };
  return {
    store,
    get: async (key: string) => store[key] as never,
    getRaw: async (key: string) => store[key] as never,
    set: async (key: string, value: unknown) => {
      store[key] = value;
    },
    setRaw: async (key: string, value: unknown) => {
      store[key] = value;
    },
    removeRaw: async (key: string) => {
      delete store[key];
    },
  } as unknown as SettingsManager & { store: Record<string, unknown> };
}

describe("migrateSettingsV7", () => {
  test("replaces legacy shipped light highlight defaults with the refined theme", async () => {
    const settings = createMockSettingsManager({
      [KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT]: "#1d4ed8",
      [KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT]: "#ffffff",
    });

    await migrateSettingsV7(settings);

    expect(settings.store[KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT]).toBe(
      DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightBgLight,
    );
    expect(settings.store[KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT]).toBe(
      DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightTextLight,
    );
    expect(settings.store[KEY_SUGGESTION_THEME_V1_MIGRATED]).toBe(true);
  });

  test("preserves custom highlight colors", async () => {
    const settings = createMockSettingsManager({
      [KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT]: "#7c3aed",
      [KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT]: "#fef3c7",
    });

    await migrateSettingsV7(settings);

    expect(settings.store[KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT]).toBe("#7c3aed");
    expect(settings.store[KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT]).toBe("#fef3c7");
    expect(settings.store[KEY_SUGGESTION_THEME_V1_MIGRATED]).toBe(true);
  });

  test("is idempotent when the migration marker already exists", async () => {
    const settings = createMockSettingsManager({
      [KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT]: "#2563eb",
      [KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT]: "#ffffff",
      [KEY_SUGGESTION_THEME_V1_MIGRATED]: true,
    });

    await migrateSettingsV7(settings);

    expect(settings.store[KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT]).toBe("#2563eb");
    expect(settings.store[KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT]).toBe("#ffffff");
  });
});
