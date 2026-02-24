export const SUPPORTED_LANGUAGES: Record<string, string> = {
  auto_detect: "Auto detect",
  en_US: "English (US)",
  fr_FR: "French",
  hr_HR: "Croatian",
  es_ES: "Spanish",
  el_GR: "Greek",
  sv_SE: "Swedish",
  de_DE: "German",
  pl_PL: "Polish",
  pt_BR: "Brazilian Portuguese",
  textExpander: "Text Expander",
};

export const SUPPORTED_LANGUAGE_KEYS = Object.keys(SUPPORTED_LANGUAGES);
export const SUPPORTED_PREDICTION_LANGUAGE_KEYS =
  SUPPORTED_LANGUAGE_KEYS.filter((lang) => lang !== "auto_detect");

export function resolveEnabledLanguages(enabledLanguages: unknown): string[] {
  if (!Array.isArray(enabledLanguages)) {
    return SUPPORTED_PREDICTION_LANGUAGE_KEYS.slice();
  }
  const enabledSet = new Set(
    enabledLanguages.filter(
      (lang): lang is string =>
        typeof lang === "string" &&
        lang in SUPPORTED_LANGUAGES &&
        lang !== "auto_detect",
    ),
  );
  const filtered = SUPPORTED_PREDICTION_LANGUAGE_KEYS.filter((lang) =>
    enabledSet.has(lang),
  );
  return filtered.length > 0
    ? filtered
    : SUPPORTED_PREDICTION_LANGUAGE_KEYS.slice();
}

export function resolveEnabledPredictionLanguages(
  enabledLanguages: unknown,
): string[] {
  return resolveEnabledLanguages(enabledLanguages);
}
export const SUPPORTED_LANGUAGES_SHORT_CODE: Record<string, string> = {
  en: "en_US",
  fr: "fr_FR",
  hr: "hr_HR",
  es: "es_ES",
  el: "el_GR",
  sv: "sv_SE",
  de: "de_DE",
  pl: "pl_PL",
  pt: "pt_BR",
};

export const DEFAULT_SEPERATOR_CHARS_REGEX: RegExp = RegExp(
  /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/,
);
export const LANG_SEPERATOR_CHARS_REGEX: Record<string, RegExp> = {
  auto_detect: DEFAULT_SEPERATOR_CHARS_REGEX,
  en_US: DEFAULT_SEPERATOR_CHARS_REGEX,
  fr_FR: RegExp(
    /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~|'/,
  ),
  hr_HR: DEFAULT_SEPERATOR_CHARS_REGEX,
  es_ES: DEFAULT_SEPERATOR_CHARS_REGEX,
  el_GR: DEFAULT_SEPERATOR_CHARS_REGEX,
  sv_SE: DEFAULT_SEPERATOR_CHARS_REGEX,
  de_DE: DEFAULT_SEPERATOR_CHARS_REGEX,
  pl_PL: DEFAULT_SEPERATOR_CHARS_REGEX,
  pt_BR: DEFAULT_SEPERATOR_CHARS_REGEX,
  textExpander: DEFAULT_SEPERATOR_CHARS_REGEX,
};
export const LANG_ADDITIONAL_SEPERATOR_REGEX: Record<string, RegExp | null> = {
  auto_detect: null,
  en_US: null,
  fr_FR: RegExp(/'/g),
  hr_HR: null,
  es_ES: null,
  el_GR: null,
  sv_SE: null,
  de_DE: null,
  pl_PL: null,
  pt_BR: null,
  textExpander: null,
};
