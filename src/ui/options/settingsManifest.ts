import { emptyTerminology } from "@core/domain/grammar/review/preferredTerminology";
import { DEFAULT_LONG_SENTENCE_WORDS } from "@core/domain/grammar/review/reviewCatalog";
import { i18n } from "./fluenttyperI18n.js";
import type {
  FieldConfig,
  ManifestDefinition,
  OptionTuple,
  TabConfig,
} from "@ui/settings-engine/types.js";
import { SUPPORTED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS } from "@core/domain/lang";
import {
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_SELECT_BY_DIGIT,
  KEY_HORIZONTAL_SUGGESTIONS,
  KEY_LANGUAGE,
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
  KEY_OBSERVABILITY_ENABLED,
  KEY_OBSERVABILITY_MODULE_OVERRIDES,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_REVIEW_RULE_OVERRIDES,
  KEY_PREFERRED_TERMINOLOGY,
  KEY_REVIEW_LONG_SENTENCE_WORDS,
  KEY_TIME_FORMAT,
  KEY_DATE_FORMAT,
  KEY_TEXT_EXPANSIONS,
  KEY_USER_DICTIONARY_LIST,
  KEY_DOMAIN_LIST_MODE,
  KEY_SHOW_SUGGESTION_FOOTER,
  KEY_SHOW_REVIEW_BUTTON,
  KEY_LIVE_GRAMMAR_PROPOSALS,
  KEY_LOCAL_AI_REVIEW_ENABLED,
  KEY_LOCAL_AI_REVIEW_TIER,
  DEFAULT_LOCAL_AI_REVIEW_ENABLED,
  KEY_EXTENSION_LANGUAGE,
  KEY_SITE_PROFILES,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
  KEY_CODE_MODE,
  KEY_SUGGESTION_BG_LIGHT,
  KEY_SUGGESTION_TEXT_LIGHT,
  KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
  KEY_SUGGESTION_BORDER_LIGHT,
  KEY_SUGGESTION_BG_DARK,
  KEY_SUGGESTION_TEXT_DARK,
  KEY_SUGGESTION_HIGHLIGHT_BG_DARK,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK,
  KEY_SUGGESTION_BORDER_DARK,
  KEY_SUGGESTION_FONT_SIZE,
  KEY_SUGGESTION_PADDING_VERTICAL,
  KEY_SUGGESTION_PADDING_HORIZONTAL,
  KEY_INLINE_SUGGESTION,
  KEY_PREFIX_ONLY_MODE,
  KEY_PERSONALIZATION_ENABLED,
  DEFAULT_NUM_SUGGESTIONS,
} from "@core/domain/constants";
import {
  DEFAULT_SUGGESTION_THEME_SETTINGS,
  type SuggestionThemeSettings,
} from "@core/domain/themeDefaults";
import { DEFAULT_LOCAL_AI_TIER } from "@core/domain/localAi/modelRegistry";
const IS_DEV_BUILD = typeof __FT_DEV_BUILD__ !== "undefined" && Boolean(__FT_DEV_BUILD__);

const LOG_LEVEL_OPTIONS: OptionTuple[] = [
  ["debug", "Debug"],
  ["info", "Info"],
  ["warn", "Warn"],
  ["error", "Error"],
];

function buildFieldLabel(label: string, description: string): string {
  const normalizedLabel = label.replace(/[:\s]+$/, "");
  return `<span class="field-title">${normalizedLabel}</span><small class="field-help">${description}</small>`;
}

function createTab(
  id: string,
  labelKey: string,
  shortDescriptionKey: string,
  keywordKeys: string[],
): TabConfig {
  return {
    id,
    label: i18n.get(labelKey),
    title: i18n.get(labelKey),
    shortDescription: i18n.get(shortDescriptionKey),
    keywords: keywordKeys.map((key) => i18n.get(key)),
  };
}

const DEV_TABS: ManifestDefinition["tabs"] = [
  createTab("observability_tab", "observability_tab", "observability_tab_desc", [
    "observability_tab",
    "observability_dashboard_group",
  ]),
];

