/** Unit identity is never converted or inferred from the writing locale. */
export interface MeasurementUnit {
  identity: string;
  symbol: string;
  prefixes: "decimal" | "binary" | "both" | "none";
  safe: boolean;
  ambiguity?: string;
  source: string;
  composition: boolean;
}

export interface MeasurementLocalePolicy {
  locale: string;
  separator: string;
  decimalMarks: readonly string[];
  /** A second, locale-native digit system (e.g. CLDR `arab`) with its own decimal mark. */
  nativeDigits?: { readonly digits: string; readonly decimalMark: string };
}
