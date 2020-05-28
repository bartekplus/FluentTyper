"use strict";

import {
  getDomain,
  isDomainOnList,
  removeDomainFromList,
  addDomainToList,
} from "../utils.js";
import { Store } from "../third_party/fancy-settings/lib/store.js";

const settings = new Store("settings");

function init() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
    if (tabs.length === 1) {
      const currentTab = tabs[0];
      const urlNode = document.getElementById("checkboxDomainLabel");
      const checkboxNode = document.getElementById("checkboxDomainInput");
      const checkboxEnableNode = document.getElementById("checkboxEnableInput");

      const domainURL = getDomain(currentTab.url);
      const opMode = settings.get("operatingMode");
      urlNode.innerText = "Enable autocomplete on: " + domainURL;

      if (isDomainOnList(settings, domainURL)) {
        checkboxNode.checked = opMode !== "blacklist";
      } else {
        checkboxNode.checked = opMode === "blacklist";
      }

      checkboxEnableNode.checked = settings.get("enable");
      document.getElementById("runOptions").href = chrome.extension.getURL(
        "options.html"
      );
    }
  });
}

function addRemoveDomain() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
    if (tabs.length === 1) {
      const currentTab = tabs[0];
      const domainURL = getDomain(currentTab.url);
      const opMode = settings.get("operatingMode");

      const message = {
        command: null,
        context: {},
      };

      if (isDomainOnList(settings, domainURL)) {
        removeDomainFromList(settings, domainURL);
        message.command = opMode === "blacklist" ? "enable" : "disable";
      } else {
        addDomainToList(settings, domainURL);
        message.command = opMode === "blacklist" ? "disable" : "enable";
      }

      chrome.tabs.sendMessage(currentTab.id, message);
    }
  });
}

function toggleOnOff() {
  const newMode = !settings.get("enable");
  settings.set("enable", newMode);

  chrome.tabs.query({}, function (tabs) {
    for (let i = 0; i < tabs.length; i++) {
      const message = {
        command: null,
        context: {},
      };

      if (newMode) {
        message.command = "enable";
      } else {
        message.command = "disable";
      }

      chrome.tabs.sendMessage(tabs[i].id, message);
    }
  });
}

init();

window.document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  window.document
    .getElementById("checkboxDomainInput")
    .addEventListener("click", addRemoveDomain);
  window.document
    .getElementById("checkboxEnableInput")
    .addEventListener("click", toggleOnOff);
});
