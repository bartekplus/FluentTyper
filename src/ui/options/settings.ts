import { SettingsEngine, type SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  createLogger,
  getRegisteredObservabilityModules,
  setGlobalObservabilityRuntime,
} from "@core/application/logging/Logger";
import { Store } from "@core/application/storage/Store.js";
import { dispatchSettingsSaveStatus } from "@ui/settings-engine/controls/FieldControl.js";
import { SUPPORTED_LANGUAGES, resolveEnabledLanguages } from "@core/domain/lang";
import { LanguageSettingsPanel } from "@ui/options/LanguageSettingsPanel";
import { TextAssetsPanel } from "@ui/options/TextAssetsPanel";
import { SiteManagementPanel } from "@ui/options/SiteManagementPanel";
import { AppearanceStudio } from "@ui/options/AppearanceStudio";
import { renderDataDiagnosticsPanel } from "@ui/options/DataDiagnosticsPanel";
import { renderAboutWorkspacePanel } from "@ui/options/AboutWorkspacePanel";
import { formatMetricNumber, formatWeekRange } from "@ui/shared/formatMetrics.js";
import { renderEssentialsWorkspacePanel } from "@ui/options/EssentialsWorkspacePanel";
import { renderGrammarWorkspacePanel } from "@ui/options/GrammarWorkspacePanel";
import { renderObservabilityWorkspacePanel } from "@ui/options/ObservabilityWorkspacePanel";
import { resolveSiteProfiles } from "@core/domain/siteProfiles";
import { sanitizeAutoLanguageSitePriors } from "@core/domain/autoLanguageDetection";
import {
  OBSERVABILITY_MODULE_IDS,
  isLogLevel,
  type LogLevel,
  type ObservabilityConfig,
  type ObservabilityEvent,
  type ObservabilityModuleState,
  type ObservabilitySnapshot,
  type ObservabilitySummary,
} from "@core/domain/observability";
import {
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_AI_PREDICTOR_ENABLED,
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_AUTO_LANGUAGE_SITE_PRIORS,
  KEY_LANGUAGE,
  KEY_FALLBACK_LANGUAGE,
  KEY_ENABLED_LANGUAGES,
  KEY_NUM_SUGGESTIONS,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_AUTO_CAPITALIZE,
  KEY_SELECT_BY_DIGIT,
  KEY_TIME_FORMAT,
  KEY_DATE_FORMAT,
  KEY_TEXT_EXPANSIONS,
  KEY_USER_DICTIONARY_LIST,
  KEY_DOMAIN_LIST_MODE,
  KEY_DISPLAY_LANG_HEADER,
  KEY_INLINE_SUGGESTION,
  KEY_PREFIX_ONLY_MODE,
  KEY_PERSONALIZATION_ENABLED,
  KEY_EXTENSION_LANGUAGE,
  KEY_SITE_PROFILES,
  KEY_ENABLED_GRAMMAR_RULES,
  // theme settings
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
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
  KEY_OBSERVABILITY_ENABLED,
  KEY_OBSERVABILITY_MODULE_OVERRIDES,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_POPUP_ACK_WEEKLY_RECAP,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_OPTIONS_CLEAR_OBSERVABILITY_EVENTS,
  CMD_OPTIONS_GET_OBSERVABILITY_SNAPSHOT,
  CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
  CMD_OPTIONS_CLEAR_PERSONALIZATION,
  CMD_OPTIONS_REPORT_OBSERVABILITY_EVENT,
  CMD_OPTIONS_REPORT_OBSERVABILITY_MODULES,
} from "@core/domain/constants";
import { PERSONALIZATION_STORAGE_KEY } from "@core/application/personalization/PersonalizationRepository";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "@core/domain/themeDefaults";
import { i18n } from "./fluenttyperI18n.js";
import { manifest } from "./settingsManifest.js";
import { createWorkspaceShell, formatLooseText } from "./workspacePanelUtils.js";

const PRODUCTIVITY_INSIGHTS_MAX_RETRIES = 5;
const PRODUCTIVITY_INSIGHTS_RETRY_DELAY_MS = 200;
const OBSERVABILITY_MAX_RETRIES = 4;
const OBSERVABILITY_RETRY_DELAY_MS = 250;
const OBSERVABILITY_POLL_INTERVAL_MS = 1500;
const IS_DEV_BUILD = typeof __FT_DEV_BUILD__ !== "undefined" && Boolean(__FT_DEV_BUILD__);
let observabilityLastSignature = "";
let observabilityBindingsInitialized = false;
let observabilityCurrentSnapshot: ObservabilitySnapshot | null = null;
let observabilityRegistry: SettingsRegistry | null = null;
const observabilityUIState = {
  moduleQuery: "",
  moduleFilter: "all" as "all" | "overrides" | "enabled" | "unregistered",
  eventQuery: "",
  eventSource: "all" as "all" | "background" | "content_script" | "options",
  eventLevel: "all" as "all" | LogLevel,
  scopeDomain: "all",
  livePaused: false,
};
const observabilityLogger = createLogger("OptionsObservability");

function resolveOptionsObservabilityConfig(registry: SettingsRegistry) {
  const enabled = registry[KEY_OBSERVABILITY_ENABLED]?.get();
  const defaultLevel = registry[KEY_OBSERVABILITY_DEFAULT_LEVEL]?.get();
  return {
    enabled: typeof enabled === "boolean" ? enabled : true,
    defaultLevel: isLogLevel(defaultLevel) ? defaultLevel : "debug",
    moduleOverrides: getObservabilityModuleOverrides(registry),
  };
}

function applyOptionsObservabilityRuntime(registry: SettingsRegistry) {
  if (!IS_DEV_BUILD) {
    return;
  }
  setGlobalObservabilityRuntime({
    config: resolveOptionsObservabilityConfig(registry),
    source: "options",
    sink: (event) => {
      try {
        void chrome.runtime.sendMessage({
          command: CMD_OPTIONS_REPORT_OBSERVABILITY_EVENT,
          context: {
            event,
          },
        });
      } catch {
        // Ignore runtime disconnects during page teardown.
      }
    },
  });
  try {
    void chrome.runtime.sendMessage({
      command: CMD_OPTIONS_REPORT_OBSERVABILITY_MODULES,
      context: {
        modules: getRegisteredObservabilityModules(),
      },
    });
  } catch {
    // Ignore runtime disconnects during page teardown.
  }
}

function optionsPageConfigChange() {
  const message = {
    command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE",
    context: {},
  };
  void chrome.runtime.sendMessage(message);
}

const CONFIG_REFRESH_KEYS = [
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_LANGUAGE,
  KEY_ENABLED_LANGUAGES,
  KEY_DOMAIN_LIST_MODE,
  KEY_FALLBACK_LANGUAGE,
  KEY_NUM_SUGGESTIONS,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_AUTO_CAPITALIZE,
  KEY_SELECT_BY_DIGIT,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_TIME_FORMAT,
  KEY_DATE_FORMAT,
  KEY_TEXT_EXPANSIONS,
  KEY_USER_DICTIONARY_LIST,
  KEY_DISPLAY_LANG_HEADER,
  KEY_INLINE_SUGGESTION,
  KEY_PERSONALIZATION_ENABLED,
  KEY_EXTENSION_LANGUAGE,
  KEY_AI_PREDICTOR_ENABLED,
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_OBSERVABILITY_ENABLED,
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
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
] as const;

const OBSERVABILITY_REFRESH_KEYS = new Set([
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_OBSERVABILITY_ENABLED,
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
]);

function refreshObservabilitySnapshot(rootId: string): void {
  const root = document.getElementById(rootId);
  if (!root) {
    return;
  }
  observabilityLastSignature = "";
  void loadObservabilitySnapshot(root);
}

function handleConfigRefreshTrigger(registry: SettingsRegistry, key: string): void {
  if (key === KEY_OBSERVABILITY_ENABLED || key === KEY_OBSERVABILITY_DEFAULT_LEVEL) {
    applyOptionsObservabilityRuntime(registry);
  }

  optionsPageConfigChange();

  if (OBSERVABILITY_REFRESH_KEYS.has(key)) {
    refreshObservabilitySnapshot("observabilityRoot");
  }
}

function wireValidationHandlers(registry: SettingsRegistry, store: Store): void {
  for (const key of [KEY_LANGUAGE, KEY_ENABLED_LANGUAGES]) {
    registry[key]?.addEvent("action", () => {
      void validateLanguageSettings(registry, store);
    });
  }
}

function wireImportExportHandlers(registry: SettingsRegistry): void {
  registry.exportSettingButton.addEvent("action", function () {
    chrome.storage.local.get(null, function (items) {
      const result = JSON.stringify(createSettingsExportSnapshot(items));
      const blob = new Blob([result], { type: "application/json" });
      const exportFilename = "FluentTyperSettings.json";
      const dlink = document.createElement("a");
      dlink.href = window.URL.createObjectURL(blob);
      dlink.download = exportFilename;
      dlink.onclick = function () {
        const that = this as HTMLAnchorElement;
        setTimeout(function () {
          window.URL.revokeObjectURL(that.href);
        }, 1500);
      };

      dlink.click();
      dlink.remove();
    });
    dispatchSettingsSaveStatus("saved", { message: i18n.get("settings_exported") });
  });

  const importInputElem = registry.importSettingButton.element as HTMLInputElement;
  importInputElem.type = "file";
  importInputElem.accept = ".json";
  importInputElem.addEventListener("input", importSettingButtonFileSelected.bind(null, registry));
}

