import {
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  CMD_TOGGLE_FT_ACTIVE_LANG,
} from "../shared/constants.ts";
import { getDomain, isEnabledForDomain, checkLastError } from "../shared/utils.ts";
import { Store } from "../third_party/fancier-settings/lib/store.js";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_SEPERATOR_CHARS_REGEX,
  LANG_SEPERATOR_CHARS_REGEX,
} from "../shared/lang.ts";
import { PresageHandler } from "./presageHandler.ts";
import libPresageMod from "../third_party/libpresage/libpresage.js";
import { SettingsManager } from "../shared/settingsManager.ts";
import { LanguageDetector } from "./languageDetector.ts";
import { PredictionManager } from "./predictionManager.ts";
import { TabMessenger } from "./tabMessenger.ts";
import { migrateToLocalStore } from "./migration.ts";

class BackgroundServiceWorker {
  constructor() {
    if (BackgroundServiceWorker.instance) {
      return BackgroundServiceWorker.instance;
    }
    BackgroundServiceWorker.instance = this;

    this.settingsManager = new SettingsManager(Store);
    this.languageDetector = new LanguageDetector(this.settingsManager);
    this.predictionManager = new PredictionManager(PresageHandler, libPresageMod);
    this.tabMessenger = new TabMessenger();
    this.language = "auto_detect";
  }

  async runPrediction(message) {
    await this.predictionManager.initialize();
    const { predictions, forceReplace } = this.predictionManager.runPrediction(
      message.context.text,
      message.context.nextChar,
      message.context.lang,
    );
    message.context.predictions = predictions;
    message.context.forceReplace = forceReplace;
    chrome.tabs.get(message.context.tabId, async function (tab) {
      checkLastError();
      if (tab) {
        message.command = "backgroundPagePredictResp";
        await chrome.tabs.sendMessage(message.context.tabId, message, {
          frameId: message.context.frameId,
        });
      }
    });
  }

  /**
   * Detects the language of the given text, using the Chrome i18n API,
   * and falls back to the configured fallback language if no supported
   * language is detected.
   *
   * @param {string} text - The text to detect the language of.
   * @param {number} tabId - The ID of the tab where the text is located.
   * @returns {string} The detected language, or the fallback language if no
   * supported language is detected.
   */
  async detectLanguage(text, tabId) {
    return await this.languageDetector.detectLanguage(text, tabId);
  }

  /**
   * Toggles the content script on or off for the active tab.
   */
  sendCommandToActiveTabContentScript(command, context = {}) {
    this.tabMessenger.sendToActiveTab(command, context);
  }

  // Define an asynchronous function that takes a boolean value indicating whether to enable the background page configuration message
  async getBackgroundPageSetConfigMsg() {
    this.language = await this.settingsManager.get("language");

    // Define an object containing the configuration information that will be sent as a message
    const message = {
      command: CMD_BACKGROUND_PAGE_SET_CONFIG,
      context: {
        autocomplete: await this.settingsManager.get("autocomplete"), // Retrieve the "autocomplete" setting value from the BackgroundServiceWorker instance
        autocompleteOnEnter: await this.settingsManager.get(
          "autocompleteOnEnter",
        ), // Retrieve the "autocompleteOnEnter" setting value from the BackgroundServiceWorker instance
        autocompleteOnTab: await this.settingsManager.get("autocompleteOnTab"), // Retrieve the "autocompleteOnTab" setting value from the BackgroundServiceWorker instance
        selectByDigit: await this.settingsManager.get("selectByDigit"), // Retrieve the "selectByDigit" setting value from the BackgroundServiceWorker instance
        lang: this.language, // Set the "lang" value to the retrieved language setting value
        autocompleteSeparatorSource: this.language
          ? LANG_SEPERATOR_CHARS_REGEX[this.language].source // Retrieve the separator character regex pattern based on the language setting value
          : DEFAULT_SEPERATOR_CHARS_REGEX.source, // Use the default pattern if the language setting value is undefined or null
        minWordLengthToPredict: await this.settingsManager.get(
          "minWordLengthToPredict",
        ),
        revertOnBackspace: await this.settingsManager.get("revertOnBackspace"),
      },
    };

    // Return the configuration message object
    return message;
  }

  /**
   * Updates the configuration of the Presage handler and sends it to all tabs.
   */
  async updatePresageConfig() {
    await this.predictionManager.initialize();
    this.language = await this.settingsManager.get("language");
    const config = {
      numSuggestions: await this.settingsManager.get("numSuggestions"),
      minWordLengthToPredict: await this.settingsManager.get("minWordLengthToPredict"),
      insertSpaceAfterAutocomplete: await this.settingsManager.get("insertSpaceAfterAutocomplete"),
      autoCapitalize: await this.settingsManager.get("autoCapitalize"),
      applySpacingRules: await this.settingsManager.get("applySpacingRules"),
      textExpansions: await this.settingsManager.get("textExpansions"),
      variableExpansion: await this.settingsManager.get("variableExpansion"),
      timeFormat: await this.settingsManager.get("timeFormat"),
      dateFormat: await this.settingsManager.get("dateFormat"),
      userDictionaryList: await this.settingsManager.get("userDictionaryList"),
    };
    this.predictionManager.setConfig(config);
    this.tabMessenger.sendToAllTabs(
      await this.getBackgroundPageSetConfigMsg(),
      this.settingsManager
    );
  }
}

/**
 * Function that is called when the extension is installed or updated.
 * @param {Object} details - The installation or update details.
 */
