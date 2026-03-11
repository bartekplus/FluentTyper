import {
  KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
  KEY_SUGGESTION_THEME_V1_MIGRATED,
} from "@core/domain/constants";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "@core/domain/themeDefaults";
import type { JsonValue } from "../settingsManager";
import type { SettingsManager } from "../settingsManager";

type RawSettingsAccess = {
  getRaw?: (key: string) => Promise<unknown>;
  setRaw?: (key: string, value: JsonValue) => Promise<void>;
};

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

async function readRaw(settings: SettingsManager, key: string): Promise<unknown> {
  const maybeRawSettings = settings as unknown as RawSettingsAccess;
  if (typeof maybeRawSettings.getRaw === "function") {
    return maybeRawSettings.getRaw(key);
  }
  return settings.get(key);
}

async function writeRaw(settings: SettingsManager, key: string, value: JsonValue): Promise<void> {
  const maybeRawSettings = settings as unknown as RawSettingsAccess;
  if (typeof maybeRawSettings.setRaw === "function") {
    await maybeRawSettings.setRaw(key, value);
    return;
  }
  await settings.set(key, value);
}

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
    const migrated = await readRaw(settings, KEY_SUGGESTION_THEME_V1_MIGRATED);
    if (migrated === true) {
      return;
    }

    const [highlightBgLight, highlightTextLight] = await Promise.all([
      readRaw(settings, KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT),
      readRaw(settings, KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT),
    ]);

    if (matchesAnyLegacyLightDefault(highlightBgLight, highlightTextLight)) {
      await writeRaw(
        settings,
        KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightBgLight as JsonValue,
      );
      await writeRaw(
        settings,
        KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightTextLight as JsonValue,
      );
    }

    await writeRaw(settings, KEY_SUGGESTION_THEME_V1_MIGRATED, true as JsonValue);
  } catch (error) {
    console.warn("[SettingsMigrationV7] Failed to migrate settings:", error);
  }
}
