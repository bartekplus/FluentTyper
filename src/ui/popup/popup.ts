import { getDomain, isEnabledForDomain, blockUnBlockDomain } from "@core/application/domain-utils";
import { SettingsManager } from "@core/application/settingsManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { SiteProfileRepository } from "@core/application/repositories/SiteProfileRepository";
import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import type { SiteProfile } from "@core/domain/siteProfiles";
import {
  getSiteProfileForDomain,
  removeSiteProfileForDomain,
  setSiteProfileForDomain,
} from "@core/domain/siteProfiles";
import {
  parseInlineOverride,
  parseSuggestionsOverride,
  resolveGlobalNumSuggestions,
} from "@core/domain/siteProfileService";
import {
  CMD_POPUP_PAGE_ENABLE,
  CMD_POPUP_PAGE_DISABLE,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_POPUP_ACK_WEEKLY_RECAP,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  MAX_NUM_SUGGESTIONS,
} from "@core/domain/constants";
import type {
  OptionsPageConfigChangeMessage,
  PopupPageEnableMessage,
  PopupPageDisableMessage,
  ProductivityDashboardStats,
  PopupGetProductivityStatsMessage,
  PopupAckWeeklyRecapMessage,
  PopupAckDonationMilestoneMessage,
} from "@core/domain/messageTypes";
import { i18n } from "@third-party/fancier-settings/i18n.js";

const settings = new SettingsManager();
const coreSettingsRepository = new CoreSettingsRepository(settings);
const siteProfileRepository = new SiteProfileRepository(settings);
let currentDomainURL: string | undefined;
let currentEnabledLanguages: string[] = [];
let currentProfileLanguageFallback = "en_US";
let lastMarkedDonationPromptId: string | null = null;
const PRODUCTIVITY_DASHBOARD_MAX_RETRIES = 5;
const PRODUCTIVITY_DASHBOARD_RETRY_DELAY_MS = 200;
const OPTIONS_ANCHOR_ADVANCED = "advanced_tab";

function getSiteProfileElements() {
  return {
    toggle: document.getElementById("checkboxSiteProfileInput") as HTMLInputElement,
    language: document.getElementById("siteLanguageSelect") as HTMLSelectElement,
    suggestions: document.getElementById("siteNumSuggestionsSelect") as HTMLSelectElement,
    inline: document.getElementById("siteInlineModeSelect") as HTMLSelectElement,
    section: document.getElementById("siteProfileSection") as HTMLElement,
    status: document.getElementById("siteProfileStatus") as HTMLElement,
  };
}

function getDefaultSiteProfileLanguage(language: string, enabledLanguages: string[]): string {
  if (enabledLanguages.includes(language)) {
    return language;
  }
  return enabledLanguages[0];
}

function setSiteProfileInputsDisabled(disabled: boolean): void {
  const { language, suggestions, inline } = getSiteProfileElements();
  const details = document.getElementById("siteProfileDetails");
  if (disabled) {
    details?.classList.add("is-hidden");
  } else {
    details?.classList.remove("is-hidden");
  }
  language.disabled = disabled;
  suggestions.disabled = disabled;
  inline.disabled = disabled;
}

function getOnOffLabel(value: boolean): string {
  return value ? i18n.get("site_profile_on") : i18n.get("site_profile_off");
}

function getInheritLabel(globalValueLabel: string): string {
  return `${i18n.get("site_profile_inherit_global")} (${globalValueLabel})`;
}

function getProfileStatusLabel(profileEnabled: boolean): string {
  return profileEnabled
    ? i18n.get("popup_site_profile_status_active")
    : i18n.get("popup_site_profile_status_global");
}

async function notifyConfigChange() {
  const message: OptionsPageConfigChangeMessage = {
    command: CMD_OPTIONS_PAGE_CONFIG_CHANGE,
    context: {},
  };
  chrome.runtime.sendMessage(message);
}

