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
  apply(themeSettings: ThemeSettings, doc: Document = document): void {
    const safeThemeSettings = this.sanitizeThemeSettings(themeSettings, doc);
    const existingStyle = doc.getElementById("fluent-typer-theme-overrides");
    if (existingStyle) {
      existingStyle.remove();
    }

    const styleElement = doc.createElement("style");
    styleElement.id = "fluent-typer-theme-overrides";

    styleElement.textContent = this.buildThemeOverrideCss(safeThemeSettings);

    doc.head.appendChild(styleElement);
  }

  private buildThemeOverrideCss(themeSettings: ThemeSettings): string {
    const lines: string[] = [":root {"];
    for (const spec of THEME_SETTING_SPECS) {
      const value = themeSettings[spec.key];
      lines.push(`  --${spec.cssName}: ${value} !important;`);
      lines.push(`  --ft-theme-${spec.cssName}: ${value} !important;`);
    }
    lines.push("}");
    return lines.join("\n");
  }

  private sanitizeThemeSettings(themeSettings: ThemeSettings, doc: Document): ThemeSettings {
    const sanitizedThemeSettings = {} as ThemeSettings;
    for (const spec of THEME_SETTING_SPECS) {
      const fallbackValue = DEFAULT_SUGGESTION_THEME_SETTINGS[spec.key];
      sanitizedThemeSettings[spec.key] = this.sanitizeCssValue(
        themeSettings[spec.key],
        fallbackValue,
        spec.cssProperty,
        doc,
      );
    }
    return sanitizedThemeSettings;
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
