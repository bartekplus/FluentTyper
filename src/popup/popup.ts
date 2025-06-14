import {
  getDomain,
  isEnabledForDomain,
  blockUnBlockDomain,
} from "../shared/utils";
import { SettingsManager } from "../shared/settingsManager";
import { SUPPORTED_LANGUAGES } from "../shared/lang";
import {
  CMD_POPUP_PAGE_ENABLE,
  CMD_POPUP_PAGE_DISABLE,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
} from "../shared/constants";
import {
  OptionsPageConfigChangeMessage,
  PopupPageEnableMessage,
  PopupPageDisableMessage,
} from "../shared/messageTypes";

const settings = new SettingsManager();

function init() {
  chrome.tabs.query(
    { active: true, currentWindow: true },
    async function (tabs) {
      if (tabs.length === 1) {
        const currentTab = tabs[0];
        const urlNode = document.getElementById(
          "checkboxDomainLabel",
        ) as HTMLElement;
        const checkboxNode = document.getElementById(
          "checkboxDomainInput",
        ) as HTMLInputElement;
        const checkboxEnableNode = document.getElementById(
          "checkboxEnableInput",
        ) as HTMLInputElement;
        const domainURL = getDomain(currentTab.url || "");
        if (domainURL && domainURL !== "null") {
          const enabled = await isEnabledForDomain(settings, domainURL);
          checkboxNode.checked = enabled;
          urlNode.innerHTML = `<span>Enable autocomplete on:<br> ${domainURL}`;
          if (typeof currentTab.id === "number") {
            window.document
              .getElementById("checkboxDomainInput")
              ?.addEventListener(
                "click",
                addRemoveDomain.bind(null, currentTab.id, domainURL),
              );
          }
        }
        checkboxEnableNode.checked = Boolean(await settings.get("enable"));
      }
      const language = (await settings.get("language")) as string;
      const select = window.document.getElementById(
        "languageSelect",
      ) as HTMLSelectElement;
      for (const [langCode, lang] of Object.entries(SUPPORTED_LANGUAGES)) {
        const opt = window.document.createElement("option");
        opt.value = langCode;
        opt.innerHTML = lang;
        select.appendChild(opt);
      }
      select.value = language;
    },
  );
  window.document
    .getElementById("checkboxEnableInput")
    ?.addEventListener("click", toggleOnOff);
  window.document
    .getElementById("languageSelect")
    ?.addEventListener("change", languageChangeEvent);
  document.getElementById("runOptions")!.onclick = function () {
    chrome.runtime.openOptionsPage();
  };
}

async function addRemoveDomain(tabId: number, domainURL: string) {
  const urlNode = document.getElementById("checkboxDomainLabel") as HTMLElement;
  const checkboxNode = document.getElementById(
    "checkboxDomainInput",
  ) as HTMLInputElement;
  let message: PopupPageEnableMessage | PopupPageDisableMessage;
  if (checkboxNode.checked) {
    message = {
      command: CMD_POPUP_PAGE_ENABLE,
      context: {},
    };
  } else {
    message = {
      command: CMD_POPUP_PAGE_DISABLE,
      context: {},
    };
  }
  urlNode.innerHTML = `<span>Enable autocomplete on: ${domainURL}`;
  await blockUnBlockDomain(settings, domainURL, !checkboxNode.checked);
  chrome.tabs.sendMessage(tabId, message);
}

async function languageChangeEvent() {
  const select = window.document.getElementById(
    "languageSelect",
  ) as HTMLSelectElement;
  const message: OptionsPageConfigChangeMessage = {
    command: CMD_OPTIONS_PAGE_CONFIG_CHANGE,
    context: {},
  };
  await settings.set("language", select.value);
  chrome.runtime.sendMessage(message);
}

async function toggleOnOff() {
  const newMode = !(await settings.get("enable"));
  await settings.set("enable", newMode);
  chrome.tabs.query({}, function (tabs) {
    for (let i = 0; i < tabs.length; i++) {
      let message: PopupPageEnableMessage | PopupPageDisableMessage;
      if (newMode) {
        message = {
          command: CMD_POPUP_PAGE_ENABLE,
          context: {},
        };
      } else {
        message = {
          command: CMD_POPUP_PAGE_DISABLE,
          context: {},
        };
      }
      chrome.tabs.sendMessage(tabs[i].id!, message);
    }
  });
}

window.document.addEventListener("DOMContentLoaded", function () {
  init();
});