function applyInlineSuggestionLocks(registry: SettingsRegistry, enabled: boolean): void {
  if (enabled) {
    registry[KEY_AUTOCOMPLETE_ON_TAB].set(true);
    registry[KEY_NUM_SUGGESTIONS].set(10);
    registry[KEY_PREFIX_ONLY_MODE].set(true);
  }
  registry[KEY_AUTOCOMPLETE_ON_TAB].setDisabled(enabled);
  registry[KEY_PREFIX_ONLY_MODE].setDisabled(enabled);
  registry[KEY_NUM_SUGGESTIONS].setDisabled(enabled);
}

function wireRuntimeSettingsHandlers(registry: SettingsRegistry): void {
  registry[KEY_INLINE_SUGGESTION]?.addEvent("action", () => {
    applyInlineSuggestionLocks(registry, registry[KEY_INLINE_SUGGESTION].get() as boolean);
  });

  registry[KEY_EXTENSION_LANGUAGE]?.addEvent("action", () => {
    const langValue = registry[KEY_EXTENSION_LANGUAGE].get();
    const storageKey = `store.settings.${KEY_EXTENSION_LANGUAGE}`;
    localStorage.setItem(storageKey, JSON.stringify(langValue));
    optionsPageConfigChange();
    setTimeout(() => location.reload(), 100);
  });

  for (const key of CONFIG_REFRESH_KEYS) {
    const setting = registry[key];
    if (!setting || typeof setting.addEvent !== "function") {
      continue;
    }
    setting.addEvent("action", () => handleConfigRefreshTrigger(registry, key));
  }
}

/** Re-sanitizes a stored per-language record; returns true when it had to be rewritten. */
async function sanitizeStoredForEnabledLanguages(
  store: Store,
  key: string,
  enabledLanguages: string[],
  sanitize: (raw: unknown, enabledLanguages: string[]) => unknown,
) {
  const raw = await store.get(key);
  const sanitized = sanitize(raw, enabledLanguages);
  const hasChanges = JSON.stringify(raw || {}) !== JSON.stringify(sanitized);
  if (hasChanges) {
    await store.set(key, sanitized);
  }
  return hasChanges;
}

export async function validateLanguageSettings(registry: SettingsRegistry, store: Store) {
  const enabledLanguagesRaw = await store.get(KEY_ENABLED_LANGUAGES);
  const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
  const allowAutoDetect = enabledLanguages.length > 1;
  const language = ((await store.get(KEY_LANGUAGE)) as string | undefined) || enabledLanguages[0];
  const fallbackLanguage =
    ((await store.get(KEY_FALLBACK_LANGUAGE)) as string | undefined) || enabledLanguages[0];

  const resolvedLanguage =
    language === "auto_detect" && allowAutoDetect
      ? "auto_detect"
      : enabledLanguages.includes(language)
        ? language
        : enabledLanguages[0];
  const resolvedFallbackLanguage = enabledLanguages.includes(fallbackLanguage)
    ? fallbackLanguage
    : enabledLanguages[0];
  let didSanitize = false;
  if (
    !Array.isArray(enabledLanguagesRaw) ||
    enabledLanguagesRaw.length !== enabledLanguages.length ||
    enabledLanguagesRaw.some((language, index) => language !== enabledLanguages[index])
  ) {
    await store.set(KEY_ENABLED_LANGUAGES, enabledLanguages);
    registry[KEY_ENABLED_LANGUAGES].set(enabledLanguages, true);
    didSanitize = true;
  }
  if (resolvedLanguage !== language) {
    await store.set(KEY_LANGUAGE, resolvedLanguage);
    registry[KEY_LANGUAGE].set(resolvedLanguage, true);
    didSanitize = true;
  }
  if (resolvedFallbackLanguage !== fallbackLanguage) {
    await store.set(KEY_FALLBACK_LANGUAGE, resolvedFallbackLanguage);
    registry[KEY_FALLBACK_LANGUAGE].set(resolvedFallbackLanguage, true);
    didSanitize = true;
  }

  const siteProfilesChanged = await sanitizeStoredForEnabledLanguages(
    store,
    KEY_SITE_PROFILES,
    enabledLanguages,
    resolveSiteProfiles,
  );
  const sitePriorsChanged = await sanitizeStoredForEnabledLanguages(
    store,
    KEY_AUTO_LANGUAGE_SITE_PRIORS,
    enabledLanguages,
    sanitizeAutoLanguageSitePriors,
  );
  if (siteProfilesChanged || sitePriorsChanged || didSanitize) {
    optionsPageConfigChange();
  }
}

function importSettingButtonFileSelected(registry: SettingsRegistry) {
  const importInputElem = registry.importSettingButton.element as HTMLInputElement;
  const fr = new FileReader();
  fr.addEventListener("load", () => {
    try {
      const jsonSettings = sanitizeSettingsImportSnapshot(
        JSON.parse(fr.result as string) as Record<string, unknown>,
      );
      void chrome.storage.local.set(jsonSettings);
      dispatchSettingsSaveStatus("saved", { message: i18n.get("settings_imported") });
      optionsPageConfigChange();
      location.reload();
    } catch (error) {
      const block = document.createElement("div");
      block.className = "block";
      const notification = document.createElement("div");
      notification.className = "notification is-danger";
      notification.textContent = `Failed to import JSON file:  ${String(error)}`;
      block.appendChild(notification);
      registry.importSettingButton.rootElement.appendChild(block);
    }
  });

  fr.readAsText((importInputElem.files as FileList)[0]);
  importInputElem.value = "";
}

export function createSettingsExportSnapshot(
  items: Record<string, unknown>,
): Record<string, unknown> {
  const exportableItems = { ...items };
  delete exportableItems[PERSONALIZATION_STORAGE_KEY];
  return exportableItems;
}

export function sanitizeSettingsImportSnapshot(
  items: Record<string, unknown>,
): Record<string, unknown> {
  const importableItems = { ...items };
  delete importableItems["store.settings.revertOnBackspace"];
  delete importableItems[PERSONALIZATION_STORAGE_KEY];
  return importableItems;
}

const themePresets = {
  default: { ...DEFAULT_SUGGESTION_THEME_SETTINGS },
  compact: {
    suggestionBgLight: "rgba(255, 255, 255, 0.85)",
    suggestionTextLight: "#1a202c",
    suggestionHighlightBgLight: "rgba(15, 23, 42, 0.96)",
    suggestionHighlightTextLight: "#ffffff",
    suggestionBorderLight: "rgba(226, 232, 240, 0.7)",
    suggestionBgDark: "rgba(15, 23, 42, 0.9)",
    suggestionTextDark: "#f8fafc",
    suggestionHighlightBgDark: "rgba(30, 41, 59, 0.92)",
    suggestionHighlightTextDark: "#f8fafc",
    suggestionBorderDark: "rgba(71, 85, 105, 0.72)",
    suggestionFontSize: "0.8rem",
    suggestionPaddingVertical: "0.4rem",
    suggestionPaddingHorizontal: "0.6rem",
  },
};

function setupSaveToast() {
  const toast = document.getElementById("settings-save-toast");
  const text = document.getElementById("settings-save-toast-text");
  if (!toast || !text) {
    return;
  }
  let timerId = 0;
  window.addEventListener("fluenttyper:settings-save-status", (event) => {
    const detail = (event as CustomEvent<{ state?: string; message?: string }>).detail;
    if (!detail?.state) {
      return;
    }
    window.clearTimeout(timerId);
    toast.classList.remove("is-hidden", "is-error");
    if (detail.state === "saving") {
      text.textContent = i18n.get("settings_status_saving");
      return;
    }
    if (detail.state === "error") {
      toast.classList.add("is-error");
      text.textContent = detail.message || i18n.get("settings_status_error");
      timerId = window.setTimeout(() => toast.classList.add("is-hidden"), 2200);
      return;
    }
    text.textContent = detail.message || i18n.get("settings_status_saved");
    timerId = window.setTimeout(() => toast.classList.add("is-hidden"), 1400);
  });
}

function localizeStaticShell() {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (key) {
      element.textContent = i18n.get(key);
    }
  });

  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    if (key) {
      element.placeholder = i18n.get(key);
    }
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
    const key = element.dataset.i18nAriaLabel;
    if (key) {
      element.setAttribute("aria-label", i18n.get(key));
    }
  });
}

let lastMarkedDonationPromptId: string | null = null;

function t(key: string) {
  return i18n.get(key);
}

function formatLanguageLabel(language: unknown) {
  if (typeof language !== "string" || !language) {
    return t("productivity_unknown_language");
  }
  return SUPPORTED_LANGUAGES[language] || language;
}

function formatTrendDayLabel(dateKey: unknown) {
  if (typeof dateKey !== "string") {
    return "";
  }
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
}

function sendRuntimeMessage(message: object) {
  return new Promise<unknown>((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response || null);
    });
  });
}

async function acknowledgeWeeklyRecap(weekKey: unknown) {
  if (typeof weekKey !== "string" || !weekKey) {
    return;
  }
  await sendRuntimeMessage({
    command: CMD_POPUP_ACK_WEEKLY_RECAP,
    context: { weekKey },
  });
}