const DEV_OBSERVABILITY_SETTINGS: FieldConfig[] = [
  {
    tab: "observability_tab",
    group: i18n.get("observability_tab"),
    name: "observabilityWorkspacePanel",
    type: "customPanel",
    label: i18n.get("observability_tab"),
    description: i18n.get("observability_tab_desc"),
    keywords: [i18n.get("observability_dashboard_group"), i18n.get("observability_controls_group")],
  },
  {
    tab: "observability_tab",
    group: i18n.get("observability_controls_group"),
    name: "observabilityHint",
    type: "description",
    text: `<p>${i18n.get("observability_desc")}</p>`,
  },
  {
    tab: "observability_tab",
    group: i18n.get("observability_controls_group"),
    name: KEY_OBSERVABILITY_ENABLED,
    type: "checkbox",
    label: buildFieldLabel(
      i18n.get("observability_enabled_label"),
      i18n.get("observability_enabled_desc"),
    ),
    default: true,
  },
  {
    tab: "observability_tab",
    group: i18n.get("observability_controls_group"),
    name: KEY_OBSERVABILITY_DEFAULT_LEVEL,
    type: "popupButton",
    options: LOG_LEVEL_OPTIONS,
    label: buildFieldLabel(
      i18n.get("observability_default_level_label"),
      i18n.get("observability_default_level_desc"),
    ),
    default: "debug",
  },
  {
    tab: "observability_tab",
    group: i18n.get("observability_controls_group"),
    name: KEY_OBSERVABILITY_MODULE_OVERRIDES,
    type: "valueOnly",
    default: {},
  },
  {
    tab: "observability_tab",
    group: i18n.get("observability_predictor_group"),
    name: KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
    type: "checkbox",
    label: buildFieldLabel(
      i18n.get("predictor_debug_presage_label"),
      i18n.get("predictor_debug_presage_desc"),
    ),
    default: true,
  },
  {
    tab: "observability_tab",
    group: i18n.get("observability_dashboard_group"),
    name: "observabilityPanel",
    type: "description",
    text: `<div id='observabilityRoot'>${i18n.get("observability_loading")}</div>`,
  },
];

function themeValueSetting(groupKey: string, name: keyof SuggestionThemeSettings): FieldConfig {
  return {
    tab: "theming_tab",
    group: i18n.get(groupKey),
    name,
    type: "valueOnly",
    default: DEFAULT_SUGGESTION_THEME_SETTINGS[name],
  };
}

