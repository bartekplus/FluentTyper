import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "@core/domain/themeDefaults";
import type { SetConfigContext } from "@core/domain/messageTypes";

export class ThemeApplicator {
  apply(
    themeSettings: NonNullable<SetConfigContext["themeConfig"]>,
    doc: Document = document,
  ): void {
    const safeThemeSettings = this.sanitizeThemeSettings(themeSettings, doc);
    const existingStyle = doc.getElementById("fluent-typer-theme-overrides");
    if (existingStyle) {
      existingStyle.remove();
    }

    const styleElement = doc.createElement("style");
    styleElement.id = "fluent-typer-theme-overrides";

    styleElement.textContent = `
      :root {
        --suggestion-bg-light: ${safeThemeSettings.suggestionBgLight} !important;
        --ft-theme-suggestion-bg-light: ${safeThemeSettings.suggestionBgLight} !important;
        --suggestion-text-light: ${safeThemeSettings.suggestionTextLight} !important;
        --ft-theme-suggestion-text-light: ${safeThemeSettings.suggestionTextLight} !important;
        --suggestion-highlight-bg-light: ${safeThemeSettings.suggestionHighlightBgLight} !important;
        --ft-theme-suggestion-highlight-bg-light: ${safeThemeSettings.suggestionHighlightBgLight} !important;
        --suggestion-highlight-text-light: ${safeThemeSettings.suggestionHighlightTextLight} !important;
        --ft-theme-suggestion-highlight-text-light: ${safeThemeSettings.suggestionHighlightTextLight} !important;
        --suggestion-border-color-light: ${safeThemeSettings.suggestionBorderLight} !important;
        --ft-theme-suggestion-border-color-light: ${safeThemeSettings.suggestionBorderLight} !important;
        --suggestion-bg-dark: ${safeThemeSettings.suggestionBgDark} !important;
        --ft-theme-suggestion-bg-dark: ${safeThemeSettings.suggestionBgDark} !important;
        --suggestion-text-dark: ${safeThemeSettings.suggestionTextDark} !important;
        --ft-theme-suggestion-text-dark: ${safeThemeSettings.suggestionTextDark} !important;
        --suggestion-highlight-bg-dark: ${safeThemeSettings.suggestionHighlightBgDark} !important;
        --ft-theme-suggestion-highlight-bg-dark: ${safeThemeSettings.suggestionHighlightBgDark} !important;
        --suggestion-highlight-text-dark: ${safeThemeSettings.suggestionHighlightTextDark} !important;
        --ft-theme-suggestion-highlight-text-dark: ${safeThemeSettings.suggestionHighlightTextDark} !important;
        --suggestion-border-color-dark: ${safeThemeSettings.suggestionBorderDark} !important;
        --ft-theme-suggestion-border-color-dark: ${safeThemeSettings.suggestionBorderDark} !important;
        --suggestion-font-size: ${safeThemeSettings.suggestionFontSize} !important;
        --ft-theme-suggestion-font-size: ${safeThemeSettings.suggestionFontSize} !important;
        --suggestion-padding-vertical: ${safeThemeSettings.suggestionPaddingVertical} !important;
        --ft-theme-suggestion-padding-vertical: ${safeThemeSettings.suggestionPaddingVertical} !important;
        --suggestion-padding-horizontal: ${safeThemeSettings.suggestionPaddingHorizontal} !important;
        --ft-theme-suggestion-padding-horizontal: ${safeThemeSettings.suggestionPaddingHorizontal} !important;
      }
    `;

    doc.head.appendChild(styleElement);
  }

  private sanitizeThemeSettings(
    themeSettings: NonNullable<SetConfigContext["themeConfig"]>,
    doc: Document,
  ): NonNullable<SetConfigContext["themeConfig"]> {
    return {
      suggestionBgLight: this.sanitizeCssValue(
        themeSettings.suggestionBgLight,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgLight,
        "color",
        doc,
      ),
      suggestionTextLight: this.sanitizeCssValue(
        themeSettings.suggestionTextLight,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionTextLight,
        "color",
        doc,
      ),
      suggestionHighlightBgLight: this.sanitizeCssValue(
        themeSettings.suggestionHighlightBgLight,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightBgLight,
        "color",
        doc,
      ),
      suggestionHighlightTextLight: this.sanitizeCssValue(
        themeSettings.suggestionHighlightTextLight,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightTextLight,
        "color",
        doc,
      ),
      suggestionBorderLight: this.sanitizeCssValue(
        themeSettings.suggestionBorderLight,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBorderLight,
        "color",
        doc,
      ),
      suggestionBgDark: this.sanitizeCssValue(
        themeSettings.suggestionBgDark,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgDark,
        "color",
        doc,
      ),
      suggestionTextDark: this.sanitizeCssValue(
        themeSettings.suggestionTextDark,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionTextDark,
        "color",
        doc,
      ),
      suggestionHighlightBgDark: this.sanitizeCssValue(
        themeSettings.suggestionHighlightBgDark,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightBgDark,
        "color",
        doc,
      ),
      suggestionHighlightTextDark: this.sanitizeCssValue(
        themeSettings.suggestionHighlightTextDark,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightTextDark,
        "color",
        doc,
      ),
      suggestionBorderDark: this.sanitizeCssValue(
        themeSettings.suggestionBorderDark,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBorderDark,
        "color",
        doc,
      ),
      suggestionFontSize: this.sanitizeCssValue(
        themeSettings.suggestionFontSize,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionFontSize,
        "font-size",
        doc,
      ),
      suggestionPaddingVertical: this.sanitizeCssValue(
        themeSettings.suggestionPaddingVertical,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionPaddingVertical,
        "padding-top",
        doc,
      ),
      suggestionPaddingHorizontal: this.sanitizeCssValue(
        themeSettings.suggestionPaddingHorizontal,
        DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionPaddingHorizontal,
        "padding-left",
        doc,
      ),
    };
  }

  private sanitizeCssValue(
    value: unknown,
    fallback: string,
    property: string,
    doc: Document,
  ): string {
    if (typeof value !== "string") {
      return fallback;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue || this.isUnsafeCustomPropertyValue(trimmedValue)) {
      return fallback;
    }

    const probe = doc.createElement("div");
    probe.style.setProperty(property, trimmedValue);
    return probe.style.getPropertyValue(property) ? trimmedValue : fallback;
  }

  private isUnsafeCustomPropertyValue(value: string): boolean {
    const normalizedValue = value.toLowerCase();
    return (
      normalizedValue.includes("var(") ||
      normalizedValue.includes("url(") ||
      normalizedValue.includes(";") ||
      normalizedValue.includes("{") ||
      normalizedValue.includes("}")
    );
  }
}
