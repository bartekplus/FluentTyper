const SUPPORTED_LANGUAGES = {
  auto_detect: "Auto detect",
  en: "English",
  fr: "French",
  hr: "Croatian",
  es: "Spanish",
  el: "Greek",
  sv: "Swedish",
  textExpander: "Text Expander",
};

const DEFAULT_SEPERATOR_CHARS_REGEX = RegExp(
  /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/
);
const LANG_SEPERATOR_CHARS_REGEX = {
  auto_detect: DEFAULT_SEPERATOR_CHARS_REGEX,
  en: DEFAULT_SEPERATOR_CHARS_REGEX,
  fr: RegExp(
    /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~|'/
  ),
  hr: DEFAULT_SEPERATOR_CHARS_REGEX,
  es: DEFAULT_SEPERATOR_CHARS_REGEX,
  el: DEFAULT_SEPERATOR_CHARS_REGEX,
  sv: DEFAULT_SEPERATOR_CHARS_REGEX,
  textExpander: DEFAULT_SEPERATOR_CHARS_REGEX,
};
const LANG_ADDITIONAL_SEPERATOR_REGEX = {
  auto_detect: null,
  en: null,
  fr: RegExp(/'/g),
  hr: null,
  es: null,
  el: null,
  sv: null,
  textExpander: null,
};
export {
  SUPPORTED_LANGUAGES,
  DEFAULT_SEPERATOR_CHARS_REGEX,
  LANG_SEPERATOR_CHARS_REGEX,
  LANG_ADDITIONAL_SEPERATOR_REGEX,
};
