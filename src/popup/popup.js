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
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, async function (
    tabs
  ) {
    if (tabs.length === 1) {
      const currentTab = tabs[0];
      const urlNode = document.getElementById("checkboxDomainLabel");
      const checkboxNode = document.getElementById("checkboxDomainInput");
      const checkboxEnableNode = document.getElementById("checkboxEnableInput");
      const domainURL = getDomain(currentTab.url);
      const granted = await chromePromise(chrome.permissions.contains, {
        origins: [new URL(currentTab.url).origin + "/*"],
      });

      urlNode.innerHTML = "<span>Enable autocomplete on: " + domainURL;
      if (!granted) {
        removeDomainFromList(settings, domainURL);
        urlNode.innerText += "\nAutomatically reloads a page.";
      }

      if (isDomainOnList(settings, domainURL)) {
        checkboxNode.checked = true;
      } else {
        checkboxNode.checked = false;
      }

      checkboxEnableNode.checked = settings.get("enable");
      document.getElementById("runOptions").href = chrome.extension.getURL(
        "options.html"
      );
    }
  });
}

async function chromePromise(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
}

function addRemoveDomain() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, async function (
    tabs
  ) {
    if (tabs.length === 1) {
      const currentTab = tabs[0];
      const domainURL = getDomain(currentTab.url);
      const message = {
        command: "disable",
        context: {},
      };

      if (isDomainOnList(settings, domainURL)) {
        removeDomainFromList(settings, domainURL);
        message.command = "disable";
      } else {
        let granted = true;
        if (navigator.userAgent.indexOf("Chrome") !== -1) {
          granted = await chromePromise(chrome.permissions.contains, {
            origins: [new URL(currentTab.url).origin + "/*"],
          });
          if (!granted) {
            granted = await chromePromise(chrome.permissions.request, {
              origins: [new URL(currentTab.url).origin + "/*"],
            });
            if (granted) {
              chrome.tabs.reload(currentTab.id);
            }
          }
        }

        if (granted) {
          addDomainToList(settings, domainURL);
          message.command = "enable";
        }
      }
      setTimeout(init, 0);

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

      setTimeout(init, 0);
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
