import { FancierSettingsWithManifest } from "./js/classes/fancier-settings.js";

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
      settings.manifest.removeDomainBtn.addEvent("action", function () {
        settings.manifest.domainList.remove();
      });

      // Update pressage config on change
      [
        "numSuggestions",
        "minWordLenghtToPredict",
        "predictNextWordAfterSeparatorChar",
        "insertSpaceAfterAutocomplete",
        "autoCapitalize",
        "removeSpace",
      ].forEach((element) => {
        settings.manifest[element].addEvent("action", function () {
          optionsPageConfigChange();
        });
      });
      if (navigator.userAgent.indexOf("Chrome") !== -1) {
        settings.manifest.allUrls.element.element.addEventListener(
          "click",
          function () {
            const fn = this.checked
              ? chrome.permissions.request
              : chrome.permissions.remove;
            fn(
              {
                origins: ["<all_urls>"],
              },
              function (success) {
                if (!success) {
                  settings.manifest.allUrls.fireEvent("change");
                }
              }
            );
          }
        );
      } else {
        settings.manifest.allUrls.element.parentElement.style.display = "none";
      }
    }))();
});