async function loadSiteProfileEditor() {
  const { toggle, language, suggestions, inline, section, status } = getSiteProfileElements();
  const domainSectionWrapper = document.getElementById("domainSectionWrapper") as HTMLElement;
  if (!currentDomainURL) {
    if (domainSectionWrapper) {
      domainSectionWrapper.classList.add("is-hidden");
    } else {
      section.classList.add("is-hidden");
    }
    return;
  }
  if (domainSectionWrapper) {
    domainSectionWrapper.classList.remove("is-hidden");
  }
  section.classList.remove("is-hidden");
  const [siteProfilesRaw, numSuggestionsRaw, inlineSuggestionRaw] = await Promise.all([
    siteProfileRepository.getRawSiteProfiles(),
    coreSettingsRepository.getNumSuggestions(),
    coreSettingsRepository.getInlineSuggestion(),
  ]);
  const profile = getSiteProfileForDomain(
    siteProfilesRaw,
    currentDomainURL,
    currentEnabledLanguages,
  );
  const globalNumSuggestions = resolveGlobalNumSuggestions(numSuggestionsRaw);
  const globalInlineSuggestion = inlineSuggestionRaw === true;

  language.innerHTML = "";
  for (const langCode of currentEnabledLanguages) {
    const option = document.createElement("option");
    option.value = langCode;
    option.textContent = SUPPORTED_LANGUAGES[langCode];
    language.appendChild(option);
  }

  suggestions.innerHTML = "";
  const globalSuggestionOption = document.createElement("option");
  globalSuggestionOption.value = "global";
  globalSuggestionOption.textContent = getInheritLabel(String(globalNumSuggestions));
  suggestions.appendChild(globalSuggestionOption);
  for (let idx = 0; idx <= MAX_NUM_SUGGESTIONS; idx++) {
    const option = document.createElement("option");
    option.value = String(idx);
    option.textContent = String(idx);
    suggestions.appendChild(option);
  }

  inline.innerHTML = "";
  [
    {
      value: "global",
      text: getInheritLabel(getOnOffLabel(globalInlineSuggestion)),
    },
    { value: "on", text: getOnOffLabel(true) },
    { value: "off", text: getOnOffLabel(false) },
  ].forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.value;
    option.textContent = entry.text;
    inline.appendChild(option);
  });

  const fallbackLanguage = getDefaultSiteProfileLanguage(
    currentProfileLanguageFallback,
    currentEnabledLanguages,
  );
  if (profile) {
    toggle.checked = true;
    language.value = profile.language;
    suggestions.value =
      typeof profile.numSuggestions === "number" ? String(profile.numSuggestions) : "global";
    inline.value =
      typeof profile.inline_suggestion === "boolean"
        ? profile.inline_suggestion
          ? "on"
          : "off"
        : "global";
    status.textContent = getProfileStatusLabel(true);
  } else {
    toggle.checked = false;
    language.value = fallbackLanguage;
    suggestions.value = "global";
    inline.value = "global";
    status.textContent = getProfileStatusLabel(false);
  }
  setSiteProfileInputsDisabled(!toggle.checked);
}

function readSiteProfileFromEditor(): SiteProfile {
  const { language, suggestions, inline } = getSiteProfileElements();
  const languageValue = currentEnabledLanguages.includes(language.value)
    ? language.value
    : currentProfileLanguageFallback;
  const profile: SiteProfile = {
    language: languageValue,
  };
  const numSuggestions = parseSuggestionsOverride(suggestions.value);
  if (typeof numSuggestions === "number") {
    profile.numSuggestions = numSuggestions;
  }
  const inlineSuggestion = parseInlineOverride(inline.value);
  if (typeof inlineSuggestion === "boolean") {
    profile.inline_suggestion = inlineSuggestion;
  }
  return profile;
}

async function saveSiteProfileFromEditor() {
  if (!currentDomainURL) {
    return;
  }
  const { toggle, status } = getSiteProfileElements();
  const siteProfilesRaw = await siteProfileRepository.getRawSiteProfiles();
  const nextProfiles = toggle.checked
    ? setSiteProfileForDomain(
        siteProfilesRaw,
        currentDomainURL,
        readSiteProfileFromEditor(),
        currentEnabledLanguages,
      )
    : removeSiteProfileForDomain(siteProfilesRaw, currentDomainURL, currentEnabledLanguages);
  await siteProfileRepository.setSiteProfiles(nextProfiles);
  status.textContent = getProfileStatusLabel(toggle.checked);
  await notifyConfigChange();
}

function translateUI() {
  const elements = document.querySelectorAll("[data-i18n]");
  elements.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      const translated = i18n.get(key);
      if (translated) {
        el.textContent = translated;
      }
    }
  });

  const titleElements = document.querySelectorAll("[data-i18n-title]");
  titleElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) {
      const translated = i18n.get(key);
      if (translated) {
        el.setAttribute("title", translated);
      }
    }
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatWeekRange(weekKey: string): string {
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

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy copy path.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

async function sendRuntimeMessage<T>(message: object): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve((response as T) || null);
    });
  });
}

