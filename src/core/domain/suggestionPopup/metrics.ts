import {
  SUGGESTION_POPUP_FONT_FAMILY,
  SUGGESTION_POPUP_FONT_STRETCH,
  SUGGESTION_POPUP_FONT_STYLE,
  SUGGESTION_POPUP_FONT_WEIGHT,
  SUGGESTION_POPUP_LETTER_SPACING,
  SUGGESTION_POPUP_TEXT_TRANSFORM,
  SUGGESTION_POPUP_WORD_SPACING,
} from "./typography";

/** The popup's widest size per layout (never wider than the viewport allows). */
export const SUGGESTION_POPUP_MAX_WIDTH_PX = { list: 460, row: 640 } as const;

/** How much the user's Appearance sizes scale the popup; 1 is the default size. */
export interface SuggestionPopupThemeScale {
  fontSize: number;
  paddingVertical: number;
  paddingHorizontal: number;
}

export const NEUTRAL_THEME_SCALE: SuggestionPopupThemeScale = {
  fontSize: 1,
  paddingVertical: 1,
  paddingHorizontal: 1,
};

/**
 * Appearance sizes are read relative to the defaults they were first tuned
 * for, and clamped, so they nudge the popup's sizes rather than set them.
 */
export const THEME_SCALE_REFERENCES = {
  fontSize: { reference: "0.9rem", min: 0.85, property: "font-size" },
  paddingVertical: { reference: "0.6rem", min: 0.75, property: "padding-top" },
  paddingHorizontal: { reference: "0.8rem", min: 0.75, property: "padding-left" },
} as const;

/** Resolves a CSS length to px for the CSS `property` it is used as; null when it can't. */
export type CssLengthResolver = (
  value: string,
  property: (typeof THEME_SCALE_REFERENCES)[keyof SuggestionPopupThemeScale]["property"],
) => number | null;
const THEME_SCALE_MAX = 1.2;

export function themeScaleFor(
  themePx: number | null,
  referencePx: number | null,
  min: number,
): number {
  if (!themePx || !referencePx || !Number.isFinite(themePx) || !Number.isFinite(referencePx)) {
    return 1;
  }
  return clamp(themePx / referencePx, min, THEME_SCALE_MAX);
}

/** px, rem and em (16px) lengths; null for anything that needs the browser to resolve. */
export function parseCssLengthPx(value: string): number | null {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(-?\d*\.?\d+)(px|rem|em)$/);
  if (!match) {
    return value.trim() === "0" ? 0 : null;
  }
  const unitPx = match[2] === "px" ? 1 : 16;
  return Number.parseFloat(match[1]) * unitPx;
}

/**
 * The popup's theme scale from Appearance values. px, rem and em are read
 * directly; pass `resolveLength` (the browser) for any other CSS length, as the
 * popup on web pages does.
 */
export function themeScaleFromValues(
  values: Record<keyof SuggestionPopupThemeScale, string>,
  resolveLength: CssLengthResolver = () => null,
): SuggestionPopupThemeScale {
  const scale = (key: keyof SuggestionPopupThemeScale) => {
    const { reference, min, property } = THEME_SCALE_REFERENCES[key];
    const toPx = (value: string) => parseCssLengthPx(value) ?? resolveLength(value, property);
    return themeScaleFor(toPx(values[key]), toPx(reference), min);
  };
  return {
    fontSize: scale("fontSize"),
    paddingVertical: scale("paddingVertical"),
    paddingHorizontal: scale("paddingHorizontal"),
  };
}

/**
 * The CSS custom properties that size the popup for text of `fontSizePx` on
 * `lineHeightPx` lines. 16px text on a 1.4 line with the default Appearance
 * sizes gives the design's 32px rows.
 */
export function computeSuggestionPopupStyleVars(args: {
  fontSizePx: number;
  lineHeightPx: number;
  themeScale: SuggestionPopupThemeScale;
  viewportWidthPx: number;
}): Record<string, string> {
  const { fontSizePx, lineHeightPx, themeScale } = args;
  const fontPx = Math.round(clamp(fontSizePx * 0.84 * themeScale.fontSize, 12, 15));
  const linePx = Math.round(clamp(lineHeightPx * 0.86 * themeScale.fontSize, 16, 22));
  const padX = Math.round(clamp(fontSizePx * 0.62 * themeScale.paddingHorizontal, 8, 12));
  const padY = Math.round(clamp(fontSizePx * 0.14 * themeScale.paddingVertical, 3, 6));
  const rowPx = Math.round(clamp(linePx + fontSizePx * 0.85 * themeScale.paddingVertical, 28, 38));
  const radiusPx = Math.round(clamp(fontSizePx * 0.5, 8, 10));
  const availableWidth = Math.max(152, args.viewportWidthPx - 16);
  const minWidthPx = Math.round(clamp(Math.max(fontPx * 9, 148), 148, availableWidth));
  return {
    "--ft-font-size": `${fontPx}px`,
    "--ft-line-height": `${linePx}px`,
    "--ft-row-height": `${rowPx}px`,
    "--ft-pad-x": `${padX}px`,
    "--ft-pad-y": `${padY}px`,
    "--ft-radius": `${radiusPx}px`,
    "--ft-panel-min-width": `${minWidthPx}px`,
    "--suggestion-font-size": `${fontPx}px`,
    "--ft-font-family": SUGGESTION_POPUP_FONT_FAMILY,
    "--ft-font-weight": SUGGESTION_POPUP_FONT_WEIGHT,
    "--ft-font-style": SUGGESTION_POPUP_FONT_STYLE,
    "--ft-font-stretch": SUGGESTION_POPUP_FONT_STRETCH,
    "--ft-letter-spacing": SUGGESTION_POPUP_LETTER_SPACING,
    "--ft-word-spacing": SUGGESTION_POPUP_WORD_SPACING,
    "--ft-text-transform": SUGGESTION_POPUP_TEXT_TRANSFORM,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
