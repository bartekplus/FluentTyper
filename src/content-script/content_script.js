/*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/

import { TributeManager } from "./TributeManager.ts";
import { DomObserver } from "./DomObserver.ts";
import {
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  POPUP_PAGE_ENABLE,
  POPUP_PAGE_DISABLE,
  STATUS_COMMAND,
} from "../shared/constants.ts";
import { LANG_SEPERATOR_CHARS_REGEX } from "../shared/lang.ts";

(function () {
  const WATCHDOG_INTERVAL_MS = 1000;
  // Class for creating a fluent typing experience with autocomplete functionality
  class FluentTyper {
    constructor() {
      // CSS selectors for identifying elements that support fluent typing
      this.SELECTORS = "textarea, input, [contentEditable]";
      // Tribute Manager instance
      this.tributeManager = null;
      // Reference to the current pending request
      this.pendingReq = null;
      // Flag indicating whether the plugin is enabled or disabled
      this._enabled = false;
      // Flag indicating whether autocomplete is enabled or disabled
      this.autocomplete = false;
      // Flag indicating whether autocomplete on 'enter' key is enabled or disabled
      this.autocompleteOnEnter = true;
      // Flag indicating whether autocomplete on 'tab' key is enabled or disabled
      this.autocompleteOnTab = true;
      // User language for autocomplete
      this.lang = "";
      // Node for observing DOM changes
      this.observerNode = document.body || document.documentElement;
      this.domObserver = new DomObserver(
        this.observerNode,
        this.mutationCallback.bind(this),
      );
      // Active element - last element that received key input
      this.activeHelperArrId = null;
      // Minimum characters typed by user to start prediction
      this.minWordLengthToPredict = 0;
      // Flag indicating whether backspace reverts last edit or deletes last character
      this.revertOnBackspace = true;

      // Add message listener for handling plugin messages
      chrome.runtime.onMessage.addListener(this.messageHandler.bind(this));
      // Load configuration settings from storage
      this.getConfig();
      // Set up a watchdog timer for checking the plugin status periodically
      setInterval(this.watchDog.bind(this), WATCHDOG_INTERVAL_MS);
    }

    // Checks if the observerNode has changed and re-enables the plugin if necessary
    watchDog() {
      // Get the current document node
      const currentNode = document.body || document.documentElement;
      // Compare the current node with the observerNode
      if (this.observerNode !== currentNode) {
        // If the observerNode has changed and the plugin is enabled, disable and re-enable it
        if (this.enabled) {
          this.restart();
        }
        // Update the observerNode to the current node
        this.observerNode = currentNode;
        this.domObserver.setNode(currentNode);
      }
    }

    // Setter for the enabled property, which enables or disables the plugin
    set enabled(newValue) {
      // Check if the new value is different from the current value
      if (this._enabled !== newValue) {
        // Update the enabled property with the new value
        this._enabled = newValue;
        // If the new value is true, enable the plugin; if it's false, disable the plugin
        if (newValue) {
          this.enable();
        } else {
          this.disable();
        }
      }
    }

    // Getter for the enabled property, which returns the current value of the property
    get enabled() {
      return this._enabled;
    }

    // Attaches a MutationObserver to the current observerNode to listen for changes in the DOM
    attachMutationObserver() {
      this.domObserver.attach();
    }

    // Callback for TributeManager to request predictions
    handleGetPrediction(context) {
      const message = {
        command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
        context: {
          text: context.text,
          nextChar: context.nextChar,
          tributeId: context.tributeId,
          requestId: context.requestId,
          lang: this.lang, // FluentTyper's current language
        },
      };
      this.pendingReq = message;

      chrome.runtime.sendMessage(message, (response) => {
        this.messageHandler(response); // Pass response to messageHandler
        this.checkLastError();
      });
    }

    // Callback for TributeManager when a tribute element is triggered (e.g. by keydown)
    handleTributeTrigger(helperArrId) {
      this.activeHelperArrId = helperArrId;
    }

    initializeTributeManager() {
      this.tributeManager = new TributeManager({
        selectors: this.SELECTORS,
        minWordLengthToPredict: this.minWordLengthToPredict,
        autocomplete: this.autocomplete,
        autocompleteOnEnter: this.autocompleteOnEnter,
        autocompleteOnTab: this.autocompleteOnTab,
        lang: this.lang,
        autocompleteSeparator: LANG_SEPERATOR_CHARS_REGEX[this.lang] || /\s+/,
        selectByDigit: this.selectByDigit,
        revertOnBackspace: this.revertOnBackspace,
        getPrediction: this.handleGetPrediction.bind(this),
        onTrigger: this.handleTributeTrigger.bind(this),
      });
    }

    // Checks if a Tribute instance is attached to the specified element
    isHelperAttached(elem) {
      // Iterate over each Tribute instance in tributeArr
      for (const [key] of Object.entries(this.tributeArr)) {
        // If the Tribute instance's element matches the specified element, return true
        if (
          this.tributeManager &&
          elem === this.tributeManager.tributeArr[key].elem
        ) {
          return true;
        }
      }
      return false;
    }

    /**
     * Logs the last error if there was one from the chrome.runtime API.
     */
    checkLastError() {
      try {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
        }
      } catch (error) {
        console.error(error);
      }
    }

    /**
     * Checks if the given element is part of the document tree.
     * @param {Element} element - The element to check.
     * @returns {boolean} - True if the element is part of the document, false otherwise.
     */
    isInDocument(element) {
      // Keep moving up the tree until we reach the document or a shadow root host
      while (element.parentNode || element.host) {
        element = element.parentNode || element.host;
      }
      // Check if the element is the document itself
      return element === document;
    }

    /**
     * Processes the mutations and attaches or detaches Tribute components as needed.
     * @param {MutationRecord[]} mutationsList - An array of MutationRecords representing the changes to the DOM.
     */
    processMutations(mutationsList) {
      // Disconnect the observer so we can safely modify the DOM
      this.domObserver.disconnect();

      // Detach any Tribute components whose elements are no longer in the document
      if (this.tributeManager) {
        for (const [key, entry] of Object.entries(
          this.tributeManager.tributeArr,
        )) {
          if (!this.isInDocument(entry.elem)) {
            this.tributeManager.detachHelper(key);
          }
        }
      }

      // Attach Tribute components to any added nodes that are in the document
      for (const mutation of mutationsList) {
        mutation.addedNodes.forEach((element) => {
          if (this.isInDocument(element)) {
            if (this.tributeManager)
              this.tributeManager.queryAndAttachHelper(element);
          }
        });

        // Attach Tribute components to any mutated attributes that are in the document
        if (mutation.type === "attributes") {
          if (this.isInDocument(mutation.target)) {
            if (this.tributeManager)
              this.tributeManager.queryAndAttachHelper(mutation.target);
          }
        }
      }

      // Re-attach the observer
      this.attachMutationObserver();
    }

    /**
     * A callback function for the MutationObserver that processes the mutations.
     * @param {MutationRecord[]} mutationsList - An array of MutationRecords representing the changes to the DOM.
     */
    mutationCallback(mutationsList) {
      // Use setTimeout to run the processing on the next event loop iteration
      setTimeout(this.processMutations.bind(this, mutationsList), 0);
    }

    /**
     * Sets the configuration options for Tribute.
     * @param {object} config - The configuration options to set.
     */
    setConfig(config) {
      // Set the autocomplete option
      this.autocomplete = config.autocomplete;
      // Set the autocompleteOnEnter option
      this.autocompleteOnEnter = config.autocompleteOnEnter;
      // Set the autocompleteOnTab option
      this.autocompleteOnTab = config.autocompleteOnTab;
      this.lang = config.lang;
      this.selectByDigit = config.selectByDigit;
      this.minWordLengthToPredict =
        config.minWordLengthToPredict === -1
          ? Number.MAX_VALUE
          : config.minWordLengthToPredict;
      this.revertOnBackspace = config.revertOnBackspace;
      this.tributeManager = null;
      // If enabled state is the same but other configs changed, and it is enabled, restart to apply.
      // If enabled state changes, the setter for 'enabled' will handle it.
      if (this.enabled && config.enabled) {
        this.restart();
      } else {
        this.enabled = config.enabled;
      }
    }

    /**
     * Enables Tribute by querying for and attaching helpers, and attaching a mutation observer.
     */
    enable() {
      if (!this.tributeManager) {
        this.initializeTributeManager();
      }
      // Query and attach helpers to nodes via TributeManager
      if (this.tributeManager) this.tributeManager.queryAndAttachHelper();
      // Attach a mutation observer
      this.attachMutationObserver();
    }

    /**
     * Disables Tribute by disconnecting the mutation observer and detaching all helpers.
     */
    disable() {
      // If there is an observer, disconnect it
      this.domObserver.disconnect();
      // Detach all helpers via TributeManager
      if (this.tributeManager) this.tributeManager.detachAllHelpers();
    }
    /**
     * Restarts Tribute by disabling and then enabling it again.
     * This is useful for reloading the configuration or applying changes.
     */
    restart() {
      // Disable Tribute
      this.disable();
      // Enable Tribute
      setTimeout(() => {
        if (this._enabled) this.enable();
      }, 0); // Ensure enable is called if still enabled
    }

    /**
     * Handles incoming messages from content scripts and popup pages.
     *
     * @param {Object} message - The message object received.
     * @param {*} sender - The sender of the message.
     * @param {function} sendResponse - The callback function to send a response message back to the sender.
     */
    messageHandler(message, sender, sendResponse) {
      // Check if there was an error in the previous message
      this.checkLastError();
      let sendStatusMsg = false;

      // If message is empty, return
      if (!message) {
        return;
      }

      // Handle message based on command
      switch (message.command) {
        case CMD_BACKGROUND_PAGE_PREDICT_RESP:
          if (
            this.pendingReq &&
            this.tributeManager &&
            message.context.tributeId !== undefined && // Ensure tributeId is present
            this.pendingReq.context.tributeId === message.context.tributeId &&
            this.pendingReq.context.requestId === message.context.requestId
          ) {
            this.tributeManager.fulfillPrediction(message.context);
            this.pendingReq = null;
          } else {
            console.log(
              "Prediction response ignored (mismatch or no pending request):",
              message.context,
            );
          }
          break;
        case CMD_BACKGROUND_PAGE_SET_CONFIG:
          // Update config object with the context object
          this.setConfig(message.context);
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case CMD_CONTENT_SCRIPT_GET_CONFIG: // This case might be handled by the initial getConfig call's callback
          this.setConfig(message.context);
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG:
          // Update the language configuration in tributeArr
          this.lang = message.context.lang;
          if (this.tributeManager && this.activeHelperArrId !== null) {
            this.tributeManager.updateLangConfig(
              this.lang,
              this.activeHelperArrId,
            );
          }
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case POPUP_PAGE_DISABLE:
          // Disable TributeJS
          this.enabled = false;
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case POPUP_PAGE_ENABLE:
          // Enable TributeJS
          this.enabled = true;
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case CMD_TOGGLE_FT_ACTIVE_TAB:
          // Toggle TributeJS enable/disable state
          this.enabled = !this.enabled;
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case CMD_TRIGGER_FT_ACTIVE_TAB:
          if (this.tributeManager && this.activeHelperArrId !== null) {
            this.tributeManager.triggerTribute(this.activeHelperArrId);
          }
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        default:
          // Unknown message type, log it to the console
          console.log("Unknown message:", message);
          break;
      }

      // Send a status message to the sender if required
      if (sendStatusMsg) {
        const statusMsg = {
          command: STATUS_COMMAND,
          context: { enabled: this.enabled },
        };
        if (sendResponse) sendResponse(statusMsg);
      }
    }

    // Method to get configuration using chrome runtime sendMessage API
    getConfig() {
      const message = {
        command: CMD_CONTENT_SCRIPT_GET_CONFIG,
        context: {},
      };

      // Send message and attach messageHandler function as callback
      chrome.runtime.sendMessage(message, (response) => {
        this.messageHandler(response); // Pass response to messageHandler
        this.checkLastError();
      });
    }
  }

  if (window.FluentTyper) {
    // Was script alredy injected ?
    return;
  }
  window.FluentTyper = new FluentTyper();
})();
