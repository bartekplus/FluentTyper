import { isDomainOnBlackList, checkLastError } from "./utils.js";
import { Store } from "./third_party/fancier-settings/lib/store.js";
import { SUPPORTED_LANGUAGES } from "./third_party/libpresage/lang.js";

(function () {
  const SANDBOX_FRAME_INIT_TIME_MS = 3000;
  const SANDBOX_FRAME_LOAD_TIME_MS = 500;
  class BackgrounPage {
    constructor() {
      this.settings = new Store("settings");
      this.language = "";
      this.fallbackLanguage = "";

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

    async isEnabledForDomain(domainURL) {
      let enabledForDomain = await this.settings.get("enable");
      if (enabledForDomain) {
        if (await isDomainOnBlackList(this.settings, domainURL)) {
          enabledForDomain = false;
        }
      }
      return enabledForDomain;
    }

    detectLanguage(request) {
      chrome.i18n.detectLanguage(request.context.text, (result) => {
        let detectedLanguage = null;
        let maxpercentage = -1;
        for (let i = 0; i < result.languages.length; i++) {
          if (result.languages[i].percentage > maxpercentage) {
            detectedLanguage = result.languages[i].language;
            maxpercentage = result.languages[i].percentage;
          }
        }
        if (SUPPORTED_LANGUAGES.includes(detectedLanguage)) {
          request.context.lang = detectedLanguage;
          this.sendMsgToSandbox(request);
        } else if (SUPPORTED_LANGUAGES.includes(this.fallbackLanguage)) {
          request.context.lang = this.fallbackLanguage;
          this.sendMsgToSandbox(request);
        }
      });
    }

    //Messages from option page and content script
    onMessage(request, sender, sendResponse) {
      let asyncResponse = false;
      checkLastError();

      request.context.tabId = sender.tab.id;
      request.context.frameId = sender.frameId;

      switch (request.command) {
        case "contentScriptPredictReq":
          request.command = "backgroundPagePredictReq";
          if (this.language === "auto_detect") {
            request.context.lang = this.detectLanguage(request);
          } else {
            request.context.lang = this.language;
            this.sendMsgToSandbox(request);
          }

          break;
        case "status":
          // showPageAction(sender.tab.id, request.context.enabled);
          break;

        case "optionsPageConfigChange":
          this.updatePresageConfig();
          break;

        case "contentScriptGetConfig":
          asyncResponse = true;
          Promise.all([
            this.isEnabledForDomain(sender.tab.url),
            this.settings.get("autocomplete"),
          ])
            .then((values) => {
              sendResponse({
                command: "backgroundPageSetConfig",
                context: {
                  enabled: values[0],
                  autocomplete: values[1],
                },
              });
            })
            .catch(function (e) {
              console.error(e);
            });

          break;
      }
      return asyncResponse;
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
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        checkLastError();
        if (tabs.length === 1) {
          const currentTab = tabs[0];

          const message = {
            command: "backgroundPageToggle",
            context: {},
          };

          chrome.tabs.sendMessage(currentTab.id, message);
        }
      });
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

    async updatePresageConfig() {
      this.language = await this.settings.get("language");
      this.fallbackLanguage = await this.settings.get("fallbackLanguage");
      this.sendMsgToSandbox({
        command: "backgroundPageSetConfig",
        context: {
          numSuggestions: await this.settings.get("numSuggestions"),
          minWordLengthToPredict: await this.settings.get(
            "minWordLengthToPredict"
          ),
          insertSpaceAfterAutocomplete: await this.settings.get(
            "insertSpaceAfterAutocomplete"
          ),
          autoCapitalize: await this.settings.get("autoCapitalize"),
          dontPredictChars: await this.settings.get("dontPredictChars"),
          removeSpace: await this.settings.get("removeSpace"),
          textExpansions: await this.settings.get("textExpansions"),
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
    onDOMContentLoaded() {
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
  new BackgrounPage();
})();
