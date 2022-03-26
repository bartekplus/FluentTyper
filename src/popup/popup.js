import {
  getDomain,
  isDomainOnBlackList,
  removeDomainFromBlackList,
  addDomainToBlackList,
} from "../utils.js";
import { Store } from "../third_party/fancier-settings/lib/store.js";

const settings = new Store("settings");

function init() {
  chrome.tabs.query(
    { active: true, currentWindow: true },
    async function (tabs) {
      if (tabs.length === 1) {
        const currentTab = tabs[0];
        const urlNode = document.getElementById("checkboxDomainLabel");
        const checkboxNode = document.getElementById("checkboxDomainInput");
        const checkboxEnableNode = document.getElementById(
          "checkboxEnableInput"
        );
        const domainURL = getDomain(currentTab.url);
        if (domainURL && domainURL !== "null") {
          const blocked = await isDomainOnBlackList(settings, domainURL);
          checkboxNode.checked = !blocked;
          urlNode.innerHTML = "<span>Enable autocomplete on: " + domainURL;

          window.document
            .getElementById("checkboxDomainInput")
            .addEventListener(
              "click",
              addRemoveDomain.bind(null, currentTab.id, domainURL)
            );
        }

        checkboxEnableNode.checked = await settings.get("enable");
      }
    }
  );
  window.document
    .getElementById("checkboxEnableInput")
    .addEventListener("click", toggleOnOff);
  document.getElementById("runOptions").onclick = function () {
    chrome.runtime.openOptionsPage();
  };
}

async function addRemoveDomain(tabId, domainURL) {
  const urlNode = document.getElementById("checkboxDomainLabel");
  const checkboxNode = document.getElementById("checkboxDomainInput");
  const message = {
    command: checkboxNode.checked ? "popupPageEnable" : "popupPageDisable",
    context: {},
  };

  urlNode.innerHTML = "<span>Enable autocomplete on: " + domainURL;

  if (checkboxNode.checked) {
    removeDomainFromBlackList(settings, domainURL);
  } else {
    addDomainToBlackList(settings, domainURL);
  }
  chrome.tabs.sendMessage(tabId, message);
}

async function toggleOnOff() {
  const newMode = !(await settings.get("enable"));
  settings.set("enable", newMode);

  chrome.tabs.query({}, function (tabs) {
    for (let i = 0; i < tabs.length; i++) {
      const message = {
        command: null,
        context: {},
      };

      if (newMode) {
        message.command = "popupPageEnable";
      } else {
        message.command = "popupPageDisable";
      }

      chrome.tabs.sendMessage(tabs[i].id, message);
    }
  });
}

window.document.addEventListener("DOMContentLoaded", function () {
  init();
});
