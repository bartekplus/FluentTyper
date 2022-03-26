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
      options: [
        ["auto_detect", "Auto detect"],
        ["en", "English"],
      ],
      label: "Prediction language:",
      default: "en",
    },
    {
      tab: i18n.get("settings"),
      group: i18n.get("General"),
      name: "fallbackLanguage",
      type: "popupButton",
      options: [
        ["en", "English"],
        ["none", "None"],
      ],
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
        "Minimum word length to start prediction (If set to '0' then predict will start after any separator char (whitespace, !, \", #, $, %, &, ', (, ), *, +, -, ., /, :, ;, <, =, >, ?, @, [, \\, ], ^, _, `, {, |, }, ~) ):",
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
      default: true,
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
      name: "removeSpace",
      type: "checkbox",
      label: "Automatically remove space before punctuation characters.",
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
      name: "dontPredictChars",
      type: "text",
      label:
        "List of space-separated chars that will not trigger prediction if a word starts with it.",
      default: "",
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
      tab: "Domain blocklist",
      group: i18n.get("Management"),
      name: "domainBlackList",
      type: "listBox",
      options: (function () {})(),
      default: [],
    },
    {
      tab: "Domain blocklist",
      group: i18n.get("Management"),
      name: "removeDomainBtn",
      type: "button",
      text: i18n.get("remove"),
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
