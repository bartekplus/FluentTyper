import { normalizeCssColor } from "@core/domain/color";
import { resolveSuggestionAccents } from "@core/domain/suggestionPopup/palette";

function canvasContext(): CanvasRenderingContext2D | null {
  try {
    return document.createElement("canvas").getContext("2d");
  } catch {
    return null;
  }
}
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "@core/domain/themeDefaults";
import type { SetConfigContext } from "@core/domain/messageTypes";

type ThemeSettings = NonNullable<SetConfigContext["themeConfig"]>;
type ThemeSettingKey = keyof ThemeSettings;

type ThemeSettingSpec = {
  key: ThemeSettingKey;
  cssName: string;
  cssProperty: string;
};

const THEME_SETTING_SPECS: ThemeSettingSpec[] = [
  { key: "suggestionBgLight", cssName: "suggestion-bg-light", cssProperty: "color" },
  { key: "suggestionTextLight", cssName: "suggestion-text-light", cssProperty: "color" },
  {
    key: "suggestionHighlightBgLight",
    cssName: "suggestion-highlight-bg-light",
    cssProperty: "color",
  },
  {
    key: "suggestionHighlightTextLight",
    cssName: "suggestion-highlight-text-light",
    cssProperty: "color",
  },
  { key: "suggestionBorderLight", cssName: "suggestion-border-color-light", cssProperty: "color" },
  { key: "suggestionBgDark", cssName: "suggestion-bg-dark", cssProperty: "color" },
  { key: "suggestionTextDark", cssName: "suggestion-text-dark", cssProperty: "color" },
  {
    key: "suggestionHighlightBgDark",
    cssName: "suggestion-highlight-bg-dark",
    cssProperty: "color",
  },
  {
    key: "suggestionHighlightTextDark",
    cssName: "suggestion-highlight-text-dark",
    cssProperty: "color",
  },
  { key: "suggestionBorderDark", cssName: "suggestion-border-color-dark", cssProperty: "color" },
  { key: "suggestionFontSize", cssName: "suggestion-font-size", cssProperty: "font-size" },
  {
    key: "suggestionPaddingVertical",
    cssName: "suggestion-padding-vertical",
    cssProperty: "padding-top",
  },
  {
    key: "suggestionPaddingHorizontal",
    cssName: "suggestion-padding-horizontal",
    cssProperty: "padding-left",
  },
];

export class ThemeApplicator {
  apply(themeSettings: ThemeSettings): void {
    const safeThemeSettings = this.sanitizeThemeSettings(themeSettings);
    document.getElementById("fluent-typer-theme-overrides")?.remove();

    const styleElement = document.createElement("style");
    styleElement.id = "fluent-typer-theme-overrides";

    styleElement.textContent = this.buildThemeOverrideCss(safeThemeSettings);

    document.head.appendChild(styleElement);
  }

  private buildThemeOverrideCss(themeSettings: ThemeSettings): string {
    const lines: string[] = [":root {"];
    for (const spec of THEME_SETTING_SPECS) {
      const value = themeSettings[spec.key];
      lines.push(`  --${spec.cssName}: ${value} !important;`);
      lines.push(`  --ft-theme-${spec.cssName}: ${value} !important;`);
    }
    // Accents for typed text that read on these colors (the design's, when they do).
    const context = canvasContext();
    const accents = resolveSuggestionAccents(themeSettings, (color) =>
      normalizeCssColor(color, context),
    );
    for (const mode of ["light", "dark"] as const) {
      lines.push(`  --ft-theme-suggestion-accent-${mode}: ${accents[mode].accent} !important;`);
      lines.push(
        `  --ft-theme-suggestion-highlight-accent-${mode}: ${accents[mode].highlightAccent} !important;`,
      );
    }
    lines.push("}");
    return lines.join("\n");
  }

  private sanitizeThemeSettings(themeSettings: ThemeSettings): ThemeSettings {
    const sanitizedThemeSettings = {} as ThemeSettings;
    for (const spec of THEME_SETTING_SPECS) {
      const fallbackValue = DEFAULT_SUGGESTION_THEME_SETTINGS[spec.key];
      sanitizedThemeSettings[spec.key] = this.sanitizeCssValue(
        themeSettings[spec.key],
        fallbackValue,
        spec.cssProperty,
      );
    }
    return sanitizedThemeSettings;
  }

  private sanitizeCssValue(value: unknown, fallback: string, property: string): string {
    if (typeof value !== "string") {
      return fallback;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue || /var\(|url\(|[;{}]/i.test(trimmedValue)) {
      return fallback;
    }

    const probe = document.createElement("div");
    probe.style.setProperty(property, trimmedValue);
    return probe.style.getPropertyValue(property) ? trimmedValue : fallback;
  }
}
