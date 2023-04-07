import { i18n } from "./i18n.js";
import { SUPPORTED_LANGUAGES } from "../../lang.js";
import { DOMAIN_LIST_MODE } from "../../utils.js";

const donateHTML =
  '<div class="has-text-centered"> \
  Developing and maintaining FluentTyper requires a significant amount of work and effort. If you find FluentTyper useful, you may wish to consider supporting its development by making a voluntary donation. Your support will also enable future enhancements to the extension <br>\
  <a href="https://www.buymeacoffee.com/FluentTyper" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"  alt="Buy Me A Coffee" style="height: 60px !important; width: 217px !important"/></a></div>';
const testFluentTyperHTML =
  '<textarea class="textarea is-full"  rows="12" placeholder="Click here and start typing…"></textarea>';

// SAMPLE
const manifest = {
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
      name: "language",
      type: "popupButton",
      options: Object.entries({
        ...{ auto_detect: "Auto detect" },
        ...SUPPORTED_LANGUAGES,
      }),
      label: "Prediction language:",
      default: "en",
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "domainListMode",
      type: "popupButton",
      options: Object.entries({
        ...DOMAIN_LIST_MODE,
      }),
      label: "Domain list mode:",
      default: "blackList",
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "fallbackLanguage",
      type: "popupButton",
      options: Object.entries(SUPPORTED_LANGUAGES),
      label: "Fallback prediction language:",
      default: "en",
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "minWordLengthToPredict",
      type: "slider",
      min: 0,
      max: 12,
      display: true,
      label:
        "This setting determines the minimum word length required to trigger the prediction feature. If set to '0', predictions will appear after a whitespace:",
      default: 1,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "numSuggestions",
      type: "slider",
      min: 0,
      max: 10,
      display: true,
      label:
        "This setting controls the number of suggestions that will appear in the prediction list. To disable prediction altogether, set this value to 0.",
      default: 5,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "autocomplete",
      type: "checkbox",
      label:
        "Enable this option to automatically complete words as you type by pressing the spacebar. To undo auto-completion and revert to the original text, simply press the backspace key.",
      default: false,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "insertSpaceAfterAutocomplete",
      type: "checkbox",
      label:
        "Enable this option to have a space automatically inserted after autocomplete suggestions while typing.",
      default: true,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "applySpacingRules",
      type: "checkbox",
      label:
        "Enable this option to automatically apply consistent spacing rules for punctuation and special characters throughout your document.",
      default: true,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "autoCapitalize",
      type: "checkbox",
      label:
        "Enable this option to automatically capitalize the first word of each sentence in your document.",
      default: true,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "selectByDigit",
      type: "checkbox",
      label:
        "Enable this option to select suggestions using the digit keys on your keyboard.",
      default: false,
    },
    {
      tab: i18n.get("Text Expander"),
      name: "textExpansions",
      type: "valueOnly",
      text: "",
      default: [
        [
          "FF",
          "Check out FluentTyper, a phenomenal productivity app that autocompletes words as you type, saving loads of time. It's free, and I think you'll love it!",
        ],
        ["callMe", "Call me back once you get free."],
        ["asap", "as soon as possible"],
        ["afaik", "as far as I know"],
        ["afaic", "as far as I'm concerned"],
        ["eur", "€"],
      ],
    },
    {
      tab: i18n.get("Test FluentTyper"),
      name: "Test FluentTyper",
      type: "description",
      text: testFluentTyperHTML,
    },
    {
      tab: "Domain black/white list",
      group: i18n.get("Management"),
      name: "domainBlackList",
      type: "listBox",
      options: (function () {})(),
      default: [],
    },
    {
      tab: "Domain black/white list",
      group: i18n.get("Management"),
      name: "removeDomainBtn",
      type: "button",
      text: i18n.get("remove"),
    },
    {
      tab: "Domain black/white list",
      group: i18n.get("Management"),
      name: "domain",
      type: "text",
      subtype: "url",
      label: i18n.get("add_domain"),
      text: i18n.get("x-domain"),
      store: false,
    },
    {
      tab: "Domain black/white list",
      group: i18n.get("Management"),
      name: "addDomainBtn",
      type: "button",
      text: i18n.get("add"),
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
