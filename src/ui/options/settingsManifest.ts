import { i18n } from "./fluenttyperI18n.js";
import type { FieldConfig, ManifestDefinition, OptionTuple } from "@ui/settings-engine/types.js";
import { SUPPORTED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS } from "@core/domain/lang";
import {
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_SELECT_BY_DIGIT,
  KEY_LANGUAGE,
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_AI_PREDICTOR_ENABLED,
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
  KEY_OBSERVABILITY_ENABLED,
  KEY_OBSERVABILITY_MODULE_OVERRIDES,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_TIME_FORMAT,
  KEY_DATE_FORMAT,
  KEY_TEXT_EXPANSIONS,
  KEY_USER_DICTIONARY_LIST,
  KEY_DOMAIN_LIST_MODE,
  KEY_DISPLAY_LANG_HEADER,
  KEY_EXTENSION_LANGUAGE,
  KEY_SITE_PROFILES,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
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
  DEFAULT_NUM_SUGGESTIONS,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PREDICTION_TIMEOUT_MS,
} from "@core/domain/constants";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "@core/domain/themeDefaults";
import {
  DEFAULT_V3_GRAMMAR_RULES,
  GRAMMAR_RULE_CATALOG,
  GRAMMAR_RULE_IDS,
  RECOMMENDED_V3_GRAMMAR_RULES,
} from "@core/domain/grammar/ruleCatalog";

const IS_DEV_BUILD = typeof __FT_DEV_BUILD__ !== "undefined" && Boolean(__FT_DEV_BUILD__);

const WEBLLM_DEV_MODEL_OPTIONS: OptionTuple[] = [
  ["SmolLM2-360M-Instruct-q4f16_1-MLC", "SmolLM2 360M q4f16 (fastest)"],
  ["Qwen2.5-0.5B-Instruct-q4f16_1-MLC", "Qwen2.5 0.5B q4f16 (default)"],
  ["Qwen3-0.6B-q4f16_1-MLC", "Qwen3 0.6B q4f16"],
  ["Llama-3.2-1B-Instruct-q4f16_1-MLC", "Llama 3.2 1B q4f16"],
  ["SmolLM2-1.7B-Instruct-q4f16_1-MLC", "SmolLM2 1.7B q4f16"],
  ["Qwen2.5-1.5B-Instruct-q4f16_1-MLC", "Qwen2.5 1.5B q4f16"],
  ["Qwen2.5-3B-Instruct-q4f16_1-MLC", "Qwen2.5 3B q4f16"],
  ["Qwen2.5-7B-Instruct-q4f16_1-MLC", "Qwen2.5 7B q4f16"],
  ["Mistral-7B-Instruct-v0.3-q4f16_1-MLC", "Mistral 7B Instruct v0.3 q4f16"],
];

const LOG_LEVEL_OPTIONS = [
  { value: "debug", text: "Debug" },
  { value: "info", text: "Info" },
  { value: "warn", text: "Warn" },
  { value: "error", text: "Error" },
];

function buildFieldLabel(label: string, description: string): string {
  const normalizedLabel = label.replace(/[:\s]+$/, "");
  return `${normalizedLabel}:&nbsp;<small>${description}</small>`;
}

const DEV_TABS: ManifestDefinition["tabs"] = [
  {
    id: "observability_tab",
    label: i18n.get("observability_tab"),
    title: i18n.get("observability_tab"),
    shortDescription: i18n.get("observability_tab_desc"),
    icon: "OB",
    keywords: [i18n.get("observability_tab"), i18n.get("observability_dashboard_group")],
  },
];

const DEV_PREDICTOR_SETTINGS: FieldConfig[] = [
  {
    tab: "core_settings",
    group: i18n.get("prediction_engine"),
    name: KEY_AI_PREDICTOR_ENABLED,
    type: "checkbox",
    label: buildFieldLabel(
      i18n.get("enable_ai_predictor_label"),
      i18n.get("enable_ai_predictor_desc"),
    ),
    default: true,
  },
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
    group: i18n.get("observability_predictor_group"),
    name: KEY_DEBUG_AI_PREDICTOR_ENABLED,
    type: "checkbox",
    label: buildFieldLabel(
      i18n.get("predictor_debug_webllm_label"),
      i18n.get("predictor_debug_webllm_desc"),
    ),
    default: true,
  },
  {
    tab: "observability_tab",
    group: i18n.get("observability_predictor_group"),
    name: KEY_AI_MODEL_ID,
    type: "popupButton",
    options: WEBLLM_DEV_MODEL_OPTIONS,
    label: buildFieldLabel(
      i18n.get("predictor_debug_model_label"),
      i18n.get("predictor_debug_model_desc"),
    ),
    default: DEFAULT_AI_MODEL_ID,
  },
  {
    tab: "observability_tab",
    group: i18n.get("observability_predictor_group"),
    name: KEY_AI_PREDICTION_TIMEOUT_MS,
    type: "slider",
    min: 20,
    max: 2000,
    step: 10,
    display: true,
    label: buildFieldLabel(
      i18n.get("predictor_debug_timeout_label"),
      i18n.get("predictor_debug_timeout_desc"),
    ),
    default: DEFAULT_AI_PREDICTION_TIMEOUT_MS,
  },
  {
    tab: "observability_tab",
    group: i18n.get("observability_dashboard_group"),
    name: "observabilityPanel",
    type: "description",
    text: `<div id='observabilityRoot'>${i18n.get("observability_loading")}</div>`,
  },
];

