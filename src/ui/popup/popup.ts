import {
  getDomain,
  isDomainAllowedByPreference,
  blockUnBlockDomain,
} from "@core/application/domain-utils";
import { SettingsManager } from "@core/application/settingsManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { SiteProfileRepository } from "@core/application/repositories/SiteProfileRepository";
import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import {
  getSiteProfileForDomain,
  removeSiteProfileForDomain,
  setSiteProfileForDomain,
  type SiteProfile,
} from "@core/domain/siteProfiles";
import {
  parseBooleanOverride,
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
  CMD_GET_AUTO_LANGUAGE_STATUS,
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
import { formatTranslation, i18n } from "@ui/options/fluenttyperI18n.js";
import { formatMetricNumber as formatNumber, formatWeekRange } from "@ui/shared/formatMetrics.js";
import {
  type WebsiteAccessPermissionState,
  WebsiteAccessPermissionController,
  WebsiteAccessPermissionService,
} from "@ui/shared/websiteAccessPermission";

const settings = new SettingsManager();
const coreSettingsRepository = new CoreSettingsRepository(settings);
const siteProfileRepository = new SiteProfileRepository(settings);
let currentDomainURL: string | undefined;
let currentTabId: number | null = null;
let currentEnabledLanguages: string[] = [];
let currentProfileLanguageFallback = "en_US";

// Literal i18n keys (badge, title, body) so they stay greppable. Must precede currentPageState init (TDZ).
const STATIC_PAGE_STATE_KEYS = {
  no_page: [
    "popup_page_state_no_page_badge",
    "popup_page_state_no_page_title",
    "popup_page_state_no_page_body",
  ],
  restricted: [
    "popup_page_state_restricted_badge",
    "popup_page_state_restricted_title",
    "popup_page_state_restricted_body",
  ],
  extension: [
    "popup_page_state_extension_badge",
    "popup_page_state_extension_title",
    "popup_page_state_extension_body",
  ],
  file: [
    "popup_page_state_file_badge",
    "popup_page_state_file_title",
    "popup_page_state_file_body",
  ],
  other: [
    "popup_page_state_other_badge",
    "popup_page_state_other_title",
    "popup_page_state_other_body",
  ],
} as const;

let currentPageState: PopupPageState = getCurrentPageState(undefined);
let lastMarkedDonationPromptId: string | null = null;
const PRODUCTIVITY_DASHBOARD_RETRY_DELAYS_MS = [150, 300, 600, 1200, 2400] as const;
let productivityDashboardRetryTimerId: number | null = null;
let productivityDashboardLoadCancelled = false;
let productivityDashboardLoadCompleted = false;
let currentWebsiteAccessPermissionState: WebsiteAccessPermissionState | null = null;
const OPTIONS_ANCHOR_ADVANCED = "advanced_tab";
const POPUP_THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

type PopupPageState =
  | { kind: "actionable" }
  | {
      kind: "restricted" | "non_actionable";
      badge: string;
      title: string;
      body: string;
    };

function getPageStateElements() {
  return {
    badge: document.getElementById("pageStateBadge"),
    title: document.getElementById("pageStateTitle"),
    body: document.getElementById("pageStateBody"),
    language: document.getElementById("pageStateLanguage"),
    hint: document.getElementById("checkboxDomainHint"),
    meta: document.getElementById("pageStateMeta"),
    panel: document.getElementById("pageStatePanel"),
    profile: document.getElementById("pageStateProfile"),
    section: document.getElementById("domainSectionWrapper"),
  };
}

type PageStateElements = ReturnType<typeof getPageStateElements>;

function setNodeTextAndTitle(node: HTMLElement | null, value: string): void {
  if (!node) {
    return;
  }
  node.textContent = value;
  if (value.length > 0) {
    node.title = value;
  } else {
    node.removeAttribute("title");
  }
}

function clearPageStateSupplementalContent(elements: PageStateElements): void {
  setNodeTextAndTitle(elements.language, "");
  setNodeTextAndTitle(elements.profile, "");
  elements.meta?.classList.add("is-hidden");
  setNodeTextAndTitle(elements.hint, "");
}

function renderNonActionablePageState(
  state: Pick<Extract<PopupPageState, { kind: "restricted" | "non_actionable" }>, "badge" | "body">,
  titleText: string,
  panelState: "restricted" | "non_actionable" | "paused",
  showDomainSection: boolean,
  clearDomainToggle = false,
): void {
  const elements = getPageStateElements();
  const { badge, title, body, panel, section } = elements;
  if (!badge || !title || !body) {
    return;
  }

  badge.textContent = state.badge;
  setNodeTextAndTitle(title, titleText);
  body.textContent = state.body;
  clearPageStateSupplementalContent(elements);
  panel?.setAttribute("data-page-state", panelState);
  setSiteSpecificControlsEnabled(false);
  if (clearDomainToggle) {
    const domainToggle = document.getElementById("checkboxDomainInput") as HTMLInputElement | null;
    if (domainToggle) {
      domainToggle.checked = false;
    }
  }
  section?.classList.toggle("is-hidden", !showDomainSection);
}

const SITE_SPECIFIC_CONTROL_IDS = [
  "checkboxDomainInput",
  "checkboxSiteProfileInput",
  "siteLanguageSelect",
  "siteNumSuggestionsSelect",
  "siteInlineModeSelect",
  "sitePreferNativeAutocompleteSelect",
];

function setSiteSpecificControlsEnabled(enabled: boolean): void {
  for (const id of SITE_SPECIFIC_CONTROL_IDS) {
    const control = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (control) {
      control.disabled = !enabled;
    }
  }
}

function staticPageState(
  kind: "restricted" | "non_actionable",
  key: keyof typeof STATIC_PAGE_STATE_KEYS,
): Extract<PopupPageState, { kind: "restricted" | "non_actionable" }> {
  const [badge, title, body] = STATIC_PAGE_STATE_KEYS[key];
  return { kind, badge: i18n.get(badge), title: i18n.get(title), body: i18n.get(body) };
}

function getCurrentPageState(url?: string): PopupPageState {
  if (!url) {
    return staticPageState("non_actionable", "no_page");
  }

  const normalizedUrl = url.toLowerCase();
  const restrictedPrefixes = [
    "chrome://",
    "edge://",
    "brave://",
    "opera://",
    "about:",
    "devtools://",
    "view-source:",
  ];
  if (restrictedPrefixes.some((prefix) => normalizedUrl.startsWith(prefix))) {
    return staticPageState("restricted", "restricted");
  }
  if (
    normalizedUrl.startsWith("chrome-extension://") ||
    normalizedUrl.startsWith("moz-extension://")
  ) {
    return staticPageState("non_actionable", "extension");
  }
  if (normalizedUrl.startsWith("file://")) {
    return staticPageState("non_actionable", "file");
  }
  if (normalizedUrl.startsWith("http://") || normalizedUrl.startsWith("https://")) {
    return { kind: "actionable" };
  }
  return staticPageState("non_actionable", "other");
}

function resolveDisplayedLanguage(): string {
  const languageSelect = document.getElementById("languageSelect") as HTMLSelectElement | null;
  const selectedLanguage = languageSelect?.value;
  if (selectedLanguage && selectedLanguage in SUPPORTED_LANGUAGES) {
    return selectedLanguage;
  }
  return currentProfileLanguageFallback;
}

async function getActiveAutoLanguageStatus(): Promise<{
  language: string;
  locked: boolean;
} | null> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      command: CMD_GET_AUTO_LANGUAGE_STATUS,
      context: {
        tabId: currentTabId ?? undefined,
        domainURL: currentDomainURL,
      },
    });
    const status = (response as { status?: { language?: string; locked?: boolean } | null })
      ?.status;
    if (!status || typeof status.language !== "string" || status.language.length === 0) {
      return null;
    }
    return {
      language: status.language,
      locked: status.locked === true,
    };
  } catch {
    return null;
  }
}