async function handleDonationPromptAction(prompt: Record<string, unknown>, action: string) {
  if (!prompt || typeof prompt.promptId !== "string" || !prompt.promptId) {
    return;
  }
  await sendRuntimeMessage({
    command: CMD_POPUP_ACK_DONATION_MILESTONE,
    context: {
      promptId: prompt.promptId,
      action,
      milestoneHours: typeof prompt.milestoneHours === "number" ? prompt.milestoneHours : null,
    },
  });
}

type RankedRow = Record<string, unknown>;

function appendRankedList(
  container: HTMLElement,
  rows: RankedRow[],
  emptyText: string,
  rowMapper: (row: RankedRow) => [string, string],
) {
  const list = document.createElement("ul");
  list.className = "productivity-insights-list";
  if (!Array.isArray(rows) || rows.length === 0) {
    const item = document.createElement("li");
    item.textContent = emptyText;
    list.appendChild(item);
    container.appendChild(list);
    return;
  }
  rows.forEach((row) => {
    const item = document.createElement("li");
    const [labelText, valueText] = rowMapper(row);
    const label = document.createElement("span");
    label.textContent = labelText;
    const value = document.createElement("strong");
    value.textContent = valueText;
    item.appendChild(label);
    item.appendChild(value);
    list.appendChild(item);
  });
  container.appendChild(list);
}

type MetricStats = {
  estimatedMinutesSaved: unknown;
  acceptedSuggestions: unknown;
  charactersSaved: unknown;
};

function appendMetricCard(container: HTMLElement, label: string, metric: MetricStats) {
  const card = document.createElement("article");
  card.className = "productivity-insights-metric";
  const title = document.createElement("h4");
  title.textContent = label;
  const value = document.createElement("p");
  value.className = "metric-main";
  value.textContent = `${formatMetricNumber(metric.estimatedMinutesSaved)} ${t("popup_short_minutes")}`;
  const details = document.createElement("p");
  details.className = "metric-meta";
  details.textContent = `${formatMetricNumber(metric.acceptedSuggestions)} ${t("popup_short_accepted")} • ${formatMetricNumber(
    metric.charactersSaved,
  )} ${t("popup_short_chars")}`;
  card.appendChild(title);
  card.appendChild(value);
  card.appendChild(details);
  container.appendChild(card);
}

function appendTrendChart(container: HTMLElement, trendPoints: unknown) {
  const section = document.createElement("section");
  section.className = "productivity-insights-section";
  const title = document.createElement("h4");
  title.textContent = t("productivity_trend_chart_title");
  section.appendChild(title);

  const chart = document.createElement("div");
  chart.className = "productivity-trend-chart";
  const points = Array.isArray(trendPoints) ? (trendPoints as Record<string, unknown>[]) : [];
  const maxMinutes =
    points.reduce(
      (maxValue, point) => Math.max(maxValue, Number(point?.estimatedMinutesSaved) || 0),
      0,
    ) || 1;

  if (points.length === 0) {
    const empty = document.createElement("p");
    empty.className = "trend-value";
    empty.textContent = t("productivity_trend_empty");
    section.appendChild(empty);
    container.appendChild(section);
    return;
  }

  points.forEach((point) => {
    const item = document.createElement("div");
    item.className = "trend-bar-item";
    const barTrack = document.createElement("div");
    barTrack.className = "trend-bar-track";
    const barFill = document.createElement("div");
    barFill.className = "trend-bar-fill";
    const minutes = Number(point?.estimatedMinutesSaved) || 0;
    barFill.style.height = `${Math.max(6, Math.round((minutes / maxMinutes) * 100))}%`;
    barTrack.appendChild(barFill);
    const label = document.createElement("span");
    label.className = "trend-bar-label";
    label.textContent = formatTrendDayLabel(point?.dateKey);
    item.appendChild(barTrack);
    item.appendChild(label);
    chart.appendChild(item);
  });

  section.appendChild(chart);
  container.appendChild(section);
}

function appendMilestoneProgress(
  container: HTMLElement,
  milestoneProgress: Record<string, unknown>,
) {
  const section = document.createElement("section");
  section.className = "productivity-insights-section";
  const title = document.createElement("h4");
  title.textContent = t("productivity_milestone_progress_title");
  section.appendChild(title);

  const progressMeta = document.createElement("p");
  progressMeta.className = "trend-value";
  progressMeta.textContent = `${formatMetricNumber(milestoneProgress?.lifetimeHoursSaved)}h / ${formatMetricNumber(
    milestoneProgress?.nextMilestoneHours,
  )}h`;
  section.appendChild(progressMeta);

  const progressTrack = document.createElement("div");
  progressTrack.className = "productivity-progress-track";
  const progressFill = document.createElement("div");
  progressFill.className = "productivity-progress-fill";
  progressFill.style.width = `${Math.max(
    0,
    Math.min(100, Number(milestoneProgress?.progressPct) || 0),
  )}%`;
  progressTrack.appendChild(progressFill);
  section.appendChild(progressTrack);
  container.appendChild(section);
}

function appendEventSummary(container: HTMLElement, eventSummary: Record<string, unknown>) {
  const section = document.createElement("section");
  section.className = "productivity-insights-section";
  const title = document.createElement("h4");
  title.textContent = t("productivity_event_summary_title");
  section.appendChild(title);

  const text = document.createElement("p");
  text.className = "trend-value";
  text.textContent = `${formatMetricNumber(eventSummary?.suggestionsShown)} ${t("productivity_events_shown")} • ${formatMetricNumber(
    eventSummary?.snippetsExpanded,
  )} ${t("productivity_events_expanded")} • ${formatMetricNumber(
    eventSummary?.charsInsertedFromSnippet,
  )} ${t("productivity_events_inserted")} • ${formatMetricNumber(
    eventSummary?.charsTypedForTrigger,
  )} ${t("productivity_events_typed")}`;
  section.appendChild(text);
  container.appendChild(section);
}

type ProductivityStats = Record<string, unknown>;