function openOptionsPageAtAnchor(anchor: string): void {
  const baseUrl = chrome.runtime.getURL("options/options.html");
  const targetUrl = `${baseUrl}#${anchor}`;
  chrome.tabs.query({ url: `${baseUrl}*` }, (tabs) => {
    const existingOptionsTab = tabs.find((tab) => typeof tab.id === "number");
    if (existingOptionsTab?.id !== undefined) {
      chrome.tabs.update(existingOptionsTab.id, {
        active: true,
        url: targetUrl,
      });
      return;
    }
    chrome.tabs.create({ url: targetUrl });
  });
}

async function acknowledgeWeeklyRecap(weekKey: string): Promise<void> {
  const message: PopupAckWeeklyRecapMessage = {
    command: CMD_POPUP_ACK_WEEKLY_RECAP,
    context: {
      weekKey,
    },
  };
  await sendRuntimeMessage(message);
}

async function handleDonationPromptAction(
  promptId: string,
  action: "shown" | "supported" | "snooze",
  milestoneHours: number | null,
): Promise<void> {
  const message: PopupAckDonationMilestoneMessage = {
    command: CMD_POPUP_ACK_DONATION_MILESTONE,
    context: {
      promptId,
      action,
      milestoneHours,
    },
  };
  await sendRuntimeMessage(message);
}

function formatLanguageSummary(stats: ProductivityDashboardStats): string {
  const source = stats.perLanguageLast7Days.length
    ? stats.perLanguageLast7Days
    : stats.perLanguageLifetime;
  if (!source.length) {
    return i18n.get("popup_dashboard_languages_empty");
  }
  const topLanguages = source.slice(0, 2).map((entry) => {
    const languageLabel = SUPPORTED_LANGUAGES[entry.language] || entry.language;
    return `${languageLabel}: ${formatNumber(entry.estimatedMinutesSaved)} ${i18n.get("popup_short_minutes")}`;
  });
  const periodLabel = stats.perLanguageLast7Days.length
    ? i18n.get("popup_short_last7")
    : i18n.get("popup_short_lifetime");
  return `${periodLabel}: ${topLanguages.join(" • ")}`;
}

function renderMilestoneProgress(stats: ProductivityDashboardStats): void {
  const fillNode = document.getElementById("dashboardProgressFill") as HTMLElement | null;
  const labelNode = document.getElementById("dashboardProgressLabel") as HTMLElement | null;
  if (!fillNode || !labelNode) {
    return;
  }
  fillNode.style.width = `${stats.milestoneProgress.progressPct}%`;
  labelNode.textContent = `${formatNumber(
    stats.milestoneProgress.lifetimeHoursSaved,
  )}h / ${stats.milestoneProgress.nextMilestoneHours}h`;
}

