import {
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
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
  KEY_ENABLED_LANGUAGES,
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
} from "../shared/constants";
import { checkLastError } from "../shared/utils";
import { resolveEnabledLanguages } from "../shared/lang";
import { logError } from "../shared/error";
import { SettingsManager } from "../shared/settingsManager";
import { LanguageDetector } from "./LanguageDetector";
import { PredictionManager, type PredictionConfig } from "./PredictionManager";
import { TabMessenger } from "./TabMessenger";
import { ProductivityStatsManager } from "./ProductivityStatsManager";
import { migrateSettingsV3 } from "../shared/settings/SettingsMigrationV3";
import { migrateToLocalStore } from "./Migration";
import type {
  ConfigMessage,
  PredictRequestMessage,
  PredictResponseMessage,
} from "../shared/messageTypes";
import {
  clampAIPredictionTimeoutMs,
  resolveActiveLanguage,
  resolveDomainRuntimeSettings,
  sanitizeSiteProfilesSetting,
} from "./config/runtimeSettings";

declare const __FT_DEV_BUILD__: boolean | undefined;
declare const __FT_E2E_BUILD__: boolean | undefined;

export const IS_DEV_BUILD =
  typeof __FT_DEV_BUILD__ !== "undefined" && Boolean(__FT_DEV_BUILD__);
export const IS_E2E_BUILD =
  typeof __FT_E2E_BUILD__ !== "undefined" && Boolean(__FT_E2E_BUILD__);
export const ENABLE_TEST_RUNTIME_HOOKS = IS_DEV_BUILD || IS_E2E_BUILD;
export const ENABLE_AI_PREDICTOR = IS_DEV_BUILD || IS_E2E_BUILD;

export class BackgroundServiceWorker {
  static instance: BackgroundServiceWorker;
  settingsManager!: SettingsManager;
  languageDetector!: LanguageDetector;
  predictionManager!: PredictionManager;
  tabMessenger!: TabMessenger;
  productivityStatsManager!: ProductivityStatsManager;
  language!: string;

  constructor() {
    if (BackgroundServiceWorker.instance) {
      return BackgroundServiceWorker.instance;
    }
    this.settingsManager = new SettingsManager();
    this.languageDetector = new LanguageDetector(this.settingsManager);
    this.predictionManager = new PredictionManager();
    this.tabMessenger = new TabMessenger();
    this.productivityStatsManager = new ProductivityStatsManager(
      this.settingsManager,
    );
    this.language = "auto_detect";
    BackgroundServiceWorker.instance = this;
  }

  async runPrediction(
    message: PredictRequestMessage,
    configOverride?: { numSuggestions?: number },
  ): Promise<void> {
    const { predictions, forceReplace } =
      await this.predictionManager.runPrediction(
        message.context.text!,
        message.context.nextChar!,
        message.context.lang!,
        configOverride,
        {
          requestId: message.context.requestId,
          tabId: message.context.tabId,
          frameId: message.context.frameId,
          tributeId: message.context.tributeId,
        },
      );
    if (
      (!Array.isArray(predictions) || predictions.length === 0) &&
      !forceReplace
    ) {
      return;
    }
    const predictResponseMessage: PredictResponseMessage = {
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: {
        text: message.context.text,
        nextChar: message.context.nextChar,
        lang: message.context.lang,
        tabId: message.context.tabId,
        tributeId: message.context.tributeId,
        requestId: message.context.requestId,
        frameId: message.context.frameId,
        predictions,
        forceReplace,
      },
    };
    chrome.tabs.get(message.context.tabId!, async function (tab) {
      checkLastError();
      if (tab) {
        await chrome.tabs.sendMessage(
          message.context.tabId!,
          predictResponseMessage,
          {
            frameId: message.context.frameId,
          },
        );
      }
    });
  }

  async detectLanguage(
    text: string,
    tabId: number,
    enabledLanguages?: string[],
  ): Promise<string> {
    return this.languageDetector.detectLanguage(text, tabId, enabledLanguages);
  }

  sendCommandToActiveTabContentScript(
    message: import("../shared/messageTypes").Message,
  ): void {
    this.tabMessenger.sendToActiveTab(message);
  }

  async getBackgroundPageSetConfigMsg(domainURL?: string): Promise<ConfigMessage> {
    const domainSettings = await resolveDomainRuntimeSettings(
      this.settingsManager,
      domainURL,
    );
    this.language = domainSettings.language;
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
        lang: this.language,
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

  async updatePresageConfig(): Promise<void> {
    await sanitizeSiteProfilesSetting(this.settingsManager);
    await this.predictionManager.initialize();
    this.language = await resolveActiveLanguage(this.settingsManager);
    const [
      numSuggestions,
      minWordLengthToPredict,
      insertSpaceAfterAutocomplete,
      autoCapitalize,
      applySpacingRules,
      textExpansions,
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

    const config: PredictionConfig = {
      numSuggestions: numSuggestions as number,
      engineNumSuggestions: MAX_NUM_SUGGESTIONS,
      minWordLengthToPredict: minWordLengthToPredict as number,
      insertSpaceAfterAutocomplete: insertSpaceAfterAutocomplete as boolean,
      autoCapitalize: autoCapitalize as boolean,
      applySpacingRules: applySpacingRules as boolean,
      textExpansions: textExpansions as Array<[string, object]>,
      variableExpansion: variableExpansion as boolean,
      timeFormat: timeFormat as string,
      dateFormat: dateFormat as string,
      userDictionaryList: userDictionaryList as string[],
      aiPredictorEnabled: ENABLE_AI_PREDICTOR
        ? typeof aiPredictorEnabled === "boolean"
          ? aiPredictorEnabled
          : DEFAULT_AI_PREDICTOR_ENABLED
        : false,
      aiModelId:
        typeof aiModelId === "string" && aiModelId.trim().length > 0
          ? aiModelId
          : DEFAULT_AI_MODEL_ID,
      aiPredictionTimeoutMs: clampAIPredictionTimeoutMs(aiPredictionTimeoutMs),
      debugPresagePredictorEnabled: IS_DEV_BUILD
        ? typeof debugPresagePredictorEnabled === "boolean"
          ? debugPresagePredictorEnabled
          : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED
        : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
      debugAIPredictorEnabled: IS_DEV_BUILD
        ? typeof debugAIPredictorEnabled === "boolean"
          ? debugAIPredictorEnabled
          : DEFAULT_DEBUG_AI_PREDICTOR_ENABLED
        : DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
    };
    this.predictionManager.setConfig(config);
    this.productivityStatsManager.setSnippetShortcuts(
      textExpansions as Array<[string, object]>,
    );
    this.tabMessenger.sendToAllTabs(
      await this.getBackgroundPageSetConfigMsg(),
      this.settingsManager,
      async (domain: string) => {
        const domainSettings = await resolveDomainRuntimeSettings(
          this.settingsManager,
          domain,
        );
        return {
          lang: domainSettings.language,
          inline_suggestion: domainSettings.inlineSuggestion,
        };
      },
    );
  }

  async initialize(lastVersion: string | undefined): Promise<void> {
    try {
      await migrateToLocalStore(lastVersion);
      await migrateSettingsV3(this.settingsManager);
      await this.predictionManager.initialize();
      await this.updatePresageConfig();
    } catch (error) {
      logError("lastVersion handler", error);
    }
  }

  async resolveEnabledLanguages(): Promise<string[]> {
    return resolveEnabledLanguages(
      await this.settingsManager.get(KEY_ENABLED_LANGUAGES),
    );
  }
}
