export function clampColorChannel(channel: number): number {
  return Math.min(Math.max(Math.round(channel), 0), 255);
}

/** WCAG 2.1 relative luminance of an sRGB colour. */
export function relativeLuminance(color: { r: number; g: number; b: number }): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = clampColorChannel(channel) / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
