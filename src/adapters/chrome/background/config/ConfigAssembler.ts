import {
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
} from "@core/domain/constants";
import type { SettingsManager } from "@core/application/settingsManager";
import type { ConfigMessage } from "@core/domain/messageTypes";
import type { PredictionConfig } from "../PredictionOrchestrator";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { ObservabilitySettingsRepository } from "@core/application/repositories/ObservabilitySettingsRepository";
import { PredictorSettingsRepository } from "@core/application/repositories/PredictorSettingsRepository";
import { resolveActiveLanguage, resolveDomainRuntimeSettings } from "./runtimeSettings";
import type { ObservabilityConfig } from "@core/domain/observability";

interface ConfigAssemblerOptions {
  isDevBuild: boolean;
}

interface AssembledPredictionRuntimeConfig {
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
      showReviewButton,
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
      this.coreSettingsRepository.getShowReviewButton(),
      this.coreSettingsRepository.getUserDictionaryList(),
      this.coreSettingsRepository.getThemeSettings(),
      this.getObservabilityConfig(),
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
        showReviewButton,
        inline_suggestion: domainSettings.inlineSuggestion,
        preferNativeAutocomplete: domainSettings.preferNativeAutocomplete,
        codeMode: domainSettings.codeMode,
        enabledGrammarRules: await this.coreSettingsRepository.getEnabledGrammarRules(),
        userDictionaryList,
        themeConfig,
        observability,
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
      observability,
      prefixOnlyMode,
      inlineSuggestion,
      personalizationEnabled,
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
      this.getObservabilityConfig(),
      this.coreSettingsRepository.getPrefixOnlyMode(),
      this.coreSettingsRepository.getInlineSuggestion(),
      this.coreSettingsRepository.getPersonalizationEnabled(),
    ]);
    const autoCapitalize = enabledGrammarRules.includes("capitalizeSentenceStart");

    return {
      language,
      textExpansions,
      observabilityConfig: observability,
      predictionConfig: {
        numSuggestions,
        minWordLengthToPredict,
        insertSpaceAfterAutocomplete,
        autoCapitalize,
        textExpansions,
        prefixOnlyMode: prefixOnlyMode || inlineSuggestion,
        personalizationEnabled,

        timeFormat,
        dateFormat,
        userDictionaryList,
        aiPredictorEnabled: this.options.isDevBuild ? predictorSettings.aiPredictorEnabled : false,
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

  async resolveDomainConfigOverrides(domainURL: string): Promise<{
    lang: string;
    inline_suggestion: boolean;
    preferNativeAutocomplete: boolean;
    codeMode: boolean;
  }> {
    const domainSettings = await resolveDomainRuntimeSettings(this.settingsManager, domainURL);
    return {
      lang: domainSettings.language,
      inline_suggestion: domainSettings.inlineSuggestion,
      preferNativeAutocomplete: domainSettings.preferNativeAutocomplete,
      codeMode: domainSettings.codeMode,
    };
  }

  private async getObservabilityConfig(): Promise<ObservabilityConfig | undefined> {
    if (!this.options.isDevBuild) {
      return undefined;
    }
    const snapshot = await this.observabilitySettingsRepository.getSnapshot();
    if (!snapshot) {
      return undefined;
    }
    return {
      enabled: snapshot.enabled,
      defaultLevel: snapshot.defaultLevel,
      moduleOverrides: snapshot.moduleOverrides,
    };
  }
}
