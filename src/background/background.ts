import {
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_BACKGROUND_PAGE_PREDICT_REQ,
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_CONTENT_SCRIPT_USAGE_EVENT,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_POPUP_ACK_WEEKLY_RECAP,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE,
  KEY_DISPLAY_LANG_HEADER,
  KEY_INLINE_SUGGESTION,
  KEY_REVERT_ON_BACKSPACE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_SELECT_BY_DIGIT,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE,
  KEY_LANGUAGE,
  KEY_ENABLED_LANGUAGES,
  KEY_ENABLED,
  KEY_NUM_SUGGESTIONS,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_AUTO_CAPITALIZE,
  KEY_APPLY_SPACING_RULES,
  KEY_TEXT_EXPANSIONS,
  KEY_VARIABLE_EXPANSION,
  KEY_TIME_FORMAT,
  KEY_DATE_FORMAT,
  KEY_USER_DICTIONARY_LIST,
  KEY_SITE_PROFILES,
  KEY_AI_PREDICTOR_ENABLED,
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  DEFAULT_AI_PREDICTOR_ENABLED,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PREDICTION_TIMEOUT_MS,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
  MAX_NUM_SUGGESTIONS,
} from "../shared/constants";
import { getDomain, isEnabledForDomain, checkLastError } from "../shared/utils";
import { logError } from "../shared/error";
import { resolveEnabledLanguages } from "../shared/lang";
import { JsonValue, SettingsManager } from "../shared/settingsManager";
import {
  getSiteProfileForDomain,
  resolveSiteProfiles,
  setSiteProfileForDomain,
} from "../shared/siteProfiles";
import { LanguageDetector } from "./LanguageDetector";
import { PresageConfig } from "./PresageHandler";
import { PredictionManager } from "./PredictionManager";
import { TabMessenger } from "./TabMessenger";
import { migrateToLocalStore } from "./Migration";
import { ProductivityStatsManager } from "./ProductivityStatsManager";
import {
  Message,
  PredictRequestMessage,
  PredictResponseMessage,
  ConfigMessage,
  ToggleActiveTabMessage,
  TriggerActiveTabMessage,
  UpdateLangConfigMessage,
  ContentScriptPredictRequestMessage,
  OptionsPageConfigChangeMessage,
  ContentScriptGetConfigMessage,
  ContentScriptUsageEventMessage,
  PopupGetProductivityStatsMessage,
  PopupAckWeeklyRecapMessage,
  PopupAckDonationMilestoneMessage,
  OptionsResetProductivityStatsMessage,
  OptionsGetPredictorDebugSnapshotMessage,
  OptionsClearPredictorDebugTraceMessage,
} from "../shared/messageTypes";

declare const __FT_DEV_BUILD__: boolean | undefined;
declare const __FT_E2E_BUILD__: boolean | undefined;

const IS_DEV_BUILD =
  typeof __FT_DEV_BUILD__ !== "undefined" && Boolean(__FT_DEV_BUILD__);
const IS_E2E_BUILD =
  typeof __FT_E2E_BUILD__ !== "undefined" && Boolean(__FT_E2E_BUILD__);
const ENABLE_TEST_RUNTIME_HOOKS = IS_DEV_BUILD || IS_E2E_BUILD;

interface DomainRuntimeSettings {
  language: string;
  enabledLanguages: string[];
  inlineSuggestion: boolean;
  numSuggestions: number;
  hasNumSuggestionsOverride: boolean;
}

function clampNumSuggestions(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(value)));
}

function clampAIPredictionTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AI_PREDICTION_TIMEOUT_MS;
  }
  return Math.min(2000, Math.max(20, Math.round(value)));
}

