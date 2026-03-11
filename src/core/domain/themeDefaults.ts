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
  suggestionTextLight: "#2d3748",
  suggestionHighlightBgLight: "#edf2f7",
  suggestionHighlightTextLight: "#2d3748",
  suggestionBorderLight: "#e2e8f0",
  suggestionBgDark: "#0f172a",
  suggestionTextDark: "#e2e8f0",
  suggestionHighlightBgDark: "#1e293b",
  suggestionHighlightTextDark: "#f8fafc",
  suggestionBorderDark: "#334155",
  suggestionFontSize: "0.85rem",
  suggestionPaddingVertical: "0.6rem",
  suggestionPaddingHorizontal: "0.8rem",
};