function renderWeeklyRecapCard(stats: ProductivityDashboardStats): void {
  const cardNode = document.getElementById("weeklyRecapCard") as HTMLElement;
  const titleNode = document.getElementById("weeklyRecapTitle") as HTMLElement;
  const summaryNode = document.getElementById("weeklyRecapSummary") as HTMLElement;
  const snippetNode = document.getElementById("weeklyRecapSnippet") as HTMLElement;
  const milestoneNode = document.getElementById("weeklyRecapMilestone") as HTMLElement;
  const equivalentNode = document.getElementById("weeklyRecapEquivalent") as HTMLElement;
  const dismissButton = document.getElementById("weeklyRecapDismissBtn") as HTMLButtonElement;
  const viewButton = document.getElementById("weeklyRecapViewBtn") as HTMLButtonElement;
  const shareButton = document.getElementById("weeklyRecapShareBtn") as HTMLButtonElement;
  const supportLink = document.getElementById("weeklyRecapSupportLink") as HTMLAnchorElement;

  if (!stats.shouldShowWeeklyRecap) {
    cardNode.classList.add("is-hidden");
    return;
  }

  cardNode.classList.remove("is-hidden");
  titleNode.textContent = `${i18n.get("popup_weekly_recap_title")} (${formatWeekRange(
    stats.weeklyRecap.weekKey,
  )})`;
  summaryNode.textContent = `${formatNumber(
    stats.weeklyRecap.acceptedSuggestions,
  )} ${i18n.get("popup_short_accepted")} • ${formatNumber(
    stats.weeklyRecap.charactersSaved,
  )} ${i18n.get("popup_short_chars")} • ${formatNumber(
    stats.weeklyRecap.estimatedMinutesSaved,
  )} ${i18n.get("popup_short_minutes")}`;
  const milestones = stats.weeklyRecap.milestonesCrossedHours || [];
  milestoneNode.textContent =
    milestones.length > 0
      ? `${i18n.get("popup_weekly_recap_milestone_label")}: ${milestones
          .map((hours) => `${formatNumber(hours)}h`)
          .join(", ")}`
      : i18n.get("popup_weekly_recap_milestone_none");
  const equivalentTaskLabel =
    stats.weeklyRecap.equivalentTasks === 1
      ? i18n.get("popup_weekly_recap_task_singular")
      : i18n.get("popup_weekly_recap_task_plural");
  equivalentNode.textContent = `${i18n.get(
    "popup_weekly_recap_equivalent_prefix",
  )} ${formatNumber(stats.weeklyRecap.equivalentTasks)} ${equivalentTaskLabel}.`;
  snippetNode.textContent = stats.weeklyRecap.topSnippet
    ? `${i18n.get("popup_weekly_recap_top_snippet")}: ${stats.weeklyRecap.topSnippet.snippet} (${stats.weeklyRecap.topSnippet.count}x)`
    : i18n.get("popup_weekly_recap_top_snippet_empty");

  const recapShareText = `${i18n.get("popup_weekly_recap_title")} (${formatWeekRange(
    stats.weeklyRecap.weekKey,
  )}): ${formatNumber(stats.weeklyRecap.acceptedSuggestions)} ${i18n.get(
    "popup_short_accepted",
  )}, ${formatNumber(stats.weeklyRecap.charactersSaved)} ${i18n.get(
    "popup_short_chars",
  )}, ${formatNumber(stats.weeklyRecap.estimatedMinutesSaved)} ${i18n.get("popup_short_minutes")}.`;

  dismissButton.onclick = () => {
    void acknowledgeWeeklyRecap(stats.weeklyRecap.weekKey);
    cardNode.classList.add("is-hidden");
  };
  shareButton.onclick = () => {
    void copyTextToClipboard(recapShareText);
    void acknowledgeWeeklyRecap(stats.weeklyRecap.weekKey);
    cardNode.classList.add("is-hidden");
  };
  supportLink.onclick = () => {
    void acknowledgeWeeklyRecap(stats.weeklyRecap.weekKey);
    cardNode.classList.add("is-hidden");
  };
  viewButton.onclick = () => {
    void acknowledgeWeeklyRecap(stats.weeklyRecap.weekKey);
    openOptionsPageAtAnchor(OPTIONS_ANCHOR_ADVANCED);
    cardNode.classList.add("is-hidden");
  };
}

function renderMilestoneHint(stats: ProductivityDashboardStats): void {
  const container = document.getElementById("dashboardMilestoneHint") as HTMLElement;
  const textNode = document.getElementById("dashboardMilestoneText") as HTMLElement;
  const linkNode = document.getElementById("dashboardMilestoneLink") as HTMLAnchorElement;
  const laterButton = document.getElementById("dashboardMilestoneLaterBtn") as HTMLButtonElement;

  if (!stats.donationPrompt) {
    container.classList.add("is-hidden");
    linkNode.onclick = null;
    laterButton.onclick = null;
    lastMarkedDonationPromptId = null;
    return;
  }
  const donationPrompt = stats.donationPrompt;

  if (lastMarkedDonationPromptId !== donationPrompt.promptId) {
    lastMarkedDonationPromptId = donationPrompt.promptId;
    void handleDonationPromptAction(
      donationPrompt.promptId,
      "shown",
      donationPrompt.milestoneHours,
    );
  }

  container.classList.remove("is-hidden");
  textNode.textContent = donationPrompt.message;
  linkNode.onclick = () => {
    void handleDonationPromptAction(
      donationPrompt.promptId,
      "supported",
      donationPrompt.milestoneHours,
    );
  };
  laterButton.onclick = () => {
    void handleDonationPromptAction(
      donationPrompt.promptId,
      "snooze",
      donationPrompt.milestoneHours,
    );
    container.classList.add("is-hidden");
  };
}