async function resolveDomainRuntimeSettings(
  settingsManager: SettingsManager,
  domainURL?: string,
): Promise<DomainRuntimeSettings> {
  const [globalLanguage, enabledLanguages, inlineSuggestionGlobal, numGlobal] =
    await Promise.all([
      resolveActiveLanguage(settingsManager),
      getEnabledLanguages(settingsManager),
      settingsManager.get(KEY_INLINE_SUGGESTION),
      settingsManager.get(KEY_NUM_SUGGESTIONS),
    ]);
  const siteProfilesRaw = await settingsManager.get(KEY_SITE_PROFILES);
  const profile = domainURL
    ? getSiteProfileForDomain(siteProfilesRaw, domainURL, enabledLanguages)
    : undefined;

  const language = profile?.language ?? globalLanguage;
  const inlineSuggestion =
    typeof profile?.inline_suggestion === "boolean"
      ? profile.inline_suggestion
      : Boolean(inlineSuggestionGlobal);
  const hasNumSuggestionsOverride = typeof profile?.numSuggestions === "number";
  const numSuggestions = clampNumSuggestions(
    hasNumSuggestionsOverride ? profile?.numSuggestions : numGlobal,
  );

  return {
    language,
    enabledLanguages,
    inlineSuggestion,
    numSuggestions,
    hasNumSuggestionsOverride,
  };
}

