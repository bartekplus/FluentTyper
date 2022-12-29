import { i18n } from "./i18n.js";
import { SUPPORTED_LANGUAGES } from "../../lang.js";
import { DOMAIN_LIST_MODE } from "../../utils.js";

const donateHTML =
  '<div class="has-text-centered"><a href="https://www.buymeacoffee.com/FluentTyper" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"  alt="Buy Me A Coffee" style="height: 60px !important; width: 217px !important"/></a></div>';
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
        "Minimum word length to start prediction (If set to '0' then predict will start after whitespace",
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
      label: "Number of suggestions (Set to 0 to disable prediction):",
      default: 5,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "autocomplete",
      type: "checkbox",
      label:
        "Auto-completes word on 'space' (Returns to original text on 'backspace').",
      default: false,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "insertSpaceAfterAutocomplete",
      type: "checkbox",
      label: "Automatically insert space after autocomplete.",
      default: true,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "applySpacingRules",
      type: "checkbox",
      label:
        "Automatically apply spacing rules for punctuations and special characters.",
      default: true,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "autoCapitalize",
      type: "checkbox",
      label: "Capitalize the first word of each sentence.",
      default: true,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "selectByDigit",
      type: "checkbox",
      label: "Select suggestion using digit keys.",
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
          "Check out a phenomenal productivity app called FluentTyper. It autocompletes words for you while you typing, saving loads of time. I think you'll love it, and it's free!",
        ],
        ["callMe", "Call me back once you get free."],
        ["asap", "as soon as possible"],
        ["afaik", "as far as I know"],
        ["afaic", "as far as I'm concerned"],
        ["eur", "€"],
      ],
    },
    {
      tab: i18n.get("Test FlutenTyper"),
      name: "Test FlutenTyper",
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
