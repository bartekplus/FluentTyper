import {
  getDomain,
  isDomainAllowedByPreference,
  blockUnBlockDomain,
} from "@core/application/domain-utils";
import { SettingsManager } from "@core/application/settingsManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { SiteProfileRepository } from "@core/application/repositories/SiteProfileRepository";
import {
  SUPPORTED_LANGUAGES,
  resolveFallbackLanguage,
  resolvePrimaryLanguage,
} from "@core/domain/lang";
import {
  getSiteProfileForDomain,
  removeSiteProfileForDomain,
  setSiteProfileForDomain,
  type SiteProfile,
} from "@core/domain/siteProfiles";
import { resolveGlobalNumSuggestions } from "@core/domain/siteProfileService";
import {
  CMD_POPUP_PAGE_ENABLE,
  CMD_POPUP_PAGE_DISABLE,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_REVIEW_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import type {
  ReviewActiveTabMessage,
  PopupPageEnableMessage,
  PopupPageDisableMessage,
  ProductivityDashboardStats,
  PopupGetProductivityStatsMessage,
} from "@core/domain/messageTypes";
import { formatTranslation, i18n } from "@ui/options/fluenttyperI18n.js";
import { localizeDocument } from "@ui/shared/localizeDocument";
import {
  formatMetricNumber as formatNumber,
  formatSavingsSummary,
  formatWeekRange,
} from "@ui/shared/formatMetrics.js";
import {
  type WebsiteAccessPermissionState,
  WebsiteAccessPermissionController,
  WebsiteAccessPermissionService,
} from "@ui/shared/websiteAccessPermission";
import {
  ackDonation,
  acknowledgeWeeklyRecap,
  fetchAutoLanguageStatus,
  notifyConfigChange,
  sendRuntimeMessage,
  trackDonationPromptShown,
} from "@ui/shared/runtimeMessaging";
import {
  appendLanguageOptions,
  applySiteProfileToSelects,
  buildSiteProfile,
  languageLabel,
  populateSiteProfileSelects,
} from "@ui/shared/siteProfileEditor";

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
const markDonationPromptShown = trackDonationPromptShown();
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
    badge: document.getElementById("pageStateBadge") as HTMLElement,
    title: document.getElementById("pageStateTitle") as HTMLElement,
    body: document.getElementById("pageStateBody") as HTMLElement,
    language: document.getElementById("pageStateLanguage") as HTMLElement,
    hint: document.getElementById("checkboxDomainHint") as HTMLElement,
    meta: document.getElementById("pageStateMeta") as HTMLElement,
    panel: document.getElementById("pageStatePanel") as HTMLElement,
    profile: document.getElementById("pageStateProfile") as HTMLElement,
    section: document.getElementById("domainSectionWrapper") as HTMLElement,
  };
}

function setNodeTextAndTitle(node: HTMLElement, value: string): void {
  node.textContent = value;
  if (value.length > 0) {
    node.title = value;
  } else {
    node.removeAttribute("title");
  }
}

function renderNonActionablePageState(
  state: Pick<Extract<PopupPageState, { kind: "restricted" | "non_actionable" }>, "badge" | "body">,
  titleText: string,
  panelState: "restricted" | "non_actionable" | "paused",
  showDomainSection: boolean,
): void {
  const { badge, title, body, language, profile, meta, hint, panel, section } =
    getPageStateElements();
  badge.textContent = state.badge;
  setNodeTextAndTitle(title, titleText);
  body.textContent = state.body;
  setNodeTextAndTitle(language, "");
  setNodeTextAndTitle(profile, "");
  meta.classList.add("is-hidden");
  setNodeTextAndTitle(hint, "");
  panel.setAttribute("data-page-state", panelState);
  setReviewActionVisible(false);
  setSiteSpecificControlsEnabled(false);
  if (showDomainSection) {
    (document.getElementById("checkboxDomainInput") as HTMLInputElement).checked = false;
  }
  section.classList.toggle("is-hidden", !showDomainSection);
}