async function sanitizeSiteProfilesSetting(
  settingsManager: SettingsManager,
): Promise<void> {
  const [siteProfilesRaw, enabledLanguagesRaw] = await Promise.all([
    settingsManager.get(KEY_SITE_PROFILES),
    settingsManager.get(KEY_ENABLED_LANGUAGES),
  ]);
  const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
  const sanitizedSiteProfiles = resolveSiteProfiles(
    siteProfilesRaw,
    enabledLanguages,
  );
  if (
    JSON.stringify(siteProfilesRaw || {}) !==
    JSON.stringify(sanitizedSiteProfiles)
  ) {
    await settingsManager.set(
      KEY_SITE_PROFILES,
      sanitizedSiteProfiles as unknown as JsonValue,
    );
  }
}

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
  ) {
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
        predictions: predictions,
        forceReplace: forceReplace,
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
    return await this.languageDetector.detectLanguage(
      text,
      tabId,
      enabledLanguages,
    );
  }

  sendCommandToActiveTabContentScript(message: Message) {
    this.tabMessenger.sendToActiveTab(message);
  }

  async getBackgroundPageSetConfigMsg(
    domainURL?: string,
  ): Promise<ConfigMessage> {
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

    // Get theme configuration
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

    const message: ConfigMessage = {
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
    return message;
  }

  async updatePresageConfig() {
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
    const config: PresageConfig = {
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
      aiPredictorEnabled:
        typeof aiPredictorEnabled === "boolean"
          ? aiPredictorEnabled
          : DEFAULT_AI_PREDICTOR_ENABLED,
      aiModelId:
        typeof aiModelId === "string" && aiModelId.trim().length > 0
          ? aiModelId
          : DEFAULT_AI_MODEL_ID,
      aiPredictionTimeoutMs: clampAIPredictionTimeoutMs(aiPredictionTimeoutMs),
      debugPresagePredictorEnabled:
        IS_DEV_BUILD
          ? typeof debugPresagePredictorEnabled === "boolean"
            ? debugPresagePredictorEnabled
            : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED
          : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
      debugAIPredictorEnabled:
        IS_DEV_BUILD
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
}

async function getEnabledLanguages(
  settingsManager: SettingsManager,
): Promise<string[]> {
  const enabledLanguages = await settingsManager.get(KEY_ENABLED_LANGUAGES);
  return resolveEnabledLanguages(enabledLanguages);
}

async function resolveActiveLanguage(
  settingsManager: SettingsManager,
): Promise<string> {
  const [language, enabledLanguagesRaw] = await Promise.all([
    settingsManager.get(KEY_LANGUAGE),
    settingsManager.get(KEY_ENABLED_LANGUAGES),
  ]);
  const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
  const currentLanguage = typeof language === "string" ? language : "";
  const allowAutoDetect = enabledLanguages.length > 1;
  if (currentLanguage === "auto_detect" && allowAutoDetect) {
    return currentLanguage;
  }
  if (enabledLanguages.includes(currentLanguage)) {
    return currentLanguage;
  }
  const fallbackLanguage = enabledLanguages[0];
  await settingsManager.set(KEY_LANGUAGE, fallbackLanguage);
  return fallbackLanguage;
}

function onInstalled(details: chrome.runtime.InstalledDetails) {
  checkLastError();
  if (details.reason === "install") {
    chrome.tabs.create({
      url: "new_installation/index.html",
    });
  } else if (details.reason === "update") {
    const thisVersion = chrome.runtime.getManifest().version;
    console.log(`Updated from ${details.previousVersion} to ${thisVersion}!`);
    migrateToLocalStore(details.previousVersion).catch((error) => {
      logError("migrateToLocalStore", error);
    });
  }
}

async function handleToggleActiveLangCommand(
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  const result =
    await backgroundServiceWorker.tabMessenger.getActiveTabHostname();
  const domainURL = result?.hostname || undefined;

  const availableLangs = await getEnabledLanguages(
    backgroundServiceWorker.settingsManager,
  );

  const domainSettings = await resolveDomainRuntimeSettings(
    backgroundServiceWorker.settingsManager,
    domainURL,
  );

  const currentLanguage = domainSettings.language;
  backgroundServiceWorker.language = currentLanguage;

  const currentLangIndex = availableLangs.indexOf(currentLanguage);
  const nextLangIndex =
    (currentLangIndex >= 0 ? currentLangIndex + 1 : 0) % availableLangs.length;
  const nextLang = availableLangs[nextLangIndex];

  const siteProfilesRaw =
    await backgroundServiceWorker.settingsManager.get(KEY_SITE_PROFILES);
  const profile = domainURL
    ? getSiteProfileForDomain(siteProfilesRaw, domainURL, availableLangs)
    : undefined;

  if (profile && domainURL) {
    await backgroundServiceWorker.settingsManager.set(
      KEY_SITE_PROFILES,
      setSiteProfileForDomain(
        siteProfilesRaw,
        domainURL,
        { ...profile, language: nextLang },
        availableLangs,
      ) as unknown as JsonValue,
    );
  } else {
    await backgroundServiceWorker.settingsManager.set(KEY_LANGUAGE, nextLang);
  }

  backgroundServiceWorker.language = nextLang;
  const updateLangConfigMessage: UpdateLangConfigMessage = {
    command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
    context: {
      lang: nextLang,
    },
  };
  backgroundServiceWorker.sendCommandToActiveTabContentScript(
    updateLangConfigMessage,
  );
}

function onCommand(command: string) {
  const backgroundServiceWorker = new BackgroundServiceWorker();
  switch (command) {
    case CMD_TOGGLE_FT_ACTIVE_TAB: {
      const message: ToggleActiveTabMessage = {
        command: CMD_TOGGLE_FT_ACTIVE_TAB,
      };
      backgroundServiceWorker.sendCommandToActiveTabContentScript(message);
      break;
    }
    case CMD_TRIGGER_FT_ACTIVE_TAB: {
      const message: TriggerActiveTabMessage = {
        command: CMD_TRIGGER_FT_ACTIVE_TAB,
      };

      backgroundServiceWorker.sendCommandToActiveTabContentScript(message);
      break;
    }
    case CMD_TOGGLE_FT_ACTIVE_LANG: {
      handleToggleActiveLangCommand(backgroundServiceWorker).catch((error) =>
        logError("onCommand CMD_TOGGLE_FT_ACTIVE_LANG", error),
      );
      break;
    }
    default:
      logError("onCommand", `Unknown command: ${command}`);
      break;
  }
}

async function handleContentScriptPredictReq(
  request: ContentScriptPredictRequestMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    const domainURL = getDomain(sender.tab?.url || "");
    const domainSettings = await resolveDomainRuntimeSettings(
      backgroundServiceWorker.settingsManager,
      domainURL,
    );
    let language = domainSettings.language;
    backgroundServiceWorker.language = language;
    if (language === "auto_detect") {
      language = await backgroundServiceWorker.detectLanguage(
        request.context.text!,
        sender.tab!.id!,
        domainSettings.enabledLanguages,
      );
    }
    if (request.context.lang !== language) {
      const updateLangConfigMessage: UpdateLangConfigMessage = {
        command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
        context: {
          lang: language,
        },
      };
      backgroundServiceWorker.sendCommandToActiveTabContentScript(
        updateLangConfigMessage,
      );
    }
    const predictRequestMessage: PredictRequestMessage = {
      command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
      context: {
        text: request.context.text,
        nextChar: request.context.nextChar,
        lang: language,
        tabId: sender.tab!.id!,
        frameId: sender.frameId!,
        // langName: SUPPORTED_LANGUAGES[language],
        tributeId: request.context.tributeId,
        requestId: request.context.requestId,
      },
    };

    backgroundServiceWorker.runPrediction(
      predictRequestMessage,
      domainSettings.hasNumSuggestionsOverride
        ? { numSuggestions: domainSettings.numSuggestions }
        : undefined,
    );
  } catch (error) {
    logError("handleContentScriptPredictReq", error);
  }
}

async function handleOptionsPageConfigChange(
  request: OptionsPageConfigChangeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    await backgroundServiceWorker.updatePresageConfig();
    sendResponse({ ok: true });
  } catch (error) {
    logError("handleOptionsPageConfigChange", error);
    sendResponse({ ok: false });
  }
}

