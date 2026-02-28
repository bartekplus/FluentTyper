// Handles language detection logic for FluentTyper
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGES_SHORT_CODE,
  resolveEnabledPredictionLanguages,
} from "@core/domain/lang";
import type { SettingsManager } from "@core/application/settingsManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";

export class LanguageDetector {
  private readonly settingsRepository: CoreSettingsRepository;

  constructor(settings: SettingsManager) {
    this.settingsRepository = new CoreSettingsRepository(settings);
  }

  async detectLanguage(text: string, tabId: number, enabledLanguages?: string[]): Promise<string> {
    const fallbackLanguageRaw = await this.settingsRepository.getFallbackLanguage();
    const allowedLanguages = resolveEnabledPredictionLanguages(enabledLanguages);
    const fallbackLanguage =
      fallbackLanguageRaw && fallbackLanguageRaw !== "auto_detect"
        ? fallbackLanguageRaw
        : allowedLanguages[0];
    const allowedSet = new Set(allowedLanguages);
    const globalAny = globalThis as { browser?: typeof chrome };
    const api = typeof globalAny.browser === "undefined" ? chrome : globalAny.browser;
    const result = await api.i18n.detectLanguage(text);
    let detectedLanguage: string | null = null;
    let maxPercentage = -1;
    for (const language of result.languages) {
      let resolvedLanguage: string | null = null;
      if (language.language in SUPPORTED_LANGUAGES) {
        resolvedLanguage = language.language;
      } else if (language.language in SUPPORTED_LANGUAGES_SHORT_CODE) {
        resolvedLanguage = SUPPORTED_LANGUAGES_SHORT_CODE[language.language];
      }
      if (
        resolvedLanguage &&
        allowedSet.has(resolvedLanguage) &&
        language.percentage > maxPercentage
      ) {
        detectedLanguage = resolvedLanguage;
        maxPercentage = language.percentage;
      }
    }
    if (detectedLanguage) {
      return detectedLanguage;
    }
    const pageLang = await api.tabs.detectLanguage(tabId);
    if (pageLang in SUPPORTED_LANGUAGES && allowedSet.has(pageLang)) {
      return pageLang;
    }
    if (
      pageLang in SUPPORTED_LANGUAGES_SHORT_CODE &&
      allowedSet.has(SUPPORTED_LANGUAGES_SHORT_CODE[pageLang])
    ) {
      return SUPPORTED_LANGUAGES_SHORT_CODE[pageLang];
    }
    if (allowedSet.has(fallbackLanguage)) {
      return fallbackLanguage;
    }
    return allowedLanguages[0];
  }
}