function renderStaticPageState(
  state: Extract<PopupPageState, { kind: "restricted" | "non_actionable" }>,
): void {
  const siteProfileSection = document.getElementById("siteProfileSection");
  renderNonActionablePageState(
    state,
    state.title,
    state.kind,
    state.kind === "restricted",
    state.kind === "restricted",
  );
  siteProfileSection?.classList.add("is-hidden");
}

function renderPermissionBlockedPageState(state: WebsiteAccessPermissionState): void {
  if (!currentDomainURL) {
    return;
  }

  const permissionBlockedState =
    state === "missing"
      ? {
          badge: i18n.get("permission_status_missing_badge"),
          body: i18n.get("popup_page_state_permission_missing_body"),
          kind: "paused" as const,
        }
      : {
          badge: i18n.get("permission_status_unavailable_badge"),
          body: i18n.get("popup_page_state_permission_unavailable_body"),
          kind: "non_actionable" as const,
        };
  renderNonActionablePageState(
    permissionBlockedState,
    currentDomainURL,
    permissionBlockedState.kind,
    false,
  );
}

function applyPopupThemeMode(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.body?.setAttribute("data-theme", theme);
}

function syncPopupThemeWithSystem(): void {
  if (typeof window.matchMedia !== "function") {
    applyPopupThemeMode("light");
    return;
  }

  const colorSchemeQuery = window.matchMedia(POPUP_THEME_MEDIA_QUERY);
  const applyCurrentTheme = () => {
    applyPopupThemeMode(colorSchemeQuery.matches ? "dark" : "light");
  };

  applyCurrentTheme();
  colorSchemeQuery.addEventListener("change", applyCurrentTheme);
}

