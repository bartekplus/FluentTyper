import { getDomain, isEnabledForDomain, blockUnBlockDomain } from "../utils.js";
import { Store } from "../third_party/fancier-settings/lib/store.js";
import { SUPPORTED_LANGUAGES } from "../lang.js";

const settings = new Store("settings");

// Initialize the extension
function init() {
  // Query the active tab
  chrome.tabs.query(
    { active: true, currentWindow: true },
    async function (tabs) {
      // If there is only one tab
      if (tabs.length === 1) {
        // Get the current tab
        const currentTab = tabs[0];

        // Get the necessary nodes from the DOM
        const urlNode = document.getElementById("checkboxDomainLabel");
        const checkboxNode = document.getElementById("checkboxDomainInput");
        const checkboxEnableNode = document.getElementById(
          "checkboxEnableInput",
        );

        // Get the domain URL of the current tab
        const domainURL = getDomain(currentTab.url);

        // If a valid domain URL is found
        if (domainURL && domainURL !== "null") {
          // Check if autocomplete is enabled for the domain
          const enabled = await isEnabledForDomain(settings, domainURL);

          // Set the checkbox value to the enabled state
          checkboxNode.checked = enabled;

          // Update the label to show the current domain URL
          urlNode.innerHTML = "<span>Enable autocomplete on:<br> " + domainURL;

          // Add a click event listener to the checkbox to add or remove the domain from the list
          window.document
            .getElementById("checkboxDomainInput")
            .addEventListener(
              "click",
              addRemoveDomain.bind(null, currentTab.id, domainURL),
            );
        }

        // Set the checkbox value to the global enable setting
        checkboxEnableNode.checked = await settings.get("enable");
      }

      // Get the current language setting
      const language = await settings.get("language");

      // Get the language select element from the DOM
      const select = window.document.getElementById("languageSelect");

      // Add the supported languages as options to the select element
      for (const [langCode, lang] of Object.entries(SUPPORTED_LANGUAGES)) {
        const opt = window.document.createElement("option");
        opt.value = langCode;
        opt.innerHTML = lang;
        select.appendChild(opt);
      }

      // Set the selected option to the current language
      select.value = language;
    },
  );

  // Add a click event listener to the enable checkbox to toggle the feature on or off
  window.document
    .getElementById("checkboxEnableInput")
    .addEventListener("click", toggleOnOff);

  // Add a change event listener to the language select element to update the language setting
  window.document
    .getElementById("languageSelect")
    .addEventListener("change", languageChangeEvent);

  // Add a click event listener to the "Run Options" button to open the options page
  document.getElementById("runOptions").onclick = function () {
    chrome.runtime.openOptionsPage();
  };
}

// Function to add or remove a domain from the list of enabled domains
async function addRemoveDomain(tabId, domainURL) {
  // Get the necessary nodes from the DOM
  const urlNode = document.getElementById("checkboxDomainLabel");
  const checkboxNode = document.getElementById("checkboxDomainInput");

  // Create a message object to send to the content script
  const message = {
    command: checkboxNode.checked ? "popupPageEnable" : "popupPageDisable",
    context: {},
  };

  // Update the label to show the current domain URL
  urlNode.innerHTML = "<span>Enable autocomplete on: " + domainURL;

  // Add or remove the domain from the list of enabled domains
  blockUnBlockDomain(settings, domainURL, !checkboxNode.checked);

  // Send the message to the content script to enable or disable the feature on the current tab
  chrome.tabs.sendMessage(tabId, message);
}

// Define an asynchronous function called 'languageChangeEvent'
async function languageChangeEvent() {
  // Get the 'select' element with an ID of 'languageSelect'
  const select = window.document.getElementById("languageSelect");

  // Set the 'language' value in the 'settings' object to the value of the 'select' element
  settings.set("language", select.value);

  // Create a 'message' object with a 'command' property and a 'context' property
  const message = {
    command: "optionsPageConfigChange",
    context: {},
  };

  // Send the 'message' object to the extension's background script
  chrome.runtime.sendMessage(message);
}

// Function to toggle the feature on or off
async function toggleOnOff() {
  // Get the current mode (enabled or disabled) from the settings
  const newMode = !(await settings.get("enable"));

  // Set the new mode in the settings
  settings.set("enable", newMode);

  // Send a message to all tabs to enable or disable the feature
  chrome.tabs.query({}, function (tabs) {
    for (let i = 0; i < tabs.length; i++) {
      const message = {
        command: null,
        context: {},
      };

      // Set the appropriate command based on the new mode
      if (newMode) {
        message.command = "popupPageEnable";
      } else {
        message.command = "popupPageDisable";
      }

      // Send the message to the content script in the current tab
      chrome.tabs.sendMessage(tabs[i].id, message);
    }
  });
}

window.document.addEventListener("DOMContentLoaded", function () {
  init();
});
