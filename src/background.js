import { getDomain, isEnabledForDomain, checkLastError } from "./utils.js";
import { Store } from "./third_party/fancier-settings/lib/store.js";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_SEPERATOR_CHARS_REGEX,
  LANG_SEPERATOR_CHARS_REGEX,
} from "./lang.js";
import { PresageHandler } from "./presageHandler.js";
import libPresageMod from "./third_party/libpresage/libpresage.js";

class BackgrounServiceWorker {
  constructor() {
    if (BackgrounServiceWorker.instance) {
      return BackgrounServiceWorker.instance;
    }
    BackgrounServiceWorker.instance = this;

    this.settings = new Store("settings");
  }

  async _doInitializePresagee() {
    const Module = await libPresageMod();
    this.presageHandler = new PresageHandler(Module);
    this.updatePresageConfig();
  }

  async _initializePresage() {
    if (!this.initializationPromise) {
      this.initializationPromise = this._doInitializePresagee();
    }
    return this.initializationPromise;
  }

  async runPrediction(message) {
    await this._initializePresage();
    const result = this.presageHandler.runPrediction(
      message.context.text,
      message.context.nextChar,
      message.context.lang
    );
    message.context.predictions = result.predictions;
    message.context.forceReplace = result.forceReplace;

    chrome.tabs.get(message.context.tabId, function (tab) {
      checkLastError();

      if (tab) {
        // Update command to indicate orign of the message
        message.command = "backgroundPagePredictResp";
        chrome.tabs.sendMessage(message.context.tabId, message, {
          frameId: message.context.frameId,
        });
      }
    });
  }

  async detectLanguage(text, tabId) {
    const fallbackLanguage = this.settings.get("fallbackLanguage");
    const result = await chrome.i18n.detectLanguage(text);

    let detectedLanguage = null;
    let maxpercentage = -1;

    for (let i = 0; i < result.languages.length; i++) {
      if (result.languages[i].language in SUPPORTED_LANGUAGES) {
        if (result.languages[i].percentage > maxpercentage) {
          detectedLanguage = result.languages[i].language;
          maxpercentage = result.languages[i].percentage;
        }
      }
    }
    if (detectedLanguage) return detectedLanguage;

    const pageLang = await chrome.tabs.detectLanguage(tabId);
    if (pageLang in SUPPORTED_LANGUAGES) {
      return pageLang;
    }

    return fallbackLanguage;
  }

  toggleOnOffActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      checkLastError();
      if (tabs.length === 1) {
        const currentTab = tabs[0];

        const message = {
          command: "backgroundPageToggle",
          context: {},
        };

        chrome.tabs.sendMessage(currentTab.id, message);
      }
    });
  }

  async updatePresageConfig() {
    await this._initializePresage();

    this.presageHandler.setConfig(
      await this.settings.get("numSuggestions"),
      await this.settings.get("minWordLengthToPredict"),
      await this.settings.get("insertSpaceAfterAutocomplete"),
      await this.settings.get("autoCapitalize"),
      await this.settings.get("applySpacingRules"),
      await this.settings.get("textExpansions")
    );
  }
}

function onInstalled(details) {
  checkLastError();
  if (details.reason === "install") {
    chrome.tabs.create({
      url: "new_installation/index.html",
    });
  } else if (details.reason === "update") {
    const thisVersion = chrome.runtime.getManifest().version;
    console.log(
      "Updated from " + details.previousVersion + " to " + thisVersion + "!"
    );
    // chrome.tabs.create({url: "options/index.html"});
  }
}

function onCommand(command) {
  const backgrounServiceWorker = new BackgrounServiceWorker();
  switch (command) {
    case "toggle-ft-active-tab":
      backgrounServiceWorker.toggleOnOffActiveTab();
      break;

    default:
      console.log("Unknown command: ", command);
      break;
  }
}

//Messages from option page and content script
function onMessage(request, sender, sendResponse) {
  const backgrounServiceWorker = new BackgrounServiceWorker();
  let asyncResponse = false;
  checkLastError();

  request.context.tabId = sender?.tab?.id;
  request.context.frameId = sender.frameId;

  switch (request.command) {
    case "contentScriptPredictReq":
      request.command = "backgroundPagePredictReq";

      asyncResponse = true;
      backgrounServiceWorker.settings
        .get("language")
        .then(async (language) => {
          if (language === "auto_detect") {
            language = await backgrounServiceWorker.detectLanguage(
              request.context.text,
              request.context.tabId
            );
          }

          if (request.context.lang !== language) {
            sendResponse({
              command: "backgroundPageUpdateLangConfig",
              context: {
                lang: language,
                autocompleteSeparatorSource:
                  LANG_SEPERATOR_CHARS_REGEX[language].source,
                tributeId: request.context.tributeId,
              },
            });
          } else {
            request.context.lang = language;
            request.context.langName =
              SUPPORTED_LANGUAGES[request.context.lang];
            backgrounServiceWorker.runPrediction(request);
            sendResponse();
          }
        })
        .catch(function (e) {
          console.error(e);
        });

      break;

    case "optionsPageConfigChange":
      backgrounServiceWorker.updatePresageConfig();
      break;

    case "contentScriptGetConfig":
      asyncResponse = true;
      Promise.all([
        isEnabledForDomain(
          backgrounServiceWorker.settings,
          getDomain(sender.tab.url)
        ),
        backgrounServiceWorker.settings.get("autocomplete"),
        backgrounServiceWorker.settings.get("selectByDigit"),
        backgrounServiceWorker.settings.get("language"),
      ])
        .then((values) => {
          sendResponse({
            command: "backgroundPageSetConfig",
            context: {
              enabled: values[0],
              autocomplete: values[1],
              selectByDigit: values[2],
              lang: values[3],
              autocompleteSeparatorSource: (
                LANG_SEPERATOR_CHARS_REGEX[values[3]] ||
                DEFAULT_SEPERATOR_CHARS_REGEX
              ).source,
            },
          });
        })
        .catch(function (e) {
          console.error(e);
        });

      break;
  }

  return asyncResponse;
}

chrome.runtime.onInstalled.addListener(onInstalled);
chrome.commands.onCommand.addListener(onCommand);
chrome.runtime.onMessage.addListener(onMessage);
