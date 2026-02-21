import { i18n } from "./i18n.js";
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_PREDICTION_LANGUAGE_KEYS,
} from "../../shared/lang.ts";
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
  KEY_ENABLED_LANGUAGES,
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
  KEY_INLINE_SUGGESTION,
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
      tab: i18n.get("core_settings"),
      group: i18n.get("General"),
      name: "enable",
      type: "checkbox",
      label: i18n.get("enable_fluent_typer"),
      default: true,
    },
    {
      tab: i18n.get("core_settings"),
      group: i18n.get("prediction_engine"),
      name: KEY_NUM_SUGGESTIONS,
      type: "slider",
      min: 0,
      max: 10,
      display: true,
      label: i18n.get("num_predictions_label") + ":&nbsp;<small>" + i18n.get("num_predictions_desc") + "</small>",
      default: DEFAULT_NUM_SUGGESTIONS,
    },
    {
      tab: i18n.get("core_settings"),
      group: i18n.get("prediction_engine"),
      name: KEY_MIN_WORD_LENGTH_TO_PREDICT,
      type: "slider",
      min: -1,
      max: 12,
      display: true,
      label: i18n.get("min_chars_label") + ":&nbsp;<small>" + i18n.get("min_chars_desc") + "</small>",
      default: 1,
    },

    // =========================================================================
    // TAB: Autocomplete
    // All settings related to how completions are accepted and behave.
    // =========================================================================
    {
      tab: i18n.get("autocomplete_tab"),
      group: i18n.get("accept_predictions"),
      name: KEY_AUTOCOMPLETE_ON_TAB,
      type: "checkbox",
      label: i18n.get("accept_tab_label") + ":&nbsp;<small>" + i18n.get("accept_tab_desc") + "</small>",
      default: true,
    },
    {
      tab: i18n.get("autocomplete_tab"),
      group: i18n.get("accept_predictions"),
      name: KEY_AUTOCOMPLETE_ON_ENTER,
      type: "checkbox",
      label: i18n.get("accept_enter_label") + ":&nbsp;<small>" + i18n.get("accept_enter_desc") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("autocomplete_tab"),
      group: i18n.get("accept_predictions"),
      name: KEY_AUTOCOMPLETE,
      type: "checkbox",
      label: i18n.get("accept_space_label") + ":&nbsp;<small>" + i18n.get("accept_space_desc") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("autocomplete_tab"),
      group: i18n.get("accept_predictions"),
      name: KEY_SELECT_BY_DIGIT,
      type: "checkbox",
      label: i18n.get("accept_digits_label") + ":&nbsp;<small>" + i18n.get("accept_digits_desc") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("autocomplete_tab"),
      group: i18n.get("behavior_after_completion"),
      name: KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
      type: "checkbox",
      label: i18n.get("add_space_label") + ":&nbsp;<small>" + i18n.get("add_space_desc") + "</small>",
      default: true,
    },
    {
      tab: i18n.get("autocomplete_tab"),
      group: i18n.get("behavior_after_completion"),
      name: KEY_REVERT_ON_BACKSPACE,
      type: "checkbox",
      label: i18n.get("smart_backspace_label") + ":&nbsp;<small>" + i18n.get("smart_backspace_desc") + "</small>",
      default: false,
    },

    // =========================================================================
    // TAB: Language
    // All language-specific settings in one place.
    // =========================================================================
    {
      tab: i18n.get("language_tab"),
      group: i18n.get("language_selection"),
      name: KEY_LANGUAGE,
      type: "popupButton",
      options: Object.entries(SUPPORTED_LANGUAGES),
      label: i18n.get("primary_lang_label"),
      default: "en_US",
    },
    {
      tab: i18n.get("language_tab"),
      group: i18n.get("language_selection"),
      name: KEY_ENABLED_LANGUAGES,
      type: "listBoxMultiselect",
      label: i18n.get("enabled_langs_label"),
      options: SUPPORTED_PREDICTION_LANGUAGE_KEYS.map((lang) => [
        lang,
        SUPPORTED_LANGUAGES[lang],
      ]),
      default: SUPPORTED_PREDICTION_LANGUAGE_KEYS,
    },
    {
      tab: i18n.get("language_tab"),
      group: i18n.get("language_selection"),
      name: KEY_FALLBACK_LANGUAGE,
      type: "popupButton",
      options: Object.entries(SUPPORTED_LANGUAGES),
      label: i18n.get("fallback_lang_label") + ":&nbsp;<small>" + i18n.get("fallback_lang_desc") + "</small>",
      default: "en_US",
    },
    {
      tab: i18n.get("language_tab"),
      group: i18n.get("language_display"),
      name: KEY_DISPLAY_LANG_HEADER,
      type: "checkbox",
      label: i18n.get("show_lang_header_label") + ":&nbsp;<small>" + i18n.get("show_lang_header_desc") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("language_tab"),
      group: i18n.get("formatting_rules"),
      name: KEY_AUTO_CAPITALIZE,
      type: "checkbox",
      label: i18n.get("auto_capitalize_label"),
      default: true,
    },

    // =========================================================================
    // TAB: Shortcuts & Expansions
    // A unified home for the powerful Text Expander and its related settings.
    // =========================================================================
    {
      tab: i18n.get("shortcuts_expansions_tab"),
      group: i18n.get("text_expander"),
      name: KEY_TEXT_EXPANSIONS,
      type: "valueOnly",
      label: i18n.get("text_expander_desc"),
      default: [
        ["FF", "Check out FluentTyper, a phenomenal productivity app that autocompletes words as you type, saving loads of time. It's free, and I think you'll love it!"],
        ["callMe", "Call me back once you get free."],
        ["asap", "as soon as possible"],
        ["afaik", "as far as I know"],
        ["eur", "€"],
      ],
    },
    {
      tab: i18n.get("shortcuts_expansions_tab"),
      group: i18n.get("dynamic_variables"),
      name: KEY_VARIABLE_EXPANSION,
      type: "checkbox",
      label: i18n.get("enable_dynamic_vars_label") + ":&nbsp;<small>" + i18n.get("enable_dynamic_vars_desc") + Object.keys(DATE_TIME_VARIABLES) + "</small>",
      default: false,
    },
    {
      tab: i18n.get("shortcuts_expansions_tab"),
      group: i18n.get("dynamic_variables"),
      name: KEY_DATE_FORMAT,
      type: "text",
      label: i18n.get("custom_date_format_label") + ":&nbsp;<small>" + i18n.get("custom_date_format_desc") + "</small>",
      default: "",
    },
    {
      tab: i18n.get("shortcuts_expansions_tab"),
      group: i18n.get("dynamic_variables"),
      name: KEY_TIME_FORMAT,
      type: "text",
      label: i18n.get("custom_time_format_label") + ":&nbsp;<small>" + i18n.get("custom_time_format_desc") + "</small>",
      default: "",
    },

    // =========================================================================
    // TAB: Site Management
    // For the domain blacklist/whitelist.
    // =========================================================================
    {
      tab: i18n.get("site_mgmt_tab"),
      group: i18n.get("domain_list_mode"),
      name: KEY_DOMAIN_LIST_MODE,
      type: "popupButton",
      options: Object.entries(DOMAIN_LIST_MODE),
      label: i18n.get("choose_list_mode_label") + ":&nbsp;<small>" + i18n.get("choose_list_mode_desc") + "</small>",
      default: "blackList",
    },
    {
      tab: i18n.get("site_mgmt_tab"),
      group: i18n.get("manage_domains"),
      name: "domainBlackList",
      type: "listBox",
      label: i18n.get("domain_list_label"),
      default: [],
    },
    {
      tab: i18n.get("site_mgmt_tab"),
      group: i18n.get("manage_domains"),
      name: "domain",
      type: "text",
      subtype: "url",
      label: i18n.get("add_domain_label"),
      text: i18n.get("x-domain"),
      store: false,
    },
    {
      tab: i18n.get("site_mgmt_tab"),
      group: i18n.get("manage_domains"),
      name: "addDomainBtn",
      type: "button",
      text: i18n.get("add"),
    },
    {
      tab: i18n.get("site_mgmt_tab"),
      group: i18n.get("manage_domains"),
      name: "removeDomainBtn",
      type: "button",
      text: i18n.get("remove_selected_btn"),
    },


    // =========================================================================
    // TAB: My Dictionary
    // A friendlier home for the User Dictionary.
    // =========================================================================
    {
      tab: i18n.get("my_dict_tab"),
      group: i18n.get("custom_words"),
      name: KEY_USER_DICTIONARY_LIST,
      type: "listBox",
      label: i18n.get("personal_dict_label"),
      default: [],
    },
    {
      tab: i18n.get("my_dict_tab"),
      group: i18n.get("add_remove_words"),
      name: "userDictionary",
      type: "text",
      subtype: "text",
      pattern: '^\\S+$',
      label: i18n.get("add_new_word_label"),
      text: i18n.get("my_custom_word_placeholder"),
      store: false,
    },
    {
      tab: i18n.get("my_dict_tab"),
      group: i18n.get("add_remove_words"),
      name: "addUserWordBtn",
      type: "button",
      text: i18n.get("add_word_btn"),
    },
    {
      tab: i18n.get("my_dict_tab"),
      group: i18n.get("add_remove_words"),
      name: "removeUserWordBtn",
      type: "button",
      text: i18n.get("remove_word_btn"),
    },
    {
      tab: i18n.get("my_dict_tab"),
      group: i18n.get("dict_mgmt"),
      name: "importUserDictButton",
      type: "button",
      text: i18n.get("import_dict_btn"),
      label: i18n.get("import_dict_desc"),
    },
    {
      tab: i18n.get("my_dict_tab"),
      group: i18n.get("dict_mgmt"),
      name: "removeAllUserWordsBtn",
      type: "button",
      text: i18n.get("clear_dict_btn"),
    },

    // =========================================================================
    // TAB: Theming
    // For customizing the appearance of the tribute suggestions popup.
    // =========================================================================
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("theme_presets"),
      name: KEY_USE_DEFAULT_THEME_BTN,
      type: "button",
      text: i18n.get("use_default_theme_btn"),
      label: i18n.get("use_default_theme_desc"),
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("theme_presets"),
      name: KEY_USE_COMPACT_THEME_BTN,
      type: "button",
      text: i18n.get("use_compact_theme_btn"),
      label: i18n.get("use_compact_theme_desc"),
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("light_theme_colors"),
      name: KEY_TRIBUTE_BG_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("bg_color_label") + ":&nbsp;<small>" + i18n.get("light_bg_color_desc") + "</small>",
      default: "#ffffff",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("light_theme_colors"),
      name: KEY_TRIBUTE_TEXT_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("text_color_label") + ":&nbsp;<small>" + i18n.get("light_text_color_desc") + "</small>",
      default: "#2d3748",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("light_theme_colors"),
      name: KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("highlight_bg_label") + ":&nbsp;<small>" + i18n.get("light_highlight_bg_desc") + "</small>",
      default: "#edf2f7",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("light_theme_colors"),
      name: KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("highlight_text_label") + ":&nbsp;<small>" + i18n.get("light_highlight_text_desc") + "</small>",
      default: "#2d3748",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("light_theme_colors"),
      name: KEY_TRIBUTE_BORDER_LIGHT,
      type: "text",
      required: true,
      label: i18n.get("border_color_label") + ":&nbsp;<small>" + i18n.get("light_border_color_desc") + "</small>",
      default: "#e2e8f0",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("dark_theme_colors"),
      name: KEY_TRIBUTE_BG_DARK,
      type: "text",
      required: true,
      label: i18n.get("bg_color_label") + ":&nbsp;<small>" + i18n.get("dark_bg_color_desc") + "</small>",
      default: "#2d3748",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("dark_theme_colors"),
      name: KEY_TRIBUTE_TEXT_DARK,
      type: "text",
      required: true,
      label: i18n.get("text_color_label") + ":&nbsp;<small>" + i18n.get("dark_text_color_desc") + "</small>",
      default: "#e2e8f0",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("dark_theme_colors"),
      name: KEY_TRIBUTE_HIGHLIGHT_BG_DARK,
      type: "text",
      required: true,
      label: i18n.get("highlight_bg_label") + ":&nbsp;<small>" + i18n.get("dark_highlight_bg_desc") + "</small>",
      default: "#4a5568",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("dark_theme_colors"),
      name: KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK,
      type: "text",
      required: true,
      label: i18n.get("highlight_text_label") + ":&nbsp;<small>" + i18n.get("dark_highlight_text_desc") + "</small>",
      default: "#ffffff",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("dark_theme_colors"),
      name: KEY_TRIBUTE_BORDER_DARK,
      type: "text",
      required: true,
      label: i18n.get("border_color_label") + ":&nbsp;<small>" + i18n.get("dark_border_color_desc") + "</small>",
      default: "#4a5568",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("typography_spacing"),
      name: KEY_TRIBUTE_FONT_SIZE,
      type: "text",
      required: true,
      label: i18n.get("font_size_label") + ":&nbsp;<small>" + i18n.get("font_size_desc") + "</small>",
      default: "0.9rem",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("typography_spacing"),
      name: KEY_TRIBUTE_PADDING_VERTICAL,
      type: "text",
      required: true,
      label: i18n.get("vertical_padding_label") + ":&nbsp;<small>" + i18n.get("vertical_padding_desc") + "</small>",
      default: "0.6rem",
    },
    {
      tab: i18n.get("theming_tab"),
      group: i18n.get("typography_spacing"),
      name: KEY_TRIBUTE_PADDING_HORIZONTAL,
      type: "text",
      required: true,
      label: i18n.get("horizontal_padding_label") + ":&nbsp;<small>" + i18n.get("horizontal_padding_desc") + "</small>",
      default: "0.8rem",
    },

    // =========================================================================
    // TAB: Advanced
    // For power-user features and data management.
    // =========================================================================
    {
      tab: i18n.get("advanced_tab"),
      group: i18n.get("experimental_features"),
      name: KEY_APPLY_SPACING_RULES,
      type: "checkbox",
      label: i18n.get("apply_spacing_rules_label") + ":&nbsp;<small>" + i18n.get("apply_spacing_rules_desc") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("advanced_tab"),
      group: i18n.get("experimental_features"),
      name: KEY_INLINE_SUGGESTION,
      type: "checkbox",
      label: i18n.get("enable_inline_suggestion_label") + ":&nbsp;<small>" + i18n.get("enable_inline_suggestion_desc") + "</small>",
      default: false,
    },
    {
      tab: i18n.get("advanced_tab"),
      group: i18n.get("config_data"),
      name: "importSettingButton",
      type: "button",
      text: i18n.get("import_settings_btn"),
      label: i18n.get("import_settings_desc"),
    },
    {
      tab: i18n.get("advanced_tab"),
      group: i18n.get("config_data"),
      name: "exportSettingButton",
      type: "button",
      text: i18n.get("export_settings_btn"),
      label: i18n.get("export_settings_desc"),
    },

    // =========================================================================
    // TAB: Test Pad
    // Renamed for clarity.
    // =========================================================================
    {
      tab: i18n.get("test_pad_tab"),
      name: "Test FluentTyper",
      type: "description",
      text: testFluentTyperHTML,
    },

    // =========================================================================
    // TAB: About & Support
    // Merging "About" and "Donate" into one clear section.
    // =========================================================================
    {
      tab: i18n.get("about_support_tab"),
      group: i18n.get("about_fluent_typer_group"),
      name: "FluentTyperInfo",
      type: "description",
      text: i18n.get("x-FluentTyper"), // Assuming this contains app description
    },
    {
      tab: i18n.get("about_support_tab"),
      group: i18n.get("about_fluent_typer_group"),
      name: "Version",
      type: "description",
      text: `Version: ${chrome.runtime.getManifest().version}`,
    },
    {
      tab: i18n.get("about_support_tab"),
      group: i18n.get("support_development_group"),
      name: "Donate",
      type: "description",
      text: donateHTML,
    },
  ],
};

export { manifest };
