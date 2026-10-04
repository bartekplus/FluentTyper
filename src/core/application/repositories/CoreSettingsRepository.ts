import {
  emptyTerminology,
  validateTerminology,
  type PreferredTerminology,
} from "@core/domain/grammar/review/preferredTerminology";
import {
  isReviewSupportedRule,
  longSentenceThreshold,
  normalizeReviewRuleOverrides,
} from "@core/domain/grammar/review/reviewCatalog";
import {
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  DEFAULT_NUM_SUGGESTIONS,
} from "@core/domain/constants";
import type { SettingField } from "@core/domain/contracts/settings";
import { resolveGrammarRuleSelection } from "@core/domain/grammar/GrammarRuleSettings";
import { clamp, isFiniteNumber, isObjectRecord } from "@core/domain/guards";
import { resolveEnabledLanguages } from "@core/domain/lang";
import { sanitizeObservabilityConfig, type ObservabilityConfig } from "@core/domain/observability";
import { serialQueue } from "@core/domain/serialQueue";
import {
  DEFAULT_SUGGESTION_THEME_SETTINGS,
  type SuggestionThemeSettings,
} from "@core/domain/themeDefaults";
import { toStoredString } from "../domain-utils";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

const DEFAULT_LANGUAGE = "en_US";
const DEFAULT_MIN_WORD_LENGTH_TO_PREDICT = 1;

type ThemeField = keyof SuggestionThemeSettings & SettingField;

/** Settings read-modify-write queues. */
const reviewRuleWrites = serialQueue();
const dictionaryWrites = serialQueue();

export class CoreSettingsRepository extends SettingsRepositoryBase {
  private static toString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
  }

  private async getBooleanField(field: SettingField, fallback = false): Promise<boolean> {
    const value = await this.getField(field);
    return typeof value === "boolean" ? value : fallback;
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

  async getEnabledLanguages(): Promise<string[]> {
    return resolveEnabledLanguages(await this.getField("enabledLanguages"));
  }

  async getNumSuggestions(): Promise<number> {
    const value = await this.getField("numSuggestions");
    return isFiniteNumber(value) ? Math.max(0, Math.round(value)) : DEFAULT_NUM_SUGGESTIONS;
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

  async getCodeMode(): Promise<boolean> {
    return this.getBooleanField("codeMode", false);
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

  /** The "Extension UI Language" setting; "auto_detect" follows the browser. */
  async getExtensionLanguage(): Promise<string> {
    return this.getStringField("extensionLanguage", "auto_detect");
  }

  async getSelectByDigit(): Promise<boolean> {
    return this.getBooleanField("selectByDigit");
  }

  async getHorizontalSuggestions(): Promise<boolean> {
    return this.getBooleanField("horizontalSuggestions");
  }

  async getMinWordLengthToPredict(): Promise<number> {
    const value = await this.getField("minWordLengthToPredict");
    if (!isFiniteNumber(value)) {
      return DEFAULT_MIN_WORD_LENGTH_TO_PREDICT;
    }
    return clamp(Math.round(value), -1, 12);
  }

  /** The popup's bottom line (key hints and prediction language); off unless turned on. */
  async getShowSuggestionFooter(): Promise<boolean> {
    return this.getBooleanField("showSuggestionFooter");
  }

  /** The "Review text" button on the focused multi-line field; on unless turned off. */
  async getShowReviewButton(): Promise<boolean> {
    return this.getBooleanField("showReviewButton", true);
  }

  /** Review fixes offered in the suggestion popup while typing; on unless turned off. */
  async getLiveGrammarProposals(): Promise<boolean> {
    return this.getBooleanField("liveGrammarProposals", true);
  }

  async getInsertSpaceAfterAutocomplete(): Promise<boolean> {
    return this.getBooleanField("insertSpaceAfterAutocomplete");
  }

  async getAutoLanguageSitePriors(): Promise<Record<string, Record<string, number>>> {
    const value = await this.getField("autoLanguageSitePriors");
    return isObjectRecord(value) ? value : {};
  }

  async setAutoLanguageSitePriors(priors: Record<string, Record<string, number>>): Promise<void> {
    await this.setField("autoLanguageSitePriors", priors);
  }

  async getEnabledGrammarRules(): Promise<string[]> {
    return resolveGrammarRuleSelection(await this.getField("enabledGrammarRules"));
  }

  async getReviewLongSentenceWords(): Promise<number> {
    return longSentenceThreshold(await this.getField("reviewLongSentenceWords"));
  }

  async getPreferredTerminology(): Promise<PreferredTerminology> {
    const result = validateTerminology(await this.getField("preferredTerminology"));
    return result.ok ? result.value : emptyTerminology();
  }

  async getReviewRuleOverrides(): Promise<Record<string, boolean>> {
    return normalizeReviewRuleOverrides(await this.getField("reviewRuleOverrides"));
  }

  async disableReviewRule(ruleId: string): Promise<boolean> {
    if (!isReviewSupportedRule(ruleId)) return false;
    return reviewRuleWrites(async () => {
      const overrides = await this.getReviewRuleOverrides();
      await this.setField("reviewRuleOverrides", { ...overrides, [ruleId]: false });
      return true;
    });
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
      const [shortcut, expansion] = entry;
      if (typeof shortcut !== "string") {
        continue;
      }
      if (typeof expansion !== "string" && !isObjectRecord(expansion)) {
        continue;
      }
      normalized.push([shortcut, expansion]);
    }
    return normalized;
  }

  async getDebugPresagePredictorEnabled(): Promise<boolean> {
    return this.getBooleanField(
      "debugPresagePredictorEnabled",
      DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
    );
  }

  async getObservabilitySnapshot(): Promise<ObservabilityConfig> {
    const [enabled, defaultLevel, moduleOverrides] = await Promise.all([
      this.getField("observabilityEnabled"),
      this.getField("observabilityDefaultLevel"),
      this.getField("observabilityModuleOverrides"),
    ]);

    return sanitizeObservabilityConfig({ enabled, defaultLevel, moduleOverrides });
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

  /** Appends one word unless an entry already matches it (case-insensitively). */
  async addUserDictionaryWord(word: string): Promise<boolean> {
    const trimmed = word.trim();
    // One word: letters (with their marks), inner apostrophes or hyphens.
    if (trimmed.length > 64 || !/^[\p{L}\p{M}]+(?:['\u2019-][\p{L}\p{M}]+)*$/u.test(trimmed)) {
      return false;
    }
    // Read-modify-write: queue adds so two quick ones both land.
    return dictionaryWrites(async () => {
      const current = await this.getUserDictionaryList();
      if (!current.some((entry) => entry.trim().toLowerCase() === trimmed.toLowerCase())) {
        await this.setField("userDictionaryList", [...current, trimmed]);
      }
      return true;
    });
  }

  async getThemeSettings(): Promise<SuggestionThemeSettings> {
    const fields = Object.keys(DEFAULT_SUGGESTION_THEME_SETTINGS) as ThemeField[];
    const values = await Promise.all(fields.map((field) => this.getField(field)));
    const settings = { ...DEFAULT_SUGGESTION_THEME_SETTINGS };
    fields.forEach((field, index) => {
      settings[field] = CoreSettingsRepository.toString(
        values[index],
        DEFAULT_SUGGESTION_THEME_SETTINGS[field],
      );
    });
    return settings;
  }
}
