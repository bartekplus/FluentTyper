import type { SetConfigContext } from "@core/domain/messageTypes";

export class ThemeApplicator {
  apply(
    themeSettings: NonNullable<SetConfigContext["themeConfig"]>,
    doc: Document = document,
  ): void {
    const existingStyle = doc.getElementById("fluent-typer-theme-overrides");
    if (existingStyle) {
      existingStyle.remove();
    }

    const styleElement = doc.createElement("style");
    styleElement.id = "fluent-typer-theme-overrides";

    styleElement.textContent = `
      :root {
        --suggestion-bg-light: ${themeSettings.suggestionBgLight} !important;
        --ft-theme-suggestion-bg-light: ${themeSettings.suggestionBgLight} !important;
        --suggestion-text-light: ${themeSettings.suggestionTextLight} !important;
        --ft-theme-suggestion-text-light: ${themeSettings.suggestionTextLight} !important;
        --suggestion-highlight-bg-light: ${themeSettings.suggestionHighlightBgLight} !important;
        --ft-theme-suggestion-highlight-bg-light: ${themeSettings.suggestionHighlightBgLight} !important;
        --suggestion-highlight-text-light: ${themeSettings.suggestionHighlightTextLight} !important;
        --ft-theme-suggestion-highlight-text-light: ${themeSettings.suggestionHighlightTextLight} !important;
        --suggestion-border-color-light: ${themeSettings.suggestionBorderLight} !important;
        --ft-theme-suggestion-border-color-light: ${themeSettings.suggestionBorderLight} !important;
        --suggestion-bg-dark: ${themeSettings.suggestionBgDark} !important;
        --ft-theme-suggestion-bg-dark: ${themeSettings.suggestionBgDark} !important;
        --suggestion-text-dark: ${themeSettings.suggestionTextDark} !important;
        --ft-theme-suggestion-text-dark: ${themeSettings.suggestionTextDark} !important;
        --suggestion-highlight-bg-dark: ${themeSettings.suggestionHighlightBgDark} !important;
        --ft-theme-suggestion-highlight-bg-dark: ${themeSettings.suggestionHighlightBgDark} !important;
        --suggestion-highlight-text-dark: ${themeSettings.suggestionHighlightTextDark} !important;
        --ft-theme-suggestion-highlight-text-dark: ${themeSettings.suggestionHighlightTextDark} !important;
        --suggestion-border-color-dark: ${themeSettings.suggestionBorderDark} !important;
        --ft-theme-suggestion-border-color-dark: ${themeSettings.suggestionBorderDark} !important;
        --suggestion-font-size: ${themeSettings.suggestionFontSize} !important;
        --ft-theme-suggestion-font-size: ${themeSettings.suggestionFontSize} !important;
        --suggestion-padding-vertical: ${themeSettings.suggestionPaddingVertical} !important;
        --ft-theme-suggestion-padding-vertical: ${themeSettings.suggestionPaddingVertical} !important;
        --suggestion-padding-horizontal: ${themeSettings.suggestionPaddingHorizontal} !important;
        --ft-theme-suggestion-padding-horizontal: ${themeSettings.suggestionPaddingHorizontal} !important;
      }
    `;

    doc.head.appendChild(styleElement);
  }
}
