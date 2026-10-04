import {
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
} from "@core/domain/constants";
import type { SettingsManager } from "@core/application/settingsManager";
import type { ConfigMessage } from "@core/domain/messageTypes";
import type { PredictionConfig } from "../PredictionOrchestrator";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { LocalAiSettingsRepository } from "@core/application/repositories/LocalAiSettingsRepository";
import { type DomainRuntimeSettings, resolveDomainRuntimeSettings } from "./runtimeSettings";
import type { ObservabilityConfig } from "@core/domain/observability";
import { resolveFallbackLanguage } from "@core/domain/lang";

interface ConfigAssemblerOptions {
  isDevBuild: boolean;
}

interface AssembledPredictionRuntimeConfig {
  predictionConfig: PredictionConfig;
  observabilityConfig?: ObservabilityConfig;
}

function domainConfigOverrides(domainSettings: DomainRuntimeSettings) {
  return {
    lang: domainSettings.language,
    inline_suggestion: domainSettings.inlineSuggestion,
    preferNativeAutocomplete: domainSettings.preferNativeAutocomplete,
    codeMode: domainSettings.codeMode,
  };
}

export class ConfigAssembler {
  private readonly settingsManager: SettingsManager;
  private readonly coreSettingsRepository: CoreSettingsRepository;
  private readonly localAiSettingsRepository: LocalAiSettingsRepository;
  private readonly options: ConfigAssemblerOptions;

  constructor(settingsManager: SettingsManager, options: ConfigAssemblerOptions) {
    this.settingsManager = settingsManager;
    this.coreSettingsRepository = new CoreSettingsRepository(settingsManager);
    this.localAiSettingsRepository = new LocalAiSettingsRepository(settingsManager);
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
      horizontalSuggestions,
      extensionLanguage,
      minWordLengthToPredict,
      showSuggestionFooter,
      showReviewButton,
      liveGrammarProposals,
      localAiReviewEnabled,
      userDictionaryList,
      themeConfig,
      observability,
      fallbackLanguage,
    ] = await Promise.all([
      this.coreSettingsRepository.isEnabled(),
      this.coreSettingsRepository.getAutocomplete(),
      this.coreSettingsRepository.getAutocompleteOnEnter(),
      this.coreSettingsRepository.getAutocompleteOnTab(),
      this.coreSettingsRepository.getInsertSpaceAfterAutocomplete(),
      this.coreSettingsRepository.getSelectByDigit(),
      this.coreSettingsRepository.getHorizontalSuggestions(),
      this.coreSettingsRepository.getExtensionLanguage(),
      this.coreSettingsRepository.getMinWordLengthToPredict(),
      this.coreSettingsRepository.getShowSuggestionFooter(),
      this.coreSettingsRepository.getShowReviewButton(),
      this.coreSettingsRepository.getLiveGrammarProposals(),
      this.localAiSettingsRepository.getLocalAiReviewEnabled(),
      this.coreSettingsRepository.getUserDictionaryList(),
      this.coreSettingsRepository.getThemeSettings(),
      this.getObservabilityConfig(),
      this.coreSettingsRepository.getFallbackLanguage(),
    ]);
    const { enabledLanguages } = domainSettings;

    return {
      command: CMD_BACKGROUND_PAGE_SET_CONFIG,
      context: {
        enabled,
        autocomplete,
        autocompleteOnEnter,
        autocompleteOnTab,
        insertSpaceAfterAutocomplete,
        selectByDigit,
        horizontalSuggestions,
        extensionLanguage,
        ...domainConfigOverrides(domainSettings),
        enabledLanguages,
        // As the language detector resolves it: the setting if enabled, else the first enabled.
        fallbackLanguage: resolveFallbackLanguage(fallbackLanguage, enabledLanguages),
        minWordLengthToPredict,
        showSuggestionFooter,
        showReviewButton,
        liveGrammarProposals,
        localAiReviewEnabled,
        enabledGrammarRules: await this.coreSettingsRepository.getEnabledGrammarRules(),
        reviewRuleOverrides: await this.coreSettingsRepository.getReviewRuleOverrides(),
        reviewLongSentenceWords: await this.coreSettingsRepository.getReviewLongSentenceWords(),
        preferredTerminology: await this.coreSettingsRepository.getPreferredTerminology(),
        userDictionaryList,
        themeConfig,
        observability,
      },
    };
  }

  async assemblePredictionRuntimeConfig(): Promise<AssembledPredictionRuntimeConfig> {
    const [
      numSuggestions,
      minWordLengthToPredict,
      insertSpaceAfterAutocomplete,
      enabledGrammarRules,
      textExpansions,

      timeFormat,
      dateFormat,
      userDictionaryList,
      debugPresagePredictorEnabled,
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
      this.coreSettingsRepository.getDebugPresagePredictorEnabled(),
      this.getObservabilityConfig(),
      this.coreSettingsRepository.getPrefixOnlyMode(),
      this.coreSettingsRepository.getInlineSuggestion(),
      this.coreSettingsRepository.getPersonalizationEnabled(),
    ]);
    const autoCapitalize = enabledGrammarRules.includes("capitalizeSentenceStart");

    return {
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
        debugPresagePredictorEnabled: this.options.isDevBuild
          ? debugPresagePredictorEnabled
          : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
      },
    };
  }

  async resolveDomainConfigOverrides(
    domainURL: string,
  ): Promise<ReturnType<typeof domainConfigOverrides>> {
    return domainConfigOverrides(
      await resolveDomainRuntimeSettings(this.settingsManager, domainURL),
    );
  }

  private async getObservabilityConfig(): Promise<ObservabilityConfig | undefined> {
    return this.options.isDevBuild
      ? this.coreSettingsRepository.getObservabilitySnapshot()
      : undefined;
  }
}