const SAFE_GRAMMAR_RULE_IDS = new Set(
  GRAMMAR_RULE_CATALOG.filter((rule) => rule.safetyTier === "safe").map((rule) => rule.id),
);
const RECOMMENDED_GRAMMAR_RULE_IDS = new Set(
  GRAMMAR_RULE_CATALOG.filter((rule) => rule.recommended).map((rule) => rule.id),
);
const HAS_DISTINCT_RECOMMENDED_BADGE =
  SAFE_GRAMMAR_RULE_IDS.size !== RECOMMENDED_GRAMMAR_RULE_IDS.size ||
  [...RECOMMENDED_GRAMMAR_RULE_IDS].some((ruleId) => !SAFE_GRAMMAR_RULE_IDS.has(ruleId));

const GRAMMAR_RULE_OPTIONS = GRAMMAR_RULE_CATALOG.map((rule) => {
  const rolloutBadge =
    rule.defaultRollout === "on"
      ? i18n.get("grammar_rule_rollout_safe_badge")
      : i18n.get("grammar_rule_rollout_advanced_badge");
  const recommendedBadge =
    HAS_DISTINCT_RECOMMENDED_BADGE && rule.recommended
      ? i18n.get("grammar_rule_recommended_badge")
      : "";
  const scopeBadge =
    rule.languageScope === "en_US" ? i18n.get("grammar_rule_scope_en_us_badge") : "";
  const badge = [rolloutBadge, recommendedBadge, scopeBadge].filter(Boolean).join(" · ");
  return {
    value: rule.id,
    text: i18n.get(rule.titleI18nKey) || rule.name,
    description: i18n.get(rule.descriptionI18nKey),
    example: i18n.get(rule.exampleI18nKey),
    safetyTier: rule.safetyTier,
    languageScope: rule.languageScope,
    ...(badge
      ? {
          badge,
        }
      : {}),
    ...(rule.recommended ? { recommended: true } : {}),
  };
});

