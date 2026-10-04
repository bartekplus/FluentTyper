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

/** "pt" is stored as "pr" by the options page; anything unknown falls back to English. */
export function resolveReviewUiLanguage(locale: string | undefined): (typeof REVIEW_LANGS)[number] {
  const code = (locale ?? "").split(/[-_]/)[0].toLowerCase();
  const normalized = code === "pt" ? "pr" : code;
  return (REVIEW_LANGS as readonly string[]).includes(normalized)
    ? (normalized as (typeof REVIEW_LANGS)[number])
    : "en";
}

/**
 * One entry in the UI language `lang` (English when it has none). Parameters
 * are plain text; callers render them as text nodes.
 */
export function localizeReviewText(
  entry: Translations,
  lang: string,
  params: Record<string, string | number> = {},
): string {
  const template = entry[REVIEW_LANGS.indexOf(resolveReviewUiLanguage(lang))] || entry[0];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