const manifest: ManifestDefinition = {
  name: i18n.get("options_page_title"),
  icon: "/icon/icon128.png",
  tabs: [
    createTab("core_settings", "options_tab_essentials", "options_tab_essentials_desc", [
      "options_tab_essentials",
      "prediction_engine",
    ]),
    createTab("theming_tab", "theming_tab", "options_tab_appearance_desc", [
      "theming_tab",
      "theme_presets",
    ]),
    createTab("grammar_tab", "grammar_tab", "options_tab_grammar_desc", [
      "grammar_rules",
      "grammar_tab",
    ]),
    createTab("language_tab", "options_tab_languages", "options_tab_languages_desc", [
      "options_tab_languages",
      "language_selection",
    ]),
    createTab("shortcuts_expansions_tab", "options_tab_snippets", "options_tab_snippets_desc", [
      "options_tab_snippets",
      "text_expander",
    ]),
    createTab("site_mgmt_tab", "options_tab_sites", "options_tab_sites_desc", [
      "options_tab_sites",
      "site_profiles",
    ]),
    createTab("advanced_tab", "options_tab_data", "options_tab_data_desc", [
      "options_tab_data",
      "config_data",
      "options_tab_about",
      "support_development_group",
    ]),
    ...(IS_DEV_BUILD ? DEV_TABS : []),
  ],
  settings: [
    // =========================================================================
    // TAB: Typing & Autocomplete (Merged Core & Autocomplete)
    // =========================================================================
    {
      tab: "core_settings",
      group: i18n.get("options_tab_essentials"),
      name: "essentialsWorkspacePanel",
      type: "customPanel",
      label: i18n.get("options_tab_essentials"),
      description: i18n.get("options_tab_essentials_desc"),
      keywords: [i18n.get("prediction_engine"), i18n.get("accept_predictions")],
    },
    {
      tab: "core_settings",
      group: i18n.get("General"),
      name: "enable",
      type: "checkbox",
      label: i18n.get("enable_fluent_typer"),
      default: true,
    },
    {
      tab: "core_settings",
      group: i18n.get("General"),
      name: KEY_PREFER_NATIVE_AUTOCOMPLETE,
      type: "checkbox",
      label: buildFieldLabel(
        i18n.get("prefer_native_autocomplete_label"),
        i18n.get("prefer_native_autocomplete_desc"),
      ),
      default: true,
    },
    {
      tab: "core_settings",
      group: i18n.get("General"),
      name: KEY_CODE_MODE,
      type: "checkbox",
      label: buildFieldLabel(i18n.get("code_mode_label"), i18n.get("code_mode_desc")),
      default: false,
    },
    {
      tab: "core_settings",
      group: i18n.get("General"),
      name: KEY_INLINE_SUGGESTION,
      type: "checkbox",
      label: buildFieldLabel(
        i18n.get("enable_inline_suggestion_label"),
        i18n.get("enable_inline_suggestion_desc"),
      ),
      default: false,
    },
    {
      tab: "core_settings",
      group: i18n.get("General"),
      name: KEY_HORIZONTAL_SUGGESTIONS,
      type: "checkbox",
      label: buildFieldLabel(
        i18n.get("horizontal_suggestions_label"),
        i18n.get("horizontal_suggestions_desc"),
      ),
      default: false,
    },
    {
      tab: "core_settings",
      group: i18n.get("General"),
      name: KEY_SHOW_SUGGESTION_FOOTER,
      type: "checkbox",
      label: buildFieldLabel(
        i18n.get("show_suggestion_footer_label"),
        i18n.get("show_suggestion_footer_desc"),
      ),
      default: false,
    },
    {
      tab: "core_settings",
      group: i18n.get("General"),
      name: KEY_PREFIX_ONLY_MODE,
      type: "checkbox",
      label: buildFieldLabel(i18n.get("prefix_only_mode_label"), i18n.get("prefix_only_mode_desc")),
      default: false,
    },
    {
      tab: "core_settings",
      group: i18n.get("prediction_engine"),
      name: KEY_PERSONALIZATION_ENABLED,
      type: "checkbox",
      label: buildFieldLabel(
        i18n.get("personalization_enabled_label"),
        i18n.get("personalization_enabled_desc"),
      ),
      default: false,
    },
    {
      tab: "core_settings",
      group: i18n.get("prediction_engine"),
      name: KEY_NUM_SUGGESTIONS,
      type: "slider",
      min: 0,
      max: 10,
      display: true,
      label: buildFieldLabel(i18n.get("num_predictions_label"), i18n.get("num_predictions_desc")),
      default: DEFAULT_NUM_SUGGESTIONS,
    },
    {
      tab: "core_settings",
      group: i18n.get("prediction_engine"),
      name: KEY_MIN_WORD_LENGTH_TO_PREDICT,
      type: "slider",
      min: -1,
      max: 12,
      display: true,
      label: buildFieldLabel(i18n.get("min_chars_label"), i18n.get("min_chars_desc")),
      default: 1,
    },
    {
      tab: "core_settings",
      group: i18n.get("accept_predictions"),
      name: KEY_AUTOCOMPLETE_ON_TAB,
      type: "checkbox",
      label: buildFieldLabel(i18n.get("accept_tab_label"), i18n.get("accept_tab_desc")),
      default: true,
    },
    {
      tab: "core_settings",
      group: i18n.get("accept_predictions"),
      name: KEY_AUTOCOMPLETE_ON_ENTER,
      type: "checkbox",
      label: buildFieldLabel(i18n.get("accept_enter_label"), i18n.get("accept_enter_desc")),
      default: false,
    },
    {
      tab: "core_settings",
      group: i18n.get("accept_predictions"),
      name: KEY_AUTOCOMPLETE,
      type: "checkbox",
      label: buildFieldLabel(i18n.get("accept_space_label"), i18n.get("accept_space_desc")),
      default: false,
    },
    {
      tab: "core_settings",
      group: i18n.get("accept_predictions"),
      name: KEY_SELECT_BY_DIGIT,
      type: "checkbox",
      label: buildFieldLabel(i18n.get("accept_digits_label"), i18n.get("accept_digits_desc")),
      default: false,
    },
    {
      tab: "core_settings",
      group: i18n.get("behavior_after_completion"),
      name: KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
      type: "checkbox",
      label: buildFieldLabel(i18n.get("add_space_label"), i18n.get("add_space_desc")),
      default: true,
    },
    // =========================================================================
    // TAB: Grammar Rules
    // =========================================================================
    {
      tab: "grammar_tab",
      group: i18n.get("grammar_tab"),
      name: "grammarWorkspacePanel",
      type: "customPanel",
      label: i18n.get("grammar_tab"),
      description: i18n.get("options_tab_grammar_desc"),
      keywords: [i18n.get("grammar_rules"), i18n.get("grammar_tab")],
    },
    {
      tab: "grammar_tab",
      group: i18n.get("popup_review_text"),
      name: KEY_SHOW_REVIEW_BUTTON,
      type: "checkbox",
      label: buildFieldLabel(
        i18n.get("show_review_button_label"),
        i18n.get("show_review_button_desc"),
      ),
      default: true,
    },
    {
      tab: "grammar_tab",
      group: i18n.get("popup_review_text"),
      name: KEY_LIVE_GRAMMAR_PROPOSALS,
      type: "checkbox",
      label: buildFieldLabel(
        i18n.get("live_grammar_proposals_label"),
        i18n.get("live_grammar_proposals_desc"),
      ),
      default: true,
    },
    // Rendered in the Grammar workspace's Local AI card (LocalAiSettingsPanel).
    {
      tab: "grammar_tab",
      group: i18n.get("local_ai_title"),
      name: KEY_LOCAL_AI_REVIEW_ENABLED,
      type: "checkbox",
      label: buildFieldLabel(i18n.get("local_ai_enabled_label"), i18n.get("local_ai_enabled_desc")),
      default: DEFAULT_LOCAL_AI_REVIEW_ENABLED,
    },
    {
      tab: "grammar_tab",
      group: i18n.get("local_ai_title"),
      name: KEY_LOCAL_AI_REVIEW_TIER,
      type: "valueOnly",
      default: DEFAULT_LOCAL_AI_TIER,
    },
    {
      tab: "grammar_tab",
      group: i18n.get("grammar_rules"),
      name: KEY_REVIEW_LONG_SENTENCE_WORDS,
      type: "valueOnly",
      default: DEFAULT_LONG_SENTENCE_WORDS,
    },
    {
      tab: "grammar_tab",
      group: i18n.get("grammar_rules"),
      name: KEY_PREFERRED_TERMINOLOGY,
      type: "valueOnly",
      default: emptyTerminology(),
    },
    // Both rule maps are edited together in the Grammar rule matrix (GrammarRuleMatrix).
    {
      tab: "grammar_tab",
      group: i18n.get("grammar_rules"),
      name: KEY_ENABLED_GRAMMAR_RULES,
      type: "valueOnly",
      default: {},
    },
    {
      tab: "grammar_tab",
      group: i18n.get("grammar_rules"),
      name: KEY_REVIEW_RULE_OVERRIDES,
      type: "valueOnly",
      default: {},
    },

    // =========================================================================
    // TAB: Language
    // =========================================================================
    {
      tab: "language_tab",
      group: i18n.get("extension_ui_language"),
      name: KEY_EXTENSION_LANGUAGE,
      type: "popupButton",
      options: [
        ["auto_detect", i18n.get("auto_detect_lang")],
        ...Object.entries(SUPPORTED_LANGUAGES).filter(
          ([key]) => key !== "textExpander" && key !== "auto_detect",
        ),
      ],
      label: buildFieldLabel(
        i18n.get("extension_language_label"),
        i18n.get("extension_language_desc"),
      ),
      default: "auto_detect",
    },
    {
      tab: "language_tab",
      group: i18n.get("language_selection"),
      name: "languagePreferencesPanel",
      type: "customPanel",
      label: i18n.get("options_panel_language_label"),
      description: i18n.get("options_panel_language_desc"),
      keywords: [i18n.get("options_panel_language_label"), i18n.get("fallback_lang_label")],
    },
    {
      tab: "language_tab",
      group: i18n.get("language_selection"),
      name: KEY_LANGUAGE,
      type: "valueOnly",
      default: "en_US",
    },
    {
      tab: "language_tab",
      group: i18n.get("language_selection"),
      name: KEY_ENABLED_LANGUAGES,
      type: "valueOnly",
      default: SUPPORTED_PREDICTION_LANGUAGE_KEYS,
    },
    {
      tab: "language_tab",
      group: i18n.get("language_selection"),
      name: KEY_FALLBACK_LANGUAGE,
      type: "valueOnly",
      default: "en_US",
    },

    // =========================================================================
    // TAB: Dictionary & Expansions
    // =========================================================================
    {
      tab: "shortcuts_expansions_tab",
      group: i18n.get("text_expander"),
      name: "writingAssetsPanel",
      type: "customPanel",
      label: i18n.get("options_panel_text_assets_label"),
      description: i18n.get("options_panel_text_assets_desc"),
      keywords: [i18n.get("options_panel_text_assets_label"), i18n.get("dynamic_variables")],
    },
    {
      tab: "shortcuts_expansions_tab",
      group: i18n.get("text_expander"),
      name: KEY_TEXT_EXPANSIONS,
      type: "valueOnly",
      default: [
        [
          "FF",
          "Check out FluentTyper, a phenomenal productivity app that autocompletes words as you type, saving loads of time. It's free, and I think you'll love it!",
        ],
        ["callMe", "Call me back once you get free."],
        ["asap", "as soon as possible"],
        ["afaik", "as far as I know"],
        ["eur", "€"],
        ["ddate", "Today is ${date}"],
        ["ttime", "The current time is ${time}"],
        ["ddatetime", "It is exactly ${datetime}"],
        ["dnextwk", "Let's touch base next week on ${date:+1w}"],
        ["rsales", "${random:Hi|Hello|Hey there} ${random:friend|mate|colleague}!"],
        ["purl", "Here is the link we discussed: ${page_url}"],
        ["ptitle", "Page Title: ${page_title}"],
        ["pdomain", "Domain: ${page_domain}"],
        ["rruuid", "Reference ID: ${uuid}"],
      ],
    },
    {
      tab: "shortcuts_expansions_tab",
      group: i18n.get("dynamic_variables"),
      name: KEY_DATE_FORMAT,
      type: "valueOnly",
      default: "",
    },
    {
      tab: "shortcuts_expansions_tab",
      group: i18n.get("dynamic_variables"),
      name: KEY_TIME_FORMAT,
      type: "valueOnly",
      default: "",
    },
    {
      tab: "shortcuts_expansions_tab",
      group: i18n.get("custom_words"),
      name: KEY_USER_DICTIONARY_LIST,
      type: "valueOnly",
      default: [],
    },

    // =========================================================================
    // TAB: Site Management
    // =========================================================================
    {
      tab: "site_mgmt_tab",
      group: i18n.get("manage_domains"),
      name: "siteManagementPanel",
      type: "customPanel",
      label: i18n.get("options_panel_sites_label"),
      description: i18n.get("options_panel_sites_desc"),
      keywords: [i18n.get("options_panel_sites_label"), i18n.get("domain_list_mode")],
    },
    {
      tab: "site_mgmt_tab",
      group: i18n.get("domain_list_mode"),
      name: KEY_DOMAIN_LIST_MODE,
      type: "valueOnly",
      default: "blackList",
    },
    {
      tab: "site_mgmt_tab",
      group: i18n.get("manage_domains"),
      name: "domainBlackList",
      type: "valueOnly",
      default: [],
    },
    {
      tab: "site_mgmt_tab",
      group: i18n.get("site_profiles"),
      name: KEY_SITE_PROFILES,
      type: "valueOnly",
      default: {},
    },

    // =========================================================================
    // TAB: Appearance
    // =========================================================================
    {
      tab: "theming_tab",
      group: i18n.get("theme_presets"),
      name: "appearanceStudioPanel",
      type: "customPanel",
      label: i18n.get("options_panel_appearance_label"),
      description: i18n.get("options_panel_appearance_desc"),
      keywords: [i18n.get("options_panel_appearance_label"), i18n.get("typography_spacing")],
    },
    themeValueSetting("light_theme_colors", KEY_SUGGESTION_BG_LIGHT),
    themeValueSetting("light_theme_colors", KEY_SUGGESTION_TEXT_LIGHT),
    themeValueSetting("light_theme_colors", KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT),
    themeValueSetting("light_theme_colors", KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT),
    themeValueSetting("light_theme_colors", KEY_SUGGESTION_BORDER_LIGHT),
    themeValueSetting("dark_theme_colors", KEY_SUGGESTION_BG_DARK),
    themeValueSetting("dark_theme_colors", KEY_SUGGESTION_TEXT_DARK),
    themeValueSetting("dark_theme_colors", KEY_SUGGESTION_HIGHLIGHT_BG_DARK),
    themeValueSetting("dark_theme_colors", KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK),
    themeValueSetting("dark_theme_colors", KEY_SUGGESTION_BORDER_DARK),
    themeValueSetting("typography_spacing", KEY_SUGGESTION_FONT_SIZE),
    themeValueSetting("typography_spacing", KEY_SUGGESTION_PADDING_VERTICAL),
    themeValueSetting("typography_spacing", KEY_SUGGESTION_PADDING_HORIZONTAL),

    // =========================================================================
    // TAB: Data & Backup
    // =========================================================================
    {
      tab: "advanced_tab",
      group: i18n.get("options_tab_data"),
      name: "dataDiagnosticsPanel",
      type: "customPanel",
      label: i18n.get("options_tab_data"),
      description: i18n.get("options_tab_data_desc"),
      keywords: [i18n.get("options_tab_data"), i18n.get("productivity_dashboard_group")],
    },
    {
      tab: "advanced_tab",
      group: i18n.get("productivity_dashboard_group"),
      name: "productivityStatsPanel",
      type: "description",
      text: `<div id='productivityStatsRoot'>${i18n.get("productivity_insights_loading")}</div>`,
    },
    {
      tab: "advanced_tab",
      group: i18n.get("productivity_dashboard_group"),
      name: "resetProductivityStatsButton",
      type: "button",
      danger: true,
      text: i18n.get("reset_productivity_stats_btn"),
      label: i18n.get("reset_productivity_stats_desc"),
    },
    {
      tab: "advanced_tab",
      group: i18n.get("config_data"),
      name: "clearPersonalizationButton",
      type: "button",
      danger: true,
      text: i18n.get("clear_personalization_btn"),
      label: i18n.get("clear_personalization_desc"),
    },
    {
      tab: "advanced_tab",
      group: i18n.get("config_data"),
      name: "importSettingButton",
      type: "button",
      text: i18n.get("import_settings_btn"),
      label: i18n.get("import_settings_desc"),
    },
    {
      tab: "advanced_tab",
      group: i18n.get("config_data"),
      name: "exportSettingButton",
      type: "button",
      text: i18n.get("export_settings_btn"),
      label: i18n.get("export_settings_desc"),
    },
    ...(IS_DEV_BUILD ? DEV_OBSERVABILITY_SETTINGS : []),

    {
      tab: "advanced_tab",
      group: i18n.get("about_support_tab"),
      name: "aboutWorkspacePanel",
      type: "customPanel",
      label: i18n.get("options_tab_about"),
      description: i18n.get("options_tab_about_desc"),
      keywords: [i18n.get("options_tab_about"), i18n.get("support_development_group")],
    },
  ],
};

export { manifest };