async function handleContentScriptGetConfig(
  request: ContentScriptGetConfigMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    const domain = getDomain(sender.tab?.url || "") || "";
    const isEnabled = await isEnabledForDomain(
      backgroundServiceWorker.settingsManager,
      domain,
    );
    const message =
      await backgroundServiceWorker.getBackgroundPageSetConfigMsg(domain);
    message.context.enabled = isEnabled;
    sendResponse(message);
  } catch (error) {
    logError("handleContentScriptGetConfig", error);
  }
  return true;
}

async function handleContentScriptUsageEvent(
  request: ContentScriptUsageEventMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    await backgroundServiceWorker.productivityStatsManager.recordUsageEvent(
      request.context,
    );
    sendResponse({ ok: true });
  } catch (error) {
    logError("handleContentScriptUsageEvent", error);
    sendResponse({ ok: false });
  }
}

async function handlePopupGetProductivityStats(
  request: PopupGetProductivityStatsMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    const stats =
      await backgroundServiceWorker.productivityStatsManager.getDashboardStats();
    sendResponse(stats);
  } catch (error) {
    logError("handlePopupGetProductivityStats", error);
    sendResponse({ ok: false });
  }
}

async function handlePopupAckWeeklyRecap(
  request: PopupAckWeeklyRecapMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    await backgroundServiceWorker.productivityStatsManager.acknowledgeWeeklyRecap(
      request.context.weekKey,
    );
    sendResponse({ ok: true });
  } catch (error) {
    logError("handlePopupAckWeeklyRecap", error);
    sendResponse({ ok: false });
  }
}

async function handlePopupAckDonationMilestone(
  request: PopupAckDonationMilestoneMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    await backgroundServiceWorker.productivityStatsManager.handleDonationPromptAction(
      request.context.promptId,
      request.context.action,
      request.context.milestoneHours,
    );
    sendResponse({ ok: true });
  } catch (error) {
    logError("handlePopupAckDonationMilestone", error);
    sendResponse({ ok: false });
  }
}

async function handleOptionsResetProductivityStats(
  request: OptionsResetProductivityStatsMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    await backgroundServiceWorker.productivityStatsManager.resetStats();
    sendResponse({ ok: true });
  } catch (error) {
    logError("handleOptionsResetProductivityStats", error);
    sendResponse({ ok: false });
  }
}

async function handleOptionsGetPredictorDebugSnapshot(
  request: OptionsGetPredictorDebugSnapshotMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    await backgroundServiceWorker.predictionManager.initialize();
    sendResponse(
      backgroundServiceWorker.predictionManager.getPredictorDebugSnapshot(),
    );
  } catch (error) {
    logError("handleOptionsGetPredictorDebugSnapshot", error);
    sendResponse({ ok: false });
  }
}

