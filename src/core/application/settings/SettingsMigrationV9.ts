import { KEY_SUGGESTION_THEME_V2_MIGRATED } from "@core/domain/constants";
import {
  DEFAULT_SUGGESTION_THEME_SETTINGS,
  type SuggestionThemeSettings,
} from "@core/domain/themeDefaults";
import type { SettingsManager } from "../settingsManager";
import { normalizeString } from "./SettingsMigrationV7";

type ThemeColorField = Exclude<
  keyof SuggestionThemeSettings,
  "suggestionFontSize" | "suggestionPaddingVertical" | "suggestionPaddingHorizontal"
>;

/** The popup palette shipped before the 2026 popup redesign, one set per color mode. */
const PREVIOUS_DEFAULTS: ReadonlyArray<Partial<Record<ThemeColorField, string>>> = [
  {
    suggestionBgLight: "#ffffff",
    suggestionTextLight: "#2d3748",
    suggestionHighlightBgLight: "#0f172a",
    suggestionHighlightTextLight: "#ffffff",
    suggestionBorderLight: "#e2e8f0",
  },
  {
    suggestionBgDark: "#0f172a",
    suggestionTextDark: "#e2e8f0",
    suggestionHighlightBgDark: "#1e293b",
    suggestionHighlightTextDark: "#f8fafc",
    suggestionBorderDark: "#334155",
  },
];

/**
 * Unset, still the previous default, or already the new one: a run that failed
 * part way through a mode finishes it on the next start instead of skipping it.
 */
function isUntouched(stored: unknown, previous: string, next: string): boolean {
  if (stored === undefined) {
    return true;
  }
  const value = normalizeString(stored);
  return value === previous || value === next.toLowerCase();
}

/**
 * Moves users still on the previous popup palette to the redesigned one. Each
 * color mode moves only as a whole: one customized color keeps that mode as it is.
 */
export async function migrateSettingsV9(settings: SettingsManager): Promise<void> {
  if ((await settings.getRaw(KEY_SUGGESTION_THEME_V2_MIGRATED)) === true) {
    return;
  }
  for (const mode of PREVIOUS_DEFAULTS) {
    const fields = Object.keys(mode) as ThemeColorField[];
    const stored = await Promise.all(fields.map((field) => settings.getRaw(field)));
    if (
      fields.every((field, index) =>
        isUntouched(stored[index], mode[field]!, DEFAULT_SUGGESTION_THEME_SETTINGS[field]),
      )
    ) {
      for (const field of fields) {
        await settings.setRaw(field, DEFAULT_SUGGESTION_THEME_SETTINGS[field]);
      }
    } else {
      // A customized mode keeps its look: colors never saved would otherwise
      // fall back to the new defaults, so they keep the previous ones.
      for (const [index, field] of fields.entries()) {
        if (stored[index] === undefined) await settings.setRaw(field, mode[field]!);
      }
    }
  }
  await settings.setRaw(KEY_SUGGESTION_THEME_V2_MIGRATED, true);
}
