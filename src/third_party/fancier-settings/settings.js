import { FancierSettingsWithManifest } from "./js/classes/fancier-settings.js";
import { Store } from "./lib/store.js";
import { ElementWrapper } from "./js/classes/utils.js";
import { SUPPORTED_LANGUAGES, resolveEnabledLanguages } from "../../shared/lang.ts";
import { TextExpander } from "../../options/textExpander.js";
import { SiteProfilesManager } from "../../options/siteProfiles.js";
import { resolveSiteProfiles } from "../../shared/siteProfiles.ts";
import {
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_LANGUAGE,
  KEY_FALLBACK_LANGUAGE,
  KEY_ENABLED_LANGUAGES,
  KEY_NUM_SUGGESTIONS,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_AUTO_CAPITALIZE,
  KEY_APPLY_SPACING_RULES,
  KEY_SELECT_BY_DIGIT,
  KEY_VARIABLE_EXPANSION,
  KEY_TIME_FORMAT,
  KEY_DATE_FORMAT,
  KEY_REVERT_ON_BACKSPACE,
  KEY_TEXT_EXPANSIONS,
  KEY_USER_DICTIONARY_LIST,
  KEY_DOMAIN_LIST_MODE,
  KEY_DISPLAY_LANG_HEADER,
  KEY_INLINE_SUGGESTION,
  KEY_EXTENSION_LANGUAGE,
  KEY_SITE_PROFILES,
  // theme settings
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
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_POPUP_ACK_WEEKLY_RECAP,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
} from "../../shared/constants.ts";
import { i18n } from "./i18n.js";

const PRODUCTIVITY_INSIGHTS_MAX_RETRIES = 5;
const PRODUCTIVITY_INSIGHTS_RETRY_DELAY_MS = 200;

function optionsPageConfigChange() {
  const message = {
    command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE",
    context: {},
  };
  chrome.runtime.sendMessage(message);
}

function fallbackLanguageVisibility(settings, value) {
  if (value === "auto_detect")
    settings.manifest.fallbackLanguage.bundle.element.classList.remove(
      "is-hidden"
    );
  else
    settings.manifest.fallbackLanguage.bundle.element.classList.add(
      "is-hidden"
    );
}

