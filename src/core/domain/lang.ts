import { PUNCTUATION_EQUIVALENTS } from "./spacingRules";

export const TEXT_EXPANDER_LANG = "textExpander";

// Strong RTL letters (digits, marks and U+FEFF are neutral).  Any other letter
// is a strong LTR character.  The containing element's computed `direction`
// only describes the paragraph — a Latin run inside an RTL paragraph still
// continues rightward — so anchoring must follow the run.
export const RTL_LETTER_REGEX =
  /(?=\p{L})[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

// Characters that are never part of a word in any language. U+0640 ARABIC
// TATWEEL is an intra-word joining filler rather than a letter, so "كتـــاب"
// has to reach Presage as "كتاب" — not split into fragments.
const IGNORED_WORD_CHARS_REGEX = /\u0640/g;

export function stripIgnoredWordChars(text: string): string {
  return text.replace(IGNORED_WORD_CHARS_REGEX, "");
}

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
  ar_SA: "Arabic",
  [TEXT_EXPANDER_LANG]: "Text Expander",
};

const SUPPORTED_LANGUAGE_KEYS = Object.keys(SUPPORTED_LANGUAGES);
export const SUPPORTED_PREDICTION_LANGUAGE_KEYS = SUPPORTED_LANGUAGE_KEYS.filter(
  (lang) => lang !== "auto_detect",
);

export function resolveEnabledLanguages(enabledLanguages: unknown): string[] {
  if (!Array.isArray(enabledLanguages)) {
    return SUPPORTED_PREDICTION_LANGUAGE_KEYS.slice();
  }
  const enabledSet = new Set(
    enabledLanguages.filter(
      (lang): lang is string =>
        typeof lang === "string" && lang in SUPPORTED_LANGUAGES && lang !== "auto_detect",
    ),
  );
  const filtered = SUPPORTED_PREDICTION_LANGUAGE_KEYS.filter((lang) => enabledSet.has(lang));
  return filtered.length > 0 ? filtered : SUPPORTED_PREDICTION_LANGUAGE_KEYS.slice();
}

export const SUPPORTED_LANGUAGES_SHORT_CODE: Record<string, string> = {
  ar: "ar_SA",
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

const BASE_SEPARATOR_CHARS_REGEX_SOURCE =
  '\\s+|!|"|#|\\$|%|&|\\(|\\)|\\*|\\+|,|-|\\.|\\/|:|;|<|=|>|\\?|@|\\[|\\\\|\\]|\\^|_|`|{|\\||}|~';
const TYPOGRAPHIC_SEPARATOR_CHARS_REGEX_SOURCE = [
  "\\u201C|\\u201D|\\u2018|\\u2014|\\u2013|\\u2026|\\u201E|\\u00AB|\\u00BB|\\u2039|\\u203A",
  ...Object.keys(PUNCTUATION_EQUIVALENTS),
].join("|");
const DEFAULT_SEPARATOR_CHARS_REGEX_SOURCE = `${BASE_SEPARATOR_CHARS_REGEX_SOURCE}|${TYPOGRAPHIC_SEPARATOR_CHARS_REGEX_SOURCE}`;

export const DEFAULT_SEPARATOR_CHARS_REGEX: RegExp = RegExp(DEFAULT_SEPARATOR_CHARS_REGEX_SOURCE);
// U+0640 (ARABIC TATWEEL) is deliberately NOT a separator: it is an
// intra-word joining filler, so "كتـــاب" is a single word. Splitting on it
// would hand Presage a fragment ("اب"). It is stripped instead, see
// stripIgnoredWordChars.
export const LANG_SEPARATOR_CHARS_REGEX: Record<string, RegExp> = {
  ...Object.fromEntries(
    SUPPORTED_LANGUAGE_KEYS.map((lang) => [lang, DEFAULT_SEPARATOR_CHARS_REGEX]),
  ),
  fr_FR: RegExp(`${DEFAULT_SEPARATOR_CHARS_REGEX_SOURCE}|'|\\u2019`),
};
export const LANG_ADDITIONAL_SEPARATOR_REGEX: Record<string, RegExp | undefined> = {
  fr_FR: /['\u2019]/g,
};
