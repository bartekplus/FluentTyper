import { FancySettingsWithManifest } from "./js/classes/fancy-settings.js";

window.addEvent("domready", function () {
  // Option 1: Use the manifest:
  (() =>
    new FancySettingsWithManifest(function (settings) {
      settings.manifest.removeDomainBtn.addEvent("action", function () {
        settings.manifest.domainList.remove();
      });
      if (navigator.userAgent.indexOf("Chrome") !== -1) {
        settings.manifest.allUrls.element.addEventListener(
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
