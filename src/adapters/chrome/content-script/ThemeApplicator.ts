import { normalizeCssColor } from "@core/domain/color";
import { resolveSuggestionAccents } from "@core/domain/suggestionPopup/palette";
import { canvas2dContext } from "@core/application/dom-utils";
import {
  DEFAULT_SUGGESTION_THEME_SETTINGS,
  type SuggestionThemeSettings,
} from "@core/domain/themeDefaults";

type ThemeSettingKey = keyof SuggestionThemeSettings;

type ThemeSettingSpec = {
  key: ThemeSettingKey;
  cssName: string;
  cssProperty: string;
};

const STYLE_ID = "fluent-typer-theme-overrides";

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
  apply(themeSettings: SuggestionThemeSettings): void {
    const safeThemeSettings = this.sanitizeThemeSettings(themeSettings);
    this.remove();

    const styleElement = document.createElement("style");
    styleElement.id = STYLE_ID;

    styleElement.textContent = this.buildThemeOverrideCss(safeThemeSettings);

    document.head.appendChild(styleElement);
  }

  remove(): void {
    document.getElementById(STYLE_ID)?.remove();
  }

  private buildThemeOverrideCss(themeSettings: SuggestionThemeSettings): string {
    const lines: string[] = [":root {"];
    for (const spec of THEME_SETTING_SPECS) {
      const value = themeSettings[spec.key];
      lines.push(`  --${spec.cssName}: ${value} !important;`);
      lines.push(`  --ft-theme-${spec.cssName}: ${value} !important;`);
    }
    // Accents for typed text that read on these colors (the design's, when they do).
    const context = canvas2dContext();
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

  private sanitizeThemeSettings(themeSettings: SuggestionThemeSettings): SuggestionThemeSettings {
    const sanitizedThemeSettings = {} as SuggestionThemeSettings;
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
