import { i18n } from "./i18n.js";

// SAMPLE
var manifest = {
  name: "FluentTyper Settings",
  icon: "icon/icon128.png",
  settings: [
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "enable",
      type: "checkbox",
      label: i18n.get("enable"),
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "operatingMode",
      type: "radioButtons",
      options: [
        ["blacklist", "Enabled by default (domain list is a blacklist)"],
        ["whitelist", "Disabled by default (domain list is a whitelist)"],
      ],
      label: "Operating mode:",
    },
    {
      tab: "Domain list",
      group: i18n.get("Management"),
      name: "domainList",
      type: "listBox",
      options: (function () {})(),
    },
    {
      tab: "Domain list",
      group: i18n.get("Management"),
      name: "removeDomainBtn",
      type: "button",
      text: i18n.get("remove"),
    },
    {
      tab: "Domain list",
      group: i18n.get("add"),
      name: "domain",
      type: "text",
      label: i18n.get("domain"),
      text: i18n.get("x-domain"),
      store: false,
    },
    {
      tab: "Domain list",
      group: i18n.get("add"),
      name: "addDomainBtn",
      type: "button",
      text: i18n.get("add"),
    },
    {
      tab: "Domain list",
      group: i18n.get("add"),
      name: "addDomainDsc",
      type: "description",
      text: i18n.get("description-url"),
    },
    {
      tab: i18n.get("About"),
      group: i18n.get("FluentTyper"),
      name: "FluentTyper",
      type: "description",
      text: i18n.get("x-FluentTyper"),
    },
    {
      tab: i18n.get("About"),
      group: i18n.get("Credits"),
      name: "Credits",
      type: "description",
      text: i18n.get("x-Credits"),
    },
    {
      tab: i18n.get("About"),
      group: i18n.get("Version"),
      name: "Version",
      type: "description",
      text: chrome.runtime.getManifest().version,
    },
  ],
};

export { manifest };