function renderDashboard(stats: ProductivityDashboardStats): void {
  (document.getElementById("metricAccepted") as HTMLElement).textContent = formatNumber(
    stats.lifetime.acceptedSuggestions,
  );
  (document.getElementById("metricCharsSaved") as HTMLElement).textContent = formatNumber(
    stats.lifetime.charactersSaved,
  );
  (document.getElementById("metricMinutesSaved") as HTMLElement).textContent = formatNumber(
    stats.lifetime.estimatedMinutesSaved,
  );

  (document.getElementById("dashboardPeriodSummary") as HTMLElement).textContent =
    `${i18n.get("popup_short_last7")}: ${formatNumber(
      stats.last7Days.acceptedSuggestions,
    )} ${i18n.get("popup_short_accepted")} • ${formatNumber(
      stats.last7Days.charactersSaved,
    )} ${i18n.get("popup_short_chars")} • ${formatNumber(
      stats.last7Days.estimatedMinutesSaved,
    )} ${i18n.get("popup_short_minutes")}`;
  (document.getElementById("dashboardLanguageSummary") as HTMLElement).textContent =
    formatLanguageSummary(stats);
  renderMilestoneProgress(stats);
  renderWeeklyRecapCard(stats);
  renderMilestoneHint(stats);
}

async function loadProductivityDashboard(retryCount = 0): Promise<void> {
  const message: PopupGetProductivityStatsMessage = {
    command: CMD_POPUP_GET_PRODUCTIVITY_STATS,
    context: {},
  };
  const response = await sendRuntimeMessage<ProductivityDashboardStats | { ok: boolean }>(message);
  if (!response || "ok" in response) {
    if (retryCount < PRODUCTIVITY_DASHBOARD_MAX_RETRIES) {
      window.setTimeout(() => {
        void loadProductivityDashboard(retryCount + 1);
      }, PRODUCTIVITY_DASHBOARD_RETRY_DELAY_MS);
    }
    return;
  }
  renderDashboard(response);
}

function init() {
  translateUI();
  document.getElementById("openStatsOptionsBtn")?.addEventListener("click", () => {
    openOptionsPageAtAnchor(OPTIONS_ANCHOR_ADVANCED);
  });
  window.document
    .getElementById("checkboxSiteProfileInput")
    ?.addEventListener("click", async () => {
      const { toggle } = getSiteProfileElements();
      setSiteProfileInputsDisabled(!toggle.checked);
      await saveSiteProfileFromEditor();
    });
  ["siteLanguageSelect", "siteNumSuggestionsSelect", "siteInlineModeSelect"]
    .map((id) => document.getElementById(id))
    .forEach((element) => {
      element?.addEventListener("change", async () => {
        const { toggle } = getSiteProfileElements();
        if (!toggle.checked) {
          return;
        }
        await saveSiteProfileFromEditor();
      });
    });

  chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
    if (tabs.length === 1) {
      const currentTab = tabs[0];
      const urlNode = document.getElementById("checkboxDomainLabel") as HTMLElement;
      const checkboxNode = document.getElementById("checkboxDomainInput") as HTMLInputElement;
      const checkboxEnableNode = document.getElementById("checkboxEnableInput") as HTMLInputElement;
      const domainURL = getDomain(currentTab.url || "");
      currentDomainURL = domainURL;
      if (domainURL && domainURL !== "null") {
        const enabled = await isEnabledForDomain(settings, domainURL);
        checkboxNode.checked = enabled;
        urlNode.innerHTML = `<span>${i18n.get("popup_enable_autocomplete_on")}</span>`;
        const labelSpan = urlNode.querySelector("span");
        if (labelSpan) {
          labelSpan.appendChild(document.createTextNode(domainURL));
        }
        if (typeof currentTab.id === "number") {
          window.document
            .getElementById("checkboxDomainInput")
            ?.addEventListener("click", addRemoveDomain.bind(null, currentTab.id, domainURL));
        }
      }
      checkboxEnableNode.checked = await coreSettingsRepository.isEnabled();
    }
    let language = await coreSettingsRepository.getLanguage();
    currentEnabledLanguages = await coreSettingsRepository.getEnabledLanguages();
    const select = window.document.getElementById("languageSelect") as HTMLSelectElement;
    const allowAutoDetect = currentEnabledLanguages.length > 1;
    const isAutoDetect = language === "auto_detect";
    const isValidLanguage = currentEnabledLanguages.includes(language);
    const displayLanguage =
      isAutoDetect && allowAutoDetect
        ? "auto_detect"
        : isValidLanguage
          ? language
          : currentEnabledLanguages[0];

    if (!isValidLanguage && !(isAutoDetect && allowAutoDetect)) {
      language = displayLanguage;
      await coreSettingsRepository.setLanguage(language);
      chrome.runtime.sendMessage({
        command: CMD_OPTIONS_PAGE_CONFIG_CHANGE,
        context: {},
      });
    }
    if (allowAutoDetect) {
      const opt = window.document.createElement("option");
      opt.value = "auto_detect";
      opt.textContent = SUPPORTED_LANGUAGES.auto_detect;
      select.appendChild(opt);
    }
    for (const langCode of currentEnabledLanguages) {
      const opt = window.document.createElement("option");
      opt.value = langCode;
      opt.textContent = SUPPORTED_LANGUAGES[langCode];
      select.appendChild(opt);
    }
    select.value = displayLanguage;
    currentProfileLanguageFallback = getDefaultSiteProfileLanguage(
      displayLanguage,
      currentEnabledLanguages,
    );
    await loadSiteProfileEditor();
  });
  window.document.getElementById("checkboxEnableInput")?.addEventListener("click", toggleOnOff);
  window.document.getElementById("languageSelect")?.addEventListener("change", languageChangeEvent);
  document.getElementById("runOptions")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  const browserAPI = (window as Window & { browser?: typeof chrome }).browser || chrome;
  if (browserAPI && browserAPI.permissions) {
    const permissionBanner = document.getElementById("permissionBanner");
    const grantBtn = document.getElementById("grantPermissionBtn");
    if (permissionBanner && grantBtn) {
      const checkPerms = async () => {
        try {
          const contains = await browserAPI.permissions.contains({ origins: ["<all_urls>"] });
          if (!contains) {
            permissionBanner.classList.remove("is-hidden");
          } else {
            permissionBanner.classList.add("is-hidden");
          }
        } catch (e) {
          console.error("Error checking permissions in popup:", e);
        }
      };
      void checkPerms();
      grantBtn.addEventListener("click", async () => {
        try {
          const granted = await browserAPI.permissions.request({ origins: ["<all_urls>"] });
          if (granted) {
            permissionBanner.classList.add("is-hidden");
          }
        } catch (e) {
          console.error("Error requesting permissions in popup:", e);
        }
      });
    }
  }

  void loadProductivityDashboard();
}

