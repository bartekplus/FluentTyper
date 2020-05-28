//
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/frankkohlhepp/fancy-settings
// License: LGPL v2.1
//

// Defined in mootools-core.js
/* global $ */

import { i18n } from "../../i18n.js";
import { Tab } from "./tab.js";
import { Search } from "./search.js";
import { Setting } from "./setting.js";
import { manifest } from "../../manifest.js";

class FancySettings {
  constructor(name, icon) {
    // Set title and icon
    $("title").set("text", name);
    $("favicon").set("href", icon);
    $("icon").set("src", icon);
    $("settings-label").set("text", i18n.get("settings") || "Settings");
    $("search-label").set("text", i18n.get("search") || "Search");
    $("search").set("placeholder", (i18n.get("search") || "Search") + "...");

    this.tabs = [];
    this.tab = new Tab($("tab-container"), $("content"));
    this.search = new Search($("search"), $("search-result-container"));
  }

  create(params) {
    let tab, group, row, content;

    // Create tab if it doesn't exist already
    if (this.tabs[params.tab] === undefined) {
      this.tabs[params.tab] = { groups: {} };
      tab = this.tabs[params.tab];

      tab.content = this.tab.create();
      tab.content.tab.set("text", params.tab);
      this.search.bind(tab.content.tab);

      const anchor = location.hash.substring(1);
      if (params.tab === i18n.get(anchor) || params.tab === anchor) {
        tab.content.activate();
      }

      tab.content = tab.content.content;
      new Element("h2", {
        text: params.tab,
      }).inject(tab.content);
    } else {
      tab = this.tabs[params.tab];
    }

    // Create group if it doesn't exist already
    if (tab.groups[params.group] === undefined) {
      tab.groups[params.group] = {};
      group = tab.groups[params.group];

      group.content = new Element("table", {
        class: "setting group",
      }).inject(tab.content);

      row = new Element("tr").inject(group.content);

      new Element("td", {
        class: "setting group-name",
        text: params.group,
      }).inject(row);

      content = new Element("td", {
        class: "setting group-content",
      }).inject(row);

      group.setting = new Setting(content);
    } else {
      group = tab.groups[params.group];
    }

    // Create and index the setting
    const bundle = group.setting.create(params);
    this.search.add(bundle);

    return bundle;
  }

  align(settings) {
    let maxWidth = 0;
    const types = ["text", "button", "slider", "popupButton"];
    const type = settings[0].params.type;

    if (!types.contains(type)) {
      throw new Error("invalidType");
    }

    settings.each(function (setting) {
      if (setting.params.type !== type) {
        throw new Error("multipleTypes");
      }

      const width = setting.label.offsetWidth;
      if (width > maxWidth) {
        maxWidth = width;
      }
    });

    settings.each(function (setting) {
      const width = setting.label.offsetWidth;
      if (width < maxWidth) {
        if (type === "button" || type === "slider") {
          setting.element.setStyle("margin-left", maxWidth - width + 2 + "px");
          setting.search.element.setStyle(
            "margin-left",
            maxWidth - width + 2 + "px"
          );
        } else {
          setting.element.setStyle("margin-left", maxWidth - width + "px");
          setting.search.element.setStyle(
            "margin-left",
            maxWidth - width + "px"
          );
        }
      }
    });
  }
}

const FancySettingsWithManifest = function (callback) {
  let output;
  const settings = new FancySettings(manifest.name, manifest.icon);
  settings.manifest = {};

  manifest.settings.each(function (params) {
    output = settings.create(params);
    if (params.name !== undefined) {
      settings.manifest[params.name] = output;
    }
  });

  if (manifest.alignment !== undefined) {
    document.body.addClass("measuring");
    manifest.alignment.each(function (group) {
      group = group.map(function (name) {
        return settings.manifest[name];
      });
      settings.align(group);
    });
    document.body.removeClass("measuring");
  }

  if (callback !== undefined) {
    callback(settings);
  }
};

export { FancySettings, FancySettingsWithManifest };