function onInstalled(details) {
  // Check for any errors that occurred during the installation or update.
  checkLastError();

  // If the extension was just installed, open the "new installation" page.
  if (details.reason === "install") {
    chrome.tabs.create({
      url: "new_installation/index.html",
    });
  }
  // If the extension was just updated, log the previous and current versions to the console.
  else if (details.reason === "update") {
    const thisVersion = chrome.runtime.getManifest().version;
    console.log(`Updated from ${details.previousVersion} to ${thisVersion}!`);
    // TODO: Uncomment the following line to open the options page after an update.
    // chrome.tabs.create({url: "options/index.html"});
    try {
      migrateToLocalStore(details.previousVersion);
    } catch (error) {
      console.log(error);
    }
  }
}

/**
 * Function that is called when a registered command is invoked.
 * @param {string} command - The command that was invoked.
 */
function onCommand(command) {
  // Create a new instance of the background service worker.
  const backgroundServiceWorker = new BackgroundServiceWorker();

  // Use a switch statement to determine which command was invoked.
  switch (command) {
    case CMD_TOGGLE_FT_ACTIVE_TAB:
      // Call the toggleOnOffActiveTab method on the background service worker.
      backgroundServiceWorker.sendCommandToActiveTabContentScript(
        CMD_TOGGLE_FT_ACTIVE_TAB,
      );
      break;

    case CMD_TRIGGER_FT_ACTIVE_TAB:
      backgroundServiceWorker.sendCommandToActiveTabContentScript(
        CMD_TRIGGER_FT_ACTIVE_TAB,
      );
      break;
    case CMD_TOGGLE_FT_ACTIVE_LANG: {
      // Define the list of languages to cycle through, including auto_detect
      const availableLangs = [
        ...Object.keys(SUPPORTED_LANGUAGES), // Get keys if it's an object
      ];

      // Supported LANGAUGE if associative array -> fix it
      const currentLangIndex = availableLangs.indexOf(
        backgroundServiceWorker.language,
      );
      // Calculate the next index, wrapping around
      const nextLangIndex = (currentLangIndex + 1) % availableLangs.length;
      const nextLang = availableLangs[nextLangIndex];

      backgroundServiceWorker.settingsManager.set("language", nextLang);
      backgroundServiceWorker.language = nextLang;

      const context = {
        lang: nextLang,
        autocompleteSeparatorSource:
          LANG_SEPERATOR_CHARS_REGEX[nextLang].source,
      };

      backgroundServiceWorker.sendCommandToActiveTabContentScript(
        CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
        context,
      );
      break;
    }
    default:
      // Log an error message if the command is unknown.
      console.error("Unknown command: ", command);
      break;
  }
}

// --- Message Handlers ---
async function handleContentScriptPredictReq(request, sender, sendResponse, backgroundServiceWorker) {
  // Modify the command and set asyncResponse to true.
  request.command = "backgroundPagePredictReq";

  try {
    // Get the language from the settings.
    let language = await backgroundServiceWorker.settingsManager.get("language");
    backgroundServiceWorker.language = language;

    // If language is set to auto-detect, detect the language.
    if (language === "auto_detect") {
      language = await backgroundServiceWorker.detectLanguage(
        request.context.text,
        request.context.tabId,
      );
    }

    // If the language has changed, update the configuration.
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
      // Otherwise, run prediction and send a response.
      request.context.lang = language;
      request.context.langName =
        SUPPORTED_LANGUAGES[request.context.lang];
      await backgroundServiceWorker.runPrediction(request);
      sendResponse();
    }
  } catch (e) {
    console.error(e);
  }
}

function handleOptionsPageConfigChange(request, sender, sendResponse, backgroundServiceWorker) {
  backgroundServiceWorker.updatePresageConfig();
}

async function handleContentScriptGetConfig(request, sender, sendResponse, backgroundServiceWorker) {
  try {
    const isEnabled = await isEnabledForDomain(
      backgroundServiceWorker.settingsManager,
      getDomain(sender.tab.url),
    );
    const message = await backgroundServiceWorker.getBackgroundPageSetConfigMsg();
    message.context.enabled = isEnabled;
    sendResponse(message);
  } catch (e) {
    console.error(e);
  }
  return true;
}

const messageHandlers = {
  contentScriptPredictReq: handleContentScriptPredictReq,
  optionsPageConfigChange: handleOptionsPageConfigChange,
  contentScriptGetConfig: handleContentScriptGetConfig,
};

/**
 * Handles messages received from the options page and content script.
 * @param {Object} request - The message sent by the sender.
 * @param {Object} sender - The sender of the message.
 * @param {Function} sendResponse - A function to send a response to the sender.
 * @returns {boolean} - A flag indicating whether the response is async.
 */
function onMessage(request, sender, sendResponse) {
  // Create a new instance of the background service worker.
  const backgroundServiceWorker = new BackgroundServiceWorker();

  // Check for any errors that occurred previously.
  checkLastError();

  // Add tabId and frameId to the request context.
  request.context.tabId = sender?.tab?.id;
  request.context.frameId = sender.frameId;

  // Use a handler map to determine which handler to call.
  const handler = messageHandlers[request.command];
  if (handler) {
    // Always return true for async handlers
    const result = handler(request, sender, sendResponse, backgroundServiceWorker);
    if (result && typeof result.then === "function") {
      return true;
    }
    // For sync handlers, still return true to allow async sendResponse
    return true;
  }
  return false;
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