function buildLanguageOptions(enabledLanguages, allowAutoDetect) {
  const options = enabledLanguages.map((lang) => [
    lang,
    SUPPORTED_LANGUAGES[lang],
  ]);
  if (allowAutoDetect) {
    options.unshift(["auto_detect", SUPPORTED_LANGUAGES.auto_detect]);
  }
  return options;
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function sanitizeSiteProfilesForEnabledLanguages(store, enabledLanguages) {
  const resolvedEnabledLanguages =
    enabledLanguages || resolveEnabledLanguages(await store.get(KEY_ENABLED_LANGUAGES));
  const rawSiteProfiles = await store.get(KEY_SITE_PROFILES);
  const sanitizedSiteProfiles = resolveSiteProfiles(
    rawSiteProfiles,
    resolvedEnabledLanguages,
  );
  const hasChanges =
    JSON.stringify(rawSiteProfiles || {}) !== JSON.stringify(sanitizedSiteProfiles);
  if (hasChanges) {
    await store.set(KEY_SITE_PROFILES, sanitizedSiteProfiles);
  }
  return hasChanges;
}

async function validateLanguageSettings(settings, store) {
  const enabledLanguagesRaw = await store.get(KEY_ENABLED_LANGUAGES);
  const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
  const allowAutoDetect = enabledLanguages.length > 1;
  const language = (await store.get(KEY_LANGUAGE)) || enabledLanguages[0];
  const fallbackLanguage =
    (await store.get(KEY_FALLBACK_LANGUAGE)) || enabledLanguages[0];

  const resolvedLanguage =
    language === "auto_detect" && allowAutoDetect
      ? "auto_detect"
      : enabledLanguages.includes(language)
        ? language
        : enabledLanguages[0];
  const resolvedFallbackLanguage = enabledLanguages.includes(fallbackLanguage)
    ? fallbackLanguage
    : enabledLanguages[0];

  const primaryOptions = buildLanguageOptions(
    enabledLanguages,
    allowAutoDetect,
  );
  const fallbackOptions = buildLanguageOptions(enabledLanguages, false);
  settings.manifest.language.setOptions(primaryOptions, resolvedLanguage);
  settings.manifest.fallbackLanguage.setOptions(
    fallbackOptions,
    resolvedFallbackLanguage,
  );

  if (!arraysEqual(enabledLanguagesRaw, enabledLanguages)) {
    settings.manifest[KEY_ENABLED_LANGUAGES].set(enabledLanguages);
  }

  if (resolvedLanguage !== language) {
    settings.manifest.language.set(resolvedLanguage);
  }
  if (resolvedFallbackLanguage !== fallbackLanguage) {
    settings.manifest.fallbackLanguage.set(resolvedFallbackLanguage);
  }

  const siteProfilesChanged = await sanitizeSiteProfilesForEnabledLanguages(
    store,
    enabledLanguages,
  );
  if (siteProfilesChanged) {
    optionsPageConfigChange();
  }
}

function importSettingButtonFileSelected(settings) {
  const importInputElem = settings.manifest.importSettingButton.element.element;
  const fr = new FileReader();
  fr.addEventListener("load", () => {
    try {
      const jsonSettings = JSON.parse(fr.result);
      console.log(jsonSettings);
      chrome.storage.local.set(jsonSettings);
      optionsPageConfigChange();
      location.reload();
    } catch (error) {
      const block = new ElementWrapper("div", { class: "block" });
      const notification = new ElementWrapper("div", {
        class: "notification is-danger",
        text: "Failed to import JSON file:  " + error,
      });

      notification.inject(block);
      block.inject(settings.manifest.importSettingButton.bundle);
    }
  });

  fr.readAsText(importInputElem.files[0]);
  importInputElem.value = null;
}

function importUserDictFileSelected(settings) {
  const importInputElem = settings.manifest.importUserDictButton.element.element;
  const fr = new FileReader();
  fr.addEventListener("load", () => {
    try {
      const fileContent = fr.result;
      const lines = fileContent.split('\n');
      // Regex to match a single word (letters, numbers, underscore) without spaces or other special chars
      const wordRegex = /^\w+$/;
      let count = 0;

      lines.forEach(line => {
        const word = line.trim();
        if (word && wordRegex.test(word)) {
          settings.manifest.userDictionaryList.add(word, false);
          count += 1;
        }
      });
      settings.manifest.userDictionaryList.store();

      const block = new ElementWrapper("div", { class: "block" });
      const notification = new ElementWrapper("div", {
        class: "notification is-success",
        text: "Imported:  " + count + " words",
      });

      notification.inject(block);
      block.inject(settings.manifest.importUserDictButton.bundle);
    } catch (error) {
      const block = new ElementWrapper("div", { class: "block" });
      const notification = new ElementWrapper("div", {
        class: "notification is-danger",
        text: "Failed to import user dictionary file:  " + error,
      });

      notification.inject(block);
      block.inject(settings.manifest.importUserDictButton.bundle);
    }
  });
  fr.readAsText(importInputElem.files[0]);
  importInputElem.value = null;
}

// Theme application is now handled through the messaging system
// This function is no longer needed as themes are applied via background script

const themePresets = {
  default: {
    tributeBgLight: "#ffffff",
    tributeTextLight: "#2d3748",
    tributeHighlightBgLight: "#edf2f7",
    tributeHighlightTextLight: "#2d3748",
    tributeBorderLight: "#e2e8f0",
    tributeBgDark: "#2d3748",
    tributeTextDark: "#e2e8f0",
    tributeHighlightBgDark: "#4a5568",
    tributeHighlightTextDark: "#ffffff",
    tributeBorderDark: "#4a5568",
    tributeFontSize: "0.9rem",
    tributePaddingVertical: "0.6rem",
    tributePaddingHorizontal: "0.8rem"
  },
  compact: {
    tributeBgLight: "rgba(255, 255, 255, 0.85)",
    tributeTextLight: "#1a202c",
    tributeHighlightBgLight: "rgba(226, 232, 240, 0.9)",
    tributeHighlightTextLight: "#1a202c",
    tributeBorderLight: "rgba(226, 232, 240, 0.7)",
    tributeBgDark: "rgba(45, 55, 72, 0.85)",
    tributeTextDark: "#f7fafc",
    tributeHighlightBgDark: "rgba(113, 128, 150, 0.9)",
    tributeHighlightTextDark: "#f7fafc",
    tributeBorderDark: "rgba(74, 85, 104, 0.7)",
    tributeFontSize: "0.85rem",
    tributePaddingVertical: "0.4rem",
    tributePaddingHorizontal: "0.6rem"
  }
};

function applyThemePreset(settings, presetName) {
  const presetToApply = presetName === 'compact' ? themePresets.compact : themePresets.default;

  console.log(`FluentTyper: Applying ${presetName} theme preset`);

  Object.keys(presetToApply).forEach(key => {
    if (settings.manifest[key]) {
      settings.manifest[key].set(presetToApply[key]);
    }
  });

  // Theme will be applied through the messaging system when settings change
}

let lastMarkedDonationPromptId = null;

function t(key) {
  return i18n.get(key);
}

function formatMetricNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatWeekRange(weekKey) {
  if (typeof weekKey !== "string") {
    return "n/a";
  }
  const startDate = new Date(`${weekKey}T00:00:00`);
  if (Number.isNaN(startDate.getTime())) {
    return weekKey;
  }
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

function formatLanguageLabel(language) {
  if (typeof language !== "string" || !language) {
    return t("productivity_unknown_language");
  }
  return SUPPORTED_LANGUAGES[language] || language;
}

function formatTrendDayLabel(dateKey) {
  if (typeof dateKey !== "string") {
    return "";
  }
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response || null);
    });
  });
}

