import { FancierSettingsWithManifest } from "./js/classes/fancier-settings.js";
import { TextExpander } from "./textExpander.js";

function optionsPageConfigChange() {
  const message = {
    command: "optionsPageConfigChange",
    context: {},
  };
  chrome.runtime.sendMessage(message);
}

window.addEventListener("DOMContentLoaded", function () {
  // Option 1: Use the manifest:
  (() =>
    new FancierSettingsWithManifest(function (settings) {
      new TextExpander(settings, optionsPageConfigChange);
      settings.manifest.removeDomainBtn.addEvent("action", function () {
        settings.manifest.domainList.remove();
      });

      // Update pressage config on change
      [
        "numSuggestions",
        "minWordLengthToPredict",
        "predictNextWordAfterSeparatorChar",
        "insertSpaceAfterAutocomplete",
        "autoCapitalize",
        "removeSpace",
      ].forEach((element) => {
        settings.manifest[element].addEvent("action", function () {
          optionsPageConfigChange();
        });
      });
    }))();
});
