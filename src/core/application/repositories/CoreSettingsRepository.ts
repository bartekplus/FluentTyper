import { DEFAULT_NUM_SUGGESTIONS } from "@core/domain/constants";
import type { DomainListMode, SettingField, SettingsSchema } from "@core/domain/contracts/settings";
import { resolveEnabledLanguages } from "@core/domain/lang";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "@core/domain/themeDefaults";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

const DEFAULT_DOMAIN_LIST_MODE: DomainListMode = "blackList";
const DEFAULT_LANGUAGE = "en_US";
const DEFAULT_MIN_WORD_LENGTH_TO_PREDICT = 1;

type ThemeSettings = Pick<
  SettingsSchema,
  | "suggestionBgLight"
  | "suggestionTextLight"
  | "suggestionHighlightBgLight"
  | "suggestionHighlightTextLight"
  | "suggestionBorderLight"
  | "suggestionBgDark"
  | "suggestionTextDark"
  | "suggestionHighlightBgDark"
  | "suggestionHighlightTextDark"
  | "suggestionBorderDark"
  | "suggestionFontSize"
  | "suggestionPaddingVertical"
  | "suggestionPaddingHorizontal"
>;

function toStoredString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

export class CoreSettingsRepository extends SettingsRepositoryBase {
  private static toBoolean(value: unknown, fallback = false): boolean {
    return typeof value === "boolean" ? value : fallback;
  }

