import type { SettingsSchema } from "./contracts/settings";

export type SuggestionThemeSettings = Pick<
  SettingsSchema,
  | "suggestionBgLight"
  | "suggestionTextLight"
  | "suggestionHighlightBgLight"
  | "suggestionHighlightTextLight"
  | "suggestionBorderLight"
  | "suggestionBgDark"
  | "suggestionTextDark"
  | "suggestionHighlightBgDark"
  | "suggestionHighlightTextDark"
  | "suggestionBorderDark"
  | "suggestionFontSize"
  | "suggestionPaddingVertical"
  | "suggestionPaddingHorizontal"
>;

export const DEFAULT_SUGGESTION_THEME_SETTINGS: SuggestionThemeSettings = {
  suggestionBgLight: "#ffffff",
  suggestionTextLight: "#1f2329",
  suggestionHighlightBgLight: "#e3edf9",
  suggestionHighlightTextLight: "#1f2329",
  suggestionBorderLight: "#d5dae3",
  suggestionBgDark: "#22252c",
  suggestionTextDark: "#e6e7eb",
  suggestionHighlightBgDark: "#2c3b52",
  suggestionHighlightTextDark: "#f3f4f6",
  suggestionBorderDark: "#373b46",
  suggestionFontSize: "0.85rem",
  suggestionPaddingVertical: "0.6rem",
  suggestionPaddingHorizontal: "0.8rem",
};
