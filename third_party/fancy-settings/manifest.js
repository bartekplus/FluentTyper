import { i18n } from "./i18n.js";

var donateHTML =
  "<p>" +
  "Creating and maintaining FluentTyper has required - and still " +
  "does - a considerable amount of work and effort. If you like " +
  "FluentTyper, then you may wish to support FluentTyper " +
  "development by making a voluntary donation. This will also " +
  "enable future enhancement to the extension. " +
  "</p>" +
  "<form " +
  'action="https://www.paypal.com/cgi-bin/webscr"' +
  'method="post"' +
  'target="_top"' +
  ">" +
  '<input type="hidden" name="cmd" value="_donations" />' +
  '<input type="hidden" name="business" value="FNA6UN4JRSRTU" />' +
  "<input" +
  '  type="hidden"' +
  '  name="item_name"' +
  '  value="Support for Development of FluentTyper"' +
  "/>" +
  '<input type="hidden" name="currency_code" value="USD" />' +
  "<input" +
  '  type="image"' +
  '  src="https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif"' +
  '  border="0"' +
  '  name="submit"' +
  '  title="PayPal - The safer, easier way to pay online!"' +
  '  alt="Donate with PayPal button"' +
  "/>" +
  "<img" +
  '  alt=""' +
  '  border="0"' +
  '  src="https://www.paypal.com/en_US/i/scr/pixel.gif"' +
  '  width="1"' +
  '  height="1"' +
  "/>" +
  "</form>";

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
      default: true,
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
      default: "blacklist",
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("Miscellaneous"),
      name: "useEnter",
      type: "checkbox",
      label: i18n.get("useEnter"),
      default: true,
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
    {
      tab: i18n.get("About"),
      group: i18n.get("Donate"),
      name: "Donate",
      type: "description",
      text: donateHTML,
    },
  ],
};

export { manifest };
