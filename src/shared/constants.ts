// Centralized constants for command strings and config keys
// filepath: /Users/bartosztomczyk/Devel/FluentTyper/src/shared/constants.js

// Command Strings
export const CMD_CONTENT_SCRIPT_PREDICT_REQ = "CMD_CONTENT_SCRIPT_PREDICT_REQ";
export const CMD_BACKGROUND_PAGE_PREDICT_RESP =
  "CMD_BACKGROUND_PAGE_PREDICT_RESP";
export const CMD_BACKGROUND_PAGE_PREDICT_REQ =
  "CMD_BACKGROUND_PAGE_PREDICT_REQ";
export const CMD_BACKGROUND_PAGE_SET_CONFIG = "CMD_BACKGROUND_PAGE_SET_CONFIG";
export const CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG =
  "CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG";
export const CMD_OPTIONS_PAGE_CONFIG_CHANGE = "CMD_OPTIONS_PAGE_CONFIG_CHANGE";
export const CMD_CONTENT_SCRIPT_GET_CONFIG = "CMD_CONTENT_SCRIPT_GET_CONFIG";
export const CMD_TOGGLE_FT_ACTIVE_TAB = "CMD_TOGGLE_FT_ACTIVE_TAB";
export const CMD_TRIGGER_FT_ACTIVE_TAB = "CMD_TRIGGER_FT_ACTIVE_TAB";
export const CMD_TOGGLE_FT_ACTIVE_LANG = "CMD_TOGGLE_FT_ACTIVE_LANG";

// Config Keys
export const KEY_AUTOCOMPLETE = "autocomplete";
export const KEY_AUTOCOMPLETE_ON_ENTER = "autocompleteOnEnter";
export const KEY_AUTOCOMPLETE_ON_TAB = "autocompleteOnTab";
export const KEY_SELECT_BY_DIGIT = "selectByDigit";
export const KEY_AUTOCOMPLETE_SEPARATOR_SOURCE = "autocompleteSeparatorSource";
export const KEY_MIN_WORD_LENGTH_TO_PREDICT = "minWordLengthToPredict";
export const KEY_REVERT_ON_BACKSPACE = "revertOnBackspace";
export const KEY_NUM_SUGGESTIONS = "numSuggestions";
export const KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE =
  "insertSpaceAfterAutocomplete";
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
export const KEY_DISPLAY_LANG_HEADER = "displayLangHeader";
export const KEY_ENABLED = "enabled";

// Popup Commands
export const CMD_POPUP_PAGE_ENABLE = "CMD_POPUP_PAGE_ENABLE";
export const CMD_POPUP_PAGE_DISABLE = "CMD_POPUP_PAGE_DISABLE";
export const CMD_STATUS_COMMAND = "CMD_STATUS_COMMAND";
