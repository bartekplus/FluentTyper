"use strict";

import { isDomainOnList, checkLastError } from "./utils.js";

import { Store } from "./third_party/fancy-settings/lib/store.js";

var settings = new Store("settings");

// Check whether new version is installed
chrome.runtime.onInstalled.addListener(function (details) {
  checkLastError();
  if (details.reason === "install") {
    chrome.tabs.create({
      url: "new_installation/index.html",
    });
  } else if (details.reason === "update") {
    var thisVersion = chrome.runtime.getManifest().version;
    console.log(
      "Updated from " + details.previousVersion + " to " + thisVersion + "!"
    );
    // chrome.tabs.create({url: "options/index.html"});
  }
});

function sendMsgToSandbox(message) {
  var iframe = document.getElementById("sandboxFrame");
  iframe.contentWindow.postMessage(message, "*");
}

function isEnabledForDomain(domainURL) {
  var enabledForDomain = settings.get("enable");
  if (enabledForDomain) {
    var opMode = settings.get("operatingMode");
    enabledForDomain = opMode === "blacklist";

    if (isDomainOnList(settings, domainURL)) {
      if (opMode === "blacklist") {
        enabledForDomain = false;
      } else {
        enabledForDomain = true;
      }
    }
  }
  return enabledForDomain;
}

// Called when a message is passed.  We assume that the content script
// wants to show the page action.
function onRequest(request, sender, sendResponse) {
  var respMsg = {};

  checkLastError();

  request.context.tabId = sender.tab.id;
  request.context.frameId = sender.frameId;

  switch (request.command) {
    case "predictReq":
      sendMsgToSandbox(request);
      break;
    case "status":
      showPageAction(sender.tab.id, request.context.enabled);
      break;

    case "getConfig":
      respMsg = {
        command: "getConfig",
        context: {
          enabled: isEnabledForDomain(sender.tab.url),
          useEnter: settings.get("useEnter"),
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

function setPageActionIcon(tabId, isActive) {
  const iconSizes = [16, 32, 48, 64, 72, 96, 128, 256];
  const icons = {};

  for (let sizeIdx = 0; sizeIdx < iconSizes.length; sizeIdx++) {
    icons[iconSizes[sizeIdx]] =
      "/icon/icon" +
      (!isActive ? "Inactive" : "") +
      +iconSizes[sizeIdx] +
      ".png";
  }
  chrome.pageAction.setIcon({ tabId: tabId, path: icons });
}

function showPageAction(tabId, isActive) {
  setPageActionIcon(tabId, isActive);
  chrome.pageAction.show(tabId);
}

window.addEventListener("message", receiveMessage, false);

function toggleOnOffActiveTab() {
  chrome.tabs.query({ active: true }, function (tabs) {
    checkLastError();
    const currentTab = tabs[0];

    var message = {
      command: "toggle",
      context: {},
    };

    chrome.tabs.sendMessage(currentTab.id, message);
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
