import { getDomain, isEnabledForDomain, checkLastError } from "./utils.js";
import { Store } from "./third_party/fancier-settings/lib/store.js";
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGES_SHORT_CODE,
  DEFAULT_SEPERATOR_CHARS_REGEX,
  LANG_SEPERATOR_CHARS_REGEX,
} from "./lang.js";
import { PresageHandler } from "./presageHandler.js";
import libPresageMod from "./third_party/libpresage/libpresage.js";

class BackgroundServiceWorker {
  constructor() {
    if (BackgroundServiceWorker.instance) {
      return BackgroundServiceWorker.instance;
    }
    BackgroundServiceWorker.instance = this;

    this.settings = new Store("settings");
    this.language = "auto_detect";
  }

  async _doInitializePresagee() {
    // Import the Presage module using the libPresageMod() function and wait for it to resolve
    const Module = await libPresageMod();
    // Instantiate a new PresageHandler object and assign it to the presageHandler property of 'this'
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
    // Await the initialization of Presage to ensure it is ready for use
    await this._initializePresage();

    // Use destructuring to extract the predictions and forceReplace properties from the result object returned by the presageHandler
    const { predictions, forceReplace } = this.presageHandler.runPrediction(
      message.context.text,
      message.context.nextChar,
      message.context.lang,
    );

    // Update the message context with the predictions and forceReplace properties
    message.context.predictions = predictions;
    message.context.forceReplace = forceReplace;

    chrome.tabs.get(message.context.tabId, async function (tab) {
      checkLastError();

      if (tab) {
        // Update command to indicate origin of the message
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
    const fallbackLanguage = this.settings.get("fallbackLanguage");

    // Use the Chrome i18n API to detect the language of the given text.
    const api = typeof browser === "undefined" ? chrome : browser;
    const result = await api.i18n.detectLanguage(text);

    let detectedLanguage = null;
    let maxPercentage = -1;

    // Loop through the detected languages and find the supported language with the highest percentage.
    for (const language of result.languages) {
      if (
        language.language in SUPPORTED_LANGUAGES &&
        language.percentage > maxPercentage
      ) {
        detectedLanguage = language.language;
        maxPercentage = language.percentage;
      } else if (
        language.language in SUPPORTED_LANGUAGES_SHORT_CODE &&
        language.percentage > maxPercentage
      ) {
        detectedLanguage = SUPPORTED_LANGUAGES_SHORT_CODE[language.language];
        maxPercentage = language.percentage;
      }
    }

    // If a supported language was detected, return it.
    if (detectedLanguage) {
      //return detectedLanguage;
    }

    // Otherwise, try to detect the language of the tab and return it if it's a supported language.
    const pageLang = await api.tabs.detectLanguage(tabId);
    if (pageLang in SUPPORTED_LANGUAGES) {
      return pageLang;
    }
    if (pageLang in SUPPORTED_LANGUAGES_SHORT_CODE) {
      return SUPPORTED_LANGUAGES_SHORT_CODE[pageLang];
    }

    // If the language of the tab is not supported, return the fallback language.
    return fallbackLanguage;
  }

  /**
   * Toggles the content script on or off for the active tab.
   */
  sendCommandToActiveTabContentScript(command, context = {}) {
    // Query for the active tab in the current window.
    chrome.tabs.query(
      { active: true, currentWindow: true },
      async function (tabs) {
        // Check for any error that occurred during the query.
        checkLastError();

        // If exactly one tab was found, send a message to toggle the content script.
        if (tabs.length === 1) {
          const currentTab = tabs[0];

          const message = {
            command: command,
            context: context,
          };

          await chrome.tabs.sendMessage(currentTab.id, message);
        }
      },
    );
  }

  // Define an asynchronous function that takes a boolean value indicating whether to enable the background page configuration message
  async getBackgroundPageSetConfigMsg() {
    // Create an instance of the BackgroundServiceWorker class to access the settings
    const backgroundServiceWorker = new BackgroundServiceWorker();
    backgroundServiceWorker.language =
      await backgroundServiceWorker.settings.get("language");

    // Define an object containing the configuration information that will be sent as a message
    const message = {
      command: "backgroundPageSetConfig",
      context: {
        autocomplete:
          await backgroundServiceWorker.settings.get("autocomplete"), // Retrieve the "autocomplete" setting value from the BackgroundServiceWorker instance
        autocompleteOnEnter: await backgroundServiceWorker.settings.get(
          "autocompleteOnEnter",
        ), // Retrieve the "autocompleteOnEnter" setting value from the BackgroundServiceWorker instance
        autocompleteOnTab:
          await backgroundServiceWorker.settings.get("autocompleteOnTab"), // Retrieve the "autocompleteOnTab" setting value from the BackgroundServiceWorker instance
        selectByDigit:
          await backgroundServiceWorker.settings.get("selectByDigit"), // Retrieve the "selectByDigit" setting value from the BackgroundServiceWorker instance
        lang: backgroundServiceWorker.language, // Set the "lang" value to the retrieved language setting value
        autocompleteSeparatorSource: backgroundServiceWorker.language
          ? LANG_SEPERATOR_CHARS_REGEX[backgroundServiceWorker.language].source // Retrieve the separator character regex pattern based on the language setting value
          : DEFAULT_SEPERATOR_CHARS_REGEX.source, // Use the default pattern if the language setting value is undefined or null
        minWordLengthToPredict: await backgroundServiceWorker.settings.get(
          "minWordLengthToPredict",
        ),
        revertOnBackspace:
          await backgroundServiceWorker.settings.get("revertOnBackspace"),
      },
    };

    // Return the configuration message object
    return message;
  }

  /**
   * Updates the configuration of the Presage handler and sends it to all tabs.
   */
  async updatePresageConfig() {
    // Initialize the Presage handler.
    await this._initializePresage();

    this.language = await this.settings.get("language");
    // Set the Presage handler configuration based on the settings.
    this.presageHandler.setConfig(
      await this.settings.get("numSuggestions"),
      await this.settings.get("minWordLengthToPredict"),
      await this.settings.get("insertSpaceAfterAutocomplete"),
      await this.settings.get("autoCapitalize"),
      await this.settings.get("applySpacingRules"),
      await this.settings.get("textExpansions"),
      await this.settings.get("variableExpansion"),
      await this.settings.get("timeFormat"),
      await this.settings.get("dateFormat"),
      await this.settings.get("userDictionaryList"),
    );

    // Query all tabs and send a message with the new configuration to each one.
    chrome.tabs.query({}, async function (tabs) {
      // Check for any error that occurred during the query.
      checkLastError();

      // Create a background service worker to access the settings.
      const backgroundServiceWorker = new BackgroundServiceWorker();

      // Get a message object with the current configuration.
      const message =
        await backgroundServiceWorker.getBackgroundPageSetConfigMsg();

      // Loop through all tabs and send a message to each one.
      for (const tab of tabs) {
        // Skip tabs that don't have a URL.
        if (!tab.url) {
          continue;
        }

        // Get the domain of the current tab.
        const domain = getDomain(tab.url);

        // Check if the extension is enabled for the current domain.
        const enabled = await isEnabledForDomain(
          backgroundServiceWorker.settings,
          domain,
        );
        message.context.enabled = enabled;

        // Send the message to the current tab.
        try {
          await chrome.tabs.sendMessage(tab.id, message);
        } catch (error) {
          console.log(error);
        }
      }
    });
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
    case "toggle-ft-active-tab":
      // Call the toggleOnOffActiveTab method on the background service worker.
      backgroundServiceWorker.sendCommandToActiveTabContentScript(
        "toggle-ft-active-tab",
      );
      break;

    case "trigger-ft-active-tab":
      backgroundServiceWorker.sendCommandToActiveTabContentScript(
        "trigger-ft-active-tab",
      );
      break;
    case "toggle-ft-active-lang":
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

      backgroundServiceWorker.settings.set("language", nextLang);
      backgroundServiceWorker.language = nextLang;

      const context = {
        lang: nextLang,
        autocompleteSeparatorSource:
          LANG_SEPERATOR_CHARS_REGEX[nextLang].source,
      };

      backgroundServiceWorker.sendCommandToActiveTabContentScript(
        "backgroundPageUpdateLangConfig",
        context,
      );
      break;
    default:
      // Log an error message if the command is unknown.
      console.error("Unknown command: ", command);
      break;
  }
}

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

  // Set asyncResponse to false by default.
  let asyncResponse = false;

  // Check for any errors that occurred previously.
  checkLastError();

  // Add tabId and frameId to the request context.
  request.context.tabId = sender?.tab?.id;
  request.context.frameId = sender.frameId;

  // Use a switch statement to determine which command was sent in the message.
  switch (request.command) {
    case "contentScriptPredictReq":
      // Modify the command and set asyncResponse to true.
      request.command = "backgroundPagePredictReq";
      asyncResponse = true;

      // Get the language from the settings.
      backgroundServiceWorker.settings
        .get("language")
        .then(async (language) => {
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
            backgroundServiceWorker.runPrediction(request);
            sendResponse();
          }
        })
        .catch(function (e) {
          console.error(e);
        });

      break;

    case "optionsPageConfigChange":
      // Update the Presage configuration.
      backgroundServiceWorker.updatePresageConfig();
      break;

    case "contentScriptGetConfig":
      // Get the configuration from the settings and send a response.
      asyncResponse = true;
      isEnabledForDomain(
        backgroundServiceWorker.settings,
        getDomain(sender.tab.url),
      )
        .then(async (isEnabled) => {
          const message =
            await backgroundServiceWorker.getBackgroundPageSetConfigMsg();
          message.context.enabled = isEnabled;
          return message;
        })
        .then(async (message) => {
          sendResponse(message);
        })
        .catch(function (e) {
          console.error(e);
        });

      break;
  }

  // Return the asyncResponse flag.
  return asyncResponse;
}

async function migrateToLocalStore(lastVersion) {
  const currentVersion = chrome.runtime.getManifest().version;
  const migrateStore =
    !lastVersion ||
    lastVersion.localeCompare("2023.09.30", undefined, {
      numeric: true,
      sensitivity: "base",
    }) <= 0;

  const updateLang =
    !lastVersion ||
    lastVersion.localeCompare("2024.04.21", undefined, {
      numeric: true,
      sensitivity: "base",
    }) <= 0;

  if (migrateStore) {
    chrome.storage.sync.get(null, (result) => {
      chrome.storage.local.set(result);
      chrome.storage.local.set({ lastVersion: currentVersion });
    });
  }

  if (updateLang) {
    const backgroundServiceWorker = new BackgroundServiceWorker();
    const langProps = ["language", "fallbackLanguage"];
    for (const langProp of langProps) {
      const language = await backgroundServiceWorker.settings.get(langProp);
      for (const key of Object.keys(SUPPORTED_LANGUAGES)) {
        if (key.startsWith(language)) {
          await backgroundServiceWorker.settings.set(langProp, key);
          break;
        }
      }
    }
  }
  chrome.storage.local.set({ lastVersion: currentVersion });
}

chrome.runtime.onInstalled.addListener(onInstalled);
chrome.commands.onCommand.addListener(onCommand);
chrome.runtime.onMessage.addListener(onMessage);
chrome.storage.local.get("lastVersion", async (result) => {
  try {
    migrateToLocalStore(result.lastVersion);
    const backgroundServiceWorker = new BackgroundServiceWorker();
    await backgroundServiceWorker._initializePresage();
  } catch (error) {
    console.log(error);
  }
});