async function renderActionablePageState(): Promise<void> {
  if (!currentDomainURL) {
    renderStaticPageState(staticPageState("non_actionable", "no_page"));
    return;
  }

  const [globallyEnabled, siteAllowed, siteProfilesRaw] = await Promise.all([
    coreSettingsRepository.isEnabled(),
    isDomainAllowedByPreference(settings, currentDomainURL),
    siteProfileRepository.getRawSiteProfiles(),
  ]);
  const profile = getSiteProfileForDomain(
    siteProfilesRaw,
    currentDomainURL,
    currentEnabledLanguages,
  );
  const configuredLanguage = profile?.language || resolveDisplayedLanguage();
  const autoLanguageStatus =
    configuredLanguage === "auto_detect" ? await getActiveAutoLanguageStatus() : null;
  const fallbackLanguageCode = getDefaultSiteProfileLanguage(
    currentProfileLanguageFallback,
    currentEnabledLanguages,
  );
  const fallbackLanguageLabel = SUPPORTED_LANGUAGES[fallbackLanguageCode] || fallbackLanguageCode;
  const languageCode = autoLanguageStatus?.language || configuredLanguage;
  const languageLabel = SUPPORTED_LANGUAGES[languageCode] || languageCode;
  const badgeLabel = globallyEnabled
    ? siteAllowed
      ? i18n.get("popup_page_state_active_badge")
      : i18n.get("popup_page_state_site_disabled_badge")
    : i18n.get("popup_page_state_global_disabled_badge");
  const activityCopy = globallyEnabled
    ? siteAllowed
      ? i18n.get("popup_page_state_active_body")
      : i18n.get("popup_page_state_site_disabled_body")
    : i18n.get("popup_page_state_global_disabled_body");
  const autoDetectReasonCopy =
    configuredLanguage === "auto_detect" && globallyEnabled && siteAllowed
      ? autoLanguageStatus?.locked
        ? i18n.get("popup_auto_detect_reason_locked")
        : autoLanguageStatus?.language
          ? i18n.get("popup_auto_detect_reason_active")
          : formatTranslation("popup_auto_detect_reason_waiting", {
              language: fallbackLanguageLabel,
            })
      : "";
  const profileCopy = profile
    ? i18n.get("popup_page_state_profile_active")
    : i18n.get("popup_page_state_profile_global");
  const {
    badge,
    body,
    language,
    meta,
    panel,
    profile: profileNode,
    section,
    title,
    hint,
  } = getPageStateElements();
  if (!badge || !title || !body || !language || !meta || !profileNode) {
    return;
  }
  badge.textContent = badgeLabel;
  setNodeTextAndTitle(title, currentDomainURL);
  body.textContent = autoDetectReasonCopy
    ? `${activityCopy} ${autoDetectReasonCopy}`
    : activityCopy;
  if (configuredLanguage === "auto_detect" && autoLanguageStatus?.language) {
    const liveLabel = formatTranslation("language_panel_auto_detect_current", {
      language: languageLabel,
    });
    setNodeTextAndTitle(language, liveLabel);
  } else {
    setNodeTextAndTitle(language, languageLabel);
  }
  setNodeTextAndTitle(profileNode, profileCopy);
  meta.classList.remove("is-hidden");
  panel?.setAttribute("data-page-state", globallyEnabled && siteAllowed ? "active" : "paused");
  section?.classList.remove("is-hidden");
  setSiteSpecificControlsEnabled(true);
  setNodeTextAndTitle(hint, currentDomainURL);
}

