/*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
/* global Tribute */

(function () {
  const PRESAGE_PREDICTION_TIMEOUT_MS = 444;

  class FluentTyper {
    constructor() {
      this.SELECTORS = "textarea, input, [contentEditable]";
      this.newTributeId = 0;
      this.tributeArr = {};
      this.pendingReq = null;
      this.config = {
        enabled: false,
        autocomplete: false,
      };

      chrome.runtime.onMessage.addListener(this.messageHandler.bind(this));
      this.getConfig();
    }

    attachMutationObserver() {
      if (!this.observer) {
        const MutationCallback = this.MutationCallback.bind(this);
        const observerOptions = {
          childList: true,
          attributes: true,
          attributeFilter: ["contenteditable", "type", "name", "id"],
          subtree: true,
        };
        this.observer = new MutationObserver(MutationCallback);
        this.observer.observe(document.body, observerOptions);
      }
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
      this.cancelPresageRequestTimeout(tributeId);
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

    cancelPresageRequestTimeout(tributeId) {
      if (this.tributeArr[tributeId].timeout) {
        clearTimeout(this.tributeArr[tributeId].timeout);
        this.tributeArr[tributeId].timeout = null;
      }
    }

    requestTimeoutFn(tributeId, requestId) {
      if (
        this.tributeArr[tributeId] &&
        requestId === this.tributeArr[tributeId].requestId
      ) {
        this.pendingReq = null;
        this.tributeArr[tributeId].timeout = null;
        this.tributeArr[tributeId].done([]);
      }
    }
    setPresageRequestTimeout(tributeId) {
      const timeoutFn = this.requestTimeoutFn.bind(
        this,
        tributeId,
        this.tributeArr[tributeId].requestId
      );
      this.tributeArr[tributeId].timeout = setTimeout(
        timeoutFn,
        PRESAGE_PREDICTION_TIMEOUT_MS
      );
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

    MutationCallback(mutationsList) {
      for (const [key] of Object.entries(this.tributeArr)) {
        if (!this.isInDocument(this.tributeArr[key].elem)) {
          this.detachHelper(key);
        }
      }

      for (const mutation of mutationsList) {
        mutation.addedNodes.forEach((element) => {
          this.queryAndAttachHelper(element);
        });
        if (mutation.type === "attributes") {
          this.queryAndAttachHelper(mutation.target);
        }
      }
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
      if (!this.config.enabled) {
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

      if (this.isHelperAttached(elem)) {
        return;
      }

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
        timeout: null,
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
          },
        };
        // Cancel old timeout Fn
        this.cancelPresageRequestTimeout(helperArrId);
        this.setPresageRequestTimeout(helperArrId);
        // Check if we are waiting for a response
        this.pendingReq = message;
        chrome.runtime.sendMessage(message);
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
        spaceSelectsMatch: this.config.autocomplete,
        // turn tribute into an autocomplete
        autocompleteMode: true,
        autocompleteSeparator: RegExp(
          /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/
        ),
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
        selectByDigit: this.config.selectByDigit,
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
      if (!this.config.enabled) {
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

    setConfig(config) {
      this.config = config;
      if (this.config.enabled) {
        this.enable();
      } else {
        this.disable();
      }
    }
    enable() {
      this.config.enabled = true;
      this.queryAndAttachHelper();
      this.attachMutationObserver();
    }
    disable() {
      this.config.enabled = false;
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
            this.cancelPresageRequestTimeout(message.context.tributeId);

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
              // Cancel old timeout Fn
              // Send prediction to TributeJs
              this.tributeArr[message.context.tributeId].done(
                keyValPairs,
                message.context.forceReplace
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
        case "popupPageDisable":
          this.disable();
          sendStatusMsg = true;
          break;
        case "popupPageEnable":
          this.enable();
          sendStatusMsg = true;
          break;
        case "backgroundPageToggle":
          if (this.config.enabled) {
            this.disable();
          } else {
            this.enable();
          }
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
          context: { enabled: this.config.enabled },
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
