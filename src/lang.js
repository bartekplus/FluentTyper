const SUPPORTED_LANGUAGES = {
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
const SUPPORTED_LANGUAGES_SHORT_CODE = {
  en: "en_US",
  fr: "fr_FR",
  hr: "hr_HR",
  es: "es_ES",
  el: "el_GR",
  sv: "sv_SE",
  de: "de_DE",
  pl: "pl_PL",
  pr: "pt_BR",
};

const DEFAULT_SEPERATOR_CHARS_REGEX = RegExp(
  /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/,
);
const LANG_SEPERATOR_CHARS_REGEX = {
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
const LANG_ADDITIONAL_SEPERATOR_REGEX = {
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
export {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGES_SHORT_CODE,
  DEFAULT_SEPERATOR_CHARS_REGEX,
  LANG_SEPERATOR_CHARS_REGEX,
  LANG_ADDITIONAL_SEPERATOR_REGEX,
};