const SITE_SPECIFIC_CONTROL_IDS = [
  "checkboxDomainInput",
  "checkboxSiteProfileInput",
  "siteLanguageSelect",
  "siteNumSuggestionsSelect",
  "siteInlineModeSelect",
  "sitePreferNativeAutocompleteSelect",
  "siteCodeModeSelect",
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

function renderStaticPageState(
  state: Extract<PopupPageState, { kind: "restricted" | "non_actionable" }>,
): void {
  const siteProfileSection = document.getElementById("siteProfileSection");
  renderNonActionablePageState(state, state.title, state.kind, state.kind === "restricted");
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
    configuredLanguage === "auto_detect"
      ? await fetchAutoLanguageStatus({
          tabId: currentTabId ?? undefined,
          domainURL: currentDomainURL,
        })
      : null;
  const fallbackLanguageLabel = languageLabel(currentProfileLanguageFallback);
  const languageCode = autoLanguageStatus?.language || configuredLanguage;
  const activeLanguageLabel = languageLabel(languageCode);
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
  badge.textContent = badgeLabel;
  setNodeTextAndTitle(title, currentDomainURL);
  body.textContent = autoDetectReasonCopy
    ? `${activityCopy} ${autoDetectReasonCopy}`
    : activityCopy;
  if (configuredLanguage === "auto_detect" && autoLanguageStatus?.language) {
    const liveLabel = formatTranslation("language_panel_auto_detect_current", {
      language: activeLanguageLabel,
    });
    setNodeTextAndTitle(language, liveLabel);
  } else {
    setNodeTextAndTitle(language, activeLanguageLabel);
  }
  setNodeTextAndTitle(profileNode, profileCopy);
  meta.classList.remove("is-hidden");
  panel.setAttribute("data-page-state", globallyEnabled && siteAllowed ? "active" : "paused");
  setReviewActionVisible(globallyEnabled && siteAllowed);
  section.classList.remove("is-hidden");
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
    codeMode: document.getElementById("siteCodeModeSelect") as HTMLSelectElement | null,
    section: document.getElementById("siteProfileSection"),
    status: document.getElementById("siteProfileStatus"),
  };
}

function setSiteProfileInputsDisabled(disabled: boolean): void {
  document.getElementById("siteProfileDetails")?.classList.toggle("is-hidden", disabled);
}

function getProfileStatusLabel(profileEnabled: boolean): string {
  return profileEnabled
    ? i18n.get("popup_site_profile_status_active")
    : i18n.get("popup_site_profile_status_global");
}

async function loadSiteProfileEditor() {
  const {
    toggle,
    language,
    suggestions,
    inline,
    preferNativeAutocomplete,
    codeMode,
    section,
    status,
  } = getSiteProfileElements();
  if (
    !currentDomainURL ||
    currentPageState.kind !== "actionable" ||
    currentWebsiteAccessPermissionState !== "granted"
  ) {
    section?.classList.add("is-hidden");
    return;
  }
  section?.classList.remove("is-hidden");
  const [
    siteProfilesRaw,
    numSuggestionsRaw,
    inlineSuggestionRaw,
    preferNativeAutocompleteRaw,
    globalCodeMode,
  ] = await Promise.all([
    siteProfileRepository.getRawSiteProfiles(),
    coreSettingsRepository.getNumSuggestions(),
    coreSettingsRepository.getInlineSuggestion(),
    coreSettingsRepository.getPreferNativeAutocomplete(),
    coreSettingsRepository.getCodeMode(),
  ]);
  const profile = getSiteProfileForDomain(
    siteProfilesRaw,
    currentDomainURL,
    currentEnabledLanguages,
  );
  if (
    !toggle ||
    !language ||
    !suggestions ||
    !inline ||
    !preferNativeAutocomplete ||
    !codeMode ||
    !status
  ) {
    return;
  }

  const selects = { language, suggestions, inline, preferNativeAutocomplete, codeMode };
  populateSiteProfileSelects(
    selects,
    {
      numSuggestions: resolveGlobalNumSuggestions(numSuggestionsRaw),
      inlineSuggestion: inlineSuggestionRaw === true,
      preferNativeAutocomplete: preferNativeAutocompleteRaw !== false,
      codeMode: globalCodeMode,
    },
    currentEnabledLanguages,
  );
  applySiteProfileToSelects(selects, profile, currentProfileLanguageFallback);
  toggle.checked = Boolean(profile);
  status.textContent = getProfileStatusLabel(toggle.checked);
  setSiteProfileInputsDisabled(!toggle.checked);
}