async function acknowledgeWeeklyRecap(weekKey) {
  if (typeof weekKey !== "string" || !weekKey) {
    return;
  }
  await sendRuntimeMessage({
    command: CMD_POPUP_ACK_WEEKLY_RECAP,
    context: { weekKey },
  });
}

async function handleDonationPromptAction(prompt, action) {
  if (!prompt || typeof prompt.promptId !== "string" || !prompt.promptId) {
    return;
  }
  await sendRuntimeMessage({
    command: CMD_POPUP_ACK_DONATION_MILESTONE,
    context: {
      promptId: prompt.promptId,
      action,
      milestoneHours:
        typeof prompt.milestoneHours === "number" ? prompt.milestoneHours : null,
    },
  });
}

function appendRankedList(container, rows, emptyText, rowMapper) {
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

function appendMetricCard(container, label, metric) {
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

function appendTrendChart(container, trendPoints) {
  const section = document.createElement("section");
  section.className = "productivity-insights-section";
  const title = document.createElement("h4");
  title.textContent = t("productivity_trend_chart_title");
  section.appendChild(title);

  const chart = document.createElement("div");
  chart.className = "productivity-trend-chart";
  const points = Array.isArray(trendPoints) ? trendPoints : [];
  const maxMinutes =
    points.reduce(
      (maxValue, point) =>
        Math.max(maxValue, Number(point?.estimatedMinutesSaved) || 0),
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

function appendMilestoneProgress(container, milestoneProgress) {
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

function appendEventSummary(container, eventSummary) {
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

function renderProductivityInsights(root, stats) {
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
  appendMetricCard(metricGrid, t("productivity_metric_today"), stats.today);
  appendMetricCard(metricGrid, t("productivity_metric_last7"), stats.last7Days);
  appendMetricCard(metricGrid, t("productivity_metric_lifetime"), stats.lifetime);
  shell.appendChild(metricGrid);

  const trendSection = document.createElement("section");
  trendSection.className = "productivity-insights-section";
  const trendTitle = document.createElement("h4");
  trendTitle.textContent = t("productivity_week_over_week_title");
  const trendValue = document.createElement("p");
  trendValue.className = "trend-value";
  if (stats.weekOverWeekDeltaPct === null) {
    trendValue.textContent = t("productivity_week_over_week_empty");
  } else if (stats.weekOverWeekDeltaPct >= 0) {
    trendValue.textContent = `+${stats.weekOverWeekDeltaPct}% ${t("productivity_week_over_week_suffix")}`;
  } else {
    trendValue.textContent = `${stats.weekOverWeekDeltaPct}% ${t("productivity_week_over_week_suffix")}`;
  }
  trendSection.appendChild(trendTitle);
  trendSection.appendChild(trendValue);
  shell.appendChild(trendSection);
  appendTrendChart(shell, stats.last7DaysTrend);
  appendMilestoneProgress(shell, stats.milestoneProgress);
  appendEventSummary(shell, stats.last7DaysEvents);

  const columns = document.createElement("div");
  columns.className = "productivity-insights-columns";

  const snippetSection = document.createElement("section");
  snippetSection.className = "productivity-insights-section";
  const snippetTitle = document.createElement("h4");
  snippetTitle.textContent = t("productivity_top_snippets_title");
  snippetSection.appendChild(snippetTitle);
  appendRankedList(
    snippetSection,
    stats.topSnippets || [],
    t("productivity_top_snippets_empty"),
    (row) => [
      row.snippet,
      `${row.count}x • ${formatMetricNumber(row.estimatedMinutesSaved)} ${t("popup_short_minutes")}`,
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
    stats.perLanguageLast7Days || [],
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
    stats.perLanguageLifetime || [],
    t("productivity_languages_empty"),
    (row) => [
      formatLanguageLabel(row.language),
      `${formatMetricNumber(row.estimatedMinutesSaved)} ${t("popup_short_minutes")}`,
    ],
  );
  columns.appendChild(languageLifetimeSection);
  shell.appendChild(columns);

  const recapSection = document.createElement("section");
  recapSection.className = "productivity-insights-section recap-section";
  const recapTitle = document.createElement("h4");
  recapTitle.textContent = `${t("productivity_weekly_recap_title")} (${formatWeekRange(stats.weeklyRecap?.weekKey)})`;
  const recapSummary = document.createElement("p");
  recapSummary.textContent = `${formatMetricNumber(stats.weeklyRecap?.acceptedSuggestions)} ${t("popup_short_accepted")} • ${formatMetricNumber(
    stats.weeklyRecap?.charactersSaved,
  )} ${t("popup_short_chars")} • ${formatMetricNumber(
    stats.weeklyRecap?.estimatedMinutesSaved,
  )} ${t("popup_short_minutes")}`;
  recapSection.appendChild(recapTitle);
  recapSection.appendChild(recapSummary);
  if (stats.weeklyRecap?.topSnippet) {
    const recapTopSnippet = document.createElement("p");
    recapTopSnippet.className = "recap-top-snippet";
    recapTopSnippet.textContent = `${t("productivity_top_snippet_label")}: ${stats.weeklyRecap.topSnippet.snippet} (${stats.weeklyRecap.topSnippet.count}x)`;
    recapSection.appendChild(recapTopSnippet);
  } else {
    const recapTopSnippet = document.createElement("p");
    recapTopSnippet.className = "recap-top-snippet";
    recapTopSnippet.textContent = t("productivity_top_snippet_empty");
    recapSection.appendChild(recapTopSnippet);
  }
  if (stats.shouldShowWeeklyRecap) {
    const recapAction = document.createElement("button");
    recapAction.type = "button";
    recapAction.className = "button is-small is-light recap-action";
    recapAction.textContent = t("productivity_weekly_recap_mark_seen");
    recapAction.onclick = async () => {
      await acknowledgeWeeklyRecap(stats.weeklyRecap.weekKey);
      await loadProductivityInsights(root);
    };
    recapSection.appendChild(recapAction);
  }
  shell.appendChild(recapSection);

  if (stats.donationPrompt) {
    if (lastMarkedDonationPromptId !== stats.donationPrompt.promptId) {
      lastMarkedDonationPromptId = stats.donationPrompt.promptId;
      void handleDonationPromptAction(stats.donationPrompt, "shown");
    }
    const donationSection = document.createElement("div");
    donationSection.className = "productivity-insights-donation";
    const donationText = document.createElement("span");
    donationText.textContent = stats.donationPrompt.message;
    const donationActions = document.createElement("div");
    donationActions.className = "productivity-insights-donation-actions";
    const laterButton = document.createElement("button");
    laterButton.type = "button";
    laterButton.className = "button is-small is-light";
    laterButton.textContent = t("popup_donation_later");
    laterButton.onclick = async () => {
      await handleDonationPromptAction(stats.donationPrompt, "snooze");
      await loadProductivityInsights(root);
    };
    const donationLink = document.createElement("a");
    donationLink.href = "https://www.buymeacoffee.com/FluentTyper";
    donationLink.target = "_blank";
    donationLink.rel = "noopener noreferrer";
    donationLink.textContent = t("popup_donation_support");
    donationLink.onclick = () => {
      void handleDonationPromptAction(stats.donationPrompt, "supported");
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

function renderProductivityInsightsStatus(root, messageKey) {
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

async function loadProductivityInsights(root, retryCount = 0) {
  if (retryCount === 0) {
    renderProductivityInsightsStatus(root, "productivity_insights_loading");
  }
  const response = await sendRuntimeMessage({
    command: CMD_POPUP_GET_PRODUCTIVITY_STATS,
    context: {},
  });
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    "ok" in response
  ) {
    if (retryCount < PRODUCTIVITY_INSIGHTS_MAX_RETRIES) {
      window.setTimeout(() => {
        void loadProductivityInsights(root, retryCount + 1);
      }, PRODUCTIVITY_INSIGHTS_RETRY_DELAY_MS);
      return;
    }
    renderProductivityInsightsStatus(root, "productivity_insights_failed");
    return;
  }
  renderProductivityInsights(root, response);
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

window.addEventListener("DOMContentLoaded", function () {
  //chrome.storage.local.clear();

  // Option 1: Use the manifest:
  (() =>
    new FancierSettingsWithManifest(async function (settings) {
      new TextExpander(settings, optionsPageConfigChange);
      settings.manifest.removeDomainBtn.addEvent("action", function () {
        settings.manifest.domainBlackList.remove();
      });

      const store = new Store("settings");
      fallbackLanguageVisibility(settings, await store.get(KEY_LANGUAGE));
      let siteProfilesManager = null;

      settings.manifest.language.addEvent("action", function (value) {
        fallbackLanguageVisibility(settings, value);
        validateLanguageSettings(settings, store);
      });

      settings.manifest[KEY_ENABLED_LANGUAGES].addEvent("action", function () {
        validateLanguageSettings(settings, store);
        siteProfilesManager?.render();
      });
      validateLanguageSettings(settings, store);
      siteProfilesManager = new SiteProfilesManager(
        settings,
        optionsPageConfigChange,
      );
      setupProductivityInsights();
      settings.manifest.resetProductivityStatsButton.addEvent(
        "action",
        async function () {
          await sendRuntimeMessage({
            command: CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
            context: {},
          });
          const root = document.getElementById("productivityStatsRoot");
          if (root) {
            await loadProductivityInsights(root);
          }
        },
      );

      settings.manifest.addDomainBtn.addEvent("action", function () {
        if (settings.manifest.domain.element.element.checkValidity()) {
          const domainURL = settings.manifest.domain.get();
          const hostName = new URL(domainURL).hostname;
          if (hostName) {
            settings.manifest.domainBlackList.add(hostName);
            settings.manifest.domain.element.element.value = "";
          }
        }
      });

      // User dictionary add action
      settings.manifest.addUserWordBtn.addEvent("action", function () {
        if (settings.manifest.userDictionary.element.element.checkValidity()) {
          const word = settings.manifest.userDictionary.get();
          settings.manifest.userDictionaryList.add(word);
          settings.manifest.userDictionary.element.element.value = "";
        }
      });
      // User dictionary remove action
      settings.manifest.removeUserWordBtn.addEvent("action", function () {
        settings.manifest.userDictionaryList.remove();
      });
      settings.manifest.removeAllUserWordsBtn.addEvent("action", function () {
        settings.manifest.userDictionaryList.removeAll();
      });

      settings.manifest.exportSettingButton.addEvent("action", function () {
        chrome.storage.local.get(null, function (items) {
          // null implies all items
          // Convert object to a JSON.
          const result = JSON.stringify(items);
          const blob = new Blob([result], { type: "application/json" });
          const exportFilename = "FluentTyperSettings.json";
          const dlink = document.createElement("a");
          dlink.href = window.URL.createObjectURL(blob);
          dlink.download = exportFilename;
          dlink.onclick = function () {
            // revokeObjectURL needs a delay to work properly
            const that = this;
            setTimeout(function () {
              window.URL.revokeObjectURL(that.href);
            }, 1500);
          };

          dlink.click();
          dlink.remove();
        });
      });

      const importInputElem =
        settings.manifest.importSettingButton.element.element;
      importInputElem.type = "file";
      importInputElem.accept = ".json";
      importInputElem.addEventListener(
        "input",
        importSettingButtonFileSelected.bind(null, settings)
      );

      const importUserDictElem =
        settings.manifest.importUserDictButton.element.element;
      importUserDictElem.type = "file";
      importUserDictElem.accept = ".txt";
      importUserDictElem.addEventListener(
        "input",
        importUserDictFileSelected.bind(null, settings)
      );

      // Theme preset buttons
      settings.manifest[KEY_USE_DEFAULT_THEME_BTN].addEvent("action", function () {
        applyThemePreset(settings, 'default');
      });
      settings.manifest[KEY_USE_COMPACT_THEME_BTN].addEvent("action", function () {
        applyThemePreset(settings, 'compact');
      });

      settings.manifest[KEY_INLINE_SUGGESTION].addEvent("action", function () {
        if (settings.manifest[KEY_INLINE_SUGGESTION].get()) {
          settings.manifest[KEY_AUTOCOMPLETE_ON_TAB].set(true);
          settings.manifest[KEY_NUM_SUGGESTIONS].set(10);
        }
        siteProfilesManager?.render();
      });
      settings.manifest[KEY_NUM_SUGGESTIONS].addEvent("action", function () {
        siteProfilesManager?.render();
      });

      settings.manifest[KEY_EXTENSION_LANGUAGE].addEvent("action", function () {
        // Sync to localStorage so i18n.js can read it synchronously on next page load
        const langValue = settings.manifest[KEY_EXTENSION_LANGUAGE].get();
        const storageKey = `store.settings.${KEY_EXTENSION_LANGUAGE}`;
        localStorage.setItem(storageKey, JSON.stringify(langValue));
        optionsPageConfigChange();
        setTimeout(() => location.reload(), 100);
      });

      // Theme settings event listeners
      const themeSettings = [
        KEY_TRIBUTE_BG_LIGHT, KEY_TRIBUTE_TEXT_LIGHT, KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT,
        KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT, KEY_TRIBUTE_BORDER_LIGHT,
        KEY_TRIBUTE_BG_DARK, KEY_TRIBUTE_TEXT_DARK, KEY_TRIBUTE_HIGHLIGHT_BG_DARK,
        KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK, KEY_TRIBUTE_BORDER_DARK,
        KEY_TRIBUTE_FONT_SIZE, KEY_TRIBUTE_PADDING_VERTICAL, KEY_TRIBUTE_PADDING_HORIZONTAL
      ];

      // Theme settings are now handled through the messaging system
      // No direct theme application needed here

      // Update pressage config on change
      [
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
        KEY_APPLY_SPACING_RULES,
        KEY_SELECT_BY_DIGIT,
        KEY_VARIABLE_EXPANSION,
        KEY_TIME_FORMAT,
        KEY_DATE_FORMAT,
        KEY_REVERT_ON_BACKSPACE,
        KEY_TEXT_EXPANSIONS,
        KEY_USER_DICTIONARY_LIST,
        KEY_DISPLAY_LANG_HEADER,
        KEY_INLINE_SUGGESTION,
        KEY_EXTENSION_LANGUAGE,
        // Theme settings
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
        KEY_TRIBUTE_PADDING_HORIZONTAL
      ].forEach((element) => {
        settings.manifest[element].addEvent("action", function () {
          optionsPageConfigChange();
        });
      });
    }))();
});
