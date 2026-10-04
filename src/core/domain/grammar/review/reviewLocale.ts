/** UI languages, in the order of every translation entry (the options page's set; "pr" is Portuguese). */
export const REVIEW_LANGS = ["en", "fr", "hr", "es", "el", "sv", "de", "pl", "pr"] as const;

export type Translations = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/**
 * One entry in the UI language `lang` (English when it has none). Parameters
 * are plain text; callers render them as text nodes.
 */
export function localizeReviewText(
  entry: Translations,
  lang: string,
  params: Record<string, string | number> = {},
): string {
  // "pt" is stored as "pr" by the options page; an unknown language falls back to English.
  const code = lang.split(/[-_]/)[0].toLowerCase();
  const template =
    entry[(REVIEW_LANGS as readonly string[]).indexOf(code === "pt" ? "pr" : code)] || entry[0];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
