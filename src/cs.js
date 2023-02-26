/*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
/* global Tribute */

(function () {
  const WATCHDOG_INTERVAL_MS = 1000;
  class FluentTyper {
    constructor() {
      this.SELECTORS = "textarea, input, [contentEditable]";
      this.newTributeId = 0;
      this.tributeArr = {};
      this.pendingReq = null;
      this._enabled = false;
      this.autocomplete = false;
      this.lang = "";
      this.autocompleteSeparator = RegExp(
        /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/
      );
      this._autocompleteSeparatorSource = this.autocompleteSeparator.source;
      this.observerNode = document.body || document.documentElement;

      chrome.runtime.onMessage.addListener(this.messageHandler.bind(this));
      this.getConfig();
      setInterval(this.watchDog.bind(this), WATCHDOG_INTERVAL_MS);
    }

    watchDog() {
      const oNode = document.body || document.documentElement;
      if (this.observerNode !== oNode) {
        if (this.enabled) {
          this.disable();
          this.enable();
        }
        this.observerNode = oNode;
      }
    }

    set enabled(newValue) {
      if (this._enabled !== newValue) {
        this._enabled = newValue;
        if (newValue) {
          this.enable();
        } else {
          this.disable();
        }
      }
    }
    get enabled() {
      return this._enabled;
    }

    set autocompleteSeparatorSource(newValue) {
      this._autocompleteSeparatorSource = newValue;
      this.autocompleteSeparator = RegExp(newValue);
      for (const [key] of Object.entries(this.tributeArr)) {
        this.tributeArr[key].tribute.autocompleteSeparator =
          this.autocompleteSeparator;
      }
    }

    get autocompleteSeparatorSource() {
      return this._autocompleteSeparatorSource;
    }

    attachMutationObserver() {
      const observerOptions = {
        childList: true,
        attributes: true,
        attributeFilter: ["contenteditable", "type", "name", "id"],
        subtree: true,
      };

      if (!this.observer) {
        const mutationCallback = this.mutationCallback.bind(this);
        this.observer = new MutationObserver(mutationCallback);
      }

      this.observer.observe(this.observerNode, observerOptions);
    }
    keys() {
      const keyArr = [
        "Tab",
        "Escape",
        "ArrowUp",
        "ArrowDown",
        "Enter",
        "Space",
        "Backspace",
      ];

      return keyArr;
    }

    detachHelper(tributeId) {
      const elem = this.tributeArr[tributeId].elem;
      this.tributeArr[tributeId].tribute.detach(elem);
      delete this.tributeArr[tributeId].tribute;
      elem.removeEventListener(
        "tribute-replaced",
        elem.tributeReplacedEventHandler
      );
      elem.removeEventListener("keydown", elem.elementKeyDownEventHandler);

      delete this.tributeArr[tributeId];
    }

    detachAllHelpers() {
      for (const [key] of Object.entries(this.tributeArr)) {
        this.detachHelper(key);
      }

      this.tributeArr = {};
    }

    isHelperAttached(elem) {
      for (const [key] of Object.entries(this.tributeArr)) {
        if (elem === this.tributeArr[key].elem) {
          return true;
        }
      }

      return false;
    }

    checkLastError() {
      try {
        if (chrome.runtime.lastError) {
          console.log(chrome.runtime.lastError.message);
        }
      } catch (e) {
        console.error(e);
      }
    }

    isInDocument(element) {
      while (element.parentNode || element.host) {
        element = element.parentNode || element.host;
      }
      return element === document;
    }

    processMuations(mutationsList) {
      this.observer.disconnect();

      for (const [key] of Object.entries(this.tributeArr)) {
        if (!this.isInDocument(this.tributeArr[key].elem)) {
          this.detachHelper(key);
        }
      }

      for (const mutation of mutationsList) {
        mutation.addedNodes.forEach((element) => {
          if (this.isInDocument(element)) {
            this.queryAndAttachHelper(element);
          }
        });
        if (mutation.type === "attributes") {
          if (this.isInDocument(mutation.target)) {
            this.queryAndAttachHelper(mutation.target);
          }
        }
      }

      this.attachMutationObserver();
    }

    mutationCallback(mutationsList) {
      setTimeout(this.processMuations.bind(this, mutationsList), 0);
    }

    checkElemProperty(elem, propertyName, expectedValue, defaultValue) {
      const elemValue = elem.hasAttribute(propertyName)
        ? elem.getAttribute(propertyName).toLowerCase().trim()
        : defaultValue;

      return Boolean(
        elemValue === expectedValue || elemValue.match(expectedValue)
      );
    }

    attachHelperToNode(elem) {
      if (!this.enabled) {
        return;
      }
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
        /*
        {
          property: "autocomplete",
          expectedValue: "off",
          defaultValue: "",
          reverseCheck: true,
        },

        {
          property: "aria-autocomplete",
          expectedValue: RegExp(/^inline$|^list$|^both$/),
          defaultValue: "",
          reverseCheck: true,
        },
        */
      ];
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
      if (!propertiesCheck) {
        return;
      }

      const tribueId = this.newTributeId;
      this.newTributeId += 1;
      this.tributeArr[tribueId] = {
        tribute: null,
        elem: elem,
        done: null,
        requestId: 0,
        triggerInputEvent: false,
      };

      const tribueKeyFn = this.keys.bind(this);
      const tribueValuesFn = function (
        helperArrId,
        _trigger,
        done,
        context,
        nextChar
      ) {
        this.tributeArr[helperArrId].done = done;
        this.tributeArr[helperArrId].requestId += 1;
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
        this.pendingReq = message;
        chrome.runtime.sendMessage(message, this.messageHandler.bind(this));
      }.bind(this, tribueId);

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
        autocompleteMode: true,
        autocompleteSeparator: this.autocompleteSeparator,
        // Customize the elements used to wrap matched strings within the results list
        // defaults to <span></span> if undefined
        searchOpts: {
          pre: "<span>",
          post: "</span>",
          skip: true, // true will skip local search, useful if doing server-side search
        },
        // specify the minimum number of characters that must be typed before menu appears
        menuShowMinLength: 0,
        keys: tribueKeyFn,
        supportRevert: true,
        selectByDigit: this.selectByDigit,
      });
      this.tributeArr[tribueId].tribute = tribute;
      tribute.attach(elem);

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

    queryAndAttachHelper(elem) {
      if (!this.enabled) {
        return;
      }
      let elems = [];
      if (elem) {
        if (elem.matches && elem.matches(this.SELECTORS)) {
          elems = [elem];
        } else if (elem.querySelectorAll) {
          elems = elem.querySelectorAll(this.SELECTORS);
        }
      } else {
        elems = document.querySelectorAll(this.SELECTORS);
      }

      for (let i = 0; i < elems.length; i++) {
        let skip = false;
        for (const [key] of Object.entries(this.tributeArr)) {
          if (elems[i] === this.tributeArr[key].elem) continue;

          if (elems[i].contains(this.tributeArr[key].elem)) {
            this.detachHelper(key);
          } else if (this.tributeArr[key].elem.contains(elems[i])) {
            skip = true;
          }
        }
        if (skip) continue;
        if (this.isHelperAttached(elems[i])) continue;

        this.attachHelperToNode(elems[i]);
      }
    }

    triggerTribute(helperArrId) {
      this.tributeArr[helperArrId].tribute.showMenuForCollection(
        this.tributeArr[helperArrId].elem
      );
    }

    elementKeyDownEventHandler(helperArrId, event) {
      if (
        event &&
        event.code === "Space" &&
        event.getModifierState &&
        event.getModifierState("Control")
      ) {
        this.triggerTribute(helperArrId);
      }
    }

    tributeReplacedEventHandler(helperArrId) {
      if (this.tributeArr[helperArrId].triggerInputEvent) {
        this.tributeArr[helperArrId].triggerInputEvent = false;
        this.triggerTribute(helperArrId);
      }
    }
    updateLangConfig(lang, autocompleteSeparatorSource, tributeId) {
      this.autocompleteSeparatorSource = autocompleteSeparatorSource;
      this.lang = lang;
      this.triggerTribute(tributeId);
    }

    setConfig(config) {
      this.autocomplete = config.autocomplete;
      this.autocompleteSeparatorSource = config.autocompleteSeparatorSource;
      this.lang = config.lang;
      this.selectByDigit = config.selectByDigit;
      // Force restart to relaod config
      this.enabled = false;
      this.enabled = config.enabled;
    }

    enable() {
      this.queryAndAttachHelper();
      this.attachMutationObserver();
    }
    disable() {
      if (this.observer) {
        this.observer.disconnect();
      }
      this.observer = null;
      this.detachAllHelpers();
    }

    messageHandler(message, sender, sendResponse) {
      this.checkLastError();
      let sendStatusMsg = false;
      if (!message) {
        return;
      }

      switch (message.command) {
        case "backgroundPagePredictResp":
          // We were waiting for prediction
          if (this.pendingReq) {
            // Check if msg are equal
            if (
              message.context.requestId ===
              this.tributeArr[message.context.tributeId].requestId
            ) {
              const keyValPairs = [];
              for (let i = 0; i < message.context.predictions.length; i++) {
                keyValPairs.push({
                  key: message.context.predictions[i],
                  value: message.context.predictions[i],
                });
              }
              if (keyValPairs.length) {
                this.tributeArr[message.context.tributeId].triggerInputEvent =
                  message.context.triggerInputEvent;
              }
              // Send prediction to TributeJs
              this.tributeArr[message.context.tributeId].done(
                keyValPairs,
                message.context.forceReplace,
                "Lang: " + message.context.langName
              );

              // Clear pending req
              this.pendingReq = null;
            } else {
              // Msq are not equal, ignore result and wait for next prediction
            }
          }
          break;
        case "backgroundPageSetConfig":
          this.setConfig(message.context);
          sendStatusMsg = true;
          break;
        case "backgroundPageUpdateLangConfig":
          this.updateLangConfig(
            message.context.lang,
            message.context.autocompleteSeparatorSource,
            message.context.tributeId
          );
          sendStatusMsg = true;
          break;
        case "popupPageDisable":
          this.enabled = false;
          sendStatusMsg = true;
          break;
        case "popupPageEnable":
          this.enabled = true;
          sendStatusMsg = true;
          break;
        case "backgroundPageToggle":
          this.enabled = !this.enabled;
          sendStatusMsg = true;
          break;

        default:
          console.log("Unknown message:");
          console.log(message);
          break;
      }

      if (sendStatusMsg) {
        const statusMsg = {
          command: "status",
          context: { enabled: this.enabled },
        };
        // Send updated status
        if (sendResponse) sendResponse(statusMsg);
      }
    }

    getConfig() {
      const message = {
        command: "contentScriptGetConfig",
        context: {},
      };

      chrome.runtime.sendMessage(message, this.messageHandler.bind(this));
    }

    debounce(
      func,
      wait,
      option = {
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

        const callNow = option.leading && timer === null;
        const timeoutFn = timerExpired.bind(this, !callNow && option.trailing);
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