async function refreshThisSiteSection(): Promise<void> {
  if (currentPageState.kind === "actionable") {
    if (
      currentWebsiteAccessPermissionState === "missing" ||
      currentWebsiteAccessPermissionState === "unavailable"
    ) {
      renderPermissionBlockedPageState(currentWebsiteAccessPermissionState);
      return;
    }
    await renderActionablePageState();
    return;
  }
  renderStaticPageState(currentPageState);
}

function getSiteProfileElements() {
  return {
    toggle: document.getElementById("checkboxSiteProfileInput") as HTMLInputElement | null,
    language: document.getElementById("siteLanguageSelect") as HTMLSelectElement | null,
    suggestions: document.getElementById("siteNumSuggestionsSelect") as HTMLSelectElement | null,
    inline: document.getElementById("siteInlineModeSelect") as HTMLSelectElement | null,
    preferNativeAutocomplete: document.getElementById(
      "sitePreferNativeAutocompleteSelect",
    ) as HTMLSelectElement | null,
    section: document.getElementById("siteProfileSection"),
    status: document.getElementById("siteProfileStatus"),
  };
}

function getDefaultSiteProfileLanguage(language: string, enabledLanguages: string[]): string {
  if (enabledLanguages.includes(language)) {
    return language;
  }
  return enabledLanguages[0];
}

