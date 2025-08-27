import { i18n } from "./i18n.js";
import { SUPPORTED_LANGUAGES } from "../../shared/lang.ts";
import { DOMAIN_LIST_MODE } from "../../shared/utils.ts";
import { DATE_TIME_VARIABLES } from "../../shared/variables.ts";
import {
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_APPLY_SPACING_RULES,
  KEY_AUTO_CAPITALIZE,
  KEY_SELECT_BY_DIGIT,
  KEY_REVERT_ON_BACKSPACE,
  KEY_LANGUAGE,
  KEY_FALLBACK_LANGUAGE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_VARIABLE_EXPANSION,
  KEY_TIME_FORMAT,
  KEY_DATE_FORMAT,
  KEY_TEXT_EXPANSIONS,
  KEY_USER_DICTIONARY_LIST,
  KEY_DOMAIN_LIST_MODE,
  KEY_DISPLAY_LANG_HEADER,
  KEY_USE_DEFAULT_THEME_BTN,
  KEY_USE_COMPACT_THEME_BTN,
  KEY_TRIBUTE_BG_LIGHT,
  KEY_TRIBUTE_TEXT_LIGHT,
  KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT,
  KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT,
  KEY_TRIBUTE_BORDER_LIGHT,
  KEY_TRIBUTE_BG_DARK,
  KEY_TRIBUTE_TEXT_DARK,
  KEY_TRIBUTE_HIGHLIGHT_BG_DARK,
  KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK,
  KEY_TRIBUTE_BORDER_DARK,
  KEY_TRIBUTE_FONT_SIZE,
  KEY_TRIBUTE_PADDING_VERTICAL,
  KEY_TRIBUTE_PADDING_HORIZONTAL,
  DEFAULT_NUM_SUGGESTIONS,
} from "../../shared/constants.ts";

// --- UI Content ---
const donateHTML =
  '<div class="has-text-centered"> \
  <p style="margin-bottom: 1rem;">Developing and maintaining FluentTyper is a passion project. If you find it useful, please consider supporting its future development. Your contribution helps us add new features and keep the extension running smoothly.</p> \
  <a href="https://www.buymeacoffee.com/FluentTyper" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"  alt="Buy Me A Coffee" style="height: 60px !important; width: 217px !important"/></a></div>';
const testFluentTyperHTML =
  '<textarea class="textarea is-full"  rows="12" placeholder="Click here and start typing to see FluentTyper in action..."></textarea>';

