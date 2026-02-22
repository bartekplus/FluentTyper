import {
  getDomain,
  isEnabledForDomain,
  blockUnBlockDomain,
} from "../shared/utils";
import { SettingsManager } from "../shared/settingsManager";
import { SUPPORTED_LANGUAGES, resolveEnabledLanguages } from "../shared/lang";
import {
  CMD_POPUP_PAGE_ENABLE,
  CMD_POPUP_PAGE_DISABLE,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  KEY_ENABLED_LANGUAGES,
  KEY_LANGUAGE,
  KEY_EXTENSION_LANGUAGE,
} from "../shared/constants";
import {
  OptionsPageConfigChangeMessage,
  PopupPageEnableMessage,
  PopupPageDisableMessage,
} from "../shared/messageTypes";
import { i18n } from "../third_party/fancier-settings/i18n.js";

const settings = new SettingsManager();

function translateUI() {
  const elements = document.querySelectorAll("[data-i18n]");
  elements.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      const translated = i18n.get(key);
      if (translated) {
        el.innerHTML = translated;
      }
    }
  });
}

function init() {
  translateUI();

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
          urlNode.innerHTML = `<span>${i18n.get("popup_enable_autocomplete_on")}${domainURL}`;
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
      let language = (await settings.get(KEY_LANGUAGE)) as string;
      const enabledLanguages = resolveEnabledLanguages(
        await settings.get(KEY_ENABLED_LANGUAGES),
      );
      const select = window.document.getElementById(
        "languageSelect",
      ) as HTMLSelectElement;
      const allowAutoDetect = enabledLanguages.length > 1;
      const isAutoDetect = language === "auto_detect";
      const isValidLanguage = enabledLanguages.includes(language);
      const displayLanguage =
        isAutoDetect && allowAutoDetect
          ? "auto_detect"
          : isValidLanguage
            ? language
            : enabledLanguages[0];

      if (!isValidLanguage && !(isAutoDetect && allowAutoDetect)) {
        language = displayLanguage;
        await settings.set(KEY_LANGUAGE, language);
        chrome.runtime.sendMessage({
          command: CMD_OPTIONS_PAGE_CONFIG_CHANGE,
          context: {},
        });
      }
      if (allowAutoDetect) {
        const opt = window.document.createElement("option");
        opt.value = "auto_detect";
        opt.innerHTML = SUPPORTED_LANGUAGES.auto_detect;
        select.appendChild(opt);
      }
      for (const langCode of enabledLanguages) {
        const opt = window.document.createElement("option");
        opt.value = langCode;
        opt.innerHTML = SUPPORTED_LANGUAGES[langCode];
        select.appendChild(opt);
      }
      select.value = displayLanguage;
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
  urlNode.innerHTML = `<span>${i18n.get("popup_enable_autocomplete_on")}${domainURL}`;
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
  await settings.set(KEY_LANGUAGE, select.value);
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
