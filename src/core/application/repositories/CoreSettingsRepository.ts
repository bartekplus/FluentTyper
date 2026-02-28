import { DEFAULT_NUM_SUGGESTIONS } from "@core/domain/constants";
import type { DomainListMode, SettingField, SettingsSchema } from "@core/domain/contracts/settings";
import { resolveEnabledLanguages } from "@core/domain/lang";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

const DEFAULT_DOMAIN_LIST_MODE: DomainListMode = "blackList";
const DEFAULT_LANGUAGE = "en_US";
const DEFAULT_MIN_WORD_LENGTH_TO_PREDICT = 1;

type ThemeSettings = Pick<
  SettingsSchema,
  | "tributeBgLight"
  | "tributeTextLight"
  | "tributeHighlightBgLight"
  | "tributeHighlightTextLight"
  | "tributeBorderLight"
  | "tributeBgDark"
  | "tributeTextDark"
  | "tributeHighlightBgDark"
  | "tributeHighlightTextDark"
  | "tributeBorderDark"
  | "tributeFontSize"
  | "tributePaddingVertical"
  | "tributePaddingHorizontal"
>;

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
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }

  async isEnabled(): Promise<boolean> {
    return this.getBooleanField("enabled");
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
    return this.getBooleanField("autocompleteOnEnter");
  }

  async getAutocompleteOnTab(): Promise<boolean> {
    return this.getBooleanField("autocompleteOnTab");
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

  async getRevertOnBackspace(): Promise<boolean> {
    return this.getBooleanField("revertOnBackspace");
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

  async getApplySpacingRules(): Promise<boolean> {
    return this.getBooleanField("applySpacingRules");
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

  async getVariableExpansion(): Promise<boolean> {
    return this.getBooleanField("variableExpansion");
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
    const [
      tributeBgLight,
      tributeTextLight,
      tributeHighlightBgLight,
      tributeHighlightTextLight,
      tributeBorderLight,
      tributeBgDark,
      tributeTextDark,
      tributeHighlightBgDark,
      tributeHighlightTextDark,
      tributeBorderDark,
      tributeFontSize,
      tributePaddingVertical,
      tributePaddingHorizontal,
    ] = await Promise.all([
      this.getField("tributeBgLight"),
      this.getField("tributeTextLight"),
      this.getField("tributeHighlightBgLight"),
      this.getField("tributeHighlightTextLight"),
      this.getField("tributeBorderLight"),
      this.getField("tributeBgDark"),
      this.getField("tributeTextDark"),
      this.getField("tributeHighlightBgDark"),
      this.getField("tributeHighlightTextDark"),
      this.getField("tributeBorderDark"),
      this.getField("tributeFontSize"),
      this.getField("tributePaddingVertical"),
      this.getField("tributePaddingHorizontal"),
    ]);

    return {
      tributeBgLight: CoreSettingsRepository.toString(tributeBgLight),
      tributeTextLight: CoreSettingsRepository.toString(tributeTextLight),
      tributeHighlightBgLight: CoreSettingsRepository.toString(tributeHighlightBgLight),
      tributeHighlightTextLight: CoreSettingsRepository.toString(tributeHighlightTextLight),
      tributeBorderLight: CoreSettingsRepository.toString(tributeBorderLight),
      tributeBgDark: CoreSettingsRepository.toString(tributeBgDark),
      tributeTextDark: CoreSettingsRepository.toString(tributeTextDark),
      tributeHighlightBgDark: CoreSettingsRepository.toString(tributeHighlightBgDark),
      tributeHighlightTextDark: CoreSettingsRepository.toString(tributeHighlightTextDark),
      tributeBorderDark: CoreSettingsRepository.toString(tributeBorderDark),
      tributeFontSize: CoreSettingsRepository.toString(tributeFontSize),
      tributePaddingVertical: CoreSettingsRepository.toString(tributePaddingVertical),
      tributePaddingHorizontal: CoreSettingsRepository.toString(tributePaddingHorizontal),
    };
  }
}