  private static toString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
  }

  private async getBooleanField(field: SettingField, fallback = false): Promise<boolean> {
    return CoreSettingsRepository.toBoolean(await this.getField(field), fallback);
  }

  private async getStringField(field: SettingField, fallback = ""): Promise<string> {
    return CoreSettingsRepository.toString(await this.getField(field), fallback);
  }

  private async getStringArrayField(field: SettingField): Promise<string[]> {
    const value = await this.getField(field);
    return Array.isArray(value)
      ? value
          .map((item) => toStoredString(item))
          .filter((item): item is string => typeof item === "string")
      : [];
  }

  async isEnabled(): Promise<boolean> {
    return this.getBooleanField("enabled", true);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.setField("enabled", enabled);
  }

  async getLanguage(): Promise<string> {
    return this.getStringField("language", DEFAULT_LANGUAGE);
  }

  async setLanguage(language: string): Promise<void> {
    await this.setField("language", language);
  }

  async getFallbackLanguage(): Promise<string> {
    return this.getStringField("fallbackLanguage", DEFAULT_LANGUAGE);
  }

  async setFallbackLanguage(language: string): Promise<void> {
    await this.setField("fallbackLanguage", language);
  }

  async getEnabledLanguages(): Promise<string[]> {
    return resolveEnabledLanguages(await this.getField("enabledLanguages"));
  }

  async getNumSuggestions(): Promise<number> {
    const value = await this.getField("numSuggestions");
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.round(value))
      : DEFAULT_NUM_SUGGESTIONS;
  }

  async getInlineSuggestion(): Promise<boolean> {
    return this.getBooleanField("inlineSuggestion");
  }

  async getPrefixOnlyMode(): Promise<boolean> {
    return this.getBooleanField("prefixOnlyMode");
  }

  async getPersonalizationEnabled(): Promise<boolean> {
    return this.getBooleanField("personalizationEnabled");
  }

  async getPreferNativeAutocomplete(): Promise<boolean> {
    return this.getBooleanField("preferNativeAutocomplete", true);
  }

  async getDomainListMode(): Promise<DomainListMode> {
    const mode = await this.getField("domainListMode");
    return mode === "whiteList" ? "whiteList" : DEFAULT_DOMAIN_LIST_MODE;
  }

  async getDomainList(): Promise<string[]> {
    return this.getStringArrayField("domainList");
  }

  async setDomainList(list: string[]): Promise<void> {
    await this.setField("domainList", list);
  }

  async getAutocomplete(): Promise<boolean> {
    return this.getBooleanField("autocomplete");
  }

  async getAutocompleteOnEnter(): Promise<boolean> {
    return this.getBooleanField("autocompleteOnEnter", true);
  }

  async getAutocompleteOnTab(): Promise<boolean> {
    return this.getBooleanField("autocompleteOnTab", true);
  }

  async getSelectByDigit(): Promise<boolean> {
    return this.getBooleanField("selectByDigit");
  }

  async getMinWordLengthToPredict(): Promise<number> {
    const value = await this.getField("minWordLengthToPredict");
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return DEFAULT_MIN_WORD_LENGTH_TO_PREDICT;
    }
    return Math.min(12, Math.max(-1, Math.round(value)));
  }

  async getDisplayLangHeader(): Promise<boolean> {
    return this.getBooleanField("displayLangHeader");
  }

  async getInsertSpaceAfterAutocomplete(): Promise<boolean> {
    return this.getBooleanField("insertSpaceAfterAutocomplete");
  }

  async getAutoCapitalize(): Promise<boolean> {
    return this.getBooleanField("autoCapitalize");
  }

  async getAutoLanguageSitePriors(): Promise<Record<string, Record<string, number>>> {
    const value = await this.getField("autoLanguageSitePriors");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  async setAutoLanguageSitePriors(priors: Record<string, Record<string, number>>): Promise<void> {
    await this.setField("autoLanguageSitePriors", priors);
  }

  async getEnabledGrammarRules(): Promise<string[]> {
    return this.getStringArrayField("enabledGrammarRules");
  }

  async getTextExpansions(): Promise<Array<[string, object]>> {
    const value = await this.getField("textExpansions");
    if (!Array.isArray(value)) {
      return [];
    }
    const normalized: Array<[string, object]> = [];
    for (const entry of value) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }
      const shortcut = entry[0];
      const expansion = entry[1];
      if (typeof shortcut !== "string") {
        continue;
      }
      if (typeof expansion === "string") {
        normalized.push([shortcut, expansion as unknown as object]);
        continue;
      }
      if (!expansion || typeof expansion !== "object" || Array.isArray(expansion)) {
        continue;
      }
      normalized.push([shortcut, expansion]);
    }
    return normalized;
  }

  async getTimeFormat(): Promise<string> {
    return this.getStringField("timeFormat");
  }

  async getDateFormat(): Promise<string> {
    return this.getStringField("dateFormat");
  }

  async getUserDictionaryList(): Promise<string[]> {
    return this.getStringArrayField("userDictionaryList");
  }

  async getThemeSettings(): Promise<ThemeSettings> {
    const defaults = DEFAULT_SUGGESTION_THEME_SETTINGS;
    const [
      suggestionBgLight,
      suggestionTextLight,
      suggestionHighlightBgLight,
      suggestionHighlightTextLight,
      suggestionBorderLight,
      suggestionBgDark,
      suggestionTextDark,
      suggestionHighlightBgDark,
      suggestionHighlightTextDark,
      suggestionBorderDark,
      suggestionFontSize,
      suggestionPaddingVertical,
      suggestionPaddingHorizontal,
    ] = await Promise.all([
      this.getField("suggestionBgLight"),
      this.getField("suggestionTextLight"),
      this.getField("suggestionHighlightBgLight"),
      this.getField("suggestionHighlightTextLight"),
      this.getField("suggestionBorderLight"),
      this.getField("suggestionBgDark"),
      this.getField("suggestionTextDark"),
      this.getField("suggestionHighlightBgDark"),
      this.getField("suggestionHighlightTextDark"),
      this.getField("suggestionBorderDark"),
      this.getField("suggestionFontSize"),
      this.getField("suggestionPaddingVertical"),
      this.getField("suggestionPaddingHorizontal"),
    ]);

    return {
      suggestionBgLight: CoreSettingsRepository.toString(
        suggestionBgLight,
        defaults.suggestionBgLight,
      ),
      suggestionTextLight: CoreSettingsRepository.toString(
        suggestionTextLight,
        defaults.suggestionTextLight,
      ),
      suggestionHighlightBgLight: CoreSettingsRepository.toString(
        suggestionHighlightBgLight,
        defaults.suggestionHighlightBgLight,
      ),
      suggestionHighlightTextLight: CoreSettingsRepository.toString(
        suggestionHighlightTextLight,
        defaults.suggestionHighlightTextLight,
      ),
      suggestionBorderLight: CoreSettingsRepository.toString(
        suggestionBorderLight,
        defaults.suggestionBorderLight,
      ),
      suggestionBgDark: CoreSettingsRepository.toString(
        suggestionBgDark,
        defaults.suggestionBgDark,
      ),
      suggestionTextDark: CoreSettingsRepository.toString(
        suggestionTextDark,
        defaults.suggestionTextDark,
      ),
      suggestionHighlightBgDark: CoreSettingsRepository.toString(
        suggestionHighlightBgDark,
        defaults.suggestionHighlightBgDark,
      ),
      suggestionHighlightTextDark: CoreSettingsRepository.toString(
        suggestionHighlightTextDark,
        defaults.suggestionHighlightTextDark,
      ),
      suggestionBorderDark: CoreSettingsRepository.toString(
        suggestionBorderDark,
        defaults.suggestionBorderDark,
      ),
      suggestionFontSize: CoreSettingsRepository.toString(
        suggestionFontSize,
        defaults.suggestionFontSize,
      ),
      suggestionPaddingVertical: CoreSettingsRepository.toString(
        suggestionPaddingVertical,
        defaults.suggestionPaddingVertical,
      ),
      suggestionPaddingHorizontal: CoreSettingsRepository.toString(
        suggestionPaddingHorizontal,
        defaults.suggestionPaddingHorizontal,
      ),
    };
  }
}
