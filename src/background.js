"use strict";

import { isDomainOnList, checkLastError } from "./utils.js";

import { Store } from "./third_party/fancy-settings/lib/store.js";

const settings = new Store("settings");
let configUpdated = false;

// Check whether new version is installed
chrome.runtime.onInstalled.addListener(function (details) {
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
});

function sendMsgToSandbox(message) {
  const iframe = document.getElementById("sandboxFrame");
  iframe.contentWindow.postMessage(message, "*");
}

function isEnabledForDomain(domainURL) {
  let enabledForDomain = settings.get("enable");
  if (enabledForDomain) {
    enabledForDomain = false;

    if (isDomainOnList(settings, domainURL)) {
      enabledForDomain = true;
    } else if (domainURL.indexOf(chrome.runtime.getURL("")) !== -1) {
      enabledForDomain = true;
    }
  }
  return enabledForDomain;
}

// Called when a message is passed.  We assume that the content script
// wants to show the page action.
function onRequest(request, sender, sendResponse) {
  let respMsg = {};

  checkLastError();

  request.context.tabId = sender.tab.id;
  request.context.frameId = sender.frameId;

  switch (request.command) {
    case "predictReq":
      if (configUpdated === false) {
        updatePresageConfig();
        configUpdated = true;
      }
      request.context.lang = settings.get("language");
      sendMsgToSandbox(request);
      break;
    case "status":
      // showPageAction(sender.tab.id, request.context.enabled);
      break;

    case "getConfig":
      respMsg = {
        command: "setConfig",
        context: {
          enabled: isEnabledForDomain(sender.tab.url),
          useEnter: settings.get("useEnter"),
          minWordLenghtToPredict: settings.get("minWordLenghtToPredict"),
          predictNextWordAfterWhiteSpace: settings.get(
            "predictNextWordAfterWhiteSpace"
          ),
        },
      };
  }

  // Return nothing to let the connection be cleaned up.
  sendResponse(respMsg);
}

// Listen for the content script to send a message to the background page.
chrome.runtime.onMessage.addListener(onRequest);

function receiveMessage(event) {
  checkLastError();

  // Make sure that tabId is still valid
  chrome.tabs.get(event.data.context.tabId, function (tab) {
    checkLastError();

    if (tab) {
      chrome.tabs.sendMessage(event.data.context.tabId, event.data, {
        frameId: event.data.context.frameId,
      });
    }
  });
}

/*
function setPageActionIcon(tabId, isActive) {
  chrome.browserAction.setBadgeText({
    text: isActive ? "On" : "Off",
  });
}

function showPageAction(tabId, isActive) {
  setPageActionIcon(tabId, isActive);
}
*/

window.addEventListener("message", receiveMessage, false);

function toggleOnOffActiveTab() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
    checkLastError();
    if (tabs.length === 1) {
      const currentTab = tabs[0];

      const message = {
        command: "toggle",
        context: {},
      };

      chrome.tabs.sendMessage(currentTab.id, message);
    }
  });
}

chrome.commands.onCommand.addListener(function (command) {
  switch (command) {
    case "toggle-ft-active-tab":
      toggleOnOffActiveTab();
      break;

    default:
      console.log("Unknown command: ", command);
      break;
  }
});

function updatePresageConfig() {
  sendMsgToSandbox({
    command: "config",
    context: {
      lang: settings.get("language"),
      key: "Presage.Selector.SUGGESTIONS",
      value: settings.get("numSuggestions"),
    },
  });
}