function renderProductivityInsights(root: HTMLElement, stats: ProductivityStats) {
  root.innerHTML = "";

  const shell = document.createElement("section");
  shell.className = "productivity-insights";

  const header = document.createElement("div");
  header.className = "productivity-insights-header";
  const headingBlock = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = t("productivity_insights_heading");
  const subtitle = document.createElement("p");
  subtitle.textContent = t("productivity_insights_subtitle");
  headingBlock.appendChild(heading);
  headingBlock.appendChild(subtitle);
  const refreshBtn = document.createElement("button");
  refreshBtn.className = "button is-small is-light";
  refreshBtn.type = "button";
  refreshBtn.textContent = t("productivity_refresh_btn");
  refreshBtn.setAttribute("data-action", "refresh-productivity-stats");
  header.appendChild(headingBlock);
  header.appendChild(refreshBtn);
  shell.appendChild(header);

  const metricGrid = document.createElement("div");
  metricGrid.className = "productivity-insights-grid";
  appendMetricCard(metricGrid, t("productivity_metric_today"), stats.today as MetricStats);
  appendMetricCard(metricGrid, t("productivity_metric_last7"), stats.last7Days as MetricStats);
  appendMetricCard(metricGrid, t("productivity_metric_lifetime"), stats.lifetime as MetricStats);
  shell.appendChild(metricGrid);

  const trendSection = document.createElement("section");
  trendSection.className = "productivity-insights-section";
  const trendTitle = document.createElement("h4");
  trendTitle.textContent = t("productivity_week_over_week_title");
  const trendValue = document.createElement("p");
  trendValue.className = "trend-value";
  const weekOverWeekDeltaPct = Number(stats.weekOverWeekDeltaPct);
  if (stats.weekOverWeekDeltaPct === null || !Number.isFinite(weekOverWeekDeltaPct)) {
    trendValue.textContent = t("productivity_week_over_week_empty");
  } else {
    trendValue.textContent = `${weekOverWeekDeltaPct >= 0 ? "+" : ""}${weekOverWeekDeltaPct}% ${t("productivity_week_over_week_suffix")}`;
  }
  trendSection.appendChild(trendTitle);
  trendSection.appendChild(trendValue);
  shell.appendChild(trendSection);
  appendTrendChart(shell, stats.last7DaysTrend);
  appendMilestoneProgress(shell, stats.milestoneProgress as Record<string, unknown>);
  appendEventSummary(shell, stats.last7DaysEvents as Record<string, unknown>);

  const columns = document.createElement("div");
  columns.className = "productivity-insights-columns";

  const snippetSection = document.createElement("section");
  snippetSection.className = "productivity-insights-section";
  const snippetTitle = document.createElement("h4");
  snippetTitle.textContent = t("productivity_top_snippets_title");
  snippetSection.appendChild(snippetTitle);
  appendRankedList(
    snippetSection,
    (stats.topSnippets as RankedRow[]) || [],
    t("productivity_top_snippets_empty"),
    (row) => [
      formatLooseText(row.snippet),
      `${formatMetricNumber(row.count)}x • ${formatMetricNumber(row.estimatedMinutesSaved)} ${t("popup_short_minutes")}`,
    ],
  );
  columns.appendChild(snippetSection);

  const languageWeekSection = document.createElement("section");
  languageWeekSection.className = "productivity-insights-section";
  const languageWeekTitle = document.createElement("h4");
  languageWeekTitle.textContent = t("productivity_languages_last7_title");
  languageWeekSection.appendChild(languageWeekTitle);
  appendRankedList(
    languageWeekSection,
    (stats.perLanguageLast7Days as RankedRow[]) || [],
    t("productivity_languages_empty"),
    (row) => [
      formatLanguageLabel(row.language),
      `${formatMetricNumber(row.estimatedMinutesSaved)} ${t("popup_short_minutes")}`,
    ],
  );
  columns.appendChild(languageWeekSection);

  const languageLifetimeSection = document.createElement("section");
  languageLifetimeSection.className = "productivity-insights-section";
  const languageLifetimeTitle = document.createElement("h4");
  languageLifetimeTitle.textContent = t("productivity_languages_lifetime_title");
  languageLifetimeSection.appendChild(languageLifetimeTitle);
  appendRankedList(
    languageLifetimeSection,
    (stats.perLanguageLifetime as RankedRow[]) || [],
    t("productivity_languages_empty"),
    (row) => [
      formatLanguageLabel(row.language),
      `${formatMetricNumber(row.estimatedMinutesSaved)} ${t("popup_short_minutes")}`,
    ],
  );
  columns.appendChild(languageLifetimeSection);
  shell.appendChild(columns);

  const weeklyRecap = stats.weeklyRecap as Record<string, unknown> | undefined;
  const recapSection = document.createElement("section");
  recapSection.className = "productivity-insights-section recap-section";
  const recapTitle = document.createElement("h4");
  recapTitle.textContent = `${t("productivity_weekly_recap_title")} (${formatWeekRange(weeklyRecap?.weekKey)})`;
  const recapSummary = document.createElement("p");
  recapSummary.textContent = `${formatMetricNumber(weeklyRecap?.acceptedSuggestions)} ${t("popup_short_accepted")} • ${formatMetricNumber(
    weeklyRecap?.charactersSaved,
  )} ${t("popup_short_chars")} • ${formatMetricNumber(
    weeklyRecap?.estimatedMinutesSaved,
  )} ${t("popup_short_minutes")}`;
  recapSection.appendChild(recapTitle);
  recapSection.appendChild(recapSummary);
  const recapTopSnippet = document.createElement("p");
  recapTopSnippet.className = "recap-top-snippet";
  const topSnippet = weeklyRecap?.topSnippet as Record<string, unknown> | undefined;
  recapTopSnippet.textContent = topSnippet
    ? `${t("productivity_top_snippet_label")}: ${formatLooseText(topSnippet.snippet)} (${formatMetricNumber(topSnippet.count)}x)`
    : t("productivity_top_snippet_empty");
  recapSection.appendChild(recapTopSnippet);
  if (stats.shouldShowWeeklyRecap) {
    const recapAction = document.createElement("button");
    recapAction.type = "button";
    recapAction.className = "button is-small is-light recap-action";
    recapAction.textContent = t("productivity_weekly_recap_mark_seen");
    recapAction.onclick = async () => {
      await acknowledgeWeeklyRecap(weeklyRecap?.weekKey);
      await loadProductivityInsights(root);
    };
    recapSection.appendChild(recapAction);
  }
  shell.appendChild(recapSection);

  const donationPrompt = stats.donationPrompt as Record<string, unknown> | undefined;
  if (donationPrompt) {
    if (lastMarkedDonationPromptId !== donationPrompt.promptId) {
      lastMarkedDonationPromptId = String(donationPrompt.promptId);
      void handleDonationPromptAction(donationPrompt, "shown");
    }
    const donationSection = document.createElement("div");
    donationSection.className = "productivity-insights-donation";
    const donationText = document.createElement("span");
    donationText.textContent = String(donationPrompt.message);
    const donationActions = document.createElement("div");
    donationActions.className = "productivity-insights-donation-actions";
    const laterButton = document.createElement("button");
    laterButton.type = "button";
    laterButton.className = "button is-small is-light";
    laterButton.textContent = t("popup_donation_later");
    laterButton.onclick = async () => {
      await handleDonationPromptAction(donationPrompt, "snooze");
      await loadProductivityInsights(root);
    };
    const donationLink = document.createElement("a");
    donationLink.href = "https://www.buymeacoffee.com/FluentTyper";
    donationLink.target = "_blank";
    donationLink.rel = "noopener noreferrer";
    donationLink.textContent = t("popup_donation_support");
    donationLink.onclick = () => {
      void handleDonationPromptAction(donationPrompt, "supported");
    };
    donationActions.appendChild(laterButton);
    donationActions.appendChild(donationLink);
    donationSection.appendChild(donationText);
    donationSection.appendChild(donationActions);
    shell.appendChild(donationSection);
  } else {
    lastMarkedDonationPromptId = null;
  }

  root.appendChild(shell);
}

function renderProductivityInsightsStatus(root: HTMLElement, messageKey: string) {
  root.innerHTML = "";
  const status = document.createElement("div");
  status.className = "productivity-insights-status";
  status.textContent = t(messageKey);
  const refreshBtn = document.createElement("button");
  refreshBtn.className = "button is-small is-light";
  refreshBtn.type = "button";
  refreshBtn.textContent = t("productivity_retry_btn");
  refreshBtn.setAttribute("data-action", "refresh-productivity-stats");
  status.appendChild(refreshBtn);
  root.appendChild(status);
}

async function loadProductivityInsights(root: HTMLElement, retryCount = 0) {
  if (retryCount === 0) {
    renderProductivityInsightsStatus(root, "productivity_insights_loading");
  }
  const response = await sendRuntimeMessage({
    command: CMD_POPUP_GET_PRODUCTIVITY_STATS,
    context: {},
  });
  if (!response || typeof response !== "object" || Array.isArray(response) || "ok" in response) {
    if (retryCount < PRODUCTIVITY_INSIGHTS_MAX_RETRIES) {
      window.setTimeout(() => {
        void loadProductivityInsights(root, retryCount + 1);
      }, PRODUCTIVITY_INSIGHTS_RETRY_DELAY_MS);
      return;
    }
    renderProductivityInsightsStatus(root, "productivity_insights_failed");
    return;
  }
  renderProductivityInsights(root, response as ProductivityStats);
}

function setupProductivityInsights() {
  const root = document.getElementById("productivityStatsRoot");
  if (!root || root.dataset.bound === "true") {
    return;
  }
  root.dataset.bound = "true";
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.getAttribute("data-action") === "refresh-productivity-stats"
    ) {
      void loadProductivityInsights(root);
    }
  });
  window.addEventListener("focus", () => {
    void loadProductivityInsights(root);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void loadProductivityInsights(root);
    }
  });
  void loadProductivityInsights(root);
}

function formatClockTime(timestampMs: unknown) {
  const date = new Date(timestampMs as number);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function createPredictorToggleAction(label: string, key: string, enabled: boolean) {
  const row = document.createElement("div");
  row.className = "predictor-debug-toggle-row";

  const title = document.createElement("span");
  title.textContent = label;
  row.appendChild(title);

  const button = document.createElement("button");
  button.type = "button";
  button.className = enabled
    ? "button is-small is-danger is-light"
    : "button is-small is-link is-light";
  button.textContent = enabled ? "Disable" : "Enable";
  button.setAttribute("data-action", "set-predictor-toggle");
  button.setAttribute("data-key", key);
  button.setAttribute("data-enabled", enabled ? "false" : "true");
  row.appendChild(button);

  return row;
}

function isObservabilitySnapshot(snapshot: unknown): snapshot is ObservabilitySnapshot {
  return (
    !!snapshot &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot) &&
    typeof (snapshot as Record<string, unknown>).generatedAtMs === "number" &&
    typeof (snapshot as Record<string, unknown>).available === "boolean" &&
    Array.isArray((snapshot as Record<string, unknown>).events) &&
    Array.isArray((snapshot as Record<string, unknown>).modules)
  );
}

function buildObservabilitySnapshotSignature(snapshot: ObservabilitySnapshot) {
  try {
    return JSON.stringify({
      ...snapshot,
      generatedAtMs: 0,
    });
  } catch {
    return "";
  }
}

function getObservabilityModuleOverrides(
  registry: SettingsRegistry,
): Record<string, { enabled?: boolean; level?: LogLevel }> {
  const value = registry[KEY_OBSERVABILITY_MODULE_OVERRIDES]?.get();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, { enabled?: boolean; level?: LogLevel }> = {};
  for (const [moduleId, override] of Object.entries(value as Record<string, unknown>)) {
    if (!OBSERVABILITY_MODULE_IDS.includes(moduleId as (typeof OBSERVABILITY_MODULE_IDS)[number])) {
      continue;
    }
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      continue;
    }
    const record = override as Record<string, unknown>;
    const nextOverride: { enabled?: boolean; level?: LogLevel } = {};
    if (typeof record.enabled === "boolean") {
      nextOverride.enabled = record.enabled;
    }
    if (isLogLevel(record.level)) {
      nextOverride.level = record.level;
    }
    if (Object.keys(nextOverride).length > 0) {
      result[moduleId] = nextOverride;
    }
  }
  return result;
}

function setObservabilityModuleOverrides(
  registry: SettingsRegistry,
  overrides: Record<string, { enabled?: boolean; level?: LogLevel }>,
) {
  const setting = registry[KEY_OBSERVABILITY_MODULE_OVERRIDES];
  if (!setting || typeof setting.set !== "function") {
    return;
  }
  setting.set(overrides);
}

function renderObservabilityStatus(root: HTMLElement, text: string, isError = false) {
  root.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "observability-status";
  if (isError) {
    shell.classList.add("is-error");
  }
  const message = document.createElement("p");
  message.textContent = text;
  shell.appendChild(message);
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "button is-small is-light";
  refreshButton.textContent = "Refresh";
  refreshButton.setAttribute("data-action", "refresh-observability");
  shell.appendChild(refreshButton);
  root.appendChild(shell);
}

