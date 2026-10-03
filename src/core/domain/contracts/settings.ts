import type { FieldPreference } from "../fieldPreferences";
import type { PreferredTerminology } from "../grammar/review/preferredTerminology";
import type { GrammarRuleOverrides } from "../grammar/GrammarRuleSettings";
import { KEY_ENABLED_LANGUAGES, KEY_INLINE_SUGGESTION } from "../constants";
import type { LogLevel, ObservabilityModuleOverride } from "../observability";
import type { SiteProfiles } from "../siteProfiles";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "../themeDefaults";

export type SettingField = keyof SettingsSchema;
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

/** Fields whose storage key is not the field name. */
const RENAMED_STORAGE_KEYS: Partial<Record<SettingField, string>> = {
  enabled: "enable",
  domainList: "domainBlackList",
  enabledLanguages: KEY_ENABLED_LANGUAGES,
  inlineSuggestion: KEY_INLINE_SUGGESTION,
};

const ALIASES_BY_FIELD: Partial<Record<SettingField, string[]>> = {
  enabled: ["enabled"],
  ...Object.fromEntries(
    Object.keys(DEFAULT_SUGGESTION_THEME_SETTINGS).map((field) => [
      field,
      ["tribute" + field.slice("suggestion".length)],
    ]),
  ),
};

const ALIASES_BY_CANONICAL: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALIASES_BY_FIELD).map(([field, aliases]) => [
    getSettingStorageKey(field as SettingField),
    aliases,
  ]),
);

const CANONICAL_BY_STORAGE_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(ALIASES_BY_CANONICAL).flatMap(([canonical, aliases]) =>
    [canonical, ...aliases].map((key) => [key, canonical]),
  ),
);

export function getSettingStorageKey(field: SettingField): string {
  return RENAMED_STORAGE_KEYS[field] ?? field;
}

export function getSettingStorageAliases(field: SettingField): string[] {
  const canonical = getSettingStorageKey(field);
  return [canonical, ...getAliasesForCanonicalSettingKey(canonical)];
}

export function resolveCanonicalSettingKey(key: string): string {
  return CANONICAL_BY_STORAGE_KEY[key] || key;
}

export function getAliasesForCanonicalSettingKey(canonicalKey: string): string[] {
  return ALIASES_BY_CANONICAL[canonicalKey] || [];
}

export function getAliasedSettingFields(): SettingField[] {
  return Object.keys(ALIASES_BY_FIELD) as SettingField[];
}
