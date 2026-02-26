import {
  getDomain,
  isEnabledForDomain,
  blockUnBlockDomain,
} from "../shared/utils";
import { JsonValue, SettingsManager } from "../shared/settingsManager";
import { SUPPORTED_LANGUAGES, resolveEnabledLanguages } from "../shared/lang";
import {
  SiteProfile,
  getSiteProfileForDomain,
  removeSiteProfileForDomain,
  setSiteProfileForDomain,
} from "../shared/siteProfiles";
import {
  CMD_POPUP_PAGE_ENABLE,
  CMD_POPUP_PAGE_DISABLE,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_LANGUAGE,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
  DEFAULT_NUM_SUGGESTIONS,
  MAX_NUM_SUGGESTIONS,
} from "../shared/constants";
import {
  OptionsPageConfigChangeMessage,
  PopupPageEnableMessage,
  PopupPageDisableMessage,
  ProductivityDashboardStats,
  PopupGetProductivityStatsMessage,
  PopupAckDonationMilestoneMessage,
} from "../shared/messageTypes";
import { i18n } from "../third_party/fancier-settings/i18n.js";

const settings = new SettingsManager();
let currentDomainURL: string | undefined;
let currentEnabledLanguages: string[] = [];
let currentProfileLanguageFallback = "en_US";

function getSiteProfileElements() {
  return {
    toggle: document.getElementById(
      "checkboxSiteProfileInput",
    ) as HTMLInputElement,
    language: document.getElementById(
      "siteLanguageSelect",
    ) as HTMLSelectElement,
    suggestions: document.getElementById(
      "siteNumSuggestionsSelect",
    ) as HTMLSelectElement,
    inline: document.getElementById(
      "siteInlineModeSelect",
    ) as HTMLSelectElement,
    section: document.getElementById("siteProfileSection") as HTMLElement,
    status: document.getElementById("siteProfileStatus") as HTMLElement,
  };
}

function getDefaultSiteProfileLanguage(
  language: string,
  enabledLanguages: string[],
): string {
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

function parseSuggestionsOverride(value: string): number | undefined {
  if (value === "global") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, parsed));
}

function parseInlineOverride(value: string): boolean | undefined {
  if (value === "on") {
    return true;
  }
  if (value === "off") {
    return false;
  }
  return undefined;
}

function getOnOffLabel(value: boolean): string {
  return value ? i18n.get("site_profile_on") : i18n.get("site_profile_off");
}

function getInheritLabel(globalValueLabel: string): string {
  return `${i18n.get("site_profile_inherit_global")} (${globalValueLabel})`;
}