function createObservabilityLevelSelect(value: unknown, moduleId: string) {
  const select = document.createElement("select");
  select.className = "input";
  select.setAttribute("data-action", "set-observability-module-level");
  select.setAttribute("data-module-id", moduleId);
  ["debug", "info", "warn", "error"].forEach((level) => {
    const option = document.createElement("option");
    option.value = level;
    option.textContent = level;
    option.selected = value === level;
    select.appendChild(option);
  });
  return select;
}

function createObservabilitySelect(
  action: string,
  selectedValue: string,
  options: Array<{ value: string; label: string }>,
) {
  const select = document.createElement("select");
  select.className = "input observability-select";
  select.setAttribute("data-action", action);
  options.forEach((optionConfig) => {
    const option = document.createElement("option");
    option.value = optionConfig.value;
    option.textContent = optionConfig.label;
    option.selected = optionConfig.value === selectedValue;
    select.appendChild(option);
  });
  return select;
}

function createObservabilitySearchInput(
  action: string,
  value: string,
  placeholder: string,
  ariaLabel: string,
) {
  const input = document.createElement("input");
  input.type = "search";
  input.className = "input observability-search";
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", ariaLabel);
  input.setAttribute("data-action", action);
  return input;
}

function createObservabilityBadge(
  label: string,
  tone: "neutral" | "accent" | "success" | "warn" | "error" = "neutral",
) {
  const badge = document.createElement("span");
  badge.className = `observability-badge is-${tone}`;
  badge.textContent = label;
  return badge;
}

function createObservabilityCard(title: string, eyebrow?: string) {
  const card = document.createElement("article");
  card.className = "observability-card";
  if (eyebrow) {
    const eyebrowElement = document.createElement("p");
    eyebrowElement.className = "observability-card-eyebrow";
    eyebrowElement.textContent = eyebrow;
    card.appendChild(eyebrowElement);
  }
  const heading = document.createElement("h4");
  heading.textContent = title;
  card.appendChild(heading);
  return card;
}

function appendObservabilityInfoItem(container: HTMLElement, label: string, value: string) {
  const row = document.createElement("div");
  row.className = "observability-info-row";
  const key = document.createElement("span");
  key.textContent = label;
  const val = document.createElement("strong");
  val.textContent = value;
  row.append(key, val);
  container.appendChild(row);
}

function readObservabilityScrollState(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-observability-scroll-key]")).map(
    (element) => ({
      key: element.getAttribute("data-observability-scroll-key") || "",
      top: element.scrollTop,
      left: element.scrollLeft,
    }),
  );
}

function restoreObservabilityScrollState(
  root: HTMLElement,
  scrollState: Array<{ key: string; top: number; left: number }>,
) {
  scrollState.forEach((entry) => {
    const pane = root.querySelector<HTMLElement>(`[data-observability-scroll-key="${entry.key}"]`);
    if (!pane) {
      return;
    }
    pane.scrollTop = entry.top;
    pane.scrollLeft = entry.left;
  });
}

function levelBadgeTone(level: unknown) {
  return level === "error"
    ? "error"
    : level === "warn"
      ? "warn"
      : level === "info"
        ? "success"
        : "neutral";
}

function formatObservabilityUpdatedStatus(generatedAtMs: number) {
  return observabilityUIState.scopeDomain === "all"
    ? `Updated ${formatClockTime(generatedAtMs)}`
    : `Updated ${formatClockTime(generatedAtMs)} · scope ${observabilityUIState.scopeDomain}`;
}

function buildObservabilitySummaryFromEvents(events: ObservabilityEvent[]): ObservabilitySummary {
  const eventsByLevel: Record<LogLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
  const eventsBySource: Record<ObservabilityEvent["source"], number> = {
    background: 0,
    content_script: 0,
    options: 0,
  };
  events.forEach((event) => {
    eventsByLevel[event.level] += 1;
    eventsBySource[event.source] += 1;
  });
  return {
    totalEvents: events.length,
    eventsByLevel,
    eventsBySource,
  };
}

function collectObservabilityScopeDomains(snapshot: ObservabilitySnapshot): string[] {
  const domains = new Set<string>();
  [...snapshot.contentRuntimes, ...snapshot.autoLanguageRuntimes].forEach((runtime) => {
    if (typeof runtime.domain === "string" && runtime.domain.trim().length > 0) {
      domains.add(runtime.domain);
    }
  });
  return [...domains].sort((left, right) => left.localeCompare(right));
}

function buildScopedObservabilitySnapshot(
  snapshot: ObservabilitySnapshot,
  scopeDomain: string,
): ObservabilitySnapshot {
  if (scopeDomain === "all") {
    return snapshot;
  }

  const normalizedDomain = scopeDomain.trim().toLowerCase();
  if (!normalizedDomain) {
    return snapshot;
  }

  const scopedContentRuntimes = snapshot.contentRuntimes.filter(
    (runtime) => runtime.domain === normalizedDomain,
  );
  const scopedAutoLanguageRuntimes = snapshot.autoLanguageRuntimes.filter(
    (runtime) => runtime.domain === normalizedDomain,
  );
  const matchingTabIds = new Set<number>(
    [...scopedContentRuntimes, ...scopedAutoLanguageRuntimes].map((runtime) => runtime.tabId),
  );

  const scopedEvents = snapshot.events.filter(
    (event) => typeof event.tabId === "number" && matchingTabIds.has(event.tabId),
  );
  const predictor =
    snapshot.predictor && typeof snapshot.predictor === "object"
      ? ({
          ...snapshot.predictor,
          traces: Array.isArray((snapshot.predictor as Record<string, unknown>).traces)
            ? (
                (snapshot.predictor as Record<string, unknown>).traces as Array<
                  Record<string, unknown>
                >
              ).filter((trace) =>
                typeof trace.tabId === "number" ? matchingTabIds.has(trace.tabId) : false,
              )
            : [],
        } satisfies Record<string, unknown>)
      : snapshot.predictor;

  return {
    ...snapshot,
    summary: buildObservabilitySummaryFromEvents(scopedEvents),
    events: scopedEvents,
    predictor,
    contentRuntimes: scopedContentRuntimes,
    autoLanguageRuntimes: scopedAutoLanguageRuntimes,
  };
}

function matchesObservabilityModuleFilter(
  moduleState: Partial<ObservabilityModuleState>,
  query: string,
  filter: typeof observabilityUIState.moduleFilter,
) {
  const normalizedQuery = query.trim().toLowerCase();
  const haystack = [
    String(moduleState.moduleId || ""),
    ...(Array.isArray(moduleState.sources)
      ? moduleState.sources.map((value) => String(value))
      : []),
  ]
    .join(" ")
    .toLowerCase();
  if (normalizedQuery && !haystack.includes(normalizedQuery)) {
    return false;
  }
  if (filter === "overrides") {
    return Boolean(moduleState.hasOverride);
  }
  if (filter === "enabled") {
    return Boolean(moduleState.enabled);
  }
  if (filter === "unregistered") {
    return !moduleState.registered;
  }
  return true;
}

