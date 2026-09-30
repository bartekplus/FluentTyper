export const MATRIX_LANGUAGES = [
  "en_US",
  "fr_FR",
  "de_DE",
  "pl_PL",
  "es_ES",
  "pt_BR",
  "sv_SE",
  "hr_HR",
  "el_GR",
  "ar_SA",
] as const;
export type MatrixLanguage = (typeof MATRIX_LANGUAGES)[number];

/**
 * `pos`: [input, text after applying every finding of the rule] — or `null` for
 * warning-only rules, which must report at least one finding. `neg`: no finding.
 */
export interface LanguageFixture {
  pos: Array<[string, string | null]>;
  neg: string[];
}
export type RuleFixtures = Record<MatrixLanguage, LanguageFixture>;
