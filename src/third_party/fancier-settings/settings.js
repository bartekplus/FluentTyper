import { FancierSettingsWithManifest } from "./js/classes/fancier-settings.js";
import { Store } from "./lib/store.js";
import { TextExpander } from "./textExpander.js";

function optionsPageConfigChange() {
  const message = {
    command: "optionsPageConfigChange",
    context: {},
  };
  chrome.runtime.sendMessage(message);
}

function fallbackLanguageVisibility(settings, value) {
  if (value === "auto_detect")
    settings.manifest.fallbackLanguage.bundle.element.classList.remove(
      "is-hidden"
    );
  else
    settings.manifest.fallbackLanguage.bundle.element.classList.add(
      "is-hidden"
    );
}

window.addEventListener("DOMContentLoaded", function () {
  // Option 1: Use the manifest:
  (() =>
    new FancierSettingsWithManifest(async function (settings) {
      new TextExpander(settings, optionsPageConfigChange);
      settings.manifest.removeDomainBtn.addEvent("action", function () {
        settings.manifest.domainBlackList.remove();
      });

      const store = new Store("settings");
      fallbackLanguageVisibility(settings, await store.get("language"));

      settings.manifest.language.addEvent("action", function (value) {
        fallbackLanguageVisibility(settings, value);
      });

      settings.manifest.addDomainBtn.addEvent("action", function () {
        if (settings.manifest.domain.element.element.checkValidity()) {
          const domainURL = settings.manifest.domain.get();
          const hostName = new URL(domainURL).hostname;
          if (hostName) {
            settings.manifest.domainBlackList.add(hostName);
            settings.manifest.domain.element.element.value = "";
          }
        }
      });

      // Update pressage config on change
      [
        "autocomplete",
        "language",
        "domainListMode",
        "fallbackLanguage",
        "numSuggestions",
        "minWordLengthToPredict",
        "insertSpaceAfterAutocomplete",
        "autoCapitalize",
        "applySpacingRules",
        "selectByDigit",
      ].forEach((element) => {
        settings.manifest[element].addEvent("action", function () {
          optionsPageConfigChange();
        });
      });
    }))();
});