function matchesObservabilityEventFilter(
  event: Partial<ObservabilityEvent>,
  query: string,
  source: typeof observabilityUIState.eventSource,
  level: typeof observabilityUIState.eventLevel,
) {
  if (source !== "all" && event.source !== source) {
    return false;
  }
  if (level !== "all" && event.level !== level) {
    return false;
  }
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const haystack = [
    String(event.moduleId || ""),
    String(event.source || ""),
    String(event.level || ""),
    String(event.message || ""),
    String(event.traceId || ""),
    String(event.requestId ?? ""),
    String(event.tabId ?? ""),
    String(event.frameId ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

function shouldDeferObservabilityRefresh(root: HTMLElement) {
  if (observabilityUIState.livePaused) {
    return true;
  }
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && root.contains(activeElement)) {
    if (
      activeElement.matches(
        "input, select, textarea, button, summary, details, [contenteditable='true']",
      )
    ) {
      return true;
    }
  }
  return Array.from(root.querySelectorAll<HTMLElement>("[data-observability-scroll-key]")).some(
    (element) =>
      element.scrollTop > 12 &&
      (element.matches(":hover") ||
        element === activeElement ||
        (activeElement instanceof HTMLElement && element.contains(activeElement))),
  );
}

function updateObservabilityLiveStatus(root: HTMLElement, text: string) {
  const status = root.querySelector<HTMLElement>("[data-observability-live-status]");
  if (status) {
    status.textContent = text;
  }
}

function renderStoredObservabilitySnapshot(root: HTMLElement, registry: SettingsRegistry) {
  if (observabilityCurrentSnapshot) {
    renderObservabilitySnapshot(root, observabilityCurrentSnapshot, registry);
  }
}

function renderObservabilitySnapshot(
  root: HTMLElement,
  snapshot: ObservabilitySnapshot,
  registry: SettingsRegistry,
) {
  const pageScrollX = window.scrollX;
  const pageScrollY = window.scrollY;
  const scrollState = readObservabilityScrollState(root);
  const availableScopeDomains = collectObservabilityScopeDomains(snapshot);
  if (
    observabilityUIState.scopeDomain !== "all" &&
    !availableScopeDomains.includes(observabilityUIState.scopeDomain)
  ) {
    observabilityUIState.scopeDomain = "all";
  }
  const scopedSnapshot = buildScopedObservabilitySnapshot(
    snapshot,
    observabilityUIState.scopeDomain,
  );
  const events = scopedSnapshot.events;
  const modules = scopedSnapshot.modules;
  const config: ObservabilityConfig = scopedSnapshot.config;
  const summary: ObservabilitySummary = scopedSnapshot.summary;
  const predictor =
    scopedSnapshot.predictor && typeof scopedSnapshot.predictor === "object"
      ? (scopedSnapshot.predictor as Record<string, unknown>)
      : null;
  const filteredModules = modules.filter((moduleStateRecord) =>
    matchesObservabilityModuleFilter(
      moduleStateRecord,
      observabilityUIState.moduleQuery,
      observabilityUIState.moduleFilter,
    ),
  );
  const filteredEvents = events
    .filter((eventRecord) =>
      matchesObservabilityEventFilter(
        eventRecord,
        observabilityUIState.eventQuery,
        observabilityUIState.eventSource,
        observabilityUIState.eventLevel,
      ),
    )
    .slice(0, 120);
  const summaryEventsByLevel =
    summary.eventsByLevel && typeof summary.eventsByLevel === "object"
      ? (summary.eventsByLevel as Partial<Record<LogLevel, number>>)
      : {};
  const predictorConfig = predictor?.config as
    | {
        aiPredictorEnabled?: boolean;
        aiModelId?: string;
        debugPresagePredictorEnabled?: boolean;
        debugAIPredictorEnabled?: boolean;
      }
    | undefined;
  const predictorTraces = Array.isArray(predictor?.traces) ? predictor.traces : [];
  root.innerHTML = "";
  root.setAttribute("data-raw-snapshot", JSON.stringify(snapshot, null, 2));
  root.setAttribute("data-raw-snapshot-scoped", JSON.stringify(scopedSnapshot, null, 2));

  const shell = document.createElement("section");
  shell.className = "observability-dashboard";

  const header = document.createElement("div");
  header.className = "observability-header";
  const titleBlock = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Observability Control Room";
  const subtitle = document.createElement("p");
  subtitle.textContent = formatObservabilityUpdatedStatus(snapshot.generatedAtMs);
  subtitle.setAttribute("data-observability-live-status", "true");
  titleBlock.append(title, subtitle);
  header.appendChild(titleBlock);

  const actions = document.createElement("div");
  actions.className = "observability-actions";
  actions.appendChild(
    createObservabilitySelect("set-observability-scope-domain", observabilityUIState.scopeDomain, [
      { value: "all", label: "All sites" },
      ...availableScopeDomains.map((domain) => ({ value: domain, label: domain })),
    ]),
  );
  [
    ["Refresh", "refresh-observability"],
    ["Clear Events", "clear-observability"],
    ["Copy Snapshot", "copy-observability"],
    ["Copy Site Snapshot", "copy-scoped-observability"],
    [observabilityUIState.livePaused ? "Resume Live" : "Pause Live", "toggle-observability-live"],
  ].forEach(([label, action]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button is-small is-light";
    button.textContent = label;
    button.setAttribute("data-action", action);
    actions.appendChild(button);
  });
  header.appendChild(actions);
  shell.appendChild(header);

  const summaryGrid = document.createElement("div");
  summaryGrid.className = "observability-summary-grid";

  const systemCard = createObservabilityCard("Environment", "System status");
  appendObservabilityInfoItem(systemCard, "Build", snapshot.devBuild ? "dev" : "release");
  appendObservabilityInfoItem(
    systemCard,
    "Observability",
    snapshot.available ? "available" : String(snapshot.reason || "unavailable"),
  );
  appendObservabilityInfoItem(
    systemCard,
    "Live refresh",
    observabilityUIState.livePaused ? "paused" : "active",
  );
  appendObservabilityInfoItem(systemCard, "Global enabled", String(config.enabled ?? false));
  appendObservabilityInfoItem(systemCard, "Default level", String(config.defaultLevel || "n/a"));
  summaryGrid.appendChild(systemCard);

  const coverageCard = createObservabilityCard("Coverage", "What is currently visible");
  appendObservabilityInfoItem(
    coverageCard,
    "Registered modules",
    `${modules.filter((moduleState) => moduleState.registered).length} / ${modules.length}`,
  );
  appendObservabilityInfoItem(
    coverageCard,
    "Overrides",
    String(modules.filter((moduleState) => moduleState.hasOverride).length),
  );
  appendObservabilityInfoItem(
    coverageCard,
    "Content runtimes",
    String(
      Array.isArray(scopedSnapshot.contentRuntimes) ? scopedSnapshot.contentRuntimes.length : 0,
    ),
  );
  appendObservabilityInfoItem(
    coverageCard,
    "Auto-language runtimes",
    String(
      Array.isArray(scopedSnapshot.autoLanguageRuntimes)
        ? scopedSnapshot.autoLanguageRuntimes.length
        : 0,
    ),
  );
  summaryGrid.appendChild(coverageCard);

  const eventVolumeCard = createObservabilityCard("Event Volume", "Current buffer");
  appendObservabilityInfoItem(eventVolumeCard, "Buffered events", String(summary.totalEvents || 0));
  appendObservabilityInfoItem(
    eventVolumeCard,
    "Debug / info",
    `${summaryEventsByLevel.debug || 0} / ${summaryEventsByLevel.info || 0}`,
  );
  appendObservabilityInfoItem(
    eventVolumeCard,
    "Warn / error",
    `${summaryEventsByLevel.warn || 0} / ${summaryEventsByLevel.error || 0}`,
  );
  appendObservabilityInfoItem(
    eventVolumeCard,
    "Visible events",
    `${filteredEvents.length} / ${events.length}`,
  );
  summaryGrid.appendChild(eventVolumeCard);

  const predictorCard = createObservabilityCard("Predictor Diagnostics", "Route controls");
  if (predictor) {
    appendObservabilityInfoItem(
      predictorCard,
      "AI predictor",
      predictorConfig?.aiPredictorEnabled ? "enabled" : "disabled",
    );
    appendObservabilityInfoItem(
      predictorCard,
      "Presage route",
      predictorConfig?.debugPresagePredictorEnabled ? "enabled" : "disabled",
    );
    appendObservabilityInfoItem(
      predictorCard,
      "WebLLM route",
      predictorConfig?.debugAIPredictorEnabled ? "enabled" : "disabled",
    );
    appendObservabilityInfoItem(
      predictorCard,
      "Model",
      String(predictorConfig?.aiModelId || "n/a"),
    );
    appendObservabilityInfoItem(predictorCard, "Recent traces", String(predictorTraces.length));
    predictorCard.appendChild(
      createPredictorToggleAction(
        "Presage route toggle",
        KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
        Boolean(predictorConfig?.debugPresagePredictorEnabled),
      ),
    );
    predictorCard.appendChild(
      createPredictorToggleAction(
        "WebLLM route toggle",
        KEY_DEBUG_AI_PREDICTOR_ENABLED,
        Boolean(predictorConfig?.debugAIPredictorEnabled),
      ),
    );
  } else {
    appendObservabilityInfoItem(predictorCard, "State", "Unavailable");
  }
  summaryGrid.appendChild(predictorCard);
  shell.appendChild(summaryGrid);

  const workspaceGrid = createWorkspaceShell("workspace-main-grid");

  const modulesSection = document.createElement("section");
  modulesSection.className = "observability-pane";
  const modulesHeader = document.createElement("div");
  modulesHeader.className = "observability-pane-header";
  const modulesTitleBlock = document.createElement("div");
  const modulesTitle = document.createElement("h4");
  modulesTitle.textContent = "Module Controls";
  const modulesSubtitle = document.createElement("p");
  modulesSubtitle.textContent = `${filteredModules.length} of ${modules.length} modules shown`;
  modulesTitleBlock.append(modulesTitle, modulesSubtitle);
  const modulesToolbar = document.createElement("div");
  modulesToolbar.className = "observability-pane-toolbar";
  modulesToolbar.append(
    createObservabilitySearchInput(
      "filter-observability-modules",
      observabilityUIState.moduleQuery,
      "Search by module or source",
      "Filter observability modules",
    ),
    createObservabilitySelect(
      "set-observability-module-filter",
      observabilityUIState.moduleFilter,
      [
        { value: "all", label: "All modules" },
        { value: "overrides", label: "Overrides" },
        { value: "enabled", label: "Enabled" },
        { value: "unregistered", label: "Unregistered" },
      ],
    ),
  );
  modulesHeader.append(modulesTitleBlock, modulesToolbar);
  modulesSection.appendChild(modulesHeader);
  const modulesList = document.createElement("div");
  modulesList.className = "observability-scroll-region observability-module-list";
  modulesList.setAttribute("data-observability-scroll-key", "modules");
  const activeOverrides = getObservabilityModuleOverrides(registry);
  filteredModules.forEach((moduleStateRecord) => {
    const moduleState = moduleStateRecord as {
      moduleId?: string;
      enabled?: boolean;
      level?: string;
      registered?: boolean;
      hasOverride?: boolean;
      sources?: string[];
      lastEventAt?: number;
    };
    const moduleId = String(moduleState.moduleId || "unknown");
    const card = document.createElement("article");
    card.className = "observability-module-row";
    const topRow = document.createElement("div");
    topRow.className = "observability-row-top";
    const name = document.createElement("strong");
    name.textContent = moduleId;
    const badges = document.createElement("div");
    badges.className = "observability-badge-row";
    badges.appendChild(
      createObservabilityBadge(
        moduleState.registered ? "registered" : "unregistered",
        moduleState.registered ? "success" : "warn",
      ),
    );
    badges.appendChild(
      createObservabilityBadge(
        moduleState.enabled ? "enabled" : "disabled",
        moduleState.enabled ? "accent" : "neutral",
      ),
    );
    if (moduleState.hasOverride) {
      badges.appendChild(createObservabilityBadge("override", "accent"));
    }
    topRow.append(name, badges);
    card.appendChild(topRow);

    const detail = document.createElement("div");
    detail.className = "observability-module-meta";
    detail.appendChild(
      createObservabilityBadge(
        `level ${String(moduleState.level || "debug")}`,
        levelBadgeTone(moduleState.level),
      ),
    );
    if (Array.isArray(moduleState.sources) && moduleState.sources.length > 0) {
      moduleState.sources.forEach((sourceValue) => {
        detail.appendChild(createObservabilityBadge(String(sourceValue), "neutral"));
      });
    } else {
      detail.appendChild(createObservabilityBadge("no source yet", "neutral"));
    }
    detail.appendChild(
      createObservabilityBadge(
        `last ${typeof moduleState.lastEventAt === "number" ? formatClockTime(moduleState.lastEventAt) : "none"}`,
        "neutral",
      ),
    );
    card.appendChild(detail);

    const controls = document.createElement("div");
    controls.className = "observability-module-controls";
    const enabledLabel = document.createElement("label");
    enabledLabel.className = "observability-inline-toggle";
    const enabledToggle = document.createElement("input");
    enabledToggle.type = "checkbox";
    enabledToggle.checked = Boolean(
      activeOverrides[moduleId]?.enabled ?? moduleState.enabled ?? config.enabled,
    );
    enabledToggle.setAttribute("data-action", "toggle-observability-module");
    enabledToggle.setAttribute("data-module-id", moduleId);
    const enabledText = document.createElement("span");
    enabledText.textContent = "Enabled";
    enabledLabel.append(enabledToggle, enabledText);
    controls.appendChild(enabledLabel);
    const levelControl = document.createElement("label");
    levelControl.className = "observability-inline-select";
    const levelLabel = document.createElement("span");
    levelLabel.textContent = "Level";
    levelControl.append(
      levelLabel,
      createObservabilityLevelSelect(
        activeOverrides[moduleId]?.level || moduleState.level || "debug",
        moduleId,
      ),
    );
    controls.appendChild(levelControl);
    card.appendChild(controls);
    modulesList.appendChild(card);
  });
  if (filteredModules.length === 0) {
    const empty = document.createElement("p");
    empty.className = "observability-empty";
    empty.textContent = "No modules match the current filter.";
    modulesList.appendChild(empty);
  }
  modulesSection.appendChild(modulesList);
  workspaceGrid.appendChild(modulesSection);

  const eventsSection = document.createElement("section");
  eventsSection.className = "observability-pane";
  const eventsHeader = document.createElement("div");
  eventsHeader.className = "observability-pane-header";
  const eventsTitleBlock = document.createElement("div");
  const eventsTitle = document.createElement("h4");
  eventsTitle.textContent = "Recent Events";
  const eventsSubtitle = document.createElement("p");
  eventsSubtitle.textContent = `${filteredEvents.length} of ${events.length} events shown`;
  eventsTitleBlock.append(eventsTitle, eventsSubtitle);
  const eventsToolbar = document.createElement("div");
  eventsToolbar.className = "observability-pane-toolbar";
  eventsToolbar.append(
    createObservabilitySearchInput(
      "filter-observability-events",
      observabilityUIState.eventQuery,
      "Search message, trace, tab, or module",
      "Filter observability events",
    ),
    createObservabilitySelect("set-observability-event-source", observabilityUIState.eventSource, [
      { value: "all", label: "All sources" },
      { value: "background", label: "Background" },
      { value: "content_script", label: "Content script" },
      { value: "options", label: "Options" },
    ]),
    createObservabilitySelect("set-observability-event-level", observabilityUIState.eventLevel, [
      { value: "all", label: "All levels" },
      { value: "debug", label: "Debug" },
      { value: "info", label: "Info" },
      { value: "warn", label: "Warn" },
      { value: "error", label: "Error" },
    ]),
  );
  eventsHeader.append(eventsTitleBlock, eventsToolbar);
  eventsSection.appendChild(eventsHeader);
  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "observability-empty";
    empty.textContent = "No observability events captured yet.";
    eventsSection.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "observability-scroll-region observability-event-list";
    list.setAttribute("data-observability-scroll-key", "events");
    filteredEvents.forEach((eventRecord) => {
      const event = eventRecord as {
        moduleId?: string;
        level?: string;
        timestampMs?: number;
        source?: string;
        message?: string;
        traceId?: string;
        requestId?: number;
        tabId?: number;
        frameId?: number;
        context?: unknown;
      };
      const card = document.createElement("article");
      card.className = "observability-event-card";
      const topRow = document.createElement("div");
      topRow.className = "observability-row-top";
      const main = document.createElement("strong");
      main.textContent = String(event.moduleId || "module");
      const eventTime = document.createElement("span");
      eventTime.textContent = formatClockTime(event.timestampMs);
      topRow.append(main, eventTime);
      card.appendChild(topRow);
      const chips = document.createElement("div");
      chips.className = "observability-badge-row";
      chips.appendChild(
        createObservabilityBadge(String(event.level || "debug"), levelBadgeTone(event.level)),
      );
      chips.appendChild(
        createObservabilityBadge(
          String(event.source || "unknown"),
          event.source === "options" ? "accent" : "neutral",
        ),
      );
      if (event.traceId) {
        chips.appendChild(createObservabilityBadge(`trace ${event.traceId}`, "neutral"));
      }
      if (typeof event.requestId === "number") {
        chips.appendChild(createObservabilityBadge(`req ${event.requestId}`, "neutral"));
      }
      if (typeof event.tabId === "number") {
        chips.appendChild(createObservabilityBadge(`tab ${event.tabId}`, "neutral"));
      }
      if (typeof event.frameId === "number") {
        chips.appendChild(createObservabilityBadge(`frame ${event.frameId}`, "neutral"));
      }
      card.appendChild(chips);
      const message = document.createElement("p");
      message.className = "observability-event-message";
      message.textContent = String(event.message || "");
      card.appendChild(message);
      if (event.context && typeof event.context === "object") {
        const details = document.createElement("details");
        details.className = "observability-event-context";
        const contextSummary = document.createElement("summary");
        contextSummary.textContent = "Context";
        const context = document.createElement("pre");
        context.textContent = JSON.stringify(event.context, null, 2);
        details.append(contextSummary, context);
        card.appendChild(details);
      }
      list.appendChild(card);
    });
    if (filteredEvents.length === 0) {
      const empty = document.createElement("p");
      empty.className = "observability-empty";
      empty.textContent = "No events match the current filter.";
      list.appendChild(empty);
    }
    eventsSection.appendChild(list);
  }
  workspaceGrid.appendChild(eventsSection);

  const rawSection = document.createElement("section");
  rawSection.className = "observability-pane workspace-span-full";
  const rawTitle = document.createElement("h4");
  rawTitle.textContent = "Raw Snapshot";
  const rawDetails = document.createElement("details");
  rawDetails.className = "observability-raw";
  const rawSummary = document.createElement("summary");
  rawSummary.textContent =
    observabilityUIState.scopeDomain === "all"
      ? "Inspect full machine-readable snapshot"
      : `Inspect machine-readable snapshot for ${observabilityUIState.scopeDomain}`;
  const raw = document.createElement("pre");
  raw.className = "observability-raw-preview";
  raw.textContent = JSON.stringify(scopedSnapshot, null, 2);
  rawDetails.append(rawSummary, raw);
  rawSection.append(rawTitle, rawDetails);
  workspaceGrid.appendChild(rawSection);
  shell.appendChild(workspaceGrid);

  root.appendChild(shell);
  updateObservabilityLiveStatus(
    root,
    observabilityUIState.livePaused
      ? "Live updates paused"
      : formatObservabilityUpdatedStatus(snapshot.generatedAtMs),
  );
  window.requestAnimationFrame(() => {
    window.scrollTo(pageScrollX, pageScrollY);
    restoreObservabilityScrollState(root, scrollState);
  });
}

async function loadObservabilitySnapshot(root: HTMLElement, retryCount = 0) {
  const hasRenderedDashboard = Boolean(root.querySelector(".observability-dashboard"));
  if (retryCount === 0 && !hasRenderedDashboard) {
    renderObservabilityStatus(root, "Loading observability dashboard...");
  }
  const response = await sendRuntimeMessage({
    command: CMD_OPTIONS_GET_OBSERVABILITY_SNAPSHOT,
    context: {},
  });
  if (!isObservabilitySnapshot(response)) {
    if (retryCount < OBSERVABILITY_MAX_RETRIES) {
      window.setTimeout(() => {
        void loadObservabilitySnapshot(root, retryCount + 1);
      }, OBSERVABILITY_RETRY_DELAY_MS);
      return;
    }
    renderObservabilityStatus(root, "Observability snapshot unavailable.", true);
    return;
  }
  if (!response.available) {
    renderObservabilityStatus(root, "Observability is available only in development builds.", true);
    return;
  }
  observabilityCurrentSnapshot = response;
  const signature = buildObservabilitySnapshotSignature(response);
  if (
    signature &&
    signature === observabilityLastSignature &&
    root.querySelector(".observability-dashboard, .observability-status")
  ) {
    updateObservabilityLiveStatus(
      root,
      observabilityUIState.livePaused
        ? "Live updates paused"
        : `Updated ${formatClockTime(response.generatedAtMs)}`,
    );
    return;
  }
  observabilityLastSignature = signature;
  if (observabilityRegistry) {
    renderObservabilitySnapshot(root, response, observabilityRegistry);
  }
}

function setupObservabilityDashboard(registry: SettingsRegistry) {
  if (!IS_DEV_BUILD) {
    return;
  }
  observabilityRegistry = registry;
  const mountIfNeeded = () => document.getElementById("observabilityRoot");
  const scheduleRefresh = (force = false) => {
    const root = mountIfNeeded();
    if (root) {
      if (!force && shouldDeferObservabilityRefresh(root)) {
        updateObservabilityLiveStatus(
          root,
          observabilityUIState.livePaused
            ? "Live updates paused"
            : "Live updates paused while you inspect the dashboard",
        );
        return;
      }
      if (force) {
        observabilityLastSignature = "";
      }
      void loadObservabilitySnapshot(root);
    }
  };
  const root = mountIfNeeded();
  if (root) {
    applyOptionsObservabilityRuntime(registry);
    observabilityLogger.info("Mounting observability dashboard");
    scheduleRefresh(true);
  }
  if (observabilityBindingsInitialized) {
    return;
  }
  observabilityBindingsInitialized = true;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.getAttribute("data-action");
    const root = mountIfNeeded();
    if (!root) {
      return;
    }
    if (action === "refresh-observability") {
      observabilityLogger.debug("Refreshing observability dashboard");
      scheduleRefresh(true);
      return;
    }
    if (action === "clear-observability") {
      observabilityLogger.warn("Clearing observability events from options");
      void sendRuntimeMessage({
        command: CMD_OPTIONS_CLEAR_OBSERVABILITY_EVENTS,
        context: {},
      }).then(() => {
        scheduleRefresh(true);
      });
      return;
    }
    if (action === "toggle-observability-live") {
      observabilityUIState.livePaused = !observabilityUIState.livePaused;
      renderStoredObservabilitySnapshot(root, registry);
      if (!observabilityUIState.livePaused) {
        scheduleRefresh(true);
      }
      return;
    }
    if (action === "set-predictor-toggle") {
      const key = target.getAttribute("data-key");
      const nextEnabled = target.getAttribute("data-enabled") === "true";
      if (key) {
        const setting = registry[key];
        if (setting && typeof setting.set === "function") {
          setting.set(nextEnabled);
          applyOptionsObservabilityRuntime(registry);
          observabilityLogger.info("Updating predictor debug toggle", {
            key,
            nextEnabled,
          });
          optionsPageConfigChange();
          window.setTimeout(() => scheduleRefresh(true), 120);
        }
      }
      return;
    }
    if (action === "copy-observability" || action === "copy-scoped-observability") {
      const raw =
        root.getAttribute(
          action === "copy-observability" ? "data-raw-snapshot" : "data-raw-snapshot-scoped",
        ) || "";
      if (raw && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(raw);
      }
    }
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.getAttribute("data-action");
    const root = mountIfNeeded();
    if (!root) {
      return;
    }
    if (action === "filter-observability-modules" && target instanceof HTMLInputElement) {
      observabilityUIState.moduleQuery = target.value;
      renderStoredObservabilitySnapshot(root, registry);
      return;
    }
    if (action === "filter-observability-events" && target instanceof HTMLInputElement) {
      observabilityUIState.eventQuery = target.value;
      renderStoredObservabilitySnapshot(root, registry);
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.getAttribute("data-action");
    if (!action) {
      return;
    }
    const root = mountIfNeeded();
    if (!root) {
      return;
    }
    if (action === "set-observability-module-filter" && target instanceof HTMLSelectElement) {
      observabilityUIState.moduleFilter =
        target.value === "overrides" ||
        target.value === "enabled" ||
        target.value === "unregistered"
          ? target.value
          : "all";
      renderStoredObservabilitySnapshot(root, registry);
      return;
    }
    if (action === "set-observability-event-source" && target instanceof HTMLSelectElement) {
      observabilityUIState.eventSource =
        target.value === "background" ||
        target.value === "content_script" ||
        target.value === "options"
          ? target.value
          : "all";
      renderStoredObservabilitySnapshot(root, registry);
      return;
    }
    if (action === "set-observability-event-level" && target instanceof HTMLSelectElement) {
      observabilityUIState.eventLevel = isLogLevel(target.value) ? target.value : "all";
      renderStoredObservabilitySnapshot(root, registry);
      return;
    }
    if (action === "set-observability-scope-domain" && target instanceof HTMLSelectElement) {
      observabilityUIState.scopeDomain = target.value || "all";
      renderStoredObservabilitySnapshot(root, registry);
      return;
    }
    const moduleId = target.getAttribute("data-module-id");
    if (!moduleId) {
      return;
    }
    const overrides = getObservabilityModuleOverrides(registry);
    const current = { ...(overrides[moduleId] || {}) };
    if (action === "toggle-observability-module" && target instanceof HTMLInputElement) {
      current.enabled = target.checked;
    }
    if (action === "set-observability-module-level" && target instanceof HTMLSelectElement) {
      current.level = isLogLevel(target.value) ? target.value : "debug";
    }
    overrides[moduleId] = current;
    setObservabilityModuleOverrides(registry, overrides);
    applyOptionsObservabilityRuntime(registry);
    observabilityLogger.info("Updating module override", {
      moduleId,
      enabled: current.enabled,
      level: current.level,
    });
    optionsPageConfigChange();
    window.setTimeout(() => scheduleRefresh(true), 120);
  });

  window.addEventListener("focus", () => scheduleRefresh());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleRefresh();
    }
  });
  window.setInterval(() => {
    if (!document.hidden) {
      scheduleRefresh();
    }
  }, OBSERVABILITY_POLL_INTERVAL_MS);
}