function setSiteProfileInputsDisabled(disabled: boolean): void {
  const { language, suggestions, inline, preferNativeAutocomplete } = getSiteProfileElements();
  document.getElementById("siteProfileDetails")?.classList.toggle("is-hidden", disabled);
  for (const select of [language, suggestions, inline, preferNativeAutocomplete]) {
    if (select) {
      select.disabled = disabled;
    }
  }
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

function toOverrideValue(value: boolean | undefined): string {
  return typeof value === "boolean" ? (value ? "on" : "off") : "global";
}

function createSelectOption(value: string, text: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

function populateLanguageOptions(select: HTMLSelectElement, languages: string[]): void {
  select.replaceChildren();
  for (const langCode of languages) {
    select.appendChild(createSelectOption(langCode, SUPPORTED_LANGUAGES[langCode] || langCode));
  }
}

function populateSuggestionOptions(select: HTMLSelectElement, globalNumSuggestions: number): void {
  select.replaceChildren(
    createSelectOption("global", getInheritLabel(String(globalNumSuggestions))),
  );
  for (let idx = 0; idx <= MAX_NUM_SUGGESTIONS; idx += 1) {
    select.appendChild(createSelectOption(String(idx), String(idx)));
  }
}

function notifyConfigChange(): Promise<unknown> {
  const message: OptionsPageConfigChangeMessage = {
    command: CMD_OPTIONS_PAGE_CONFIG_CHANGE,
    context: {},
  };
  return chrome.runtime.sendMessage(message);
}

async function loadSiteProfileEditor() {
  const { toggle, language, suggestions, inline, preferNativeAutocomplete, section, status } =
    getSiteProfileElements();
  if (
    !currentDomainURL ||
    currentPageState.kind !== "actionable" ||
    currentWebsiteAccessPermissionState !== "granted"
  ) {
    section?.classList.add("is-hidden");
    return;
  }
  section?.classList.remove("is-hidden");
  const [siteProfilesRaw, numSuggestionsRaw, inlineSuggestionRaw, preferNativeAutocompleteRaw] =
    await Promise.all([
      siteProfileRepository.getRawSiteProfiles(),
      coreSettingsRepository.getNumSuggestions(),
      coreSettingsRepository.getInlineSuggestion(),
      coreSettingsRepository.getPreferNativeAutocomplete(),
    ]);
  const profile = getSiteProfileForDomain(
    siteProfilesRaw,
    currentDomainURL,
    currentEnabledLanguages,
  );
  const globalNumSuggestions = resolveGlobalNumSuggestions(numSuggestionsRaw);
  const globalInlineSuggestion = inlineSuggestionRaw === true;
  const globalPreferNativeAutocomplete = preferNativeAutocompleteRaw !== false;

  if (!toggle || !language || !suggestions || !inline || !preferNativeAutocomplete || !status) {
    return;
  }

  populateLanguageOptions(language, currentEnabledLanguages);
  populateSuggestionOptions(suggestions, globalNumSuggestions);

  populateBooleanOverrideOptions(inline, globalInlineSuggestion, getOnOffLabel);
  populateBooleanOverrideOptions(
    preferNativeAutocomplete,
    globalPreferNativeAutocomplete,
    (value) =>
      value
        ? i18n.get("prefer_native_autocomplete_on")
        : i18n.get("prefer_native_autocomplete_off"),
  );

  const fallbackLanguage = getDefaultSiteProfileLanguage(
    currentProfileLanguageFallback,
    currentEnabledLanguages,
  );
  if (profile) {
    toggle.checked = true;
    language.value = profile.language;
    suggestions.value =
      typeof profile.numSuggestions === "number" ? String(profile.numSuggestions) : "global";
    inline.value = toOverrideValue(profile.inline_suggestion);
    preferNativeAutocomplete.value = toOverrideValue(profile.preferNativeAutocomplete);
    status.textContent = getProfileStatusLabel(true);
  } else {
    toggle.checked = false;
    language.value = fallbackLanguage;
    suggestions.value = "global";
    inline.value = "global";
    preferNativeAutocomplete.value = "global";
    status.textContent = getProfileStatusLabel(false);
  }
  setSiteProfileInputsDisabled(!toggle.checked);
}

function readSiteProfileFromEditor(): SiteProfile {
  const { language, suggestions, inline, preferNativeAutocomplete } = getSiteProfileElements();
  const languageValue =
    language && currentEnabledLanguages.includes(language.value)
      ? language.value
      : currentProfileLanguageFallback;
  const profile: SiteProfile = {
    language: languageValue,
  };
  const numSuggestions = suggestions ? parseSuggestionsOverride(suggestions.value) : undefined;
  if (typeof numSuggestions === "number") {
    profile.numSuggestions = numSuggestions;
  }
  const inlineSuggestion = inline ? parseBooleanOverride(inline.value) : undefined;
  if (typeof inlineSuggestion === "boolean") {
    profile.inline_suggestion = inlineSuggestion;
  }
  const preferNativeAutocompleteOverride = preferNativeAutocomplete
    ? parseBooleanOverride(preferNativeAutocomplete.value)
    : undefined;
  if (typeof preferNativeAutocompleteOverride === "boolean") {
    profile.preferNativeAutocomplete = preferNativeAutocompleteOverride;
  }
  return profile;
}

function populateBooleanOverrideOptions(
  select: HTMLSelectElement,
  globalValue: boolean,
  describeValue: (value: boolean) => string,
): void {
  select.replaceChildren(
    createSelectOption("global", getInheritLabel(describeValue(globalValue))),
    createSelectOption("on", describeValue(true)),
    createSelectOption("off", describeValue(false)),
  );
}

async function saveSiteProfileFromEditor() {
  if (!currentDomainURL || currentPageState.kind !== "actionable") {
    return;
  }
  const { toggle, status } = getSiteProfileElements();
  if (!toggle || !status) {
    return;
  }
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
  await refreshThisSiteSection();
}

function translateUI() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const translated = i18n.get(el.getAttribute("data-i18n") ?? "");
    if (translated) {
      el.textContent = translated;
    }
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const translated = i18n.get(el.getAttribute("data-i18n-title") ?? "");
    if (translated) {
      el.setAttribute("title", translated);
    }
  });
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
      void chrome.tabs.update(existingOptionsTab.id, {
        active: true,
        url: targetUrl,
      });
      return;
    }
    void chrome.tabs.create({ url: targetUrl });
  });
}

