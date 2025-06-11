// Centralized constants for command strings and config keys
// filepath: /Users/bartosztomczyk/Devel/FluentTyper/src/shared/constants.js

// Command Strings
export const CMD_CONTENT_SCRIPT_PREDICT_REQ = "contentScriptPredictReq";
export const CMD_BACKGROUND_PAGE_PREDICT_REQ = "backgroundPagePredictReq";
export const CMD_BACKGROUND_PAGE_SET_CONFIG = "backgroundPageSetConfig";
export const CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG = "backgroundPageUpdateLangConfig";
export const CMD_OPTIONS_PAGE_CONFIG_CHANGE = "optionsPageConfigChange";
export const CMD_CONTENT_SCRIPT_GET_CONFIG = "contentScriptGetConfig";
export const CMD_TOGGLE_FT_ACTIVE_TAB = "toggle-ft-active-tab";
export const CMD_TRIGGER_FT_ACTIVE_TAB = "trigger-ft-active-tab";
export const CMD_TOGGLE_FT_ACTIVE_LANG = "toggle-ft-active-lang";

// Config Keys
export const KEY_AUTOCOMPLETE = "autocomplete";
export const KEY_AUTOCOMPLETE_ON_ENTER = "autocompleteOnEnter";
export const KEY_AUTOCOMPLETE_ON_TAB = "autocompleteOnTab";
export const KEY_SELECT_BY_DIGIT = "selectByDigit";
export const KEY_LANG = "lang";
export const KEY_AUTOCOMPLETE_SEPARATOR_SOURCE = "autocompleteSeparatorSource";
export const KEY_MIN_WORD_LENGTH_TO_PREDICT = "minWordLengthToPredict";
export const KEY_REVERT_ON_BACKSPACE = "revertOnBackspace";
export const KEY_NUM_SUGGESTIONS = "numSuggestions";
export const KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE = "insertSpaceAfterAutocomplete";
export const KEY_AUTO_CAPITALIZE = "autoCapitalize";
export const KEY_APPLY_SPACING_RULES = "applySpacingRules";
export const KEY_TEXT_EXPANSIONS = "textExpansions";
export const KEY_VARIABLE_EXPANSION = "variableExpansion";
export const KEY_TIME_FORMAT = "timeFormat";
export const KEY_DATE_FORMAT = "dateFormat";
export const KEY_USER_DICTIONARY_LIST = "userDictionaryList";
export const KEY_LANGUAGE = "language";
export const KEY_FALLBACK_LANGUAGE = "fallbackLanguage";
export const KEY_DOMAIN_LIST_MODE = "domainListMode";
