import { i18n } from "./i18n.js";

const donateHTML =
  '<p class="content">' +
  "Creating and maintaining FluentTyper has required - and still " +
  "does - a considerable amount of work and effort. If you like " +
  "FluentTyper, then you may wish to support FluentTyper " +
  "development by making a voluntary donation. This will also " +
  "enable future enhancement to the extension. " +
  "</p>" +
  '<div class="columns is-centered">' +
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
  "</form>" +
  "</div>";
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
      options: [["en", "English"]],
      label: "Prediction language:",
      default: "en",
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "minWordLenghtToPredict",
      type: "slider",
      min: 1,
      max: 12,
      display: true,
      label: "Minimum word lenght to start prediction:",
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
      name: "predictNextWordAfterSeparatorChar",
      type: "checkbox",
      label:
        "Predict next word after sperator char (whitespace, !, \", #, $, %, &, ', (, ), *, +, -, ., /, :, ;, <, =, >, ?, @, [, \\, ], ^, _, `, {, |, }, ~).",
      default: true,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "insertSpaceAfterAutocomplete",
      type: "checkbox",
      label: "Automatically insert space after autocomplete.",
      default: false,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "removeSpace",
      type: "checkbox",
      label: "Automatically remove space before: <b>.!?</b> characters.",
      default: false,
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
      group: i18n.get("Miscellaneous"),
      name: "useEnter",
      type: "checkbox",
      label: i18n.get("useEnter"),
      default: true,
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("Miscellaneous"),
      name: "allUrls",
      type: "checkbox",
      label: i18n.get("allUrls"),
      default: false,
    },
    {
      tab: "Domain list",
      group: i18n.get("Management"),
      name: "domainList",
      type: "listBox",
      options: (function () {})(),
      default: [],
    },
    {
      tab: "Domain list",
      group: i18n.get("Management"),
      name: "removeDomainBtn",
      type: "button",
      text: i18n.get("remove"),
    },
    {
      tab: i18n.get("Test area"),
      name: "Test area",
      group: i18n.get("Test area"),
      type: "description",
      text: testFluentTyperHTML,
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