async function addRemoveDomain(tabId: number, domainURL: string) {
  const urlNode = document.getElementById("checkboxDomainLabel") as HTMLElement;
  const checkboxNode = document.getElementById("checkboxDomainInput") as HTMLInputElement;
  let message: PopupPageEnableMessage | PopupPageDisableMessage;
  if (checkboxNode.checked) {
    message = {
      command: CMD_POPUP_PAGE_ENABLE,
      context: {},
    };
  } else {
    message = {
      command: CMD_POPUP_PAGE_DISABLE,
      context: {},
    };
  }
  urlNode.innerHTML = `<span>${i18n.get("popup_enable_autocomplete_on")}</span>`;
  const labelSpan = urlNode.querySelector("span");
  if (labelSpan) {
    labelSpan.appendChild(document.createTextNode(domainURL));
  }
  await blockUnBlockDomain(settings, domainURL, !checkboxNode.checked);
  chrome.tabs.sendMessage(tabId, message);
}

async function languageChangeEvent() {
  const select = window.document.getElementById("languageSelect") as HTMLSelectElement;

  await coreSettingsRepository.setLanguage(select.value);
  await notifyConfigChange();
  currentProfileLanguageFallback = getDefaultSiteProfileLanguage(
    select.value,
    currentEnabledLanguages,
  );
  await loadSiteProfileEditor();
}

async function toggleOnOff() {
  const newMode = !(await coreSettingsRepository.isEnabled());
  await coreSettingsRepository.setEnabled(newMode);
  chrome.tabs.query({}, function (tabs) {
    for (let i = 0; i < tabs.length; i++) {
      let message: PopupPageEnableMessage | PopupPageDisableMessage;
      if (newMode) {
        message = {
          command: CMD_POPUP_PAGE_ENABLE,
          context: {},
        };
      } else {
        message = {
          command: CMD_POPUP_PAGE_DISABLE,
          context: {},
        };
      }
      const tabId = tabs[i].id;
      if (typeof tabId === "number") {
        chrome.tabs.sendMessage(tabId, message);
      }
    }
  });
}

window.document.addEventListener("DOMContentLoaded", function () {
  init();
});
