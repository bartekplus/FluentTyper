import {
  getDomain,
  isDomainOnList,
  removeDomainFromList,
  addDomainToList,
} from "../utils.js";
import { Store } from "../third_party/fancier-settings/lib/store.js";

const settings = new Store("settings");

function init() {
  chrome.tabs.query(
    { active: true, lastFocusedWindow: true },
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
          const [granted, error] = await chromePromise(
            chrome.permissions.contains,
            {
              origins: [new URL(currentTab.url).origin + "/*"],
            }
          );
          if (error) {
            checkboxNode.disabled = true;
            console.log(error);
          } else {
            urlNode.innerHTML = "<span>Enable autocomplete on: " + domainURL;
            if (!granted) {
              await removeDomainFromList(settings, domainURL);
              urlNode.innerText += "\nAutomatically reloads a page.";
            }

            if (await isDomainOnList(settings, domainURL)) {
              checkboxNode.checked = true;
            } else {
              checkboxNode.checked = false;
            }
          }
        }

        checkboxEnableNode.checked = await settings.get("enable");
        document.getElementById("runOptions").onclick = function () {
          chrome.runtime.openOptionsPage();
        };
      }
    }
  );
}

async function chromePromise(fn, ...args) {
  return new Promise((resolve) => {
    fn(...args, (result) => {
      if (chrome.runtime.lastError) {
        resolve([undefined, chrome.runtime.lastError.message]);
      } else {
        resolve([result, undefined]);
      }
    });
  });
}

async function addRemoveDomain() {
  chrome.tabs.query(
    { active: true, lastFocusedWindow: true },
    async function (tabs) {
      if (tabs.length === 1) {
        const currentTab = tabs[0];
        const domainURL = getDomain(currentTab.url);
        const message = {
          command: "popupPageDisable",
          context: {},
        };

        if (await isDomainOnList(settings, domainURL)) {
          await removeDomainFromList(settings, domainURL);
          message.command = "popupPageDisable";
        } else {
          let granted = true;
          let error = null;
          if (navigator.userAgent.indexOf("Chrome") !== -1) {
            [granted, error] = await chromePromise(
              chrome.permissions.contains,
              {
                origins: [new URL(currentTab.url).origin + "/*"],
              }
            );
            if (!error && !granted) {
              [granted, error] = await chromePromise(
                chrome.permissions.request,
                {
                  origins: [new URL(currentTab.url).origin + "/*"],
                }
              );
              if (granted) {
                chrome.tabs.reload(currentTab.id);
              }
            }
          }

          if (granted) {
            addDomainToList(settings, domainURL);
            message.command = "popupPageEnable";
          }
        }
        setTimeout(init, 0);

        chrome.tabs.sendMessage(currentTab.id, message);
      }
    }
  );
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

      setTimeout(init, 0);
      chrome.tabs.sendMessage(tabs[i].id, message);
    }
  });
}

init();

window.document.addEventListener("DOMContentLoaded", function () {
  window.document
    .getElementById("checkboxDomainInput")
    .addEventListener("click", addRemoveDomain);
  window.document
    .getElementById("checkboxEnableInput")
    .addEventListener("click", toggleOnOff);
});
