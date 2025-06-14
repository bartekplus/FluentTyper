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
  KEY_REVERT_ON_BACKSPACE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_SELECT_BY_DIGIT,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE,
} from "../shared/constants";
import { getDomain, isEnabledForDomain, checkLastError } from "../shared/utils";
import { SUPPORTED_LANGUAGES } from "../shared/lang";
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

class BackgroundServiceWorker {
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

  async detectLanguage(text: string, tabId: number): Promise<string> {
    return await this.languageDetector.detectLanguage(text, tabId);
  }

  sendCommandToActiveTabContentScript(message: Message) {
    this.tabMessenger.sendToActiveTab(message);
  }

  async getBackgroundPageSetConfigMsg(): Promise<ConfigMessage> {
    this.language = (await this.settingsManager.get("language")) as string;
    const message: ConfigMessage = {
      command: CMD_BACKGROUND_PAGE_SET_CONFIG,
      context: {
        enabled: (await this.settingsManager.get("enabled")) as boolean,
        autocomplete: (await this.settingsManager.get(
          KEY_AUTOCOMPLETE,
        )) as boolean,
        autocompleteOnEnter: (await this.settingsManager.get(
          KEY_AUTOCOMPLETE_ON_ENTER,
        )) as boolean,
        autocompleteOnTab: (await this.settingsManager.get(
          KEY_AUTOCOMPLETE_ON_TAB,
        )) as boolean,
        selectByDigit: (await this.settingsManager.get(
          KEY_SELECT_BY_DIGIT,
        )) as boolean,
        lang: this.language,
        minWordLengthToPredict: (await this.settingsManager.get(
          KEY_MIN_WORD_LENGTH_TO_PREDICT,
        )) as number,
        revertOnBackspace: (await this.settingsManager.get(
          KEY_REVERT_ON_BACKSPACE,
        )) as boolean,
        displayLangHeader: (await this.settingsManager.get(
          KEY_DISPLAY_LANG_HEADER,
        )) as boolean,
      },
    };
    return message;
  }

  async updatePresageConfig() {
    await this.predictionManager.initialize();
    this.language = (await this.settingsManager.get("language")) as string;
    const config: PresageConfig = {
      numSuggestions: (await this.settingsManager.get(
        "numSuggestions",
      )) as number,
      minWordLengthToPredict: (await this.settingsManager.get(
        "minWordLengthToPredict",
      )) as number,
      insertSpaceAfterAutocomplete: (await this.settingsManager.get(
        "insertSpaceAfterAutocomplete",
      )) as boolean,
      autoCapitalize: (await this.settingsManager.get(
        "autoCapitalize",
      )) as boolean,
      applySpacingRules: (await this.settingsManager.get(
        "applySpacingRules",
      )) as boolean,
      textExpansions: (await this.settingsManager.get(
        "textExpansions",
      )) as Array<[string, object]>,
      variableExpansion: (await this.settingsManager.get(
        "variableExpansion",
      )) as boolean,
      timeFormat: (await this.settingsManager.get("timeFormat")) as string,
      dateFormat: (await this.settingsManager.get("dateFormat")) as string,
      userDictionaryList: (await this.settingsManager.get(
        "userDictionaryList",
      )) as string[],
    };
    this.predictionManager.setConfig(config);
    this.tabMessenger.sendToAllTabs(
      await this.getBackgroundPageSetConfigMsg(),
      this.settingsManager,
    );
  }
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
    try {
      migrateToLocalStore(details.previousVersion);
    } catch (error) {
      console.log(error);
    }
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
      const availableLangs = [...Object.keys(SUPPORTED_LANGUAGES)];
      const currentLangIndex = availableLangs.indexOf(
        backgroundServiceWorker.language,
      );
      const nextLangIndex = (currentLangIndex + 1) % availableLangs.length;
      const nextLang = availableLangs[nextLangIndex];
      backgroundServiceWorker.settingsManager.set("language", nextLang);
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
      break;
    }
    default:
      console.error("Unknown command: ", command);
      break;
  }
}

async function handleContentScriptPredictReq(
  request: ContentScriptPredictRequestMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  try {
    let language = (await backgroundServiceWorker.settingsManager.get(
      "language",
    )) as string;
    backgroundServiceWorker.language = language;
    if (language === "auto_detect") {
      language = await backgroundServiceWorker.detectLanguage(
        request.context.text!,
        sender.tab!.id!,
      );
    }
    if (request.context.lang !== language) {
      const updateLangConfigMessage: UpdateLangConfigMessage = {
        command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
        context: {
          lang: language,
        },
      };
      sendResponse(updateLangConfigMessage);
    } else {
      const predictRequestMessage: PredictRequestMessage = {
        command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
        context: {
          text: request.context.text,
          nextChar: request.context.nextChar,
          lang: language,
          tabId: sender.tab!.id!,
          frameId: sender.frameId,
          // langName: SUPPORTED_LANGUAGES[language],
          tributeId: request.context.tributeId,
          requestId: request.context.requestId,
        },
      };

      await backgroundServiceWorker.runPrediction(predictRequestMessage);
      sendResponse();
    }
  } catch (e) {
    console.error(e);
  }
}

function handleOptionsPageConfigChange(
  request: OptionsPageConfigChangeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
  backgroundServiceWorker: BackgroundServiceWorker,
) {
  backgroundServiceWorker.updatePresageConfig();
}

async function handleContentScriptGetConfig(
  request: ContentScriptGetConfigMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
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
  } catch (e) {
    console.error(e);
  }
  return true;
}

function onMessage(
  request: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
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
      return true;
    }
    case CMD_OPTIONS_PAGE_CONFIG_CHANGE: {
      handleOptionsPageConfigChange(
        request,
        sender,
        sendResponse,
        backgroundServiceWorker,
      );
      return false;
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
      console.warn(`Unknown command: ${request.command}`);
      return false;
    }
  }
}

chrome.runtime.onInstalled.addListener(onInstalled);
chrome.commands.onCommand.addListener(onCommand);
chrome.runtime.onMessage.addListener(onMessage);
chrome.storage.local.get("lastVersion", async (result) => {
  try {
    await migrateToLocalStore(result.lastVersion);
    const backgroundServiceWorker = new BackgroundServiceWorker();
    await backgroundServiceWorker.predictionManager.initialize();
  } catch (error) {
    console.log(error);
  }
});