async function handleOptionsClearPredictorDebugTrace(
  request: OptionsClearPredictorDebugTraceMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    backgroundServiceWorker.predictionManager.clearPredictorDebugTrace();
    sendResponse({ ok: true });
  } catch (error) {
    logError("handleOptionsClearPredictorDebugTrace", error);
    sendResponse({ ok: false });
  }
}

function onMessage(
  request: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  const backgroundServiceWorker = new BackgroundServiceWorker();
  checkLastError();

  switch (request.command) {
    case CMD_CONTENT_SCRIPT_PREDICT_REQ: {
      handleContentScriptPredictReq(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return false;
    }
    case CMD_OPTIONS_PAGE_CONFIG_CHANGE: {
      handleOptionsPageConfigChange(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return true;
    }
    case CMD_CONTENT_SCRIPT_GET_CONFIG: {
      handleContentScriptGetConfig(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return true;
    }
    case CMD_CONTENT_SCRIPT_USAGE_EVENT: {
      handleContentScriptUsageEvent(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return true;
    }
    case CMD_POPUP_GET_PRODUCTIVITY_STATS: {
      handlePopupGetProductivityStats(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return true;
    }
    case CMD_POPUP_ACK_WEEKLY_RECAP: {
      handlePopupAckWeeklyRecap(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return true;
    }
    case CMD_POPUP_ACK_DONATION_MILESTONE: {
      handlePopupAckDonationMilestone(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return true;
    }
    case CMD_OPTIONS_RESET_PRODUCTIVITY_STATS: {
      handleOptionsResetProductivityStats(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return true;
    }
    case CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT: {
      handleOptionsGetPredictorDebugSnapshot(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return true;
    }
    case CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE: {
      handleOptionsClearPredictorDebugTrace(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return true;
    }
    default: {
      logError("onMessage", `Unknown command: ${request.command}`);
      return false;
    }
  }
}

chrome.runtime.onInstalled.addListener(onInstalled);
chrome.commands.onCommand.addListener(onCommand);
chrome.runtime.onMessage.addListener(onMessage);

interface WebLLMTestPredictionCall {
  lang: string;
  predictionInput: string;
  numSuggestions: number;
}

interface WebLLMTestOverrideState {
  predictions: string[];
  delayMs: number;
  calls: WebLLMTestPredictionCall[];
}

type WebLLMTestGlobals = typeof globalThis & {
  __fluentTyperWebLLMTestOverride__?: WebLLMTestOverrideState;
  triggerCommandForTesting?: (command: string) => Promise<void> | void;
};

const WEB_LLM_TEST_OVERRIDE_KEY = "__fluentTyperWebLLMTestOverride__";
const TEST_MSG_TRIGGER_COMMAND = "TEST_TRIGGER_COMMAND";
const TEST_MSG_SET_WEBLLM_PREDICTIONS = "TEST_SET_WEBLLM_PREDICTIONS";
const TEST_MSG_CLEAR_WEBLLM_PREDICTIONS = "TEST_CLEAR_WEBLLM_PREDICTIONS";
const TEST_MSG_GET_WEBLLM_PREDICTION_CALLS = "TEST_GET_WEBLLM_PREDICTION_CALLS";

function getWebLLMTestGlobals(): WebLLMTestGlobals {
  return globalThis as WebLLMTestGlobals;
}

function setWebLLMTestOverride(predictions: string[], delayMs: number): void {
  const normalizedPredictions = predictions
    .map((prediction) => prediction.trim())
    .filter((prediction) => prediction.length > 0);
  getWebLLMTestGlobals()[WEB_LLM_TEST_OVERRIDE_KEY] = {
    predictions: normalizedPredictions,
    delayMs,
    calls: [],
  };
}

function clearWebLLMTestOverride(): void {
  delete getWebLLMTestGlobals()[WEB_LLM_TEST_OVERRIDE_KEY];
}

function getWebLLMTestPredictionCalls(): WebLLMTestPredictionCall[] {
  const override = getWebLLMTestGlobals()[WEB_LLM_TEST_OVERRIDE_KEY];
  if (!override || !Array.isArray(override.calls)) {
    return [];
  }
  return override.calls.map((call) => ({
    lang: call.lang,
    predictionInput: call.predictionInput,
    numSuggestions: call.numSuggestions,
  }));
}

if (ENABLE_TEST_RUNTIME_HOOKS) {
  if (typeof globalThis !== "undefined") {
    getWebLLMTestGlobals().triggerCommandForTesting = (command: string) => {
      onCommand(command);
    };
  }

  const testTriggerCommandAllowList = new Set<string>([
    CMD_TOGGLE_FT_ACTIVE_TAB,
    CMD_TRIGGER_FT_ACTIVE_TAB,
    CMD_TOGGLE_FT_ACTIVE_LANG,
  ]);

  const isTrustedInternalSender = (
    sender: chrome.runtime.MessageSender,
  ): boolean => {
    if (
      typeof sender.url === "string" &&
      sender.url.startsWith(chrome.runtime.getURL(""))
    ) {
      return true;
    }
    return sender.id === chrome.runtime.id && typeof sender.tab === "undefined";
  };

  // Alternative hook for Firefox BiDi tests.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message !== "object" || !message) {
      return false;
    }
    const type = (message as { type?: unknown }).type;
    if (
      type !== TEST_MSG_TRIGGER_COMMAND &&
      type !== TEST_MSG_SET_WEBLLM_PREDICTIONS &&
      type !== TEST_MSG_CLEAR_WEBLLM_PREDICTIONS &&
      type !== TEST_MSG_GET_WEBLLM_PREDICTION_CALLS
    ) {
      return false;
    }
    if (!isTrustedInternalSender(sender)) {
      sendResponse({ ok: false });
      return true;
    }

    switch (type) {
      case TEST_MSG_TRIGGER_COMMAND: {
        const command = (message as { command?: unknown }).command;
        if (
          typeof command !== "string" ||
          !testTriggerCommandAllowList.has(command)
        ) {
          sendResponse({ ok: false });
          return true;
        }
        onCommand(command);
        sendResponse({ ok: true });
        return true;
      }
      case TEST_MSG_SET_WEBLLM_PREDICTIONS: {
        const predictionsRaw = (message as { predictions?: unknown })
          .predictions;
        const delayMsRaw = (message as { delayMs?: unknown }).delayMs;
        if (!Array.isArray(predictionsRaw)) {
          sendResponse({ ok: false });
          return true;
        }
        const predictions = predictionsRaw.filter(
          (prediction): prediction is string => typeof prediction === "string",
        );
        const delayMs =
          typeof delayMsRaw === "number" && Number.isFinite(delayMsRaw)
            ? Math.max(0, Math.round(delayMsRaw))
            : 0;
        setWebLLMTestOverride(predictions, delayMs);
        sendResponse({ ok: true });
        return true;
      }
      case TEST_MSG_CLEAR_WEBLLM_PREDICTIONS: {
        clearWebLLMTestOverride();
        sendResponse({ ok: true });
        return true;
      }
      case TEST_MSG_GET_WEBLLM_PREDICTION_CALLS: {
        sendResponse({ ok: true, calls: getWebLLMTestPredictionCalls() });
        return true;
      }
      default:
        return false;
    }
  });
}

async function initializeBackgroundServiceWorker(
  lastVersion: string | undefined,
) {
  try {
    await migrateToLocalStore(lastVersion);
    const backgroundServiceWorker = new BackgroundServiceWorker();
    await backgroundServiceWorker.predictionManager.initialize();
    await backgroundServiceWorker.updatePresageConfig();
  } catch (error) {
    logError("lastVersion handler", error);
  }
}

function loadLastVersionAndInitialize(): void {
  chrome.storage.local.get("lastVersion", async (result) => {
    await initializeBackgroundServiceWorker(
      result?.lastVersion as string | undefined,
    );
  });
}

loadLastVersionAndInitialize();
