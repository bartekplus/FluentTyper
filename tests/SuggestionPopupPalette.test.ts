import { describe, expect, test } from "bun:test";
import { calculateThemeContrast, normalizeCssColor } from "../src/core/domain/color";
import {
  SUGGESTION_POPUP_ACCENT,
  readableAccent,
  resolveSuggestionAccents,
} from "../src/core/domain/suggestionPopup/palette";
import {
  DEFAULT_SUGGESTION_THEME_SETTINGS,
  type SuggestionThemeSettings,
} from "../src/core/domain/themeDefaults";

const sizes = {
  suggestionFontSize: "0.85rem",
  suggestionPaddingVertical: "0.6rem",
  suggestionPaddingHorizontal: "0.8rem",
};

/** The palette shipped before the redesign (dark selected row on light pages). */
const PREVIOUS_DEFAULT: SuggestionThemeSettings = {
  ...sizes,
  suggestionBgLight: "#ffffff",
  suggestionTextLight: "#2d3748",
  suggestionHighlightBgLight: "#0f172a",
  suggestionHighlightTextLight: "#ffffff",
  suggestionBorderLight: "#e2e8f0",
  suggestionBgDark: "#0f172a",
  suggestionTextDark: "#e2e8f0",
  suggestionHighlightBgDark: "#1e293b",
  suggestionHighlightTextDark: "#f8fafc",
  suggestionBorderDark: "#334155",
};

/** The Appearance "compact" preset (translucent colors). */
const COMPACT: SuggestionThemeSettings = {
  ...sizes,
  suggestionBgLight: "rgba(255, 255, 255, 0.85)",
  suggestionTextLight: "#1a202c",
  suggestionHighlightBgLight: "rgba(15, 23, 42, 0.96)",
  suggestionHighlightTextLight: "#ffffff",
  suggestionBorderLight: "rgba(226, 232, 240, 0.7)",
  suggestionBgDark: "rgba(15, 23, 42, 0.9)",
  suggestionTextDark: "#f8fafc",
  suggestionHighlightBgDark: "rgba(30, 41, 59, 0.92)",
  suggestionHighlightTextDark: "#f8fafc",
  suggestionBorderDark: "rgba(71, 85, 105, 0.72)",
};

describe("suggestion popup accents", () => {
  test("keep the design's accent on the default palettes, selected row included", () => {
    const accents = resolveSuggestionAccents(DEFAULT_SUGGESTION_THEME_SETTINGS);
    expect(accents.light).toEqual({
      accent: SUGGESTION_POPUP_ACCENT.light,
      highlightAccent: SUGGESTION_POPUP_ACCENT.light,
    });
    expect(accents.dark).toEqual({
      accent: SUGGESTION_POPUP_ACCENT.dark,
      highlightAccent: SUGGESTION_POPUP_ACCENT.dark,
    });
  });

  test.each([
    ["previous default", PREVIOUS_DEFAULT],
    ["compact preset", COMPACT],
    ["new default", DEFAULT_SUGGESTION_THEME_SETTINGS],
  ] as const)("read at 4.5:1 or better on every row of the %s palette", (_, theme) => {
    const accents = resolveSuggestionAccents(theme);
    const checks = [
      [theme.suggestionBgLight, accents.light.accent, "#ffffff"],
      [theme.suggestionHighlightBgLight, accents.light.highlightAccent, theme.suggestionBgLight],
      [theme.suggestionBgDark, accents.dark.accent, "#020617"],
      [theme.suggestionHighlightBgDark, accents.dark.highlightAccent, theme.suggestionBgDark],
    ];
    for (const [background, accent, backdrop] of checks) {
      expect(calculateThemeContrast(background, accent, backdrop)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("give a dark selected row on a light popup the design's dark-mode blue", () => {
    expect(resolveSuggestionAccents(PREVIOUS_DEFAULT).light.highlightAccent).toBe(
      SUGGESTION_POPUP_ACCENT.dark,
    );
    expect(resolveSuggestionAccents(COMPACT).light.highlightAccent).toBe(
      SUGGESTION_POPUP_ACCENT.dark,
    );
  });

  test("read colors the browser accepts beyond hex and rgb(), through the normalizer", () => {
    const theme = { ...DEFAULT_SUGGESTION_THEME_SETTINGS, suggestionBgLight: "black" };
    // Without normalizing, "black" would be read as the white backdrop.
    const accents = resolveSuggestionAccents(theme, (color) =>
      color === "black" ? "#000000" : color,
    );
    expect(accents.light.accent).toBe(SUGGESTION_POPUP_ACCENT.dark);
  });

  test("normalizeCssColor serializes through fillStyle and keeps rejected values", () => {
    // A stand-in for a canvas context: accepts "black", rejects anything unknown.
    let fillStyle = "#000000";
    const context = {
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        if (value === "black") fillStyle = "#000000";
        else if (/^#[0-9a-f]{6}$/i.test(value)) fillStyle = value.toLowerCase();
      },
    };
    expect(normalizeCssColor("black", context)).toBe("#000000");
    expect(normalizeCssColor("not-a-color", context)).toBe("not-a-color");
    expect(normalizeCssColor("black", null)).toBe("black");
  });

  test("blend toward the row's text only when no design accent reads", () => {
    const accent = readableAccent(
      [SUGGESTION_POPUP_ACCENT.light, SUGGESTION_POPUP_ACCENT.dark],
      "#808080",
      "#000000",
      "#ffffff",
    );
    expect(Object.values(SUGGESTION_POPUP_ACCENT)).not.toContain(accent);
    expect(calculateThemeContrast("#808080", accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