function resolveGlobalNumSuggestions(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_NUM_SUGGESTIONS;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(value)));
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
  const { toggle, language, suggestions, inline, section, status } =
    getSiteProfileElements();
  const domainSectionWrapper = document.getElementById(
    "domainSectionWrapper",
  ) as HTMLElement;
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
  const [siteProfilesRaw, numSuggestionsRaw, inlineSuggestionRaw] =
    await Promise.all([
      settings.get(KEY_SITE_PROFILES),
      settings.get(KEY_NUM_SUGGESTIONS),
      settings.get(KEY_INLINE_SUGGESTION),
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
  globalSuggestionOption.textContent = getInheritLabel(
    String(globalNumSuggestions),
  );
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
      typeof profile.numSuggestions === "number"
        ? String(profile.numSuggestions)
        : "global";
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
  const siteProfilesRaw = await settings.get(KEY_SITE_PROFILES);
  const nextProfiles = toggle.checked
    ? setSiteProfileForDomain(
        siteProfilesRaw,
        currentDomainURL,
        readSiteProfileFromEditor(),
        currentEnabledLanguages,
      )
    : removeSiteProfileForDomain(
        siteProfilesRaw,
        currentDomainURL,
        currentEnabledLanguages,
      );
  await settings.set(KEY_SITE_PROFILES, nextProfiles as unknown as JsonValue);
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

async function acknowledgeDonationMilestone(
  milestoneHours: number,
): Promise<void> {
  const message: PopupAckDonationMilestoneMessage = {
    command: CMD_POPUP_ACK_DONATION_MILESTONE,
    context: {
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
    return "Languages: no data yet";
  }
  const topLanguages = source.slice(0, 2).map((entry) => {
    const languageLabel = SUPPORTED_LANGUAGES[entry.language] || entry.language;
    return `${languageLabel}: ${formatNumber(entry.estimatedMinutesSaved)} min`;
  });
  const periodLabel = stats.perLanguageLast7Days.length
    ? "Last 7 days"
    : "Lifetime";
  return `${periodLabel}: ${topLanguages.join(" • ")}`;
}

function renderMilestoneHint(stats: ProductivityDashboardStats): void {
  const container = document.getElementById(
    "dashboardMilestoneHint",
  ) as HTMLElement;
  const textNode = document.getElementById(
    "dashboardMilestoneText",
  ) as HTMLElement;
  const linkNode = document.getElementById(
    "dashboardMilestoneLink",
  ) as HTMLAnchorElement;

  if (!stats.donationPrompt) {
    container.classList.add("is-hidden");
    linkNode.onclick = null;
    return;
  }
  container.classList.remove("is-hidden");
  textNode.textContent = stats.donationPrompt.message;
  linkNode.onclick = () => {
    void acknowledgeDonationMilestone(stats.donationPrompt!.milestoneHours);
  };
}

function renderDashboard(stats: ProductivityDashboardStats): void {
  (document.getElementById("metricAccepted") as HTMLElement).textContent =
    formatNumber(stats.lifetime.acceptedSuggestions);
  (document.getElementById("metricCharsSaved") as HTMLElement).textContent =
    formatNumber(stats.lifetime.charactersSaved);
  (document.getElementById("metricMinutesSaved") as HTMLElement).textContent =
    formatNumber(stats.lifetime.estimatedMinutesSaved);

  (document.getElementById("dashboardPeriodSummary") as HTMLElement).textContent =
    `Last 7 days: ${formatNumber(stats.last7Days.acceptedSuggestions)} accepted • ${formatNumber(
      stats.last7Days.charactersSaved,
    )} chars • ${formatNumber(stats.last7Days.estimatedMinutesSaved)} min`;
  (document.getElementById("dashboardLanguageSummary") as HTMLElement).textContent =
    formatLanguageSummary(stats);
  renderMilestoneHint(stats);
}

async function loadProductivityDashboard(): Promise<void> {
  const message: PopupGetProductivityStatsMessage = {
    command: CMD_POPUP_GET_PRODUCTIVITY_STATS,
    context: {},
  };
  const response = await sendRuntimeMessage<
    ProductivityDashboardStats | { ok: boolean }
  >(message);
  if (!response || "ok" in response) {
    return;
  }
  renderDashboard(response);
}

function init() {
  translateUI();
  document
    .getElementById("openStatsOptionsBtn")
    ?.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
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

  chrome.tabs.query(
    { active: true, currentWindow: true },
    async function (tabs) {
      if (tabs.length === 1) {
        const currentTab = tabs[0];
        const urlNode = document.getElementById(
          "checkboxDomainLabel",
        ) as HTMLElement;
        const checkboxNode = document.getElementById(
          "checkboxDomainInput",
        ) as HTMLInputElement;
        const checkboxEnableNode = document.getElementById(
          "checkboxEnableInput",
        ) as HTMLInputElement;
        const domainURL = getDomain(currentTab.url || "");
        currentDomainURL = domainURL;
        if (domainURL && domainURL !== "null") {
          const enabled = await isEnabledForDomain(settings, domainURL);
          checkboxNode.checked = enabled;
          urlNode.innerHTML = `<span>${i18n.get("popup_enable_autocomplete_on")}</span>`;
          urlNode
            .querySelector("span")!
            .appendChild(document.createTextNode(domainURL));
          if (typeof currentTab.id === "number") {
            window.document
              .getElementById("checkboxDomainInput")
              ?.addEventListener(
                "click",
                addRemoveDomain.bind(null, currentTab.id, domainURL),
              );
          }
        }
        checkboxEnableNode.checked = Boolean(await settings.get("enable"));
      }
      let language = (await settings.get(KEY_LANGUAGE)) as string;
      currentEnabledLanguages = resolveEnabledLanguages(
        await settings.get(KEY_ENABLED_LANGUAGES),
      );
      const select = window.document.getElementById(
        "languageSelect",
      ) as HTMLSelectElement;
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
        await settings.set(KEY_LANGUAGE, language);
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
    },
  );
  window.document
    .getElementById("checkboxEnableInput")
    ?.addEventListener("click", toggleOnOff);
  window.document
    .getElementById("languageSelect")
    ?.addEventListener("change", languageChangeEvent);
  document.getElementById("runOptions")!.onclick = function () {
    chrome.runtime.openOptionsPage();
  };
  void loadProductivityDashboard();
}

async function addRemoveDomain(tabId: number, domainURL: string) {
  const urlNode = document.getElementById("checkboxDomainLabel") as HTMLElement;
  const checkboxNode = document.getElementById(
    "checkboxDomainInput",
  ) as HTMLInputElement;
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
  urlNode
    .querySelector("span")!
    .appendChild(document.createTextNode(domainURL));
  await blockUnBlockDomain(settings, domainURL, !checkboxNode.checked);
  chrome.tabs.sendMessage(tabId, message);
}

async function languageChangeEvent() {
  const select = window.document.getElementById(
    "languageSelect",
  ) as HTMLSelectElement;

  await settings.set(KEY_LANGUAGE, select.value);
  await notifyConfigChange();
  currentProfileLanguageFallback = getDefaultSiteProfileLanguage(
    select.value,
    currentEnabledLanguages,
  );
  await loadSiteProfileEditor();
}

async function toggleOnOff() {
  const newMode = !(await settings.get("enable"));
  await settings.set("enable", newMode);
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
      chrome.tabs.sendMessage(tabs[i].id!, message);
    }
  });
}

window.document.addEventListener("DOMContentLoaded", function () {
  init();
});