// --- Manifest Definition ---
const manifest: ManifestDefinition = {
  name: i18n.get("options_page_title"),
  icon: "/icon/icon128.png",
  tabs: [
    {
      id: "core_settings",
      label: i18n.get("options_tab_essentials"),
      title: i18n.get("options_tab_essentials"),
      shortDescription: i18n.get("options_tab_essentials_desc"),
      icon: "ES",
      keywords: [i18n.get("options_tab_essentials"), i18n.get("prediction_engine")],
    },
    {
      id: "grammar_tab",
      label: i18n.get("grammar_tab"),
      title: i18n.get("grammar_tab"),
      shortDescription: i18n.get("options_tab_grammar_desc"),
      icon: "GR",
      keywords: [i18n.get("grammar_rules"), i18n.get("grammar_tab")],
    },
    {
      id: "language_tab",
      label: i18n.get("options_tab_languages"),
      title: i18n.get("options_tab_languages"),
      shortDescription: i18n.get("options_tab_languages_desc"),
      icon: "LA",
      keywords: [i18n.get("options_tab_languages"), i18n.get("language_selection")],
    },
    {
      id: "shortcuts_expansions_tab",
      label: i18n.get("options_tab_snippets"),
      title: i18n.get("options_tab_snippets"),
      shortDescription: i18n.get("options_tab_snippets_desc"),
      icon: "SD",
      keywords: [i18n.get("options_tab_snippets"), i18n.get("text_expander")],
    },
    {
      id: "site_mgmt_tab",
      label: i18n.get("options_tab_sites"),
      title: i18n.get("options_tab_sites"),
      shortDescription: i18n.get("options_tab_sites_desc"),
      icon: "SI",
      keywords: [i18n.get("options_tab_sites"), i18n.get("site_profiles")],
    },
    {
      id: "theming_tab",
      label: i18n.get("theming_tab"),
      title: i18n.get("theming_tab"),
      shortDescription: i18n.get("options_tab_appearance_desc"),
      icon: "AP",
      keywords: [i18n.get("theming_tab"), i18n.get("theme_presets")],
    },
    {
      id: "advanced_tab",
      label: i18n.get("options_tab_data"),
      title: i18n.get("options_tab_data"),
      shortDescription: i18n.get("options_tab_data_desc"),
      icon: "DD",
      keywords: [i18n.get("options_tab_data"), i18n.get("config_data")],
    },
    ...(IS_DEV_BUILD ? DEV_TABS : []),
    {
      id: "about_support_tab",
      label: i18n.get("options_tab_about"),
      title: i18n.get("options_tab_about"),
      shortDescription: i18n.get("options_tab_about_desc"),
      icon: "AB",
      keywords: [i18n.get("options_tab_about"), i18n.get("support_development_group")],
    },
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
    ...(IS_DEV_BUILD ? DEV_PREDICTOR_SETTINGS : []),
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
    {
      tab: "core_settings",
      group: i18n.get("behavior_after_completion"),
      name: KEY_INLINE_SUGGESTION,
      type: "checkbox",
      label: buildFieldLabel(
        i18n.get("enable_inline_suggestion_label"),
        i18n.get("enable_inline_suggestion_desc"),
      ),
      default: false,
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
      group: i18n.get("grammar_rules"),
      name: KEY_ENABLED_GRAMMAR_RULES,
      type: "ruleToggleCards",
      label: i18n.get("grammar_rules_label"),
      helpText: i18n.get("grammar_rules_help"),
      summaryLabel: i18n.get("grammar_rules_summary_label"),
      emptyStateText: i18n.get("grammar_rules_empty_state"),
      noMatchesText: i18n.get("grammar_rules_no_matches"),
      searchPlaceholder: i18n.get("grammar_rules_search_placeholder"),
      sectionSafeLabel: i18n.get("grammar_rules_section_safe"),
      sectionAdvancedLabel: i18n.get("grammar_rules_section_advanced"),
      filterAllLabel: i18n.get("grammar_rules_filter_all"),
      filterSafeLabel: i18n.get("grammar_rules_filter_safe"),
      filterAdvancedLabel: i18n.get("grammar_rules_filter_advanced"),
      filterEnglishOnlyLabel: i18n.get("grammar_rules_filter_english_only"),
      filterEnabledOnlyLabel: i18n.get("grammar_rules_filter_enabled_only"),
      actions: [
        {
          actionKey: "recommended",
          text: i18n.get("grammar_rules_recommended"),
          values: RECOMMENDED_V3_GRAMMAR_RULES,
        },
        {
          actionKey: "enable_all",
          text: i18n.get("grammar_rules_enable_all"),
          values: GRAMMAR_RULE_IDS,
        },
        {
          actionKey: "disable_all",
          text: i18n.get("grammar_rules_disable_all"),
          values: [],
        },
      ],
      options: GRAMMAR_RULE_OPTIONS,
      default: DEFAULT_V3_GRAMMAR_RULES,
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
    {
      tab: "language_tab",
      group: i18n.get("language_display"),
      name: KEY_DISPLAY_LANG_HEADER,
      type: "checkbox",
      label: buildFieldLabel(i18n.get("show_lang_header_label"), i18n.get("show_lang_header_desc")),
      default: false,
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
    {
      tab: "theming_tab",
      group: i18n.get("light_theme_colors"),
      name: KEY_SUGGESTION_BG_LIGHT,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgLight,
    },
    {
      tab: "theming_tab",
      group: i18n.get("light_theme_colors"),
      name: KEY_SUGGESTION_TEXT_LIGHT,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionTextLight,
    },
    {
      tab: "theming_tab",
      group: i18n.get("light_theme_colors"),
      name: KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightBgLight,
    },
    {
      tab: "theming_tab",
      group: i18n.get("light_theme_colors"),
      name: KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightTextLight,
    },
    {
      tab: "theming_tab",
      group: i18n.get("light_theme_colors"),
      name: KEY_SUGGESTION_BORDER_LIGHT,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBorderLight,
    },
    {
      tab: "theming_tab",
      group: i18n.get("dark_theme_colors"),
      name: KEY_SUGGESTION_BG_DARK,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgDark,
    },
    {
      tab: "theming_tab",
      group: i18n.get("dark_theme_colors"),
      name: KEY_SUGGESTION_TEXT_DARK,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionTextDark,
    },
    {
      tab: "theming_tab",
      group: i18n.get("dark_theme_colors"),
      name: KEY_SUGGESTION_HIGHLIGHT_BG_DARK,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightBgDark,
    },
    {
      tab: "theming_tab",
      group: i18n.get("dark_theme_colors"),
      name: KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightTextDark,
    },
    {
      tab: "theming_tab",
      group: i18n.get("dark_theme_colors"),
      name: KEY_SUGGESTION_BORDER_DARK,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBorderDark,
    },
    {
      tab: "theming_tab",
      group: i18n.get("typography_spacing"),
      name: KEY_SUGGESTION_FONT_SIZE,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionFontSize,
    },
    {
      tab: "theming_tab",
      group: i18n.get("typography_spacing"),
      name: KEY_SUGGESTION_PADDING_VERTICAL,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionPaddingVertical,
    },
    {
      tab: "theming_tab",
      group: i18n.get("typography_spacing"),
      name: KEY_SUGGESTION_PADDING_HORIZONTAL,
      type: "valueOnly",
      default: DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionPaddingHorizontal,
    },

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
      text: i18n.get("reset_productivity_stats_btn"),
      label: i18n.get("reset_productivity_stats_desc"),
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

    // =========================================================================
    // TAB: About & Support
    // =========================================================================
    {
      tab: "about_support_tab",
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
