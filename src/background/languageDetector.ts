// Handles language detection logic for FluentTyper
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGES_SHORT_CODE,
} from "../shared/lang";
import { SettingsManager } from "../shared/settingsManager";

export class LanguageDetector {
  private settings: SettingsManager;
  constructor(settings: SettingsManager) {
    this.settings = settings;
  }

  async detectLanguage(text: string, tabId: number): Promise<string> {
    const fallbackLanguage = (await this.settings.get(
      "fallbackLanguage",
    )) as string;
    const api =
      typeof (globalThis as any).browser === "undefined"
        ? chrome
        : (globalThis as any).browser;
    const result = await api.i18n.detectLanguage(text);
    let detectedLanguage: string | null = null;
    let maxPercentage = -1;
    for (const language of result.languages) {
      if (
        language.language in SUPPORTED_LANGUAGES &&
        language.percentage > maxPercentage
      ) {
        detectedLanguage = language.language;
        maxPercentage = language.percentage;
      } else if (
        language.language in SUPPORTED_LANGUAGES_SHORT_CODE &&
        language.percentage > maxPercentage
      ) {
        detectedLanguage = SUPPORTED_LANGUAGES_SHORT_CODE[language.language];
        maxPercentage = language.percentage;
      }
    }
    if (detectedLanguage) {
      return detectedLanguage;
    }
    const pageLang = await api.tabs.detectLanguage(tabId);
    if (pageLang in SUPPORTED_LANGUAGES) {
      return pageLang;
    }
    if (pageLang in SUPPORTED_LANGUAGES_SHORT_CODE) {
      return SUPPORTED_LANGUAGES_SHORT_CODE[pageLang];
    }
    return fallbackLanguage;
  }
}
