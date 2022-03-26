import { FancierSettingsWithManifest } from "./js/classes/fancier-settings.js";
import { TextExpander } from "./textExpander.js";

function optionsPageConfigChange() {
  const message = {
    command: "optionsPageConfigChange",
    context: {},
  };
  chrome.runtime.sendMessage(message);
}

function fallbackLanguageVibility(settings, value) {
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
    new FancierSettingsWithManifest(function (settings) {
      new TextExpander(settings, optionsPageConfigChange);
      settings.manifest.removeDomainBtn.addEvent("action", function () {
        settings.manifest.domainBlackList.remove();
      });

      fallbackLanguageVibility(settings, settings.manifest.language.get());
      settings.manifest.language.addEvent("action", function (value) {
        fallbackLanguageVibility(settings, value);
      });

      // Update pressage config on change
      [
        "language",
        "fallbackLanguage",
        "numSuggestions",
        "minWordLengthToPredict",
        "insertSpaceAfterAutocomplete",
        "autoCapitalize",
        "dontPredictChars",
        "removeSpace",
      ].forEach((element) => {
        settings.manifest[element].addEvent("action", function () {
          optionsPageConfigChange();
        });
      });
    }))();
});
