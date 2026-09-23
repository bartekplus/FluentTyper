export const NBSP = " ";
export const NNBSP = " ";

export interface TypographyProfile {
  /** Quotation marks typed with `"`. */
  double: readonly [open: string, close: string];
  /** Nested quotation marks typed with `'`; an apostrophe is always `’`. */
  single: readonly [open: string, close: string];
  /** Space placed inside the primary quotes (French guillemets). */
  quoteSpace: string;
}

// CLDR quotationStart/End and alternateQuotationStart/End for each language.
// Languages without a verified profile keep the English marks.
const ENGLISH: TypographyProfile = { double: ["“", "”"], single: ["‘", "’"], quoteSpace: "" };
const PROFILES: Record<string, TypographyProfile> = {
  en: ENGLISH,
  pl: { double: ["„", "”"], single: ["«", "»"], quoteSpace: "" },
  de: { double: ["„", "“"], single: ["‚", "‘"], quoteSpace: "" },
  fr: { double: ["«", "»"], single: ["“", "”"], quoteSpace: NBSP },
};

export function resolveTypographyProfile(lang: string | undefined): TypographyProfile {
  return PROFILES[(lang ?? "").slice(0, 2).toLowerCase()] ?? ENGLISH;
}

/** Spacing before high punctuation is France-specific; Canadian French spaces only the colon. */
export function usesFrenchPunctuationSpacing(lang: string | undefined): boolean {
  return lang === "fr_FR" || lang === "fr";
}
