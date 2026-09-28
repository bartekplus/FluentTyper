import { calculateThemeContrast, parseThemeColor, resolveOpaqueColor, toOpaqueHex } from "../color";
import type { SuggestionThemeSettings } from "../themeDefaults";

/** The design's accent for typed text: blue on light popups, light blue on dark ones. */
export const SUGGESTION_POPUP_ACCENT = { light: "#185fa8", dark: "#7cc4ff" } as const;

/** What the popup is drawn over when its own colors are translucent. */
const BACKDROP = { light: "#ffffff", dark: "#020617" } as const;

const COLOR_KEYS = [
  "suggestionBgLight",
  "suggestionTextLight",
  "suggestionHighlightBgLight",
  "suggestionHighlightTextLight",
  "suggestionBgDark",
  "suggestionTextDark",
  "suggestionHighlightBgDark",
  "suggestionHighlightTextDark",
] as const;

/** WCAG AA for normal text. */
const MIN_CONTRAST = 4.5;

/**
 * The first of `accents` (the design's accents, this mode's first) that reads
 * on `background`, so a dark selected row on a light popup gets the design's
 * dark-mode blue. When none does, the best one blended toward `text` (the
 * theme's own readable color there) only as far as it takes.
 */
export function readableAccent(
  accents: readonly string[],
  background: string,
  text: string,
  backdrop: string,
): string {
  const backgroundHex = toOpaqueHex(resolveOpaqueColor(background, backdrop));
  const contrast = (color: string) => calculateThemeContrast(backgroundHex, color, backgroundHex);
  const readable = accents.find((accent) => contrast(accent) >= MIN_CONTRAST);
  if (readable) {
    return readable;
  }
  const textColor = resolveOpaqueColor(text, backgroundHex);
  const best = parseThemeColor([...accents].sort((a, b) => contrast(b) - contrast(a))[0] ?? "");
  if (!best) {
    return toOpaqueHex(textColor);
  }
  for (let step = 1; step <= 10; step += 1) {
    const t = step / 10;
    const mixed = toOpaqueHex({
      r: best.r + (textColor.r - best.r) * t,
      g: best.g + (textColor.g - best.g) * t,
      b: best.b + (textColor.b - best.b) * t,
      a: 1,
    });
    if (contrast(mixed) >= MIN_CONTRAST) {
      return mixed;
    }
  }
  return toOpaqueHex(textColor);
}

/**
 * Readable accents for a theme, per color mode: on the popup (`accent`) and on
 * the selected row (`highlightAccent`), which themes often color differently.
 */
export function resolveSuggestionAccents(
  rawTheme: SuggestionThemeSettings,
  /** Serializes any CSS color the browser accepts (see normalizeCssColor). */
  normalizeColor: (color: string) => string = (color) => color,
): Record<"light" | "dark", { accent: string; highlightAccent: string }> {
  const theme = { ...rawTheme };
  for (const key of COLOR_KEYS) {
    theme[key] = normalizeColor(theme[key]);
  }
  const forMode = (mode: "light" | "dark") => {
    const bg = mode === "light" ? theme.suggestionBgLight : theme.suggestionBgDark;
    const panel = toOpaqueHex(resolveOpaqueColor(bg, BACKDROP[mode]));
    const other = mode === "light" ? "dark" : "light";
    const candidates = [SUGGESTION_POPUP_ACCENT[mode], SUGGESTION_POPUP_ACCENT[other]];
    return {
      accent: readableAccent(
        candidates,
        bg,
        mode === "light" ? theme.suggestionTextLight : theme.suggestionTextDark,
        BACKDROP[mode],
      ),
      highlightAccent: readableAccent(
        candidates,
        mode === "light" ? theme.suggestionHighlightBgLight : theme.suggestionHighlightBgDark,
        mode === "light" ? theme.suggestionHighlightTextLight : theme.suggestionHighlightTextDark,
        panel,
      ),
    };
  };
  return { light: forMode("light"), dark: forMode("dark") };
}
