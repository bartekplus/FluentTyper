"use strict";

import { isDomainOnList, checkLastError } from "./utils.js";
import { Store } from "./third_party/fancy-settings/lib/store.js";

(function () {
  const SANDBOX_FRAME_INIT_TIME_MS = 3000;
  const SANDBOX_FRAME_LOAD_TIME_MS = 500;
  class BackgrounPage {
    constructor() {
      this.settings = new Store("settings");

      chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));
      chrome.runtime.onMessage.addListener(this.onMessage.bind(this));
      chrome.commands.onCommand.addListener(this.onCommand.bind(this));
      window.addEventListener(
        "message",
        this.onMessageFromSandbox.bind(this),
        false
      );
      window.addEventListener(
        "DOMContentLoaded",
        this.onDOMContentLoaded.bind(this)
      );

      this.migrateStore();
    }

    migrateStore() {
      const domainList = this.settings.get("domainList");
      if (typeof domainList === "string" || domainList instanceof String) {
        this.settings.set("domainList", domainList.split("|@|"));
      }
    }

    onInstalled(details) {
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
    }

    sendMsgToSandbox(message) {
      const iframe = document.getElementById("sandboxFrame");
      iframe.contentWindow.postMessage(message, "*");
    }

    isEnabledForDomain(domainURL) {
      let enabledForDomain = this.settings.get("enable");
      if (enabledForDomain) {
        enabledForDomain = false;

        if (isDomainOnList(this.settings, domainURL)) {
          enabledForDomain = true;
        } else if (domainURL.indexOf(chrome.runtime.getURL("")) !== -1) {
          enabledForDomain = true;
        }
      }
      return enabledForDomain;
    }

    //Messages from option page and content script
    onMessage(request, sender, sendResponse) {
      checkLastError();

      request.context.tabId = sender.tab.id;
      request.context.frameId = sender.frameId;

      switch (request.command) {
        case "contentScriptPredictReq":
          request.context.lang = this.settings.get("language");
          request.command = "backgroundPagePredictReq";
          this.sendMsgToSandbox(request);
          break;
        case "status":
          // showPageAction(sender.tab.id, request.context.enabled);
          break;

        case "optionsPageConfigChange":
          this.updatePresageConfig();
          break;

        case "contentScriptGetConfig":
          const respMsg = {
            command: "backgroundPageSetConfig",
            context: {
              enabled: this.isEnabledForDomain(sender.tab.url),
              useEnter: this.settings.get("useEnter"),
            },
          };
          sendResponse(respMsg);
          break;
      }
    }

    //Messages from option page and content script
    onMessageFromSandbox(event) {
      checkLastError();

      switch (event.data.command) {
        case "sandBoxPredictResp":
          // Make sure that tabId is still valid
          chrome.tabs.get(event.data.context.tabId, function (tab) {
            checkLastError();

            if (tab) {
              // Update command to indicate orign of the message
              event.data.command = "backgroundPagePredictResp";
              chrome.tabs.sendMessage(event.data.context.tabId, event.data, {
                frameId: event.data.context.frameId,
              });
            }
          });
          break;

        default:
          console.log("Unkown message:");
          console.log(event);
          break;
      }
    }

    toggleOnOffActiveTab() {
      chrome.tabs.query(
        { active: true, lastFocusedWindow: true },
        function (tabs) {
          checkLastError();
          if (tabs.length === 1) {
            const currentTab = tabs[0];

            const message = {
              command: "backgroundPageToggle",
              context: {},
            };

            chrome.tabs.sendMessage(currentTab.id, message);
          }
        }
      );
    }

    onCommand(command) {
      switch (command) {
        case "toggle-ft-active-tab":
          this.toggleOnOffActiveTab();
          break;

        default:
          console.log("Unknown command: ", command);
          break;
      }
    }

    updatePresageConfig() {
      this.sendMsgToSandbox({
        command: "backgroundPageSetConfig",
        context: {
          lang: this.settings.get("language"),
          numSuggestions: this.settings.get("numSuggestions"),
          minWordLenghtToPredict: this.settings.get("minWordLenghtToPredict"),
          predictNextWordAfterWhiteSpace: this.settings.get(
            "predictNextWordAfterWhiteSpace"
          ),
          insertSpaceAfterAutocomplete: this.settings.get(
            "insertSpaceAfterAutocomplete"
          ),
          autoCapitalize: this.settings.get("autoCapitalize"),
          removeSpace: this.settings.get("removeSpace"),
        },
      });
    }

    onSandboxFrameLoaded() {
      setTimeout(
        this.updatePresageConfig.bind(this),
        SANDBOX_FRAME_INIT_TIME_MS
      );
    }

    // Trigger config update after sandboxFrame 'load' event
    onDOMContentLoaded(event) {
      if (navigator.userAgent.indexOf("Chrome") !== -1) {
        setTimeout(
          this.onSandboxFrameLoaded.bind(this),
          SANDBOX_FRAME_LOAD_TIME_MS
        );
      } else {
        const iframe = document.getElementById("sandboxFrame");
        iframe.addEventListener("load", this.onSandboxFrameLoaded.bind(this));
      }
    }
  }
  const backgroundPage = new BackgrounPage();
})();
