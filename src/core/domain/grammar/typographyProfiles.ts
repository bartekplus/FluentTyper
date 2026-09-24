export const NBSP = " ";
export const NNBSP = " ";

interface TypographyProfile {
  /** Quotation marks typed with `"`. */
  double: readonly [open: string, close: string];
  /** Nested quotation marks typed with `'`; an apostrophe is always `’`. */
  single: readonly [open: string, close: string];
  /** Space placed inside the primary quotes (French guillemets). */
  quoteSpace: string;
}

// CLDR quotationStart/End and alternateQuotationStart/End for each language.
// es and pt use the English marks in CLDR. ar is left on them too: CLDR
// reverses the marks for RTL ("”" opens), which the quote rules cannot tell
// from an English closer.
const ENGLISH: TypographyProfile = { double: ["“", "”"], single: ["‘", "’"], quoteSpace: "" };
const PROFILES: Record<string, TypographyProfile> = {
  en: ENGLISH,
  pl: { double: ["„", "”"], single: ["«", "»"], quoteSpace: "" },
  de: { double: ["„", "“"], single: ["‚", "‘"], quoteSpace: "" },
  fr: { double: ["«", "»"], single: ["“", "”"], quoteSpace: NBSP },
  el: { double: ["«", "»"], single: ["“", "”"], quoteSpace: "" },
  hr: { double: ["„", "“"], single: ["‚", "‘"], quoteSpace: "" },
  // Opener and closer are the same glyph: pairing goes by position.
  sv: { double: ["”", "”"], single: ["’", "’"], quoteSpace: "" },
};

export function resolveTypographyProfile(lang: string | undefined): TypographyProfile {
  return PROFILES[(lang ?? "").slice(0, 2).toLowerCase()] ?? ENGLISH;
}

/** Greek writes its question mark as ";" (U+037E normalizes to it). */
export function isGreekQuestionMark(ch: string, lang: string | undefined): boolean {
  return (ch === ";" || ch === "\u037E") && (lang ?? "").slice(0, 2).toLowerCase() === "el";
}

/** Spacing before high punctuation is France-specific; Canadian French spaces only the colon. */
export function usesFrenchPunctuationSpacing(lang: string | undefined): boolean {
  return lang === "fr_FR" || lang === "fr";
}