function readSiteProfileFromEditor(): SiteProfile {
  const { language, suggestions, inline, preferNativeAutocomplete, codeMode } =
    getSiteProfileElements();
  const languageValue =
    language && currentEnabledLanguages.includes(language.value)
      ? language.value
      : currentProfileLanguageFallback;
  return buildSiteProfile(languageValue, {
    numSuggestions: suggestions?.value,
    inlineSuggestion: inline?.value,
    preferNativeAutocomplete: preferNativeAutocomplete?.value,
    codeMode: codeMode?.value,
  });
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

/** Returns whether the recap is showing; the popup shows one notice at a time. */
function renderWeeklyRecapCard(stats: ProductivityDashboardStats): boolean {
  const cardNode = document.getElementById("weeklyRecapCard") as HTMLElement;
  const titleNode = document.getElementById("weeklyRecapTitle") as HTMLElement;
  const summaryNode = document.getElementById("weeklyRecapSummary") as HTMLElement;
  const dismissButton = document.getElementById("weeklyRecapDismissBtn") as HTMLButtonElement;
  const viewButton = document.getElementById("weeklyRecapViewBtn") as HTMLButtonElement;
  const shareButton = document.getElementById("weeklyRecapShareBtn") as HTMLButtonElement;

  if (!stats.shouldShowWeeklyRecap) {
    cardNode.classList.add("is-hidden");
    return false;
  }

  cardNode.classList.remove("is-hidden");
  const recapTitle = `${i18n.get("popup_weekly_recap_title")} (${formatWeekRange(
    stats.weeklyRecap.weekKey,
  )})`;
  titleNode.textContent = recapTitle;
  summaryNode.textContent = formatSavingsSummary(stats.weeklyRecap);

  const recapShareText = `${recapTitle}: ${formatSavingsSummary(stats.weeklyRecap, ", ")}.`;

  const dismiss = () => {
    void acknowledgeWeeklyRecap(stats.weeklyRecap.weekKey);
    cardNode.classList.add("is-hidden");
  };
  dismissButton.onclick = dismiss;
  shareButton.onclick = () => {
    void navigator.clipboard.writeText(recapShareText).catch(() => undefined);
    dismiss();
  };
  viewButton.onclick = () => {
    dismiss();
    openOptionsPageAtAnchor(OPTIONS_ANCHOR_ADVANCED);
  };
  return true;
}

function renderMilestoneHint(stats: ProductivityDashboardStats): void {
  const container = document.getElementById("dashboardMilestoneHint") as HTMLElement;
  const textNode = document.getElementById("dashboardMilestoneText") as HTMLElement;
  const linkNode = document.getElementById("dashboardMilestoneLink") as HTMLAnchorElement;
  const laterButton = document.getElementById("dashboardMilestoneLaterBtn") as HTMLButtonElement;

  markDonationPromptShown(stats.donationPrompt);
  if (!stats.donationPrompt) {
    container.classList.add("is-hidden");
    linkNode.onclick = null;
    laterButton.onclick = null;
    return;
  }
  const dismissButton = document.getElementById(
    "dashboardMilestoneDismissBtn",
  ) as HTMLButtonElement;
  const donationPrompt = stats.donationPrompt;

  container.classList.remove("is-hidden");
  textNode.textContent = formatTranslation("support_saved_time", {
    minutes: formatNumber(stats.lifetime.estimatedMinutesSaved),
  });
  dismissButton.onclick = () => {
    void ackDonation(donationPrompt, "dismiss");
    container.classList.add("is-hidden");
  };
  linkNode.onclick = () => {
    void ackDonation(donationPrompt, "support_clicked");
  };
  laterButton.onclick = () => {
    void ackDonation(donationPrompt, "snooze");
    container.classList.add("is-hidden");
  };
}

function renderDashboard(stats: ProductivityDashboardStats): void {
  // No-break spaces keep each number on the same line as its unit.
  const periodSummary = `${i18n.get("popup_short_last7")}: ${formatSavingsSummary(
    stats.last7Days,
    " • ",
    "\u00a0",
  )}`;

  (document.getElementById("dashboardPeriodSummary") as HTMLElement).textContent = periodSummary;
  if (renderWeeklyRecapCard(stats)) {
    document.getElementById("dashboardMilestoneHint")?.classList.add("is-hidden");
  } else {
    renderMilestoneHint(stats);
  }
}

function clearProductivityDashboardRetryTimer(): void {
  if (productivityDashboardRetryTimerId !== null) {
    window.clearTimeout(productivityDashboardRetryTimerId);
    productivityDashboardRetryTimerId = null;
  }
}

function renderDashboardUnavailable(): void {
  (document.getElementById("dashboardPeriodSummary") as HTMLElement).textContent = i18n.get(
    "popup_dashboard_stats_unavailable",
  );
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
  localizeDocument(["title"]);
  initializeFooterLinks();
  document.getElementById("openStatsOptionsBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openOptionsPageAtAnchor(OPTIONS_ANCHOR_ADVANCED);
  });
  const siteProfileToggle = getSiteProfileElements().toggle;
  siteProfileToggle?.addEventListener("click", () => {
    setSiteProfileInputsDisabled(!siteProfileToggle.checked);
    void saveSiteProfileFromEditor();
  });
  SITE_SPECIFIC_CONTROL_IDS.slice(2)
    .map((id) => document.getElementById(id))
    .forEach((element) => {
      element?.addEventListener("change", () => {
        if (siteProfileToggle?.checked) {
          void saveSiteProfileFromEditor();
        }
      });
    });

  const permissionController = new WebsiteAccessPermissionController({
    elements: {
      root: document.getElementById("permissionBanner") as HTMLElement,
      badge: document.getElementById("permissionBadge") as HTMLElement,
      title: document.getElementById("permissionTitle") as HTMLElement,
      body: document.getElementById("permissionBody") as HTMLElement,
      action: document.getElementById("grantPermissionBtn") as HTMLButtonElement,
    },
    onStateChange: async (state) => {
      currentWebsiteAccessPermissionState = state;
      if (currentPageState.kind === "actionable") {
        await loadSiteProfileEditor();
        await refreshThisSiteSection();
      }
    },
    service: new WebsiteAccessPermissionService(window.browser || chrome),
    visibleStates: ["missing", "unavailable"],
  });

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    void (async () => {
      const currentTab = tabs.length === 1 ? tabs[0] : undefined;
      currentTabId = typeof currentTab?.id === "number" ? currentTab.id : null;
      currentPageState = getCurrentPageState(currentTab?.url);
      // The website-access ask only belongs on pages FluentTyper could run on.
      document.body.dataset.pageKind = currentPageState.kind;
      currentDomainURL =
        currentPageState.kind === "actionable" ? getDomain(currentTab?.url || "") : undefined;
      if (currentPageState.kind !== "actionable") {
        await refreshThisSiteSection();
      }

      const checkboxEnableNode = document.getElementById(
        "checkboxEnableInput",
      ) as HTMLInputElement | null;
      const checkboxNode = document.getElementById(
        "checkboxDomainInput",
      ) as HTMLInputElement | null;

      if (currentPageState.kind === "actionable" && currentDomainURL && checkboxNode) {
        const activeDomainURL = currentDomainURL;
        checkboxNode.checked = await isDomainAllowedByPreference(settings, activeDomainURL);
        const activeTabId = currentTabId;
        if (activeTabId !== null) {
          checkboxNode.addEventListener("click", () => {
            void addRemoveDomain(activeTabId, activeDomainURL);
          });
        }
      }
      if (checkboxEnableNode) {
        checkboxEnableNode.checked = await coreSettingsRepository.isEnabled();
      }

      const language = await coreSettingsRepository.getLanguage();
      currentEnabledLanguages = await coreSettingsRepository.getEnabledLanguages();
      const select = window.document.getElementById("languageSelect") as HTMLSelectElement;
      const displayLanguage = resolvePrimaryLanguage(language, currentEnabledLanguages);

      if (displayLanguage !== language) {
        await coreSettingsRepository.setLanguage(displayLanguage);
        void notifyConfigChange();
      }
      if (currentEnabledLanguages.length > 1) {
        select.appendChild(new window.Option(SUPPORTED_LANGUAGES.auto_detect, "auto_detect"));
      }
      appendLanguageOptions(select, currentEnabledLanguages);
      select.value = displayLanguage;
      currentProfileLanguageFallback = resolveFallbackLanguage(
        displayLanguage,
        currentEnabledLanguages,
      );
      await permissionController.initialize();
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
  setupReviewTextAction();

  productivityDashboardLoadCancelled = false;
  productivityDashboardLoadCompleted = false;
  window.addEventListener("unload", cleanupProductivityDashboardLoader, { once: true });
  void loadProductivityDashboard();
}

/**
 * "Review text": asks the page to review its focused editor. The page captures
 * the editor and selection itself; the popup closes so focus returns there.
 * It sits in the "This site" panel, shown only while FluentTyper runs here.
 */
function setupReviewTextAction(): void {
  const button = document.getElementById("reviewTextBtn");
  if (!button) return;
  button.addEventListener("click", () => {
    const tabId = currentTabId;
    if (tabId === null) return;
    const message: ReviewActiveTabMessage = {
      command: CMD_REVIEW_FT_ACTIVE_TAB,
      context: { source: "popup" },
    };
    // Every frame receives it; only the frame holding the focused editor acts.
    void chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
    window.close();
  });
  const shortcut = document.getElementById("reviewTextShortcut");
  void chrome.commands
    ?.getAll?.()
    .then((commands) => {
      const key = commands.find((command) => command.name === CMD_REVIEW_FT_ACTIVE_TAB)?.shortcut;
      if (!shortcut || !key) return;
      shortcut.textContent = key;
      shortcut.classList.remove("is-hidden");
      button.title = formatTranslation("popup_review_text_shortcut", { shortcut: key });
    })
    .catch(() => undefined);
}

/** Shows "Review text" only where it can act: a website with FluentTyper on. */
function setReviewActionVisible(visible: boolean): void {
  const shown = visible && currentTabId !== null;
  document.getElementById("reviewTextAction")?.classList.toggle("is-hidden", !shown);
  document.getElementById("pageStatePanel")?.classList.toggle("has-action", shown);
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
  void chrome.tabs.sendMessage(tabId, message)?.catch(() => undefined);
}

async function languageChangeEvent() {
  const select = window.document.getElementById("languageSelect") as HTMLSelectElement;

  await coreSettingsRepository.setLanguage(select.value);
  await notifyConfigChange();
  currentProfileLanguageFallback = resolveFallbackLanguage(select.value, currentEnabledLanguages);
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
        void chrome.tabs.sendMessage(tab.id, message)?.catch(() => undefined);
      }
    }
  });
}

window.document.addEventListener("DOMContentLoaded", function () {
  init();
});
