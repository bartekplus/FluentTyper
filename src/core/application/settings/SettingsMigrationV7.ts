import {
  KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
  KEY_SUGGESTION_THEME_V1_MIGRATED,
} from "@core/domain/constants";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "@core/domain/themeDefaults";
import type { SettingsManager } from "../settingsManager";
import { readRawSetting, writeRawSetting } from "./settingsAccess";

const LEGACY_LIGHT_HIGHLIGHT_DEFAULTS = [
  {
    background: "#edf2f7",
    text: "#2d3748",
  },
  {
    background: "#2563eb",
    text: "#ffffff",
  },
  {
    background: "#1d4ed8",
    text: "#ffffff",
  },
] as const;

function normalizeString(value: unknown): string | null {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

function matchesAnyLegacyLightDefault(background: unknown, text: unknown): boolean {
  const normalizedBackground = normalizeString(background);
  const normalizedText = normalizeString(text);
  if (!normalizedBackground || !normalizedText) {
    return false;
  }

  return LEGACY_LIGHT_HIGHLIGHT_DEFAULTS.some(
    (entry) =>
      normalizedBackground === entry.background.toLowerCase() &&
      normalizedText === entry.text.toLowerCase(),
  );
}

export async function migrateSettingsV7(settings: SettingsManager): Promise<void> {
  try {
    const migrated = await readRawSetting(settings, KEY_SUGGESTION_THEME_V1_MIGRATED);
    if (migrated === true) {
      return;
    }

    const [highlightBgLight, highlightTextLight] = await Promise.all([
      readRawSetting(settings, KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT),
      readRawSetting(settings, KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT),
    ]);

    if (matchesAnyLegacyLightDefault(highlightBgLight, highlightTextLight)) {
      await writeRawSetting(
        settings,
        KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightBgLight,
      );
      await writeRawSetting(
        settings,
        KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightTextLight,
      );
    }

    await writeRawSetting(settings, KEY_SUGGESTION_THEME_V1_MIGRATED, true);
  } catch (error) {
    console.warn("[SettingsMigrationV7] Failed to migrate settings:", error);
  }
}
