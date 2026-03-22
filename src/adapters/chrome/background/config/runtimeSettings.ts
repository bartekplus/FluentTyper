import { MAX_NUM_SUGGESTIONS } from "@core/domain/constants";
import type { SettingsManager } from "@core/application/settingsManager";
import {
  getSiteProfileForDomain,
  resolveSiteProfiles,
  setSiteProfileForDomain,
} from "@core/domain/siteProfiles";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { SiteProfileRepository } from "@core/application/repositories/SiteProfileRepository";
import { sanitizeAutoLanguageSitePriors } from "@core/domain/autoLanguageDetection";

export interface DomainRuntimeSettings {
  language: string;
  enabledLanguages: string[];
  inlineSuggestion: boolean;
  preferNativeAutocomplete: boolean;
  numSuggestions: number;
  hasNumSuggestionsOverride: boolean;
}

interface LanguageState {
  language: string;
  enabledLanguages: string[];
}

export function clampNumSuggestions(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(value)));
}

async function resolveLanguageState(settingsManager: SettingsManager): Promise<LanguageState> {
  const settingsRepository = new CoreSettingsRepository(settingsManager);
  const [currentLanguage, enabledLanguages] = await Promise.all([
    settingsRepository.getLanguage(),
    settingsRepository.getEnabledLanguages(),
  ]);
  if (currentLanguage === "auto_detect" && enabledLanguages.length > 1) {
    return {
      language: currentLanguage,
      enabledLanguages,
    };
  }
  if (enabledLanguages.includes(currentLanguage)) {
    return {
      language: currentLanguage,
      enabledLanguages,
    };
  }
  const fallbackLanguage = enabledLanguages[0];
  await settingsRepository.setLanguage(fallbackLanguage);
  return {
    language: fallbackLanguage,
    enabledLanguages,
  };
}

export async function resolveActiveLanguage(settingsManager: SettingsManager): Promise<string> {
  return (await resolveLanguageState(settingsManager)).language;
}

export async function resolveDomainRuntimeSettings(
  settingsManager: SettingsManager,
  domainURL?: string,
): Promise<DomainRuntimeSettings> {
  const settingsRepository = new CoreSettingsRepository(settingsManager);
  const siteProfileRepository = new SiteProfileRepository(settingsManager);
  const [languageState, inlineSuggestionGlobal, preferNativeAutocompleteGlobal, numGlobal, siteProfilesRaw] =
    await Promise.all([
      resolveLanguageState(settingsManager),
      settingsRepository.getInlineSuggestion(),
      settingsRepository.getPreferNativeAutocomplete(),
      settingsRepository.getNumSuggestions(),
      siteProfileRepository.getSiteProfiles(),
    ]);
  const profile = domainURL
    ? getSiteProfileForDomain(siteProfilesRaw, domainURL, languageState.enabledLanguages)
    : undefined;

  const language = profile?.language ?? languageState.language;
  const inlineSuggestion =
    typeof profile?.inline_suggestion === "boolean"
      ? profile.inline_suggestion
      : inlineSuggestionGlobal;
  const preferNativeAutocomplete =
    typeof profile?.preferNativeAutocomplete === "boolean"
      ? profile.preferNativeAutocomplete
      : preferNativeAutocompleteGlobal;
  const hasNumSuggestionsOverride = typeof profile?.numSuggestions === "number";
  const numSuggestions = clampNumSuggestions(
    hasNumSuggestionsOverride ? profile?.numSuggestions : numGlobal,
  );

  return {
    language,
    enabledLanguages: languageState.enabledLanguages,
    inlineSuggestion,
    preferNativeAutocomplete,
    numSuggestions,
    hasNumSuggestionsOverride,
  };
}

export async function sanitizeSiteProfilesSetting(settingsManager: SettingsManager): Promise<void> {
  const settingsRepository = new CoreSettingsRepository(settingsManager);
  const siteProfileRepository = new SiteProfileRepository(settingsManager);
  const [siteProfilesRaw, enabledLanguages] = await Promise.all([
    siteProfileRepository.getRawSiteProfiles(),
    settingsRepository.getEnabledLanguages(),
  ]);
  const sanitizedSiteProfiles = resolveSiteProfiles(siteProfilesRaw, enabledLanguages);
  if (JSON.stringify(siteProfilesRaw || {}) !== JSON.stringify(sanitizedSiteProfiles)) {
    await siteProfileRepository.setSiteProfiles(sanitizedSiteProfiles);
  }
}

export async function sanitizeAutoLanguagePriorsSetting(
  settingsManager: SettingsManager,
): Promise<void> {
  const settingsRepository = new CoreSettingsRepository(settingsManager);
  const [priorsRaw, enabledLanguages] = await Promise.all([
    settingsRepository.getAutoLanguageSitePriors(),
    settingsRepository.getEnabledLanguages(),
  ]);
  const sanitizedPriors = sanitizeAutoLanguageSitePriors(priorsRaw, enabledLanguages);
  if (JSON.stringify(priorsRaw || {}) !== JSON.stringify(sanitizedPriors)) {
    await settingsRepository.setAutoLanguageSitePriors(sanitizedPriors);
  }
}

export async function rotateLanguageForDomain(
  settingsManager: SettingsManager,
  domainURL: string | undefined,
): Promise<string> {
  const settingsRepository = new CoreSettingsRepository(settingsManager);
  const siteProfileRepository = new SiteProfileRepository(settingsManager);
  const availableLangs = await settingsRepository.getEnabledLanguages();
  const domainSettings = await resolveDomainRuntimeSettings(settingsManager, domainURL);

  const currentLanguage = domainSettings.language;
  const currentLangIndex = availableLangs.indexOf(currentLanguage);
  const nextLangIndex = (currentLangIndex >= 0 ? currentLangIndex + 1 : 0) % availableLangs.length;
  const nextLang = availableLangs[nextLangIndex];

  const siteProfilesRaw = await siteProfileRepository.getRawSiteProfiles();
  const profile = domainURL
    ? getSiteProfileForDomain(siteProfilesRaw, domainURL, availableLangs)
    : undefined;

  if (profile && domainURL) {
    await siteProfileRepository.setSiteProfiles(
      setSiteProfileForDomain(
        siteProfilesRaw,
        domainURL,
        { ...profile, language: nextLang },
        availableLangs,
      ),
    );
  } else {
    await settingsRepository.setLanguage(nextLang);
  }

  return nextLang;
}