function initializeFooterLinks(): void {
  const optionsLink = document.getElementById("runOptions") as HTMLAnchorElement | null;
  if (!optionsLink) {
    return;
  }
  optionsLink.href = chrome.runtime.getURL("options/options.html");
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
  const fillNode = document.getElementById("dashboardProgressFill");
  const labelNode = document.getElementById("dashboardProgressLabel");
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

  const dismiss = () => {
    void acknowledgeWeeklyRecap(stats.weeklyRecap.weekKey);
    cardNode.classList.add("is-hidden");
  };
  dismissButton.onclick = dismiss;
  supportLink.onclick = dismiss;
  shareButton.onclick = () => {
    void copyTextToClipboard(recapShareText);
    dismiss();
  };
  viewButton.onclick = () => {
    dismiss();
    openOptionsPageAtAnchor(OPTIONS_ANCHOR_ADVANCED);
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

  const periodSummary = `${i18n.get("popup_short_last7")}: ${formatNumber(
    stats.last7Days.acceptedSuggestions,
  )} ${i18n.get("popup_short_accepted")} • ${formatNumber(
    stats.last7Days.charactersSaved,
  )} ${i18n.get("popup_short_chars")} • ${formatNumber(
    stats.last7Days.estimatedMinutesSaved,
  )} ${i18n.get("popup_short_minutes")}`;

  (document.getElementById("dashboardPeriodSummary") as HTMLElement).textContent = periodSummary;
  (document.getElementById("dashboardLanguageSummary") as HTMLElement).textContent =
    formatLanguageSummary(stats);
  renderMilestoneProgress(stats);
  renderWeeklyRecapCard(stats);
  renderMilestoneHint(stats);
}

function clearProductivityDashboardRetryTimer(): void {
  if (productivityDashboardRetryTimerId !== null) {
    window.clearTimeout(productivityDashboardRetryTimerId);
    productivityDashboardRetryTimerId = null;
  }
}

function renderDashboardUnavailable(): void {
  (document.getElementById("metricAccepted") as HTMLElement).textContent = "--";
  (document.getElementById("metricCharsSaved") as HTMLElement).textContent = "--";
  (document.getElementById("metricMinutesSaved") as HTMLElement).textContent = "--";
  (document.getElementById("dashboardProgressFill") as HTMLElement).style.width = "0%";
  (document.getElementById("dashboardProgressLabel") as HTMLElement).textContent = "--";
  const unavailableLabel = i18n.get("popup_dashboard_stats_unavailable");
  (document.getElementById("dashboardPeriodSummary") as HTMLElement).textContent = unavailableLabel;
  (document.getElementById("dashboardLanguageSummary") as HTMLElement).textContent =
    unavailableLabel;
  document.getElementById("weeklyRecapCard")?.classList.add("is-hidden");
  document.getElementById("dashboardMilestoneHint")?.classList.add("is-hidden");
}

function cleanupProductivityDashboardLoader(): void {
  productivityDashboardLoadCancelled = true;
  clearProductivityDashboardRetryTimer();
}

async function loadProductivityDashboard(retryAttempt = 0): Promise<void> {
  if (productivityDashboardLoadCancelled || productivityDashboardLoadCompleted) {
    return;
  }
  const message: PopupGetProductivityStatsMessage = {
    command: CMD_POPUP_GET_PRODUCTIVITY_STATS,
    context: {},
  };
  const response = await sendRuntimeMessage<ProductivityDashboardStats | { ok: boolean }>(message);
  if (productivityDashboardLoadCancelled || productivityDashboardLoadCompleted) {
    return;
  }

  if (response && !("ok" in response)) {
    productivityDashboardLoadCompleted = true;
    clearProductivityDashboardRetryTimer();
    renderDashboard(response);
    return;
  }

  const retryDelayMs = PRODUCTIVITY_DASHBOARD_RETRY_DELAYS_MS[retryAttempt];
  if (typeof retryDelayMs === "number") {
    clearProductivityDashboardRetryTimer();
    productivityDashboardRetryTimerId = window.setTimeout(() => {
      productivityDashboardRetryTimerId = null;
      void loadProductivityDashboard(retryAttempt + 1);
    }, retryDelayMs);
    return;
  }

  productivityDashboardLoadCompleted = true;
  clearProductivityDashboardRetryTimer();
  renderDashboardUnavailable();
}

function init() {
  syncPopupThemeWithSystem();
  translateUI();
  initializeFooterLinks();
  document.getElementById("openStatsOptionsBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openOptionsPageAtAnchor(OPTIONS_ANCHOR_ADVANCED);
  });
  window.document.getElementById("checkboxSiteProfileInput")?.addEventListener("click", () => {
    void (async () => {
      const { toggle } = getSiteProfileElements();
      if (!toggle) {
        return;
      }
      setSiteProfileInputsDisabled(!toggle.checked);
      await saveSiteProfileFromEditor();
    })();
  });
  [
    "siteLanguageSelect",
    "siteNumSuggestionsSelect",
    "siteInlineModeSelect",
    "sitePreferNativeAutocompleteSelect",
  ]
    .map((id) => document.getElementById(id))
    .forEach((element) => {
      element?.addEventListener("change", () => {
        void (async () => {
          const { toggle } = getSiteProfileElements();
          if (!toggle || !toggle.checked) {
            return;
          }
          await saveSiteProfileFromEditor();
        })();
      });
    });

  const browserAPI = (window as Window & { browser?: typeof chrome }).browser || chrome;
  const permissionBanner = document.getElementById("permissionBanner");
  const permissionBadge = document.getElementById("permissionBadge");
  const permissionTitle = document.getElementById("permissionTitle");
  const permissionBody = document.getElementById("permissionBody");
  const grantBtn = document.getElementById("grantPermissionBtn");
  const permissionController =
    permissionBanner instanceof HTMLElement &&
    permissionBadge instanceof HTMLElement &&
    permissionTitle instanceof HTMLElement &&
    permissionBody instanceof HTMLElement &&
    grantBtn instanceof HTMLButtonElement
      ? new WebsiteAccessPermissionController({
          elements: {
            root: permissionBanner,
            badge: permissionBadge,
            title: permissionTitle,
            body: permissionBody,
            action: grantBtn,
          },
          onStateChange: async (state) => {
            currentWebsiteAccessPermissionState = state;
            if (currentPageState.kind === "actionable") {
              await loadSiteProfileEditor();
              await refreshThisSiteSection();
            }
          },
          service: new WebsiteAccessPermissionService(browserAPI),
          visibleStates: ["missing", "unavailable"],
        })
      : null;

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    void (async () => {
      const currentTab = tabs.length === 1 ? tabs[0] : undefined;
      currentTabId = typeof currentTab?.id === "number" ? currentTab.id : null;
      currentPageState = getCurrentPageState(currentTab?.url);
      currentDomainURL =
        currentPageState.kind === "actionable" ? getDomain(currentTab?.url || "") : undefined;
      if (currentPageState.kind !== "actionable") {
        await refreshThisSiteSection();
      }

      const checkboxNode = document.getElementById(
        "checkboxDomainInput",
      ) as HTMLInputElement | null;
      const checkboxEnableNode = document.getElementById(
        "checkboxEnableInput",
      ) as HTMLInputElement | null;
      if (checkboxNode) {
        checkboxNode.replaceWith(checkboxNode.cloneNode(true));
      }
      const nextCheckboxNode = document.getElementById(
        "checkboxDomainInput",
      ) as HTMLInputElement | null;

      if (currentPageState.kind === "actionable" && currentDomainURL && nextCheckboxNode) {
        const activeDomainURL = currentDomainURL;
        nextCheckboxNode.checked = await isDomainAllowedByPreference(settings, activeDomainURL);
        const activeTabId = currentTabId;
        if (activeTabId !== null) {
          nextCheckboxNode.addEventListener("click", () => {
            void addRemoveDomain(activeTabId, activeDomainURL);
          });
        }
      }
      if (checkboxEnableNode) {
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
        void notifyConfigChange();
      }
      if (allowAutoDetect) {
        select.appendChild(createSelectOption("auto_detect", SUPPORTED_LANGUAGES.auto_detect));
      }
      for (const langCode of currentEnabledLanguages) {
        select.appendChild(createSelectOption(langCode, SUPPORTED_LANGUAGES[langCode]));
      }
      select.value = displayLanguage;
      currentProfileLanguageFallback = getDefaultSiteProfileLanguage(
        displayLanguage,
        currentEnabledLanguages,
      );
      if (permissionController) {
        await permissionController.initialize();
      } else {
        currentWebsiteAccessPermissionState = "unavailable";
        await loadSiteProfileEditor();
        await refreshThisSiteSection();
      }
    })();
  });
  window.document.getElementById("checkboxEnableInput")?.addEventListener("click", () => {
    void toggleOnOff();
  });
  window.document.getElementById("languageSelect")?.addEventListener("change", () => {
    void languageChangeEvent();
  });
  document.getElementById("runOptions")?.addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });

  productivityDashboardLoadCancelled = false;
  productivityDashboardLoadCompleted = false;
  window.addEventListener("unload", cleanupProductivityDashboardLoader, { once: true });
  void loadProductivityDashboard();
}

