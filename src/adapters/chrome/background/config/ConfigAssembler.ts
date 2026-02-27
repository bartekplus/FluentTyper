import {
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_AI_PREDICTOR_ENABLED,
  KEY_APPLY_SPACING_RULES,
  KEY_AUTO_CAPITALIZE,
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_DATE_FORMAT,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_DISPLAY_LANG_HEADER,
  KEY_ENABLED,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_REVERT_ON_BACKSPACE,
  KEY_SELECT_BY_DIGIT,
  KEY_TEXT_EXPANSIONS,
  KEY_TIME_FORMAT,
  KEY_USER_DICTIONARY_LIST,
  KEY_VARIABLE_EXPANSION,
  MAX_NUM_SUGGESTIONS,
} from "@core/domain/constants";
import type { SettingsManager } from "@core/application/settingsManager";
import type { ConfigMessage } from "@core/domain/messageTypes";
import type { PredictionConfig } from "../PredictionManager";
import {
  clampAIPredictionTimeoutMs,
  resolveActiveLanguage,
  resolveDomainRuntimeSettings,
} from "./runtimeSettings";

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
  private readonly options: ConfigAssemblerOptions;

  constructor(settingsManager: SettingsManager, options: ConfigAssemblerOptions) {
    this.settingsManager = settingsManager;
    this.options = options;
  }

  async assembleBackgroundPageSetConfig(
    domainURL?: string,
  ): Promise<ConfigMessage> {
    const domainSettings = await resolveDomainRuntimeSettings(
      this.settingsManager,
      domainURL,
    );
    const [
      enabled,
      autocomplete,
      autocompleteOnEnter,
      autocompleteOnTab,
      selectByDigit,
      minWordLengthToPredict,
      revertOnBackspace,
      displayLangHeader,
    ] = await Promise.all([
      this.settingsManager.get(KEY_ENABLED),
      this.settingsManager.get(KEY_AUTOCOMPLETE),
      this.settingsManager.get(KEY_AUTOCOMPLETE_ON_ENTER),
      this.settingsManager.get(KEY_AUTOCOMPLETE_ON_TAB),
      this.settingsManager.get(KEY_SELECT_BY_DIGIT),
      this.settingsManager.get(KEY_MIN_WORD_LENGTH_TO_PREDICT),
      this.settingsManager.get(KEY_REVERT_ON_BACKSPACE),
      this.settingsManager.get(KEY_DISPLAY_LANG_HEADER),
    ]);
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
      this.settingsManager.get("tributeBgLight"),
      this.settingsManager.get("tributeTextLight"),
      this.settingsManager.get("tributeHighlightBgLight"),
      this.settingsManager.get("tributeHighlightTextLight"),
      this.settingsManager.get("tributeBorderLight"),
      this.settingsManager.get("tributeBgDark"),
      this.settingsManager.get("tributeTextDark"),
      this.settingsManager.get("tributeHighlightBgDark"),
      this.settingsManager.get("tributeHighlightTextDark"),
      this.settingsManager.get("tributeBorderDark"),
      this.settingsManager.get("tributeFontSize"),
      this.settingsManager.get("tributePaddingVertical"),
      this.settingsManager.get("tributePaddingHorizontal"),
    ]);

    return {
      command: CMD_BACKGROUND_PAGE_SET_CONFIG,
      context: {
        enabled: enabled as boolean,
        autocomplete: autocomplete as boolean,
        autocompleteOnEnter: autocompleteOnEnter as boolean,
        autocompleteOnTab: autocompleteOnTab as boolean,
        selectByDigit: selectByDigit as boolean,
        lang: domainSettings.language,
        minWordLengthToPredict: minWordLengthToPredict as number,
        revertOnBackspace: revertOnBackspace as boolean,
        displayLangHeader: displayLangHeader as boolean,
        inline_suggestion: domainSettings.inlineSuggestion,
        themeConfig: {
          tributeBgLight: tributeBgLight as string,
          tributeTextLight: tributeTextLight as string,
          tributeHighlightBgLight: tributeHighlightBgLight as string,
          tributeHighlightTextLight: tributeHighlightTextLight as string,
          tributeBorderLight: tributeBorderLight as string,
          tributeBgDark: tributeBgDark as string,
          tributeTextDark: tributeTextDark as string,
          tributeHighlightBgDark: tributeHighlightBgDark as string,
          tributeHighlightTextDark: tributeHighlightTextDark as string,
          tributeBorderDark: tributeBorderDark as string,
          tributeFontSize: tributeFontSize as string,
          tributePaddingVertical: tributePaddingVertical as string,
          tributePaddingHorizontal: tributePaddingHorizontal as string,
        },
      },
    };
  }

  async assemblePredictionRuntimeConfig(): Promise<AssembledPredictionRuntimeConfig> {
    const language = await resolveActiveLanguage(this.settingsManager);
    const [
      numSuggestions,
      minWordLengthToPredict,
      insertSpaceAfterAutocomplete,
      autoCapitalize,
      applySpacingRules,
      textExpansionsRaw,
      variableExpansion,
      timeFormat,
      dateFormat,
      userDictionaryList,
      aiPredictorEnabled,
      aiModelId,
      aiPredictionTimeoutMs,
      debugPresagePredictorEnabled,
      debugAIPredictorEnabled,
    ] = await Promise.all([
      this.settingsManager.get(KEY_NUM_SUGGESTIONS),
      this.settingsManager.get(KEY_MIN_WORD_LENGTH_TO_PREDICT),
      this.settingsManager.get(KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE),
      this.settingsManager.get(KEY_AUTO_CAPITALIZE),
      this.settingsManager.get(KEY_APPLY_SPACING_RULES),
      this.settingsManager.get(KEY_TEXT_EXPANSIONS),
      this.settingsManager.get(KEY_VARIABLE_EXPANSION),
      this.settingsManager.get(KEY_TIME_FORMAT),
      this.settingsManager.get(KEY_DATE_FORMAT),
      this.settingsManager.get(KEY_USER_DICTIONARY_LIST),
      this.settingsManager.get(KEY_AI_PREDICTOR_ENABLED),
      this.settingsManager.get(KEY_AI_MODEL_ID),
      this.settingsManager.get(KEY_AI_PREDICTION_TIMEOUT_MS),
      this.settingsManager.get(KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED),
      this.settingsManager.get(KEY_DEBUG_AI_PREDICTOR_ENABLED),
    ]);

    const textExpansions = textExpansionsRaw as Array<[string, object]>;
    return {
      language,
      textExpansions,
      predictionConfig: {
        numSuggestions: numSuggestions as number,
        engineNumSuggestions: MAX_NUM_SUGGESTIONS,
        minWordLengthToPredict: minWordLengthToPredict as number,
        insertSpaceAfterAutocomplete: insertSpaceAfterAutocomplete as boolean,
        autoCapitalize: autoCapitalize as boolean,
        applySpacingRules: applySpacingRules as boolean,
        textExpansions,
        variableExpansion: variableExpansion as boolean,
        timeFormat: timeFormat as string,
        dateFormat: dateFormat as string,
        userDictionaryList: userDictionaryList as string[],
        aiPredictorEnabled: this.options.enableAIPredictor
          ? typeof aiPredictorEnabled === "boolean"
            ? aiPredictorEnabled
            : DEFAULT_AI_PREDICTOR_ENABLED
          : false,
        aiModelId:
          typeof aiModelId === "string" && aiModelId.trim().length > 0
            ? aiModelId
            : DEFAULT_AI_MODEL_ID,
        aiPredictionTimeoutMs: clampAIPredictionTimeoutMs(aiPredictionTimeoutMs),
        debugPresagePredictorEnabled: this.options.isDevBuild
          ? typeof debugPresagePredictorEnabled === "boolean"
            ? debugPresagePredictorEnabled
            : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED
          : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
        debugAIPredictorEnabled: this.options.isDevBuild
          ? typeof debugAIPredictorEnabled === "boolean"
            ? debugAIPredictorEnabled
            : DEFAULT_DEBUG_AI_PREDICTOR_ENABLED
          : DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
      },
    };
  }

  async resolveDomainConfigOverrides(
    domainURL: string,
  ): Promise<{ lang: string; inline_suggestion: boolean }> {
    const domainSettings = await resolveDomainRuntimeSettings(
      this.settingsManager,
      domainURL,
    );
    return {
      lang: domainSettings.language,
      inline_suggestion: domainSettings.inlineSuggestion,
    };
  }
}
