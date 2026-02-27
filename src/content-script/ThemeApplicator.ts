import type { SetConfigContext } from "../shared/messageTypes";

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
        --tribute-bg-light: ${themeSettings.tributeBgLight} !important;
        --tribute-text-light: ${themeSettings.tributeTextLight} !important;
        --tribute-highlight-bg-light: ${themeSettings.tributeHighlightBgLight} !important;
        --tribute-highlight-text-light: ${themeSettings.tributeHighlightTextLight} !important;
        --tribute-border-color-light: ${themeSettings.tributeBorderLight} !important;
        --tribute-bg-dark: ${themeSettings.tributeBgDark} !important;
        --tribute-text-dark: ${themeSettings.tributeTextDark} !important;
        --tribute-highlight-bg-dark: ${themeSettings.tributeHighlightBgDark} !important;
        --tribute-highlight-text-dark: ${themeSettings.tributeHighlightTextDark} !important;
        --tribute-border-color-dark: ${themeSettings.tributeBorderDark} !important;
        --tribute-font-size: ${themeSettings.tributeFontSize} !important;
        --tribute-padding-vertical: ${themeSettings.tributePaddingVertical} !important;
        --tribute-padding-horizontal: ${themeSettings.tributePaddingHorizontal} !important;
      }
    `;

    doc.head.appendChild(styleElement);
  }
}
