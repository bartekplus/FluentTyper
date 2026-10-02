import type { FieldPreference } from "../fieldPreferences";
import type { PreferredTerminology } from "../grammar/review/preferredTerminology";
import type { GrammarRuleOverrides } from "../grammar/GrammarRuleSettings";
import {
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
  KEY_OBSERVABILITY_ENABLED,
  KEY_OBSERVABILITY_MODULE_OVERRIDES,
  KEY_AUTO_LANGUAGE_SITE_PRIORS,
  KEY_AUTO_CAPITALIZE,
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_DATE_FORMAT,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_SHOW_SUGGESTION_FOOTER,
  KEY_SHOW_REVIEW_BUTTON,
  KEY_LIVE_GRAMMAR_PROPOSALS,
  KEY_LOCAL_AI_REVIEW_ENABLED,
  KEY_LOCAL_AI_REVIEW_TIER,
  KEY_LOCAL_AI_REVIEW_CONSENT,
  KEY_LOCAL_AI_SETUP_OFFER_DISMISSED,
  KEY_DOMAIN_LIST_MODE,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_REVIEW_RULE_OVERRIDES,
  KEY_PREFERRED_TERMINOLOGY,
  KEY_REVIEW_LONG_SENTENCE_WORDS,
  KEY_ENABLED_LANGUAGES,
  KEY_EXTENSION_LANGUAGE,
  KEY_FALLBACK_LANGUAGE,
  KEY_INLINE_SUGGESTION,
  KEY_PREFIX_ONLY_MODE,
  KEY_PERSONALIZATION_ENABLED,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_LANGUAGE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
  KEY_CODE_MODE,
  KEY_PRODUCTIVITY_STATS,
  KEY_SELECT_BY_DIGIT,
  KEY_HORIZONTAL_SUGGESTIONS,
  KEY_SITE_PROFILES,
  KEY_FIELD_PREFERENCES,
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
import type { LogLevel, ObservabilityModuleOverride } from "../observability";
import type { SiteProfiles } from "../siteProfiles";

const SETTINGS_KEYS = {
  fieldPreferences: KEY_FIELD_PREFERENCES,
  enabled: "enable",
  domainList: "domainBlackList",
  domainListMode: KEY_DOMAIN_LIST_MODE,
  language: KEY_LANGUAGE,
  fallbackLanguage: KEY_FALLBACK_LANGUAGE,
  enabledLanguages: KEY_ENABLED_LANGUAGES,
  inlineSuggestion: KEY_INLINE_SUGGESTION,
  prefixOnlyMode: KEY_PREFIX_ONLY_MODE,
  personalizationEnabled: KEY_PERSONALIZATION_ENABLED,
  preferNativeAutocomplete: KEY_PREFER_NATIVE_AUTOCOMPLETE,
  codeMode: KEY_CODE_MODE,
  numSuggestions: KEY_NUM_SUGGESTIONS,
  minWordLengthToPredict: KEY_MIN_WORD_LENGTH_TO_PREDICT,
  autocomplete: KEY_AUTOCOMPLETE,
  autocompleteOnEnter: KEY_AUTOCOMPLETE_ON_ENTER,
  autocompleteOnTab: KEY_AUTOCOMPLETE_ON_TAB,
  selectByDigit: KEY_SELECT_BY_DIGIT,
  horizontalSuggestions: KEY_HORIZONTAL_SUGGESTIONS,
  showSuggestionFooter: KEY_SHOW_SUGGESTION_FOOTER,
  showReviewButton: KEY_SHOW_REVIEW_BUTTON,
  liveGrammarProposals: KEY_LIVE_GRAMMAR_PROPOSALS,
  localAiReviewEnabled: KEY_LOCAL_AI_REVIEW_ENABLED,
  localAiReviewTier: KEY_LOCAL_AI_REVIEW_TIER,
  localAiReviewConsent: KEY_LOCAL_AI_REVIEW_CONSENT,
  localAiSetupOfferDismissed: KEY_LOCAL_AI_SETUP_OFFER_DISMISSED,
  autoCapitalize: KEY_AUTO_CAPITALIZE,
  autoLanguageSitePriors: KEY_AUTO_LANGUAGE_SITE_PRIORS,
  insertSpaceAfterAutocomplete: KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  textExpansions: KEY_TEXT_EXPANSIONS,

  timeFormat: KEY_TIME_FORMAT,
  dateFormat: KEY_DATE_FORMAT,
  userDictionaryList: KEY_USER_DICTIONARY_LIST,
  extensionLanguage: KEY_EXTENSION_LANGUAGE,
  siteProfiles: KEY_SITE_PROFILES,
  debugPresagePredictorEnabled: KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  observabilityEnabled: KEY_OBSERVABILITY_ENABLED,
  observabilityDefaultLevel: KEY_OBSERVABILITY_DEFAULT_LEVEL,
  observabilityModuleOverrides: KEY_OBSERVABILITY_MODULE_OVERRIDES,
  productivityStats: KEY_PRODUCTIVITY_STATS,
  enabledGrammarRules: KEY_ENABLED_GRAMMAR_RULES,
  reviewRuleOverrides: KEY_REVIEW_RULE_OVERRIDES,
  preferredTerminology: KEY_PREFERRED_TERMINOLOGY,
  reviewLongSentenceWords: KEY_REVIEW_LONG_SENTENCE_WORDS,
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
  fieldPreferences: FieldPreference[];
  enabled: boolean;
  domainList: string[];
  domainListMode: DomainListMode;
  language: string;
  fallbackLanguage: string;
  enabledLanguages: string[];
  inlineSuggestion: boolean;
  prefixOnlyMode: boolean;
  personalizationEnabled: boolean;
  preferNativeAutocomplete: boolean;
  codeMode: boolean;
  numSuggestions: number;
  minWordLengthToPredict: number;
  autocomplete: boolean;
  autocompleteOnEnter: boolean;
  autocompleteOnTab: boolean;
  selectByDigit: boolean;
  horizontalSuggestions: boolean;
  showSuggestionFooter: boolean;
  showReviewButton: boolean;
  liveGrammarProposals: boolean;
  localAiReviewEnabled: boolean;
  localAiReviewTier: "standard" | "compact";
  /** Written only by the explicit Install action; never inferred or migrated. */
  localAiReviewConsent: { modelId: string; tier: "standard" | "compact"; at: number } | null;
  localAiSetupOfferDismissed: boolean;
  autoCapitalize: boolean;
  autoLanguageSitePriors: Record<string, Record<string, number>>;
  insertSpaceAfterAutocomplete: boolean;
  textExpansions: Array<[string, object]>;

  timeFormat: string;
  dateFormat: string;
  userDictionaryList: string[];
  extensionLanguage: string;
  siteProfiles: SiteProfiles;
  debugPresagePredictorEnabled: boolean;
  observabilityEnabled: boolean;
  observabilityDefaultLevel: LogLevel;
  observabilityModuleOverrides: Record<string, ObservabilityModuleOverride>;
  productivityStats: Record<string, unknown>;
  enabledGrammarRules: GrammarRuleOverrides | string[];
  reviewRuleOverrides: Record<string, boolean>;
  preferredTerminology: PreferredTerminology;
  reviewLongSentenceWords: number;
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

const CANONICAL_BY_STORAGE_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(ALIASES_BY_CANONICAL).flatMap(([canonical, aliases]) =>
    [canonical, ...aliases].map((key) => [key, canonical]),
  ),
);

export function getSettingStorageKey(field: SettingField): string {
  return SETTINGS_KEYS[field];
}

export function getSettingStorageAliases(field: SettingField): string[] {
  const canonical = SETTINGS_KEYS[field];
  return [canonical, ...getAliasesForCanonicalSettingKey(canonical)];
}

export function resolveCanonicalSettingKey(key: string): string {
  return CANONICAL_BY_STORAGE_KEY[key] || key;
}

export function getAliasesForCanonicalSettingKey(canonicalKey: string): string[] {
  return ALIASES_BY_CANONICAL[canonicalKey] || [];
}

export function getAliasedSettingFields(): SettingField[] {
  return (Object.keys(SETTINGS_KEYS) as SettingField[]).filter(
    (field) => getAliasesForCanonicalSettingKey(SETTINGS_KEYS[field]).length > 0,
  );
}
