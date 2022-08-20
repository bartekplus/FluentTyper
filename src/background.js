import { getDomain, isDomainOnBlackList, checkLastError } from "./utils.js";
import { Store } from "./third_party/fancier-settings/lib/store.js";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_SEPERATOR_CHARS_REGEX,
  LANG_SEPERATOR_CHARS_REGEX,
} from "./third_party/libpresage/lang.js";
import { PresageHandler } from "./third_party/libpresage/presageHandler.js";
import libPresageMod from "./third_party/libpresage/libpresage.js";

class BackgrounPage {
  constructor() {
    if (BackgrounPage.instance) {
      return BackgrounPage.instance;
    }
    BackgrounPage.instance = this;

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

  async isEnabledForDomain(domainURL) {
    let enabledForDomain = await this.settings.get("enable");
    if (enabledForDomain) {
      if (await isDomainOnBlackList(this.settings, domainURL)) {
        enabledForDomain = false;
      }
    }
    return enabledForDomain;
  }

  detectLanguage(request, sendResponse) {
    chrome.i18n.detectLanguage(request.context.text, (result) => {
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

      if (detectedLanguage) {
        if (detectedLanguage !== request.context.lang) {
          sendResponse({
            command: "backgroundPageUpdateLangConfig",
            context: {
              lang: detectedLanguage,
              autocompleteSeparatorSource:
                LANG_SEPERATOR_CHARS_REGEX[detectedLanguage].source,
              tributeId: request.context.tributeId,
            },
          });
        } else {
          request.context.lang = detectedLanguage;
          request.context.langName = SUPPORTED_LANGUAGES[request.context.lang];
          this.runPrediction(request);
          sendResponse();
        }
      } else {
        chrome.tabs.detectLanguage(request.context.tabId, async (ret) => {
          let lang = await this.settings.get("fallbackLanguage");

          if (ret in SUPPORTED_LANGUAGES) {
            lang = ret;
          }
          if (lang !== request.context.lang) {
            sendResponse({
              command: "backgroundPageUpdateLangConfig",
              context: {
                lang: lang,
                autocompleteSeparatorSource:
                  LANG_SEPERATOR_CHARS_REGEX[lang].source,
                tributeId: request.context.tributeId,
              },
            });
          } else {
            request.context.lang = lang;
            request.context.langName =
              SUPPORTED_LANGUAGES[request.context.lang];
            this.runPrediction(request);
            sendResponse();
          }
        });
      }
    });
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
  const backgrounPage = new BackgrounPage();
  switch (command) {
    case "toggle-ft-active-tab":
      backgrounPage.toggleOnOffActiveTab();
      break;

    default:
      console.log("Unknown command: ", command);
      break;
  }
}

//Messages from option page and content script
function onMessage(request, sender, sendResponse) {
  console.log("xxxxxxxxx");
  const backgrounPage = new BackgrounPage();
  let asyncResponse = false;
  checkLastError();

  request.context.tabId = sender?.tab?.id;
  request.context.frameId = sender.frameId;

  switch (request.command) {
    case "contentScriptPredictReq":
      request.command = "backgroundPagePredictReq";

      asyncResponse = true;
      backgrounPage.settings
        .get("language")
        .then((language) => {
          if (language === "auto_detect") {
            asyncResponse = true;
            backgrounPage.detectLanguage(request, sendResponse);
          } else {
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
              backgrounPage.runPrediction(request);
              sendResponse();
            }
          }
        })
        .catch(function (e) {
          console.error(e);
        });

      break;

    case "optionsPageConfigChange":
      backgrounPage.updatePresageConfig();
      break;

    case "contentScriptGetConfig":
      asyncResponse = true;
      Promise.all([
        backgrounPage.isEnabledForDomain(getDomain(sender.tab.url)),
        backgrounPage.settings.get("autocomplete"),
        backgrounPage.settings.get("selectByDigit"),
        backgrounPage.settings.get("language"),
      ])
        .then((values) => {
          console.log("ogien!");
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
