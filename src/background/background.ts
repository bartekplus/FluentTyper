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
} from "../shared/constants";
import { getDomain, isEnabledForDomain, checkLastError } from "../shared/utils";
import { logError } from "../shared/error";
import { resolveEnabledLanguages } from "../shared/lang";
import { SettingsManager } from "../shared/settingsManager";
import { LanguageDetector } from "./LanguageDetector";
import { PresageConfig } from "./PresageHandler";
import { PredictionManager } from "./PredictionManager";
import { TabMessenger } from "./TabMessenger";
import { migrateToLocalStore } from "./Migration";
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
} from "../shared/messageTypes";

export class BackgroundServiceWorker {
  static instance: BackgroundServiceWorker;
  settingsManager!: SettingsManager;
  languageDetector!: LanguageDetector;
  predictionManager!: PredictionManager;
  tabMessenger!: TabMessenger;
  language!: string;

  constructor() {
    if (BackgroundServiceWorker.instance) {
      return BackgroundServiceWorker.instance;
    }
    this.settingsManager = new SettingsManager();
    this.languageDetector = new LanguageDetector(this.settingsManager);
    this.predictionManager = new PredictionManager();
    this.tabMessenger = new TabMessenger();
    this.language = "auto_detect";
    BackgroundServiceWorker.instance = this;
  }

  async runPrediction(message: PredictRequestMessage) {
    const { predictions, forceReplace } =
      await this.predictionManager.runPrediction(
        message.context.text!,
        message.context.nextChar!,
        message.context.lang!,
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

  async getBackgroundPageSetConfigMsg(): Promise<ConfigMessage> {
    this.language = await resolveActiveLanguage(this.settingsManager);
    const [
      enabled,
      autocomplete,
      autocompleteOnEnter,
      autocompleteOnTab,
      selectByDigit,
      minWordLengthToPredict,
      revertOnBackspace,
      displayLangHeader,
      inline_suggestion,
    ] = await Promise.all([
      this.settingsManager.get(KEY_ENABLED),
      this.settingsManager.get(KEY_AUTOCOMPLETE),
      this.settingsManager.get(KEY_AUTOCOMPLETE_ON_ENTER),
      this.settingsManager.get(KEY_AUTOCOMPLETE_ON_TAB),
      this.settingsManager.get(KEY_SELECT_BY_DIGIT),
      this.settingsManager.get(KEY_MIN_WORD_LENGTH_TO_PREDICT),
      this.settingsManager.get(KEY_REVERT_ON_BACKSPACE),
      this.settingsManager.get(KEY_DISPLAY_LANG_HEADER),
      this.settingsManager.get(KEY_INLINE_SUGGESTION),
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
        inline_suggestion: inline_suggestion as boolean,
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
    ]);
    const config: PresageConfig = {
      numSuggestions: numSuggestions as number,
      minWordLengthToPredict: minWordLengthToPredict as number,
      insertSpaceAfterAutocomplete: insertSpaceAfterAutocomplete as boolean,
      autoCapitalize: autoCapitalize as boolean,
      applySpacingRules: applySpacingRules as boolean,
      textExpansions: textExpansions as Array<[string, object]>,
      variableExpansion: variableExpansion as boolean,
      timeFormat: timeFormat as string,
      dateFormat: dateFormat as string,
      userDictionaryList: userDictionaryList as string[],
    };
    this.predictionManager.setConfig(config);
    this.tabMessenger.sendToAllTabs(
      await this.getBackgroundPageSetConfigMsg(),
      this.settingsManager,
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
      (async () => {
        const availableLangs = await getEnabledLanguages(
          backgroundServiceWorker.settingsManager,
        );
        const currentLanguage = await resolveActiveLanguage(
          backgroundServiceWorker.settingsManager,
        );
        backgroundServiceWorker.language = currentLanguage;
        const currentLangIndex = availableLangs.indexOf(currentLanguage);
        const nextLangIndex =
          (currentLangIndex >= 0 ? currentLangIndex + 1 : 0) %
          availableLangs.length;
        const nextLang = availableLangs[nextLangIndex];
        await backgroundServiceWorker.settingsManager.set(
          KEY_LANGUAGE,
          nextLang,
        );
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
      })().catch((error) => logError("onCommand", error));
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
    let language = await resolveActiveLanguage(
      backgroundServiceWorker.settingsManager,
    );
    backgroundServiceWorker.language = language;
    if (language === "auto_detect") {
      const enabledLanguages = await getEnabledLanguages(
        backgroundServiceWorker.settingsManager,
      );
      language = await backgroundServiceWorker.detectLanguage(
        request.context.text!,
        sender.tab!.id!,
        enabledLanguages,
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
    } else {
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

      backgroundServiceWorker.runPrediction(predictRequestMessage);
    }
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
    const isEnabled = await isEnabledForDomain(
      backgroundServiceWorker.settingsManager,
      getDomain(sender.tab!.url! as string) as string,
    );
    const message =
      await backgroundServiceWorker.getBackgroundPageSetConfigMsg();
    message.context.enabled = isEnabled;
    sendResponse(message);
  } catch (error) {
    logError("handleContentScriptGetConfig", error);
  }
  return true;
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
    default: {
      logError("onMessage", `Unknown command: ${request.command}`);
      return false;
    }
  }
}

chrome.runtime.onInstalled.addListener(onInstalled);
chrome.commands.onCommand.addListener(onCommand);
chrome.runtime.onMessage.addListener(onMessage);
chrome.storage.local.get("lastVersion", async (result) => {
  try {
    await migrateToLocalStore(result.lastVersion as string);
    const backgroundServiceWorker = new BackgroundServiceWorker();
    await backgroundServiceWorker.predictionManager.initialize();
    await backgroundServiceWorker.updatePresageConfig();
  } catch (error) {
    logError("lastVersion handler", error);
  }
});
