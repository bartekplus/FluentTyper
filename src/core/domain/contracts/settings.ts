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
  KEY_TRIBUTE_BG_DARK,
  KEY_TRIBUTE_BG_LIGHT,
  KEY_TRIBUTE_BORDER_DARK,
  KEY_TRIBUTE_BORDER_LIGHT,
  KEY_TRIBUTE_FONT_SIZE,
  KEY_TRIBUTE_HIGHLIGHT_BG_DARK,
  KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT,
  KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK,
  KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT,
  KEY_TRIBUTE_PADDING_HORIZONTAL,
  KEY_TRIBUTE_PADDING_VERTICAL,
  KEY_TRIBUTE_TEXT_DARK,
  KEY_TRIBUTE_TEXT_LIGHT,
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
  tributeBgLight: KEY_TRIBUTE_BG_LIGHT,
  tributeTextLight: KEY_TRIBUTE_TEXT_LIGHT,
  tributeHighlightBgLight: KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT,
  tributeHighlightTextLight: KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT,
  tributeBorderLight: KEY_TRIBUTE_BORDER_LIGHT,
  tributeBgDark: KEY_TRIBUTE_BG_DARK,
  tributeTextDark: KEY_TRIBUTE_TEXT_DARK,
  tributeHighlightBgDark: KEY_TRIBUTE_HIGHLIGHT_BG_DARK,
  tributeHighlightTextDark: KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK,
  tributeBorderDark: KEY_TRIBUTE_BORDER_DARK,
  tributeFontSize: KEY_TRIBUTE_FONT_SIZE,
  tributePaddingVertical: KEY_TRIBUTE_PADDING_VERTICAL,
  tributePaddingHorizontal: KEY_TRIBUTE_PADDING_HORIZONTAL,
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
  tributeBgLight: string;
  tributeTextLight: string;
  tributeHighlightBgLight: string;
  tributeHighlightTextLight: string;
  tributeBorderLight: string;
  tributeBgDark: string;
  tributeTextDark: string;
  tributeHighlightBgDark: string;
  tributeHighlightTextDark: string;
  tributeBorderDark: string;
  tributeFontSize: string;
  tributePaddingVertical: string;
  tributePaddingHorizontal: string;
}

const ALIASES_BY_CANONICAL: Record<string, string[]> = {
  [SETTINGS_KEYS.enabled]: ["enabled"],
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
