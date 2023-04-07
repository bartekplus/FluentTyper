import { getDomain, isEnabledForDomain, checkLastError } from "./utils.js";
import { Store } from "./third_party/fancier-settings/lib/store.js";
import {
  SUPPORTED_LANGUAGES,
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
      message.context.lang
    );

    // Update the message context with the predictions and forceReplace properties
    message.context.predictions = predictions;
    message.context.forceReplace = forceReplace;

    // Use Promise-based APIs instead of callbacks wherever possible
    const tab = await chrome.tabs
      .get(message.context.tabId)
      .catch(checkLastError);

    if (tab) {
      // Update command to indicate origin of the message
      message.command = "backgroundPagePredictResp";

      // Use the Promise-based sendMessage method instead of the callback-based version
      await chrome.tabs.sendMessage(message.context.tabId, message, {
        frameId: message.context.frameId,
      });
    }
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
    const result = await chrome.i18n.detectLanguage(text);

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
      }
    }

    // If a supported language was detected, return it.
    if (detectedLanguage) {
      return detectedLanguage;
    }

    // Otherwise, try to detect the language of the tab and return it if it's a supported language.
    const pageLang = await chrome.tabs.detectLanguage(tabId);
    if (pageLang in SUPPORTED_LANGUAGES) {
      return pageLang;
    }

    // If the language of the tab is not supported, return the fallback language.
    return fallbackLanguage;
  }

  /**
   * Toggles the content script on or off for the active tab.
   */
  toggleOnOffActiveTab() {
    // Query for the active tab in the current window.
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      // Check for any error that occurred during the query.
      checkLastError();

      // If exactly one tab was found, send a message to toggle the content script.
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

  /**
   * Updates the configuration of the Presage handler and sends it to all tabs.
   */
  async updatePresageConfig() {
    // Initialize the Presage handler.
    await this._initializePresage();

    // Set the Presage handler configuration based on the settings.
    this.presageHandler.setConfig(
      await this.settings.get("numSuggestions"),
      await this.settings.get("minWordLengthToPredict"),
      await this.settings.get("insertSpaceAfterAutocomplete"),
      await this.settings.get("autoCapitalize"),
      await this.settings.get("applySpacingRules"),
      await this.settings.get("textExpansions")
    );

    // Query all tabs and send a message with the new configuration to each one.
    chrome.tabs.query({}, async function (tabs) {
      // Check for any error that occurred during the query.
      checkLastError();

      // Create a background service worker to access the settings.
      const backgroundServiceWorker = new BackgroundServiceWorker();

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
          domain
        );

        // Create a message object with the current configuration.
        const message = {
          command: "backgroundPageSetConfig",
          context: {
            enabled: enabled,
            autocomplete: await backgroundServiceWorker.settings.get(
              "autocomplete"
            ),
            selectByDigit: await backgroundServiceWorker.settings.get(
              "selectByDigit"
            ),
            lang: await backgroundServiceWorker.settings.get("language"),
            autocompleteSeparatorSource:
              LANG_SEPERATOR_CHARS_REGEX[
                (await backgroundServiceWorker.settings.get("language")) || ""
              ] || DEFAULT_SEPERATOR_CHARS_REGEX.source,
          },
        };

        // Send the message to the current tab.
        chrome.tabs.sendMessage(tab.id, message);
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
      backgroundServiceWorker.toggleOnOffActiveTab();
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
          // If language is set to auto-detect, detect the language.
          if (language === "auto_detect") {
            language = await backgroundServiceWorker.detectLanguage(
              request.context.text,
              request.context.tabId
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
      Promise.all([
        isEnabledForDomain(
          backgroundServiceWorker.settings,
          getDomain(sender.tab.url)
        ),
        backgroundServiceWorker.settings.get("autocomplete"),
        backgroundServiceWorker.settings.get("selectByDigit"),
        backgroundServiceWorker.settings.get("language"),
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

  // Return the asyncResponse flag.
  return asyncResponse;
}

chrome.runtime.onInstalled.addListener(onInstalled);
chrome.commands.onCommand.addListener(onCommand);
chrome.runtime.onMessage.addListener(onMessage);
