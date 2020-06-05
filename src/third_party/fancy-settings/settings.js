import { FancySettingsWithManifest } from "./js/classes/fancy-settings.js";

window.addEvent("domready", function () {
  // Option 1: Use the manifest:
  (() =>
    new FancySettingsWithManifest(function (settings) {
      settings.manifest.removeDomainBtn.addEvent("action", function () {
        settings.manifest.domainList.remove();
      });
    }))();
});