window.addEventListener("DOMContentLoaded", function () {
  localizeStaticShell();
  setupSaveToast();
  const defaults: Record<string, unknown> = {};
  for (const setting of manifest.settings) {
    if (setting.name !== undefined && "default" in setting) {
      defaults[setting.name] = (setting as { default?: unknown }).default;
    }
  }
  const store = new Store("settings", defaults);
  const engine = new SettingsEngine({
    container: {
      tabs: document.getElementById("tab-container") as HTMLElement,
      content: document.getElementById("content") as HTMLElement,
      mobileTabs: document.getElementById("mobile-section-select") as HTMLSelectElement | null,
      searchInput: document.getElementById("options-search-input") as HTMLInputElement | null,
    },
    store,
    name: manifest.name,
    icon: manifest.icon,
  });
  const registry = engine.buildFromManifest(manifest);

  void (async () => {
    renderEssentialsWorkspacePanel(
      registry.essentialsWorkspacePanel.element,
      registry,
      IS_DEV_BUILD,
    );
    renderGrammarWorkspacePanel(registry.grammarWorkspacePanel.element, registry);
    new LanguageSettingsPanel(registry.languagePreferencesPanel.element, registry, store);
    new TextAssetsPanel(registry.writingAssetsPanel.element, registry, store);
    new SiteManagementPanel(
      registry.siteManagementPanel.element,
      registry,
      store,
      optionsPageConfigChange,
    );
    new AppearanceStudio(registry.appearanceStudioPanel.element, registry, themePresets);
    renderDataDiagnosticsPanel(registry.dataDiagnosticsPanel.element, registry);
    if (IS_DEV_BUILD && registry.observabilityWorkspacePanel?.element) {
      renderObservabilityWorkspacePanel(registry.observabilityWorkspacePanel.element, registry);
    }
    renderAboutWorkspacePanel(registry.aboutWorkspacePanel.element);
    applyOptionsObservabilityRuntime(registry);

    wireValidationHandlers(registry, store);
    await validateLanguageSettings(registry, store);
    setupProductivityInsights();
    setupObservabilityDashboard(registry);
    registry.resetProductivityStatsButton.addEvent("action", function () {
      void (async () => {
        await sendRuntimeMessage({
          command: CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
          context: {},
        });
        const root = document.getElementById("productivityStatsRoot");
        if (root) {
          await loadProductivityInsights(root);
        }
      })();
    });
    registry.clearPersonalizationButton.addEvent("action", function () {
      if (!window.confirm(i18n.get("clear_personalization_confirm"))) {
        return;
      }
      void (async () => {
        const response = await sendRuntimeMessage({
          command: CMD_OPTIONS_CLEAR_PERSONALIZATION,
          context: {},
        });
        if (
          response &&
          typeof response === "object" &&
          !Array.isArray(response) &&
          (response as { ok?: boolean }).ok
        ) {
          dispatchSettingsSaveStatus("saved", {
            message: i18n.get("clear_personalization_success"),
          });
        }
      })();
    });

    wireImportExportHandlers(registry);
    wireRuntimeSettingsHandlers(registry);
    const inlineEnabled = Boolean(await store.get(KEY_INLINE_SUGGESTION));
    applyInlineSuggestionLocks(registry, inlineEnabled);
  })();
});
