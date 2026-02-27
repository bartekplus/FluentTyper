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
export const CMD_GET_HOSTNAME = "CMD_GET_HOSTNAME";
export const CMD_CONTENT_SCRIPT_USAGE_EVENT =
  "CMD_CONTENT_SCRIPT_USAGE_EVENT";
export const CMD_POPUP_GET_PRODUCTIVITY_STATS =
  "CMD_POPUP_GET_PRODUCTIVITY_STATS";
export const CMD_POPUP_ACK_WEEKLY_RECAP = "CMD_POPUP_ACK_WEEKLY_RECAP";
export const CMD_POPUP_ACK_DONATION_MILESTONE =
  "CMD_POPUP_ACK_DONATION_MILESTONE";
export const CMD_OPTIONS_RESET_PRODUCTIVITY_STATS =
  "CMD_OPTIONS_RESET_PRODUCTIVITY_STATS";
export const CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT =
  "CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT";
export const CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE =
  "CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE";

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
export const KEY_ENABLED_LANGUAGES = "enabled_languages";
export const KEY_DOMAIN_LIST_MODE = "domainListMode";
export const KEY_AI_PREDICTOR_ENABLED = "aiPredictorEnabled";
export const KEY_AI_MODEL_ID = "aiModelId";
export const KEY_AI_PREDICTION_TIMEOUT_MS = "aiPredictionTimeoutMs";
export const KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED =
  "debugPresagePredictorEnabled";
export const KEY_DEBUG_AI_PREDICTOR_ENABLED = "debugAiPredictorEnabled";
export const KEY_DISPLAY_LANG_HEADER = "displayLangHeader";
export const KEY_INLINE_SUGGESTION = "inline_suggestion";
export const KEY_EXTENSION_LANGUAGE = "extensionLanguage";
export const KEY_ENABLED = "enable";
export const KEY_SITE_PROFILES = "siteProfiles";
export const KEY_PRODUCTIVITY_STATS = "productivityStats";
// Theming Config Keys
export const KEY_USE_DEFAULT_THEME_BTN = "useDefaultThemeBtn";
export const KEY_USE_COMPACT_THEME_BTN = "useCompactThemeBtn";
export const KEY_TRIBUTE_BG_LIGHT = "tributeBgLight";
export const KEY_TRIBUTE_TEXT_LIGHT = "tributeTextLight";
export const KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT = "tributeHighlightBgLight";
export const KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT = "tributeHighlightTextLight";
export const KEY_TRIBUTE_BORDER_LIGHT = "tributeBorderLight";
export const KEY_TRIBUTE_BG_DARK = "tributeBgDark";
export const KEY_TRIBUTE_TEXT_DARK = "tributeTextDark";
export const KEY_TRIBUTE_HIGHLIGHT_BG_DARK = "tributeHighlightBgDark";
export const KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK = "tributeHighlightTextDark";
export const KEY_TRIBUTE_BORDER_DARK = "tributeBorderDark";
export const KEY_TRIBUTE_FONT_SIZE = "tributeFontSize";
export const KEY_TRIBUTE_PADDING_VERTICAL = "tributePaddingVertical";
export const KEY_TRIBUTE_PADDING_HORIZONTAL = "tributePaddingHorizontal";

// Popup Commands
export const CMD_POPUP_PAGE_ENABLE = "CMD_POPUP_PAGE_ENABLE";
export const CMD_POPUP_PAGE_DISABLE = "CMD_POPUP_PAGE_DISABLE";
export const CMD_STATUS_COMMAND = "CMD_STATUS_COMMAND";

export const DEFAULT_NUM_SUGGESTIONS = 5;
export const MAX_NUM_SUGGESTIONS = 10;
export const DEFAULT_AI_PREDICTOR_ENABLED = true;
export const DEFAULT_AI_MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
export const DEFAULT_AI_PREDICTION_TIMEOUT_MS = 120;
export const DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED = true;
export const DEFAULT_DEBUG_AI_PREDICTOR_ENABLED = true;
