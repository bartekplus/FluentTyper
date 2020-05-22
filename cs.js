"use strict";
/* global Tribute */

(function () {
  var tributeArr = [];
  var observer = null;
  var pendingReq = null;
  var config = { enabled: false, useEnter: false };
  const PRESAGE_PREDICTION_TIMEOUT_MS = 666;

  function keys(useEnter) {
    var keyArr = [
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

    if (useEnter) {
      keyArr.push({
        key: 13,
        value: "ENTER",
      });
    }
    return keyArr;
  }

  function detachAllHelpers() {
    for (var i = 0; i < tributeArr.length; i++) {
      tributeArr[i].tribute.detach(tributeArr[i].elem);
      delete tributeArr[i].tribute;
    }
    tributeArr = [];
  }

  function isHelperAttached(helperArr, elem) {
    for (var i = 0; i < helperArr.length; i++) {
      if (elem === helperArr[i].elem) {
        return true;
      } else if (elem.hasAttribute("data-tribute")) {
        return true;
      }
    }
    return false;
  }

  function cancelPresageRequestTimeout(tributeId) {
    if (tributeArr[tributeId].timeout) {
      clearTimeout(tributeArr[tributeId].timeout);
      tributeArr[tributeId].timeout = null;
    }
  }

  function requestTimeoutFn(tributeId, requestId) {
    if (requestId === tributeArr[tributeId].requestId) {
      pendingReq = null;
      tributeArr[tributeId].timeout = null;
      tributeArr[tributeId].done([]);
    }
  }

  function setPresageRequestTimeout(tributeId) {
    var timeoutFn = requestTimeoutFn.bind(
      null,
      tributeId,
      tributeArr[tributeId].requestId
    );
    tributeArr[tributeId].timeout = setTimeout(
      timeoutFn,
      PRESAGE_PREDICTION_TIMEOUT_MS
    );
  }

  function checkLastError() {
    try {
      if (chrome.runtime.lastError) {
        console.log(chrome.runtime.lastError.message);
      }
    } catch (e) {}
  }

  function MutationCallback(mutationsList, observer) {
    var nodesAdded = false;
    for (const mutation of mutationsList) {
      if (mutation.type === "childList") {
        if (mutation.addedNodes) {
          nodesAdded = true;
        }
      }
    }
    if (nodesAdded) {
      attachHelper();
    }
  }

  function attachHelper() {
    if (!config.enabled) {
      return;
    }
    var selectors = ["textarea", "input", '[contentEditable="true"]'];

    for (var selectorId = 0; selectorId < selectors.length; selectorId++) {
      var elems = document.querySelectorAll(selectors[selectorId]);
      for (var i = 0; i < elems.length; i++) {
        var elem = elems[i];

        if (elem.getAttribute("type") === "password") {
          continue;
        }

        if (isHelperAttached(tributeArr, elem)) {
          continue;
        }
        var helperArrId = tributeArr.length;

        tributeArr.push({
          tribute: null,
          elem: elem,
          done: null,
          timeout: null,
          requestId: 0,
        });

        elem.addEventListener("tribute-replaced", function (e) {});

        var tribute = new Tribute({
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
          values: (function (data, done) {
            var localId = helperArrId;
            return function (data, done) {
              var lines = data.split("\n");
              var lastLine = lines[lines.length - 1];
              if (!lastLine) {
                return done([]);
              }
              tributeArr[localId].done = done;
              tributeArr[localId].requestId += 1;
              var message = {
                command: "predictReq",
                context: {
                  text: lastLine,
                  tributeId: localId,
                  requestId: tributeArr[localId].requestId,
                },
              };
              // Cancel old timeout Fn
              cancelPresageRequestTimeout(localId);
              setPresageRequestTimeout(localId);
              // Check if we are waiting for a response
              if (!pendingReq) {
                // Set pending request
                pendingReq = message;

                chrome.runtime.sendMessage(message, function (response) {
                  checkLastError();
                });
              } else {
                pendingReq = message;
              }
            };
          })(),

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

          keys: (function () {
            var useEnter = config.useEnter;
            return keys.bind(null, useEnter);
          })(),
        });
        tributeArr[helperArrId].tribute = tribute;
        tribute.attach(elem);
      }
    }
  }

  function initializeFluentTyper() {
    window.addEventListener(
      "DOMContentLoaded",
      function (evt) {
        initializeFluentTyper(config);
      },
      false
    );

    if (!observer) {
      var observerOptions = {
        childList: true,
        attributes: false,
        subtree: true,
      };
      observer = new MutationObserver(MutationCallback);
      observer.observe(document.body, observerOptions);
    }
  }

  function enable() {
    config.enabled = true;
    attachHelper();
  }

  function disable() {
    config.enabled = false;
    detachAllHelpers();
  }

  function messageHandler(message, sender, sendResponse) {
    checkLastError();

    switch (message.command) {
      case "predictResp":
        // We were waiting for prediction
        if (pendingReq) {
          cancelPresageRequestTimeout(message.context.tributeId);

          // Check if msg are equal
          if (
            message.context.requestId ===
            tributeArr[message.context.tributeId].requestId
          ) {
            var keyValPairs = [];
            for (var i = 0; i < message.context.predictions.length; i++) {
              keyValPairs.push({
                key: message.context.predictions[i],
                value: message.context.predictions[i],
              });
            }
            // Cancel old timeout Fn
            // Send prediction to TributeJs
            tributeArr[message.context.tributeId].done(keyValPairs);
            // Clear pending req
            pendingReq = null;
          } else {
            // Msq are not equal, ignore result and send pending msg
            setPresageRequestTimeout(message.context.tributeId);

            chrome.runtime.sendMessage(pendingReq, function (response) {
              checkLastError();
            });
          }
        }
        break;
      case "getConfig":
        config.useEnter = message.context.useEnter;
        config.enabled = message.context.enabled;
        initializeFluentTyper();

        break;
      case "disable":
        disable();
        break;
      case "enable":
        enable();
        break;
      case "toggle":
        if (config.enabled) {
          disable();
        } else {
          enable();
        }
        break;

      default:
        console.log("Unknown message");
        console.log(message);
        break;
    }
  }

  chrome.runtime.onMessage.addListener(messageHandler);

  function getConfig() {
    var message = {
      command: "getConfig",
      context: {},
    };

    chrome.runtime.sendMessage(message, messageHandler);
  }

  getConfig();
})();
