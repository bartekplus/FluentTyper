//
// Copyright (c) 2021 Bartosz Tomczyk
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/bartekplus/fancier-settings
// License: LGPL v2.1
//

import { i18n } from "../../i18n.js";
import { Tab } from "./tab.js";
import { Setting } from "./setting.js";
import { manifest } from "../../manifest.js";
import { ElementWrapper } from "./utils.js";

class FancierSettings {
  constructor(name, icon) {
    try {
      document.getElementById("title")["text"] = name;
      document.getElementById("favicon")["href"] = icon;
      document.getElementById("icon")["src"] = icon;
    } catch (err) {
      console.log(err);
    }

    this.tabs = [];
    this.tab = new Tab(
      document.getElementById("tab-container"),
      document.getElementById("content")
    );
  }

  create(params) {
    let tab, group;

    // Create tab if it doesn't exist already
    if (this.tabs[params.tab] === undefined) {
      this.tabs[params.tab] = { groups: {} };
      tab = this.tabs[params.tab];

      tab.content = this.tab.create();
      tab.content.tabA.set("innerText", params.tab);

      const anchor = location.hash.substring(1);
      if (params.tab === i18n.get(anchor) || params.tab === anchor) {
        tab.content.activate();
      }

      tab.content = tab.content.content;
    } else {
      tab = this.tabs[params.tab];
    }

    // Create group if it doesn't exist already
    if (tab.groups[params.group] === undefined) {
      tab.groups[params.group] = {};
      group = tab.groups[params.group];
      group.content = new ElementWrapper("div", {});
      tab.content.element.appendChild(group.content.element);
      group.content.element.appendChild(
        new ElementWrapper("div", {
          class: "divider",
          innerText: params.group || params.tab,
        }).element
      );

      group.setting = new Setting(group.content.element);
    } else {
      group = tab.groups[params.group];
    }

    // Create and index the setting
    const bundle = group.setting.create(params);

    return bundle;
  }

  align(settings) {
    let maxWidth = 0;
    const types = ["text", "button", "slider", "popupButton"];
    const type = settings[0].params.type;

    if (!types.includes(type)) {
      throw new Error("invalidType");
    }

    settings.forEach(function (setting) {
      if (setting.params.type !== type) {
        throw new Error("multipleTypes");
      }

      const width = setting.label.offsetWidth;
      if (width > maxWidth) {
        maxWidth = width;
      }
    });

    settings.forEach(function (setting) {
      const width = setting.label.offsetWidth;
      if (width < maxWidth) {
        if (type === "button" || type === "slider") {
          setting.element.setStyle("margin-left", maxWidth - width + 2 + "px");
        } else {
          setting.element.setStyle("margin-left", maxWidth - width + "px");
        }
      }
    });
  }
}

const FancierSettingsWithManifest = function (callback) {
  let output;
  const settings = new FancierSettings(manifest.name, manifest.icon);
  settings.manifest = {};

  manifest.settings.forEach(function (params) {
    output = settings.create(params);
    if (params.name !== undefined) {
      settings.manifest[params.name] = output;
    }
  });

  if (manifest.alignment !== undefined) {
    document.body.classList.add("measuring");
    manifest.alignment.forEach(function (group) {
      group = group.map(function (name) {
        return settings.manifest[name];
      });
      settings.align(group);
    });
    document.body.classList.remove("measuring");
  }

  if (callback !== undefined) {
    callback(settings);
  }
};

export { FancierSettings, FancierSettingsWithManifest };