async function addRemoveDomain(tabId: number, domainURL: string) {
  const checkboxNode = document.getElementById("checkboxDomainInput") as HTMLInputElement | null;
  if (!checkboxNode) {
    return;
  }
  const message: PopupPageEnableMessage | PopupPageDisableMessage = {
    command: checkboxNode.checked ? CMD_POPUP_PAGE_ENABLE : CMD_POPUP_PAGE_DISABLE,
    context: {},
  };
  await blockUnBlockDomain(settings, domainURL, !checkboxNode.checked);
  await refreshThisSiteSection();
  void chrome.tabs.sendMessage(tabId, message);
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
  await refreshThisSiteSection();
}

async function toggleOnOff() {
  const newMode = !(await coreSettingsRepository.isEnabled());
  await coreSettingsRepository.setEnabled(newMode);
  await refreshThisSiteSection();
  const message: PopupPageEnableMessage | PopupPageDisableMessage = {
    command: newMode ? CMD_POPUP_PAGE_ENABLE : CMD_POPUP_PAGE_DISABLE,
    context: {},
  };
  chrome.tabs.query({}, function (tabs) {
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        void chrome.tabs.sendMessage(tab.id, message);
      }
    }
  });
}

window.document.addEventListener("DOMContentLoaded", function () {
  init();
});
