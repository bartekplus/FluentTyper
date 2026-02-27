import {
  DEFAULT_AI_PREDICTION_TIMEOUT_MS,
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_LANGUAGE,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
  MAX_NUM_SUGGESTIONS,
} from "../../shared/constants";
import { resolveEnabledLanguages } from "../../shared/lang";
import type { JsonValue, SettingsManager } from "../../shared/settingsManager";
import {
  getSiteProfileForDomain,
  resolveSiteProfiles,
  setSiteProfileForDomain,
} from "../../shared/siteProfiles";

export interface DomainRuntimeSettings {
  language: string;
  enabledLanguages: string[];
  inlineSuggestion: boolean;
  numSuggestions: number;
  hasNumSuggestionsOverride: boolean;
}

export function clampNumSuggestions(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(value)));
}

export function clampAIPredictionTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AI_PREDICTION_TIMEOUT_MS;
  }
  return Math.min(2000, Math.max(20, Math.round(value)));
}

export async function getEnabledLanguages(
  settingsManager: SettingsManager,
): Promise<string[]> {
  const enabledLanguages = await settingsManager.get(KEY_ENABLED_LANGUAGES);
  return resolveEnabledLanguages(enabledLanguages);
}

export async function resolveActiveLanguage(
  settingsManager: SettingsManager,
): Promise<string> {
  const [language, enabledLanguagesRaw] = await Promise.all([
    settingsManager.get(KEY_LANGUAGE),
    settingsManager.get(KEY_ENABLED_LANGUAGES),
  ]);
  const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
  const currentLanguage = typeof language === "string" ? language : "";
  const allowAutoDetect = enabledLanguages.length > 1;
  if (currentLanguage === "auto_detect" && allowAutoDetect) {
    return currentLanguage;
  }
  if (enabledLanguages.includes(currentLanguage)) {
    return currentLanguage;
  }
  const fallbackLanguage = enabledLanguages[0];
  await settingsManager.set(KEY_LANGUAGE, fallbackLanguage);
  return fallbackLanguage;
}

export async function resolveDomainRuntimeSettings(
  settingsManager: SettingsManager,
  domainURL?: string,
): Promise<DomainRuntimeSettings> {
  const [globalLanguage, enabledLanguages, inlineSuggestionGlobal, numGlobal] =
    await Promise.all([
      resolveActiveLanguage(settingsManager),
      getEnabledLanguages(settingsManager),
      settingsManager.get(KEY_INLINE_SUGGESTION),
      settingsManager.get(KEY_NUM_SUGGESTIONS),
    ]);
  const siteProfilesRaw = await settingsManager.get(KEY_SITE_PROFILES);
  const profile = domainURL
    ? getSiteProfileForDomain(siteProfilesRaw, domainURL, enabledLanguages)
    : undefined;

  const language = profile?.language ?? globalLanguage;
  const inlineSuggestion =
    typeof profile?.inline_suggestion === "boolean"
      ? profile.inline_suggestion
      : Boolean(inlineSuggestionGlobal);
  const hasNumSuggestionsOverride = typeof profile?.numSuggestions === "number";
  const numSuggestions = clampNumSuggestions(
    hasNumSuggestionsOverride ? profile?.numSuggestions : numGlobal,
  );

  return {
    language,
    enabledLanguages,
    inlineSuggestion,
    numSuggestions,
    hasNumSuggestionsOverride,
  };
}

export async function sanitizeSiteProfilesSetting(
  settingsManager: SettingsManager,
): Promise<void> {
  const [siteProfilesRaw, enabledLanguagesRaw] = await Promise.all([
    settingsManager.get(KEY_SITE_PROFILES),
    settingsManager.get(KEY_ENABLED_LANGUAGES),
  ]);
  const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
  const sanitizedSiteProfiles = resolveSiteProfiles(
    siteProfilesRaw,
    enabledLanguages,
  );
  if (
    JSON.stringify(siteProfilesRaw || {}) !== JSON.stringify(sanitizedSiteProfiles)
  ) {
    await settingsManager.set(
      KEY_SITE_PROFILES,
      sanitizedSiteProfiles as unknown as JsonValue,
    );
  }
}

export async function rotateLanguageForDomain(
  settingsManager: SettingsManager,
  domainURL: string | undefined,
): Promise<string> {
  const availableLangs = await getEnabledLanguages(settingsManager);
  const domainSettings = await resolveDomainRuntimeSettings(
    settingsManager,
    domainURL,
  );

  const currentLanguage = domainSettings.language;
  const currentLangIndex = availableLangs.indexOf(currentLanguage);
  const nextLangIndex =
    (currentLangIndex >= 0 ? currentLangIndex + 1 : 0) % availableLangs.length;
  const nextLang = availableLangs[nextLangIndex];

  const siteProfilesRaw = await settingsManager.get(KEY_SITE_PROFILES);
  const profile = domainURL
    ? getSiteProfileForDomain(siteProfilesRaw, domainURL, availableLangs)
    : undefined;

  if (profile && domainURL) {
    await settingsManager.set(
      KEY_SITE_PROFILES,
      setSiteProfileForDomain(
        siteProfilesRaw,
        domainURL,
        { ...profile, language: nextLang },
        availableLangs,
      ) as unknown as JsonValue,
    );
  } else {
    await settingsManager.set(KEY_LANGUAGE, nextLang);
  }

  return nextLang;
}
