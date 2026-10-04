import type { SettingsManager } from "@core/application/settingsManager";
import {
  getSiteProfileForDomain,
  normalizeNumSuggestions,
  resolveSiteProfiles,
  setSiteProfileForDomain,
} from "@core/domain/siteProfiles";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { SiteProfileRepository } from "@core/application/repositories/SiteProfileRepository";
import { sanitizeAutoLanguageSitePriors } from "@core/domain/autoLanguageDetection";
import { resolvePrimaryLanguage } from "@core/domain/lang";

export interface DomainRuntimeSettings {
  language: string;
  enabledLanguages: string[];
  inlineSuggestion: boolean;
  preferNativeAutocomplete: boolean;
  codeMode: boolean;
  numSuggestions: number;
  hasNumSuggestionsOverride: boolean;
}

interface LanguageState {
  language: string;
  enabledLanguages: string[];
}

async function resolveLanguageState(settingsManager: SettingsManager): Promise<LanguageState> {
  const settingsRepository = new CoreSettingsRepository(settingsManager);
  const [currentLanguage, enabledLanguages] = await Promise.all([
    settingsRepository.getLanguage(),
    settingsRepository.getEnabledLanguages(),
  ]);
  const language = resolvePrimaryLanguage(currentLanguage, enabledLanguages);
  if (language !== currentLanguage) {
    await settingsRepository.setLanguage(language);
  }
  return { language, enabledLanguages };
}

export async function resolveDomainRuntimeSettings(
  settingsManager: SettingsManager,
  domainURL?: string,
): Promise<DomainRuntimeSettings> {
  const settingsRepository = new CoreSettingsRepository(settingsManager);
  const siteProfileRepository = new SiteProfileRepository(settingsManager);
  const [
    languageState,
    inlineSuggestionGlobal,
    preferNativeAutocompleteGlobal,
    codeModeGlobal,
    numGlobal,
    siteProfilesRaw,
  ] = await Promise.all([
    resolveLanguageState(settingsManager),
    settingsRepository.getInlineSuggestion(),
    settingsRepository.getPreferNativeAutocomplete(),
    settingsRepository.getCodeMode(),
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
  const codeMode = typeof profile?.codeMode === "boolean" ? profile.codeMode : codeModeGlobal;
  const hasNumSuggestionsOverride = typeof profile?.numSuggestions === "number";
  const numSuggestions =
    normalizeNumSuggestions(hasNumSuggestionsOverride ? profile?.numSuggestions : numGlobal) ?? 0;

  return {
    language,
    enabledLanguages: languageState.enabledLanguages,
    inlineSuggestion,
    preferNativeAutocomplete,
    codeMode,
    numSuggestions,
    hasNumSuggestionsOverride,
  };
}

/** Makes the stored site profiles and auto-language priors agree with the enabled languages. */
export async function sanitizeLanguageSettings(settingsManager: SettingsManager): Promise<void> {
  const settingsRepository = new CoreSettingsRepository(settingsManager);
  const siteProfileRepository = new SiteProfileRepository(settingsManager);
  const [siteProfilesRaw, priorsRaw, enabledLanguages] = await Promise.all([
    siteProfileRepository.getRawSiteProfiles(),
    settingsRepository.getAutoLanguageSitePriors(),
    settingsRepository.getEnabledLanguages(),
  ]);
  const sanitizedSiteProfiles = resolveSiteProfiles(siteProfilesRaw, enabledLanguages);
  if (JSON.stringify(siteProfilesRaw || {}) !== JSON.stringify(sanitizedSiteProfiles)) {
    await siteProfileRepository.setSiteProfiles(sanitizedSiteProfiles);
  }
  const sanitizedPriors = sanitizeAutoLanguageSitePriors(priorsRaw, enabledLanguages);
  if (JSON.stringify(priorsRaw || {}) !== JSON.stringify(sanitizedPriors)) {
    await settingsRepository.setAutoLanguageSitePriors(sanitizedPriors);
  }
}

export async function rotateLanguageForDomain(
  settingsManager: SettingsManager,
  domainURL: string | undefined,
  domainSettings: Pick<DomainRuntimeSettings, "language" | "enabledLanguages">,
): Promise<string> {
  const settingsRepository = new CoreSettingsRepository(settingsManager);
  const siteProfileRepository = new SiteProfileRepository(settingsManager);
  const { language: currentLanguage, enabledLanguages: availableLangs } = domainSettings;
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
