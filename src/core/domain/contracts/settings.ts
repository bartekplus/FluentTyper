import {
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_AI_PREDICTOR_ENABLED,
  KEY_AUTO_CAPITALIZE,
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_DATE_FORMAT,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_DISPLAY_LANG_HEADER,
  KEY_DOMAIN_LIST_MODE,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_ENABLED_LANGUAGES,
  KEY_EXTENSION_LANGUAGE,
  KEY_FALLBACK_LANGUAGE,
  KEY_INLINE_SUGGESTION,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_LANGUAGE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_PRODUCTIVITY_STATS,
  KEY_REVERT_ON_BACKSPACE,
  KEY_SELECT_BY_DIGIT,
  KEY_SITE_PROFILES,
  KEY_TEXT_EXPANSIONS,
  KEY_TIME_FORMAT,
  KEY_SUGGESTION_BG_DARK,
  KEY_SUGGESTION_BG_LIGHT,
  KEY_SUGGESTION_BORDER_DARK,
  KEY_SUGGESTION_BORDER_LIGHT,
  KEY_SUGGESTION_FONT_SIZE,
  KEY_SUGGESTION_HIGHLIGHT_BG_DARK,
  KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
  KEY_SUGGESTION_PADDING_HORIZONTAL,
  KEY_SUGGESTION_PADDING_VERTICAL,
  KEY_SUGGESTION_TEXT_DARK,
  KEY_SUGGESTION_TEXT_LIGHT,
  KEY_USER_DICTIONARY_LIST,
} from "../constants";
import type { SiteProfiles } from "../siteProfiles";

export const SETTINGS_KEYS = {
  enabled: "enable",
  domainList: "domainBlackList",
  domainListMode: KEY_DOMAIN_LIST_MODE,
  language: KEY_LANGUAGE,
  fallbackLanguage: KEY_FALLBACK_LANGUAGE,
  enabledLanguages: KEY_ENABLED_LANGUAGES,
  inlineSuggestion: KEY_INLINE_SUGGESTION,
  numSuggestions: KEY_NUM_SUGGESTIONS,
  minWordLengthToPredict: KEY_MIN_WORD_LENGTH_TO_PREDICT,
  autocomplete: KEY_AUTOCOMPLETE,
  autocompleteOnEnter: KEY_AUTOCOMPLETE_ON_ENTER,
  autocompleteOnTab: KEY_AUTOCOMPLETE_ON_TAB,
  selectByDigit: KEY_SELECT_BY_DIGIT,
  revertOnBackspace: KEY_REVERT_ON_BACKSPACE,
  displayLangHeader: KEY_DISPLAY_LANG_HEADER,
  autoCapitalize: KEY_AUTO_CAPITALIZE,
  insertSpaceAfterAutocomplete: KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  textExpansions: KEY_TEXT_EXPANSIONS,

  timeFormat: KEY_TIME_FORMAT,
  dateFormat: KEY_DATE_FORMAT,
  userDictionaryList: KEY_USER_DICTIONARY_LIST,
  extensionLanguage: KEY_EXTENSION_LANGUAGE,
  siteProfiles: KEY_SITE_PROFILES,
  aiPredictorEnabled: KEY_AI_PREDICTOR_ENABLED,
  aiModelId: KEY_AI_MODEL_ID,
  aiPredictionTimeoutMs: KEY_AI_PREDICTION_TIMEOUT_MS,
  debugPresagePredictorEnabled: KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  debugAiPredictorEnabled: KEY_DEBUG_AI_PREDICTOR_ENABLED,
  productivityStats: KEY_PRODUCTIVITY_STATS,
  enabledGrammarRules: KEY_ENABLED_GRAMMAR_RULES,
  suggestionBgLight: KEY_SUGGESTION_BG_LIGHT,
  suggestionTextLight: KEY_SUGGESTION_TEXT_LIGHT,
  suggestionHighlightBgLight: KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
  suggestionHighlightTextLight: KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
  suggestionBorderLight: KEY_SUGGESTION_BORDER_LIGHT,
  suggestionBgDark: KEY_SUGGESTION_BG_DARK,
  suggestionTextDark: KEY_SUGGESTION_TEXT_DARK,
  suggestionHighlightBgDark: KEY_SUGGESTION_HIGHLIGHT_BG_DARK,
  suggestionHighlightTextDark: KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK,
  suggestionBorderDark: KEY_SUGGESTION_BORDER_DARK,
  suggestionFontSize: KEY_SUGGESTION_FONT_SIZE,
  suggestionPaddingVertical: KEY_SUGGESTION_PADDING_VERTICAL,
  suggestionPaddingHorizontal: KEY_SUGGESTION_PADDING_HORIZONTAL,
} as const;

