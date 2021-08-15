"use strict";
/* global Tribute */

(function () {
  const PRESAGE_PREDICTION_TIMEOUT_MS = 444;

  class FluentTyper {
    constructor() {
      this.tributeArr = [];
      this.pendingReq = null;
      this.config = {
        enabled: false,
        useEnter: false,
      };

      chrome.runtime.onMessage.addListener(this.messageHandler.bind(this));
      this.getConfig();
    }

    attachMutationObserver() {
      if (!this.observer) {
        const MutationCallback = this.MutationCallback.bind(this);
        const observerOptions = {
          childList: true,
          attributes: false,
          subtree: true,
        };
        this.observer = new MutationObserver(MutationCallback);
        this.observer.observe(document.body, observerOptions);
      }
    }
    keys() {
      const keyArr = [
        {
          key: 9,
          value: "TAB",
        },
        {
          key: 27,
          value: "ESCAPE",
        },
        {
          key: 38,
          value: "UP",
        },
        {
          key: 40,
          value: "DOWN",
        },
      ];

      if (this.config.useEnter) {
        keyArr.push({
          key: 13,
          value: "ENTER",
        });
      }
      return keyArr;
    }

    detachHelper(tributeId) {
      this.cancelPresageRequestTimeout(tributeId);
      this.tributeArr[tributeId].tribute.detach(
        this.tributeArr[tributeId].elem
      );
      delete this.tributeArr[tributeId].tribute;
      this.tributeArr.splice(tributeId, 1);
    }

    detachAllHelpers() {
      for (let i = this.tributeArr.length - 1; i >= 0; i--) {
        this.detachHelper(i);
      }
      this.tributeArr = [];
    }

    isHelperAttached(helperArr, elem) {
      return elem.hasAttribute("data-tribute");
    }

    cancelPresageRequestTimeout(tributeId) {
      if (this.tributeArr[tributeId].timeout) {
        clearTimeout(this.tributeArr[tributeId].timeout);
        this.tributeArr[tributeId].timeout = null;
      }
    }

    requestTimeoutFn(tributeId, requestId) {
      if (
        tributeId < this.tributeArr.length &&
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
      } catch (e) {}
    }

    MutationCallback(mutationsList, observer) {
      let nodesAdded = false;
      for (const mutation of mutationsList) {
        if (mutation.type === "childList") {
          if (mutation.addedNodes) {
            nodesAdded = true;
          }
        }
      }
      for (let i = this.tributeArr.length - 1; i >= 0; i--) {
        if (!document.body.contains(this.tributeArr[i].elem)) {
          this.detachHelper(i);
        }
      }

      if (nodesAdded) {
        this.attachHelper();
      }
    }

    attachHelper() {
      if (!this.config.enabled) {
        return;
      }
      const selectors =
        "textarea, input, [contentEditable='true' i], [contentEditable='plaintext-only' i]";

      const elems = document.querySelectorAll(selectors);
      for (let i = 0; i < elems.length; i++) {
        const elem = elems[i];
        const inputTypes = ["text", ""];
        const autocomplete = elem.getAttribute("autocomplete")
          ? elem.getAttribute("autocomplete").toLowerCase()
          : "";

        const inputType = elem.getAttribute("type")
          ? elem.getAttribute("type").toLowerCase()
          : "";
        if (
          elem.tagName.toLowerCase() === "input" &&
          !inputTypes.includes(inputType)
        ) {
          continue;
        }

        if (autocomplete === "off") {
          // continue;
        }

        if (this.isHelperAttached(this.tributeArr, elem)) {
          continue;
        }

        this.tributeArr.push({
          tribute: null,
          elem: elem,
          done: null,
          timeout: null,
          requestId: 0,
        });

        let tribueKeyFn = this.keys.bind(this);
        let tribueValuesFn = (function (helperArrId, FluentTyperIn) {
          const localId = helperArrId;
          const FluentTyper = FluentTyperIn;
          return function (data, done) {
            const lines = data.split("\n");
            const lastLine = lines[lines.length - 1];
            if (!lastLine) {
              return done([]);
            }
            FluentTyper.tributeArr[localId].done = done;
            FluentTyper.tributeArr[localId].requestId += 1;
            const message = {
              command: "contentScriptPredictReq",
              context: {
                text: lastLine,
                tributeId: localId,
                requestId: FluentTyper.tributeArr[localId].requestId,
              },
            };
            // Cancel old timeout Fn
            FluentTyper.cancelPresageRequestTimeout(localId);
            FluentTyper.setPresageRequestTimeout(localId);
            // Check if we are waiting for a response
            FluentTyper.pendingReq = message;
            chrome.runtime.sendMessage(message);
          };
        })(this.tributeArr.length - 1, this);

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
          spaceSelectsMatch: false,
          // turn tribute into an autocomplete
          autocompleteMode: true,
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
        });
        this.tributeArr[this.tributeArr.length - 1].tribute = tribute;
        tribute.attach(elem);
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
      this.attachHelper();
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
  }

  if (window.FluentTyper) {
    // Was script alredy injected ?
    return;
  }
  window.FluentTyper = new FluentTyper();
})();