// --- Manifest Definition ---
const manifest = {
  name: "FluentTyper Settings",
  icon: "/icon/icon128.png",
  settings: [
    // =========================================================================
    // TAB: Core Settings
    // The most essential features for controlling the extension's behavior.
    // =========================================================================
    {
      tab: i18n.get("Core Settings"),
      group: i18n.get("General"),
      name: "enable",
      type: "checkbox",
      label: i18n.get("Enable FluentTyper Extension"),
      default: true,
    },
    {
      tab: i18n.get("Core Settings"),
      group: i18n.get("Prediction Engine"),
      name: KEY_NUM_SUGGESTIONS,
      type: "slider",
      min: 0,
      max: 10,
      display: true,
      label: i18n.get("Number of predictions to show:") + ":&nbsp;<small>" + i18n.get("Controls how many suggestions appear. Set to 0 to disable the prediction list entirely.") + "</small>",
      default: DEFAULT_NUM_SUGGESTIONS,
    },
    {
      tab: i18n.get("Core Settings"),
      group: i18n.get("Prediction Engine"),
      name: KEY_MIN_WORD_LENGTH_TO_PREDICT,
      type: "slider",
      min: -1,
      max: 12,
      display: true,
      label: i18n.get("Show predictions after typing X characters:") + ":&nbsp;<small>" + i18n.get("The number of characters needed to trigger predictions. <br>• Set to '0' for predictions after a space. <br>• Set to '-1' to only trigger predictions manually (Default shortcut: Ctrl+Period).") + "</small>",
      default: 1,
    },

    // =========================================================================
    // TAB: Autocomplete
    // All settings related to how completions are accepted and behave.
    // =========================================================================
    {
      tab: i18n.get("Autocomplete"),
      group: i18n.get("Accepting Predictions"),
      name: KEY_AUTOCOMPLETE_ON_TAB,
      type: "checkbox",
      label: i18n.get("Accept with 'Tab' key") + ":&nbsp;<small>" + i18n.get("Use the Tab key to confirm a prediction.") + "</small>",
      default: true,
    },
    {
      tab: i18n.get("Autocomplete"),
      group: i18n.get("Accepting Predictions"),
      name: KEY_AUTOCOMPLETE_ON_ENTER,
      type: "checkbox",
      label: i18n.get("Accept with 'Enter' key") + ":&nbsp;<small>" + i18n.get("Use the Enter key to confirm a prediction.") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("Autocomplete"),
      group: i18n.get("Accepting Predictions"),
      name: KEY_AUTOCOMPLETE,
      type: "checkbox",
      label: i18n.get("Accept with 'Spacebar' key") + ":&nbsp;<small>" + i18n.get("Use the Spacebar to confirm a prediction.") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("Autocomplete"),
      group: i18n.get("Accepting Predictions"),
      name: KEY_SELECT_BY_DIGIT,
      type: "checkbox",
      label: i18n.get("Accept with number keys (1-9)") + ":&nbsp;<small>" + i18n.get("Use number keys to select a prediction from the list directly.") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("Autocomplete"),
      group: i18n.get("Behavior After Completion"),
      name: KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
      type: "checkbox",
      label: i18n.get("Add a space after completion") + ":&nbsp;<small>" + i18n.get("Automatically inserts a space after a word is autocompleted.") + "</small>",
      default: true,
    },
    {
      tab: i18n.get("Autocomplete"),
      group: i18n.get("Behavior After Completion"),
      name: KEY_REVERT_ON_BACKSPACE,
      type: "checkbox",
      label: i18n.get("Enable Smart Backspace") + ":&nbsp;<small>" + i18n.get("When enabled, Backspace will undo the last auto-completion. When disabled, it deletes one character at a time.") + "</small>",
      default: false,
    },

    // =========================================================================
    // TAB: Language
    // All language-specific settings in one place.
    // =========================================================================
    {
      tab: i18n.get("Language"),
      group: i18n.get("Language Selection"),
      name: KEY_LANGUAGE,
      type: "popupButton",
      options: Object.entries(SUPPORTED_LANGUAGES),
      label: i18n.get("Primary prediction language:"),
      default: "en_US",
    },
    {
      tab: i18n.get("Language"),
      group: i18n.get("Language Selection"),
      name: "enabled_languages",
      type: "listBoxMultiselect",
      label: i18n.get("Enabled Languages"),
      options: Object.entries(SUPPORTED_LANGUAGES),
      default: Object.keys(SUPPORTED_LANGUAGES),
    },
    {
      tab: i18n.get("Language"),
      group: i18n.get("Language Selection"),
      name: KEY_FALLBACK_LANGUAGE,
      type: "popupButton",
      options: Object.entries(SUPPORTED_LANGUAGES),
      label: i18n.get("Secondary (fallback) language:") + ":&nbsp;<small>" + i18n.get("If no predictions are found in the primary language, FluentTyper will search in this language instead.") + "</small>",
      default: "en_US",
    },
    {
      tab: i18n.get("Language"),
      group: i18n.get("Language Display"),
      name: KEY_DISPLAY_LANG_HEADER,
      type: "checkbox",
      label: i18n.get("Show language of prediction") + ":&nbsp;<small>" + i18n.get("Displays a small language indicator (e.g., EN, DE) next to predictions. Useful when using a secondary language.") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("Language"),
      group: i18n.get("Formatting Rules"),
      name: KEY_AUTO_CAPITALIZE,
      type: "checkbox",
      label: i18n.get("Automatically capitalize the first word of a sentence"),
      default: true,
    },

    // =========================================================================
    // TAB: Shortcuts & Expansions
    // A unified home for the powerful Text Expander and its related settings.
    // =========================================================================
    {
      tab: i18n.get("Shortcuts & Expansions"),
      group: i18n.get("Text Expander"),
      name: KEY_TEXT_EXPANSIONS,
      type: "valueOnly",
      label: i18n.get("Create short abbreviations that expand into longer phrases. For example, create a shortcut 'brb' that expands to 'be right back'. The first column is the shortcut, the second is the expanded text."),
      default: [
        ["FF", "Check out FluentTyper, a phenomenal productivity app that autocompletes words as you type, saving loads of time. It's free, and I think you'll love it!"],
        ["callMe", "Call me back once you get free."],
        ["asap", "as soon as possible"],
        ["afaik", "as far as I know"],
        ["eur", "€"],
      ],
    },
    {
      tab: i18n.get("Shortcuts & Expansions"),
      group: i18n.get("Dynamic Variables"),
      name: KEY_VARIABLE_EXPANSION,
      type: "checkbox",
      label: i18n.get("Enable dynamic variables in Text Expander") + ":&nbsp;<small>" + i18n.get("Allows you to use variables like ${date} or ${time} in your expansions. Supported variables: ") + Object.keys(DATE_TIME_VARIABLES) + "</small>",
      default: false,
    },
    {
      tab: i18n.get("Shortcuts & Expansions"),
      group: i18n.get("Dynamic Variables"),
      name: KEY_DATE_FORMAT,
      type: "text",
      label: i18n.get("Custom date format token:") + ":&nbsp;<small>" + i18n.get("e.g. 'fff' -> 'August 6, 2014, 1:07 PM EDT'. See all supported tokens <a href='https://moment.github.io/luxon/#/formatting?id=table-of-tokens' target='_blank'>here</a>.") + "</small>",
      default: "",
    },
    {
      tab: i18n.get("Shortcuts & Expansions"),
      group: i18n.get("Dynamic Variables"),
      name: KEY_TIME_FORMAT,
      type: "text",
      label: i18n.get("Custom time format token:") + ":&nbsp;<small>" + i18n.get("e.g. 'ttt' -> '1:07:04 PM EDT'. See all supported tokens <a href='https://moment.github.io/luxon/#/formatting?id=table-of-tokens' target='_blank'>here</a>.") + "</small>",
      default: "",
    },

    // =========================================================================
    // TAB: Site Management
    // For the domain blacklist/whitelist.
    // =========================================================================
    {
      tab: i18n.get("Site Management"),
      group: i18n.get("Domain List Mode"),
      name: KEY_DOMAIN_LIST_MODE,
      type: "popupButton",
      options: Object.entries(DOMAIN_LIST_MODE),
      label: i18n.get("Choose list mode:") + ":&nbsp;<small>" + i18n.get("Blacklist: FluentTyper works everywhere EXCEPT the sites listed below. Whitelist: FluentTyper ONLY works on the sites listed below.") + "</small>",
      default: "blackList",
    },
    {
      tab: i18n.get("Site Management"),
      group: i18n.get("Manage Domains"),
      name: "domainBlackList",
      type: "listBox",
      label: i18n.get("Domain List:"),
      default: [],
    },
    {
      tab: i18n.get("Site Management"),
      group: i18n.get("Manage Domains"),
      name: "domain",
      type: "text",
      subtype: "url",
      label: i18n.get("Add a domain (e.g., google.com)"),
      text: i18n.get("x-domain"),
      store: false,
    },
    {
      tab: i18n.get("Site Management"),
      group: i18n.get("Manage Domains"),
      name: "addDomainBtn",
      type: "button",
      text: i18n.get("Add"),
    },
    {
      tab: i18n.get("Site Management"),
      group: i18n.get("Manage Domains"),
      name: "removeDomainBtn",
      type: "button",
      text: i18n.get("Remove Selected"),
    },
    

    // =========================================================================
    // TAB: My Dictionary
    // A friendlier home for the User Dictionary.
    // =========================================================================
    {
      tab: i18n.get("My Dictionary"),
      group: i18n.get("Custom Words"),
      name: KEY_USER_DICTIONARY_LIST,
      type: "listBox",
      label: i18n.get("Your personal dictionary words:"),
      default: [],
    },
    {
      tab: i18n.get("My Dictionary"),
      group: i18n.get("Add & Remove Words"),
      name: "userDictionary",
      type: "text",
      subtype: "text",
      pattern: '^\\S+$',
      label: i18n.get("Add new word:"),
      text: i18n.get("MyCustomWord"),
      store: false,
    },
    {
      tab: i18n.get("My Dictionary"),
      group: i18n.get("Add & Remove Words"),
      name: "addUserWordBtn",
      type: "button",
      text: i18n.get("Add Word"),
    },
    {
      tab: i18n.get("My Dictionary"),
      group: i18n.get("Add & Remove Words"),
      name: "removeUserWordBtn",
      type: "button",
      text: i18n.get("Remove Selected Word"),
    },
    {
      tab: i18n.get("My Dictionary"),
      group: i18n.get("Dictionary Management"),
      name: "importUserDictButton",
      type: "button",
      text: i18n.get("Import from file..."),
      label: i18n.get("Import a list of words from a .txt file (one word per line)."),
    },
    {
      tab: i18n.get("My Dictionary"),
      group: i18n.get("Dictionary Management"),
      name: "removeAllUserWordsBtn",
      type: "button",
      text: i18n.get("Clear Entire Dictionary"),
    },

    // =========================================================================
    // TAB: Theming
    // For customizing the appearance of the tribute suggestions popup.
    // =========================================================================
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Theme Presets"),
      name: KEY_USE_DEFAULT_THEME_BTN,
      type: "button",
      text: i18n.get("Use default theme"),
      label: i18n.get("Apply the default FluentTyper theme values."),
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Theme Presets"),
      name: KEY_USE_COMPACT_THEME_BTN,
      type: "button",
      text: i18n.get("Use compact & airy theme"),
      label: i18n.get("Apply the compact & airy theme values."),
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Light Theme Colors"),
      name: KEY_TRIBUTE_BG_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("Background Color") + ":&nbsp;<small>" + i18n.get("Background color of the suggestion popup in light mode (e.g., #ffffff)") + "</small>",
      default: "#ffffff",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Light Theme Colors"),
      name: KEY_TRIBUTE_TEXT_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("Text Color") + ":&nbsp;<small>" + i18n.get("Main text color in light mode (e.g., #2d3748)") + "</small>",
      default: "#2d3748",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Light Theme Colors"),
      name: KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("Highlight Background") + ":&nbsp;<small>" + i18n.get("Background color for highlighted suggestions in light mode (e.g., #edf2f7)") + "</small>",
      default: "#edf2f7",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Light Theme Colors"),
      name: KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("Highlight Text Color") + ":&nbsp;<small>" + i18n.get("Text color for highlighted suggestions in light mode (e.g., #2d3748)") + "</small>",
      default: "#2d3748",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Light Theme Colors"),
      name: KEY_TRIBUTE_BORDER_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("Border Color") + ":&nbsp;<small>" + i18n.get("Border color of the popup in light mode (e.g., #e2e8f0)") + "</small>",
      default: "#e2e8f0",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Dark Theme Colors"),
      name: KEY_TRIBUTE_BG_DARK,
      type: "text",
      required: true,
      label: i18n.get("Background Color") + ":&nbsp;<small>" + i18n.get("Background color of the suggestion popup in dark mode (e.g., #2d3748)") + "</small>",
      default: "#2d3748",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Dark Theme Colors"),
      name: KEY_TRIBUTE_TEXT_DARK,
      type: "text",
      required: true,
      label: i18n.get("Text Color") + ":&nbsp;<small>" + i18n.get("Main text color in dark mode (e.g., #e2e8f0)") + "</small>",
      default: "#e2e8f0",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Dark Theme Colors"),
      name: KEY_TRIBUTE_HIGHLIGHT_BG_DARK,
      type: "text",
      required: true,
      label: i18n.get("Highlight Background") + ":&nbsp;<small>" + i18n.get("Background color for highlighted suggestions in dark mode (e.g., #4a5568)") + "</small>",
      default: "#4a5568",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Dark Theme Colors"),
      name: KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK,
      type: "text",
      required: true,
      label: i18n.get("Highlight Text Color") + ":&nbsp;<small>" + i18n.get("Text color for highlighted suggestions in dark mode (e.g., #e2e8f0)") + "</small>",
      default: "#ffffff",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Dark Theme Colors"),
      name: KEY_TRIBUTE_BORDER_DARK,
      type: "text",
      required: true,
      label: i18n.get("Border Color") + ":&nbsp;<small>" + i18n.get("Border color of the popup in dark mode (e.g., #4a5568)") + "</small>",
      default: "#4a5568",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Typography & Spacing"),
      name: KEY_TRIBUTE_FONT_SIZE,
      type: "text",
      required: true,
      label: i18n.get("Font Size") + ":&nbsp;<small>" + i18n.get("Font size for suggestion text (e.g., 0.9rem, 14px)") + "</small>",
      default: "0.9rem",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Typography & Spacing"),
      name: KEY_TRIBUTE_PADDING_VERTICAL,
      type: "text",
      required: true,
      label: i18n.get("Vertical Padding") + ":&nbsp;<small>" + i18n.get("Top and bottom padding for suggestions (e.g., 0.6rem, 8px)") + "</small>",
      default: "0.6rem",
    },
    {
      tab: i18n.get("Theming"),
      group: i18n.get("Typography & Spacing"),
      name: KEY_TRIBUTE_PADDING_HORIZONTAL,
      type: "text",
      required: true,
      label: i18n.get("Horizontal Padding") + ":&nbsp;<small>" + i18n.get("Left and right padding for suggestions (e.g., 0.8rem, 12px)") + "</small>",
      default: "0.8rem",
    },

    // =========================================================================
    // TAB: Advanced
    // For power-user features and data management.
    // =========================================================================
    {
      tab: i18n.get("Advanced"),
      group: i18n.get("Experimental Features"),
      name: KEY_APPLY_SPACING_RULES,
      type: "checkbox",
      label: i18n.get("Apply automatic spacing rules for punctuation") + ":&nbsp;<small>" + i18n.get("Note: This is a beta feature and may not work as expected. Please use at your own risk.") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("Advanced"),
      group: i18n.get("Configuration Data"),
      name: "importSettingButton",
      type: "button",
      text: i18n.get("Import Settings"),
      label: i18n.get("Import your settings from a JSON file."),
    },
    {
      tab: i18n.get("Advanced"),
      group: i18n.get("Configuration Data"),
      name: "exportSettingButton",
      type: "button",
      text: i18n.get("Export Settings"),
      label: i18n.get("Export your current settings to a JSON file for backup."),
    },

    // =========================================================================
    // TAB: Test Pad
    // Renamed for clarity.
    // =========================================================================
    {
      tab: i18n.get("Test Pad"),
      name: "Test FluentTyper",
      type: "description",
      text: testFluentTyperHTML,
    },

    // =========================================================================
    // TAB: About & Support
    // Merging "About" and "Donate" into one clear section.
    // =========================================================================
    {
      tab: i18n.get("About & Support"),
      group: i18n.get("About FluentTyper"),
      name: "FluentTyperInfo",
      type: "description",
      text: i18n.get("x-FluentTyper"), // Assuming this contains app description
    },
    {
      tab: i18n.get("About & Support"),
      group: i18n.get("About FluentTyper"),
      name: "Version",
      type: "description",
      text: `Version: ${chrome.runtime.getManifest().version}`,
    },
    {
      tab: i18n.get("About & Support"),
      group: i18n.get("Support Development"),
      name: "Donate",
      type: "description",
      text: donateHTML,
    },
  ],
};

export { manifest };
