import { clamp } from "./guards";

export function clampColorChannel(channel: number): number {
  return clamp(Math.round(channel), 0, 255);
}

/** WCAG 2.1 relative luminance of an sRGB colour. */
export function relativeLuminance(color: { r: number; g: number; b: number }): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = clampColorChannel(channel) / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export type RGBAColor = { r: number; g: number; b: number; a: number };

export function clampAlpha(value: number): number {
  return clamp(value, 0, 1);
}

function parseRgbPart(value: string): number | null {
  const numericValue = Number.parseFloat(value);
  return Number.isFinite(numericValue) ? clampColorChannel(numericValue) : null;
}

function parseAlphaPart(value: string): number | null {
  const numericValue = Number.parseFloat(value);
  return Number.isFinite(numericValue) ? clampAlpha(numericValue) : null;
}

export function parseThemeColor(rawValue: string): RGBAColor | null {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/i.test(hex)) {
      return null;
    }
    const pairs = hex.length <= 4 ? [...hex].map((part) => part + part) : hex.match(/../g)!;
    const channels = pairs.map((part) => Number.parseInt(part, 16));
    return {
      r: channels[0],
      g: channels[1],
      b: channels[2],
      a: hex.length === 4 || hex.length === 8 ? channels[3] / 255 : 1,
    };
  }

  const rgbMatch = value.match(
    /^rgba?\(\s*([^\s,]+)\s*,\s*([^\s,]+)\s*,\s*([^\s,]+)(?:\s*,\s*([^)]+))?\s*\)$/i,
  );
  if (!rgbMatch) {
    return null;
  }

  const r = parseRgbPart(rgbMatch[1]);
  const g = parseRgbPart(rgbMatch[2]);
  const b = parseRgbPart(rgbMatch[3]);
  const a = rgbMatch[4] === undefined ? 1 : parseAlphaPart(rgbMatch[4]);
  if (r === null || g === null || b === null || a === null) {
    return null;
  }
  return { r, g, b, a };
}

export function toHex(channels: number[]): string {
  return `#${channels
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function toOpaqueHex(color: RGBAColor): string {
  return toHex([color.r, color.g, color.b]);
}

function compositeForegroundOverBackground(
  foreground: RGBAColor,
  background: RGBAColor,
): RGBAColor {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

export function resolveOpaqueColor(rawValue: string, backdropRawValue: string): RGBAColor {
  const backdrop = parseThemeColor(backdropRawValue) ?? { r: 0, g: 0, b: 0, a: 1 };
  const parsed = parseThemeColor(rawValue);
  if (!parsed) {
    return backdrop;
  }
  return parsed.a >= 1 ? parsed : compositeForegroundOverBackground(parsed, backdrop);
}

export function calculateThemeContrast(
  backgroundRawValue: string,
  foregroundRawValue: string,
  backdropRawValue: string,
): number {
  const background = resolveOpaqueColor(backgroundRawValue, backdropRawValue);
  const foreground = resolveOpaqueColor(foregroundRawValue, toOpaqueHex(background));
  const backgroundLuminance = relativeLuminance(background);
  const foregroundLuminance = relativeLuminance(foreground);
  const lighter = Math.max(backgroundLuminance, foregroundLuminance);
  const darker = Math.min(backgroundLuminance, foregroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `value` as the browser serializes it through a canvas 2D context's
 * fillStyle ("black" or "hsl(...)" become "#000000" or "rgba(...)"), so any CSS
 * color the browser accepts can be parsed. Unchanged without a context, or when
 * the browser rejects it.
 */
export function normalizeCssColor(value: string, context: { fillStyle: unknown } | null): string {
  if (!context) {
    return value;
  }
  // An invalid value leaves fillStyle as it was; two sentinels tell that apart.
  const serialize = (sentinel: string) => {
    context.fillStyle = sentinel;
    context.fillStyle = value;
    return context.fillStyle;
  };
  const first = serialize("#000000");
  const second = serialize("#ffffff");
  return typeof first === "string" && first === second ? first : value;
}
