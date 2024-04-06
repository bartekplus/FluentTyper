/*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
/* global Tribute */

(function () {
  const WATCHDOG_INTERVAL_MS = 1000;
  // Class for creating a fluent typing experience with autocomplete functionality
  class FluentTyper {
    constructor() {
      // CSS selectors for identifying elements that support fluent typing
      this.SELECTORS = "textarea, input, [contentEditable]";
      // Counter for generating unique tribute IDs
      this.newTributeId = 0;
      // Object for storing tribute instances
      this.tributeArr = {};
      // Reference to the current pending request
      this.pendingReq = null;
      // Flag indicating whether the plugin is enabled or disabled
      this._enabled = false;
      // Flag indicating whether autocomplete is enabled or disabled
      this.autocomplete = false;
      // Flag indicating whether autocomplete on 'enter' key is enabled or disabled
      this.autocompleteOnEnter = true;
      // User language for autocomplete
      this.lang = "";
      // Regular expression for splitting text into autocomplete segments
      this.autocompleteSeparator = RegExp(
        // Matches whitespace, punctuation, and other separator characters
        /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/
      );
      // Source string of the autocomplete separator regular expression
      this._autocompleteSeparatorSource = this.autocompleteSeparator.source;
      // Node for observing DOM changes
      this.observerNode = document.body || document.documentElement;
      // Active element - last element that received key input
      this.activeHelperArrId = null;
      // Minimum characters typed by user to start prediction
      this.minWordLengthToPredict = 0;

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
          this.disable();
          this.enable();
        }
        // Update the observerNode to the current node
        this.observerNode = currentNode;
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
    // Setter for the autocompleteSeparatorSource property, which updates the autocompleteSeparator property and applies it to all existing Tribute instances
    set autocompleteSeparatorSource(newValue) {
      // Update the autocompleteSeparatorSource property with the new value
      this._autocompleteSeparatorSource = newValue;
      // Update the autocompleteSeparator property with a new RegExp object created from the new value
      this.autocompleteSeparator = RegExp(newValue);
      // Loop through all Tribute instances and update their autocompleteSeparator properties to the new value
      for (const [key] of Object.entries(this.tributeArr)) {
        this.tributeArr[key].tribute.autocompleteSeparator =
          this.autocompleteSeparator;
      }
    }

    // Getter for the autocompleteSeparatorSource property, which returns the current value of the property
    get autocompleteSeparatorSource() {
      return this._autocompleteSeparatorSource;
    }

    // Attaches a MutationObserver to the current observerNode to listen for changes in the DOM
    attachMutationObserver() {
      // Define options for the MutationObserver
      const observerOptions = {
        childList: true,
        attributes: true,
        attributeFilter: ["contenteditable", "type", "name", "id"],
        subtree: true,
      };

      // Create a new MutationObserver if one doesn't already exist
      if (!this.observer) {
        const mutationCallback = this.mutationCallback.bind(this);
        this.observer = new MutationObserver(mutationCallback);
      }

      // Attach the MutationObserver to the observerNode with the specified options
      this.observer.observe(this.observerNode, observerOptions);
    }

    // Returns an array of keys used for special handling in key event listeners
    keys() {
      // Define an array of key names
      const keyArr = [
        "Tab",
        "Escape",
        "ArrowUp",
        "ArrowDown",
        "Space",
        "Backspace",
      ];

      if (this.autocompleteOnEnter) {
        keyArr.push("Enter");
      }

      // Return the array of key names
      return keyArr;
    }

    // Detaches the Tribute instance associated with the specified tributeId from its element
    detachHelper(tributeId) {
      // Get the element associated with the tributeId
      const elem = this.tributeArr[tributeId].elem;

      // Detach the Tribute instance from the element
      this.tributeArr[tributeId].tribute.detach(elem);

      // Remove event listeners and delete the Tribute instance from the tributeArr object
      elem.removeEventListener(
        "tribute-replaced",
        elem.tributeReplacedEventHandler
      );
      elem.removeEventListener("keydown", elem.elementKeyDownEventHandler);
      delete this.tributeArr[tributeId];
    }

    // Detaches all Tribute instances from their elements
    detachAllHelpers() {
      // Iterate over each Tribute instance in tributeArr and detach it
      for (const [key] of Object.entries(this.tributeArr)) {
        this.detachHelper(key);
      }

      // Reset tributeArr to an empty object
      this.tributeArr = {};
    }

    // Checks if a Tribute instance is attached to the specified element
    isHelperAttached(elem) {
      // Iterate over each Tribute instance in tributeArr
      for (const [key] of Object.entries(this.tributeArr)) {
        // If the Tribute instance's element matches the specified element, return true
        if (elem === this.tributeArr[key].elem) {
          return true;
        }
      }

      // If no matching Tribute instance is found, return false
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
      this.observer.disconnect();

      // Detach any Tribute components whose elements are no longer in the document
      for (const [key] of Object.entries(this.tributeArr)) {
        if (!this.isInDocument(this.tributeArr[key].elem)) {
          this.detachHelper(key);
        }
      }

      // Attach Tribute components to any added nodes that are in the document
      for (const mutation of mutationsList) {
        mutation.addedNodes.forEach((element) => {
          if (this.isInDocument(element)) {
            this.queryAndAttachHelper(element);
          }
        });

        // Attach Tribute components to any mutated attributes that are in the document
        if (mutation.type === "attributes") {
          if (this.isInDocument(mutation.target)) {
            this.queryAndAttachHelper(mutation.target);
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
     * Checks whether an element has a certain property and its value matches the expected value or pattern.
     * @param {Element} elem - The element to check.
     * @param {string} propertyName - The name of the property to check.
     * @param {string} expectedValue - The expected value or pattern for the property value.
     * @param {string} defaultValue - The default value to use if the property is not found.
     * @returns {boolean} - True if the property value matches the expected value or pattern, false otherwise.
     */
    checkElemProperty(elem, propertyName, expectedValue, defaultValue) {
      // Get the value of the property from the element's attribute or use the default value
      const elemValue = elem.hasAttribute(propertyName)
        ? elem.getAttribute(propertyName).toLowerCase().trim()
        : defaultValue;

      // Check if the property value matches the expected value or pattern
      return Boolean(
        elemValue === expectedValue || elemValue.match(expectedValue)
      );
    }

    /**
     * Attaches a helper to a given element.
     *
     * @param {Element} elem - The element to attach the helper to.
     */
    attachHelperToNode(elem) {
      // If Tribute is not enabled, return
      if (!this.enabled) {
        return;
      }

      // Define an array of properties to check against for the given element
      const properties = [
        {
          property: "contentEditable",
          expectedValue: RegExp(/.*/),
          defaultValue: "true",
          reverseCheck: false,
        },
        {
          property: "contentEditable",
          expectedValue: "false",
          defaultValue: "",
          reverseCheck: true,
        },
        {
          property: "type",
          expectedValue: "text",
          defaultValue: "text",
          reverseCheck: false,
        },
        {
          property: "name",
          expectedValue: "username",
          defaultValue: "",
          reverseCheck: true,
        },
        {
          property: "name",
          expectedValue: "password",
          defaultValue: "",
          reverseCheck: true,
        },
        {
          property: "id",
          expectedValue: "username",
          defaultValue: "",
          reverseCheck: true,
        },
      ];

      // Check if the element passes all the property checks
      let propertiesCheck = true;
      for (let index = 0; index < properties.length; index++) {
        const check = properties[index];
        let checkVal = this.checkElemProperty(
          elem,
          check.property,
          check.expectedValue,
          check.defaultValue
        );
        if (check.reverseCheck) checkVal = !checkVal;
        if (!checkVal) {
          propertiesCheck = false;
          break;
        }
      }

      // If the element does not pass all the property checks, return
      if (!propertiesCheck) {
        return;
      }

      // Generate a new Tribute ID for the element and add it to the Tribute array
      const tribueId = this.newTributeId;
      this.newTributeId += 1;
      this.tributeArr[tribueId] = {
        tribute: null,
        elem: elem,
        done: null,
        requestId: 0,
        triggerInputEvent: false,
      };

      // Define the Tribute key and value functions for the element
      const tribueKeyFn = this.keys.bind(this);
      const tribueValuesFn = function (
        helperArrId,
        _trigger,
        done,
        context,
        nextChar
      ) {
        // Update the Tribute object in the Tribute array for the element
        this.tributeArr[helperArrId].done = done;
        this.tributeArr[helperArrId].requestId += 1;
        // Create the message to send to the background script for prediction
        const message = {
          command: "contentScriptPredictReq",
          context: {
            text: context,
            nextChar: nextChar,
            tributeId: helperArrId,
            requestId: this.tributeArr[helperArrId].requestId,
            lang: this.lang,
          },
        };
        // Set the pending request to the generated message
        this.pendingReq = message;
        // Send the message to the background script for prediction and handle the response
        chrome.runtime.sendMessage(message, this.messageHandler.bind(this));
      }.bind(this, tribueId);

      // Create a new Tribute object for the element and attach it to the element
      const tribute = new Tribute({
        // symbol or string that starts the lookup
        trigger: "",

        // element to target for @mentions
        iframe: null,

        // class added in the flyout menu for active item
        selectClass: "highlight",

        // class added to the menu container
        containerClass: "tribute-container",

        // class added to each list item
        itemClass: "",

        // function called on select that returns the content to insert
        selectTemplate: function (item) {
          return item.original.value;
        },

        // template for displaying item in menu
        menuItemTemplate: function (item) {
          return item.string;
        },

        // template for when no match is found (optional),
        // If no template is provided, menu is hidden.
        noMatchTemplate: "",

        // specify an alternative parent container for the menu
        // container must be a positioned element for the menu to appear correctly ie. `position: relative;`
        // default container is the body
        menuContainer: document.body,

        // column to search against in the object (accepts function or string)
        lookup: "key",

        // column that contains the content to insert by default
        fillAttr: "value",

        // REQUIRED: array of objects to match
        values: tribueValuesFn,

        // specify whether a space is required before the trigger string
        requireLeadingSpace: false,
        // specify whether a space is allowed in the middle of mentions
        allowSpaces: false,
        // optionally specify a custom suffix for the replace text
        // (defaults to empty space if undefined)
        replaceTextSuffix: "",
        // specify whether the menu should be positioned.  Set to false and use in conjuction with menuContainer to create an inline menu
        // (defaults to true)
        positionMenu: true,
        // when the spacebar is hit, select the current match
        spaceSelectsMatch: this.autocomplete,
        // turn tribute into an autocomplete
        autocompleteMode: this.minWordLengthToPredict !== Number.MAX_VALUE,
        autocompleteSeparator: this.autocompleteSeparator,
        // Customize the elements used to wrap matched strings within the results list
        // defaults to <span></span> if undefined
        searchOpts: {
          pre: "<span>",
          post: "</span>",
          skip: true, // true will skip local search, useful if doing server-side search
        },
        // specify the minimum number of characters that must be typed before menu appears
        menuShowMinLength: this.minWordLengthToPredict,
        keys: tribueKeyFn,
        supportRevert: true,
        selectByDigit: this.selectByDigit,
      });
      this.tributeArr[tribueId].tribute = tribute;
      tribute.attach(elem);

      // Add event listeners for the tribute-replaced and keydown events.
      elem.tributeReplacedEventHandler = this.debounce(
        this.tributeReplacedEventHandler.bind(this, tribueId),
        16,
        { leading: false, trailing: true }
      );
      elem.addEventListener(
        "tribute-replaced",
        elem.tributeReplacedEventHandler
      );

      elem.elementKeyDownEventHandler = this.debounce(
        this.elementKeyDownEventHandler.bind(this, tribueId),
        32
      );
      elem.addEventListener("keydown", elem.elementKeyDownEventHandler);
    }

    /**
     * This method queries for elements that match the provided selector(s), and attaches a helper element to each element found, unless a helper element has already been attached to the element.
     *
     * @param {HTMLElement} elem - The element to query for matching elements within. If omitted, the entire document is searched.
     */
    queryAndAttachHelper(elem) {
      // Check if the feature is enabled before executing.
      if (!this.enabled) {
        return;
      }

      let elems = [];

      // If an element is provided, check if it matches the provided selector(s). If so, add it to the array of elements to attach a helper element to.
      if (elem) {
        if (elem.matches && elem.matches(this.SELECTORS)) {
          elems = [elem];
        } else if (elem.querySelectorAll) {
          elems = elem.querySelectorAll(this.SELECTORS);
        }
      } else {
        // If no element is provided, query for all elements that match the provided selector(s) within the entire document.
        elems = document.querySelectorAll(this.SELECTORS);
      }

      // Loop through each element found.
      for (let i = 0; i < elems.length; i++) {
        let skip = false;
        // Loop through each existing tribute element to check for overlaps.
        for (const [key] of Object.entries(this.tributeArr)) {
          // If the current element being checked is the same as the existing tribute element, skip to the next existing tribute element.
          if (elems[i] === this.tributeArr[key].elem) continue;

          // If the existing tribute element contains the current element being checked, detach the helper element from the existing tribute element.
          if (elems[i].contains(this.tributeArr[key].elem)) {
            this.detachHelper(key);
          } else if (this.tributeArr[key].elem.contains(elems[i])) {
            // If the current element being checked is contained within the existing tribute element, skip to the next current element.
            skip = true;
          }
        }

        // If the current element being checked should be skipped, skip to the next element.
        if (skip) continue;

        // If a helper element has already been attached to the current element being checked, skip to the next element.
        if (this.isHelperAttached(elems[i])) continue;

        // Attach a helper element to the current element being checked.
        this.attachHelperToNode(elems[i]);
      }
    }

    /**
     * This method triggers the Tribute.js menu to appear for the Tribute element with the given helper array ID.
     *
     * @param {string} helperArrId - The ID of the Tribute element's helper array to trigger.
     */
    triggerTribute(helperArrId) {
      // Show the Tribute.js menu for the Tribute element with the given helper array ID.
      this.tributeArr[helperArrId].tribute.showMenuForCollection(
        this.tributeArr[helperArrId].elem
      );
    }

    /**
     * This method handles key down events for an element with the given helper array ID.
     * If the event is a spacebar press with the control key held down, this method triggers the Tribute.js menu to appear for the Tribute element with the given helper array ID.
     *
     * @param {string} helperArrId - The ID of the Tribute element's helper array to handle key down events for.
     * @param {KeyboardEvent} event - The key down event to handle.
     */
    elementKeyDownEventHandler(helperArrId) {
      this.activeHelperArrId = helperArrId;
      // If the event is a spacebar press with the control key held down, trigger the Tribute.js menu for the Tribute element with the given helper array ID.
    }

    /**
     * This method handles Tribute.js "tribute-replaced" events for the Tribute element with the given helper array ID.
     * If the Tribute element's triggerInputEvent flag is set to true, this method triggers the Tribute.js menu to appear for the Tribute element with the given helper array ID.
     *
     * @param {string} helperArrId - The ID of the Tribute element's helper array to handle "tribute-replaced" events for.
     */
    tributeReplacedEventHandler(helperArrId) {
      // If the Tribute element's triggerInputEvent flag is set to true, trigger the Tribute.js menu for the Tribute element with the given helper array ID.
      if (this.tributeArr[helperArrId].triggerInputEvent) {
        this.tributeArr[helperArrId].triggerInputEvent = false;
        this.triggerTribute(helperArrId);
      }
    }

    /**
     * This method updates the language configuration, autocomplete separator source, and triggers the Tribute.js menu to appear for the Tribute element with the given helper array ID.
     *
     * @param {string} lang - The language to use for the Tribute element.
     * @param {string} autocompleteSeparatorSource - The source of the separator character(s) to use for autocompletion.
     * @param {string} tributeId - The ID of the Tribute element's helper array to update and trigger.
     */
    updateLangConfig(lang, autocompleteSeparatorSource, tributeId) {
      // Update the language configuration and autocomplete separator source.
      this.autocompleteSeparatorSource = autocompleteSeparatorSource;
      this.lang = lang;

      // Trigger the Tribute.js menu for the Tribute element with the given helper array ID.
      this.triggerTribute(tributeId);
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
      // Set the autocompleteSeparatorSource option
      this.autocompleteSeparatorSource = config.autocompleteSeparatorSource;
      // Set the lang option
      this.lang = config.lang;
      // Set the selectByDigit option
      this.selectByDigit = config.selectByDigit;
      // Minimum characters typed by user to start prediction
      this.minWordLengthToPredict =
        config.minWordLengthToPredict === -1 ? Number.MAX_VALUE : 0;
      // Force restart to reload config
      this.enabled = false;
      this.enabled = config.enabled;
    }

    /**
     * Enables Tribute by querying for and attaching helpers, and attaching a mutation observer.
     */
    enable() {
      // Query and attach helpers to nodes
      this.queryAndAttachHelper();
      // Attach a mutation observer
      this.attachMutationObserver();
    }

    /**
     * Disables Tribute by disconnecting the mutation observer and detaching all helpers.
     */
    disable() {
      // If there is an observer, disconnect it
      if (this.observer) {
        this.observer.disconnect();
      }
      // Set the observer to null
      this.observer = null;
      // Detach all helpers
      this.detachAllHelpers();
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
        case "backgroundPagePredictResp":
          // We were waiting for a prediction
          if (this.pendingReq) {
            // Check if the message requestId matches the tributeArr requestId
            if (
              message.context.requestId ===
              this.tributeArr[message.context.tributeId].requestId
            ) {
              // Convert the predictions array into an array of key-value pairs
              const keyValPairs = message.context.predictions.map(
                (prediction) => ({
                  key: prediction,
                  value: prediction,
                })
              );

              // If there are any key-value pairs, update the triggerInputEvent value in tributeArr
              if (keyValPairs.length) {
                this.tributeArr[message.context.tributeId].triggerInputEvent =
                  message.context.triggerInputEvent;
              }

              // Send the key-value pairs to TributeJS for autocomplete
              this.tributeArr[message.context.tributeId].done(
                keyValPairs,
                message.context.forceReplace,
                "Lang: " + message.context.langName
              );

              // Clear pending request
              this.pendingReq = null;
            } else {
              // Message requestId does not match tributeArr requestId, ignore result and wait for next prediction
            }
          }
          break;
        case "backgroundPageSetConfig":
          // Update config object with the context object
          this.setConfig(message.context);
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case "backgroundPageUpdateLangConfig":
          // Update the language configuration in tributeArr
          this.updateLangConfig(
            message.context.lang,
            message.context.autocompleteSeparatorSource,
            message.context.tributeId
          );
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case "popupPageDisable":
          // Disable TributeJS
          this.enabled = false;
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case "popupPageEnable":
          // Enable TributeJS
          this.enabled = true;
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case "toggle-ft-active-tab":
          // Toggle TributeJS enable/disable state
          this.enabled = !this.enabled;
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        case "trigger-ft-active-tab":
          this.triggerTribute(this.activeHelperArrId);
          // Send a status message to the sender
          sendStatusMsg = true;
          break;
        default:
          // Unknown message type, log it to the console
          console.log("Unknown message:");
          console.log(message);
          break;
      }

      // Send a status message to the sender if required
      if (sendStatusMsg) {
        const statusMsg = {
          command: "status",
          context: { enabled: this.enabled },
        };
        if (sendResponse) sendResponse(statusMsg);
      }
    }

    // Method to get configuration using chrome runtime sendMessage API
    getConfig() {
      const message = {
        command: "contentScriptGetConfig",
        context: {},
      };

      // Send message and attach messageHandler function as callback
      chrome.runtime.sendMessage(message, this.messageHandler.bind(this));
    }

    // Debounce function to limit the rate of function calls
    debounce(
      func, // Function to be debounced
      wait, // Time to wait before calling the function
      options = {
        // Options object with leading and trailing options
        leading: true,
        trailing: true,
      }
    ) {
      let timer = null;

      return (...args) => {
        const timerExpired = (callFunc) => {
          timer = null;
          if (callFunc) func.apply(this, args);
        };

        const callNow = options.leading && timer === null;
        const timeoutFn = timerExpired.bind(this, !callNow && options.trailing);
        clearTimeout(timer);
        timer = setTimeout(timeoutFn, wait);
        if (callNow) func.apply(this, args);
      };
    }
  }

  if (window.FluentTyper) {
    // Was script alredy injected ?
    return;
  }
  window.FluentTyper = new FluentTyper();
})();