export type SettingField = keyof typeof SETTINGS_KEYS;
export type DomainListMode = "blackList" | "whiteList";

export interface SettingsSchema {
  enabled: boolean;
  domainList: string[];
  domainListMode: DomainListMode;
  language: string;
  fallbackLanguage: string;
  enabledLanguages: string[];
  inlineSuggestion: boolean;
  numSuggestions: number;
  minWordLengthToPredict: number;
  autocomplete: boolean;
  autocompleteOnEnter: boolean;
  autocompleteOnTab: boolean;
  selectByDigit: boolean;
  revertOnBackspace: boolean;
  displayLangHeader: boolean;
  autoCapitalize: boolean;
  insertSpaceAfterAutocomplete: boolean;
  textExpansions: Array<[string, object]>;

  timeFormat: string;
  dateFormat: string;
  userDictionaryList: string[];
  extensionLanguage: string;
  siteProfiles: SiteProfiles;
  aiPredictorEnabled: boolean;
  aiModelId: string;
  aiPredictionTimeoutMs: number;
  debugPresagePredictorEnabled: boolean;
  debugAiPredictorEnabled: boolean;
  productivityStats: Record<string, unknown>;
  enabledGrammarRules: string[];
  suggestionBgLight: string;
  suggestionTextLight: string;
  suggestionHighlightBgLight: string;
  suggestionHighlightTextLight: string;
  suggestionBorderLight: string;
  suggestionBgDark: string;
  suggestionTextDark: string;
  suggestionHighlightBgDark: string;
  suggestionHighlightTextDark: string;
  suggestionBorderDark: string;
  suggestionFontSize: string;
  suggestionPaddingVertical: string;
  suggestionPaddingHorizontal: string;
}

const ALIASES_BY_CANONICAL: Record<string, string[]> = {
  [SETTINGS_KEYS.enabled]: ["enabled"],
  [SETTINGS_KEYS.suggestionBgLight]: ["tributeBgLight"],
  [SETTINGS_KEYS.suggestionTextLight]: ["tributeTextLight"],
  [SETTINGS_KEYS.suggestionHighlightBgLight]: ["tributeHighlightBgLight"],
  [SETTINGS_KEYS.suggestionHighlightTextLight]: ["tributeHighlightTextLight"],
  [SETTINGS_KEYS.suggestionBorderLight]: ["tributeBorderLight"],
  [SETTINGS_KEYS.suggestionBgDark]: ["tributeBgDark"],
  [SETTINGS_KEYS.suggestionTextDark]: ["tributeTextDark"],
  [SETTINGS_KEYS.suggestionHighlightBgDark]: ["tributeHighlightBgDark"],
  [SETTINGS_KEYS.suggestionHighlightTextDark]: ["tributeHighlightTextDark"],
  [SETTINGS_KEYS.suggestionBorderDark]: ["tributeBorderDark"],
  [SETTINGS_KEYS.suggestionFontSize]: ["tributeFontSize"],
  [SETTINGS_KEYS.suggestionPaddingVertical]: ["tributePaddingVertical"],
  [SETTINGS_KEYS.suggestionPaddingHorizontal]: ["tributePaddingHorizontal"],
};

export function getSettingStorageKey(field: SettingField): string {
  return SETTINGS_KEYS[field];
}

export function getSettingStorageAliases(field: SettingField): string[] {
  const canonical = SETTINGS_KEYS[field];
  return [canonical, ...(ALIASES_BY_CANONICAL[canonical] || [])];
}

export function resolveCanonicalSettingKey(key: string): string {
  for (const [canonical, aliases] of Object.entries(ALIASES_BY_CANONICAL)) {
    if (key === canonical || aliases.includes(key)) {
      return canonical;
    }
  }
  return key;
}

export function getAliasesForCanonicalSettingKey(canonicalKey: string): string[] {
  return ALIASES_BY_CANONICAL[canonicalKey] || [];
}

export function getAliasedSettingFields(): SettingField[] {
  return (Object.keys(SETTINGS_KEYS) as SettingField[]).filter((field) => {
    const canonical = SETTINGS_KEYS[field];
    return (ALIASES_BY_CANONICAL[canonical] || []).length > 0;
  });
}
