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
import { PredictorSettingsRepository } from "@core/application/repositories/PredictorSettingsRepository";
import { resolveActiveLanguage, resolveDomainRuntimeSettings } from "./runtimeSettings";
import { normalizeGrammarRuleSelection } from "@core/domain/grammar/ruleCatalog";

interface ConfigAssemblerOptions {
  enableAIPredictor: boolean;
  isDevBuild: boolean;
}

export interface AssembledPredictionRuntimeConfig {
  language: string;
  predictionConfig: PredictionConfig;
  textExpansions: Array<[string, object]>;
}

export class ConfigAssembler {
  private readonly settingsManager: SettingsManager;
  private readonly coreSettingsRepository: CoreSettingsRepository;
  private readonly predictorSettingsRepository: PredictorSettingsRepository;
  private readonly options: ConfigAssemblerOptions;

  constructor(settingsManager: SettingsManager, options: ConfigAssemblerOptions) {
    this.settingsManager = settingsManager;
    this.coreSettingsRepository = new CoreSettingsRepository(settingsManager);
    this.predictorSettingsRepository = new PredictorSettingsRepository(settingsManager);
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
      themeConfig,
    ] = await Promise.all([
      this.coreSettingsRepository.isEnabled(),
      this.coreSettingsRepository.getAutocomplete(),
      this.coreSettingsRepository.getAutocompleteOnEnter(),
      this.coreSettingsRepository.getAutocompleteOnTab(),
      this.coreSettingsRepository.getInsertSpaceAfterAutocomplete(),
      this.coreSettingsRepository.getSelectByDigit(),
      this.coreSettingsRepository.getMinWordLengthToPredict(),
      this.coreSettingsRepository.getDisplayLangHeader(),
      this.coreSettingsRepository.getThemeSettings(),
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
        enabledGrammarRules: normalizeGrammarRuleSelection(
          await this.coreSettingsRepository.getEnabledGrammarRules(),
        ),
        themeConfig,
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
    ]);
    const normalizedGrammarRules = normalizeGrammarRuleSelection(enabledGrammarRules);
    const autoCapitalize = normalizedGrammarRules.includes("capitalizeSentenceStart");

    return {
      language,
      textExpansions,
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
        enabledGrammarRules: normalizedGrammarRules,
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
  ): Promise<{ lang: string; inline_suggestion: boolean }> {
    const domainSettings = await resolveDomainRuntimeSettings(this.settingsManager, domainURL);
    return {
      lang: domainSettings.language,
      inline_suggestion: domainSettings.inlineSuggestion,
    };
  }
}
