import {
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  MAX_NUM_SUGGESTIONS,
} from "@core/domain/constants";
import type { SettingsManager } from "@core/application/settingsManager";
import type { ConfigMessage } from "@core/domain/messageTypes";
import type { PredictionConfig } from "../PredictionManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { ObservabilitySettingsRepository } from "@core/application/repositories/ObservabilitySettingsRepository";
import { PredictorSettingsRepository } from "@core/application/repositories/PredictorSettingsRepository";
import { resolveActiveLanguage, resolveDomainRuntimeSettings } from "./runtimeSettings";
import { normalizeGrammarRuleSelection } from "@core/domain/grammar/ruleCatalog";
import type { ObservabilityConfig } from "@core/domain/observability";

interface ConfigAssemblerOptions {
  enableAIPredictor: boolean;
  isDevBuild: boolean;
}

export interface AssembledPredictionRuntimeConfig {
  language: string;
  predictionConfig: PredictionConfig;
  textExpansions: Array<[string, object]>;
  observabilityConfig?: ObservabilityConfig;
}

export class ConfigAssembler {
  private readonly settingsManager: SettingsManager;
  private readonly coreSettingsRepository: CoreSettingsRepository;
  private readonly predictorSettingsRepository: PredictorSettingsRepository;
  private readonly observabilitySettingsRepository: ObservabilitySettingsRepository;
  private readonly options: ConfigAssemblerOptions;

  constructor(settingsManager: SettingsManager, options: ConfigAssemblerOptions) {
    this.settingsManager = settingsManager;
    this.coreSettingsRepository = new CoreSettingsRepository(settingsManager);
    this.predictorSettingsRepository = new PredictorSettingsRepository(settingsManager);
    this.observabilitySettingsRepository = new ObservabilitySettingsRepository(settingsManager);
    this.options = options;
  }

  async assembleBackgroundPageSetConfig(domainURL?: string): Promise<ConfigMessage> {
    const domainSettings = await resolveDomainRuntimeSettings(this.settingsManager, domainURL);
    const [
      enabled,
      autocomplete,
      autocompleteOnEnter,
      autocompleteOnTab,
      insertSpaceAfterAutocomplete,
      selectByDigit,
      minWordLengthToPredict,
      displayLangHeader,
      userDictionaryList,
      themeConfig,
      observability,
    ] = await Promise.all([
      this.coreSettingsRepository.isEnabled(),
      this.coreSettingsRepository.getAutocomplete(),
      this.coreSettingsRepository.getAutocompleteOnEnter(),
      this.coreSettingsRepository.getAutocompleteOnTab(),
      this.coreSettingsRepository.getInsertSpaceAfterAutocomplete(),
      this.coreSettingsRepository.getSelectByDigit(),
      this.coreSettingsRepository.getMinWordLengthToPredict(),
      this.coreSettingsRepository.getDisplayLangHeader(),
      this.coreSettingsRepository.getUserDictionaryList(),
      this.coreSettingsRepository.getThemeSettings(),
      this.options.isDevBuild ? this.observabilitySettingsRepository.getSnapshot() : null,
    ]);

    return {
      command: CMD_BACKGROUND_PAGE_SET_CONFIG,
      context: {
        enabled,
        autocomplete,
        autocompleteOnEnter,
        autocompleteOnTab,
        insertSpaceAfterAutocomplete,
        selectByDigit,
        lang: domainSettings.language,
        minWordLengthToPredict,
        displayLangHeader,
        inline_suggestion: domainSettings.inlineSuggestion,
        preferNativeAutocomplete: domainSettings.preferNativeAutocomplete,
        enabledGrammarRules: normalizeGrammarRuleSelection(
          await this.coreSettingsRepository.getEnabledGrammarRules(),
        ),
        userDictionaryList,
        themeConfig,
        observability:
          this.options.isDevBuild && observability
            ? {
                enabled: observability.enabled,
                defaultLevel: observability.defaultLevel,
                moduleOverrides: observability.moduleOverrides,
              }
            : undefined,
      },
    };
  }

  async assemblePredictionRuntimeConfig(): Promise<AssembledPredictionRuntimeConfig> {
    const language = await resolveActiveLanguage(this.settingsManager);
    const [
      numSuggestions,
      minWordLengthToPredict,
      insertSpaceAfterAutocomplete,
      enabledGrammarRules,
      textExpansions,

      timeFormat,
      dateFormat,
      userDictionaryList,
      predictorSettings,
      observabilitySettings,
    ] = await Promise.all([
      this.coreSettingsRepository.getNumSuggestions(),
      this.coreSettingsRepository.getMinWordLengthToPredict(),
      this.coreSettingsRepository.getInsertSpaceAfterAutocomplete(),
      this.coreSettingsRepository.getEnabledGrammarRules(),
      this.coreSettingsRepository.getTextExpansions(),

      this.coreSettingsRepository.getTimeFormat(),
      this.coreSettingsRepository.getDateFormat(),
      this.coreSettingsRepository.getUserDictionaryList(),
      this.predictorSettingsRepository.getSnapshot(),
      this.options.isDevBuild ? this.observabilitySettingsRepository.getSnapshot() : null,
    ]);
    const normalizedGrammarRules = normalizeGrammarRuleSelection(enabledGrammarRules);
    const autoCapitalize = normalizedGrammarRules.includes("capitalizeSentenceStart");

    return {
      language,
      textExpansions,
      observabilityConfig:
        this.options.isDevBuild && observabilitySettings
          ? {
              enabled: observabilitySettings.enabled,
              defaultLevel: observabilitySettings.defaultLevel,
              moduleOverrides: observabilitySettings.moduleOverrides,
            }
          : undefined,
      predictionConfig: {
        numSuggestions,
        engineNumSuggestions: MAX_NUM_SUGGESTIONS,
        minWordLengthToPredict,
        insertSpaceAfterAutocomplete,
        autoCapitalize,
        textExpansions,

        timeFormat,
        dateFormat,
        userDictionaryList,
        aiPredictorEnabled: this.options.enableAIPredictor
          ? predictorSettings.aiPredictorEnabled
          : false,
        aiModelId: predictorSettings.aiModelId,
        aiPredictionTimeoutMs: predictorSettings.aiPredictionTimeoutMs,
        debugPresagePredictorEnabled: this.options.isDevBuild
          ? predictorSettings.debugPresagePredictorEnabled
          : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
        debugAIPredictorEnabled: this.options.isDevBuild
          ? predictorSettings.debugAIPredictorEnabled
          : DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
      },
    };
  }

  async resolveDomainConfigOverrides(
    domainURL: string,
  ): Promise<{ lang: string; inline_suggestion: boolean; preferNativeAutocomplete: boolean }> {
    const domainSettings = await resolveDomainRuntimeSettings(this.settingsManager, domainURL);
    return {
      lang: domainSettings.language,
      inline_suggestion: domainSettings.inlineSuggestion,
      preferNativeAutocomplete: domainSettings.preferNativeAutocomplete,
    };
  }
}
