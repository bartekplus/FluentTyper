import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import {
  CMD_GET_AUTO_LANGUAGE_STATUS,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_REVIEW_FT_ACTIVE_TAB,
} from "../src/core/domain/constants";
import type { ProductivityDashboardStats } from "../src/core/domain/messageTypes";
import { installJsdom } from "./support/jsdomGlobals";

type RuntimeOutcome =
  | { type: "stats"; value: ProductivityDashboardStats }
  | { type: "response"; value: { ok: boolean } }
  | { type: "lastError"; message?: string };

type PermissionApi = {
  contains?: (options: chrome.permissions.Permissions) => Promise<boolean> | boolean;
  request?: (options: chrome.permissions.Permissions) => Promise<boolean> | boolean;
};

type PopupOptions = {
  outcomes?: RuntimeOutcome[];
  summary?: string;
  permissions?: PermissionApi;
  tab?: chrome.tabs.Tab;
  translations?: Record<string, string>;
  responses?: Record<string, unknown>;
  storage?: Record<string, unknown>;
};

const granted: PermissionApi = { contains: async () => true };

let importNonce = 0;
let activeDom: JSDOM | null = null;
let restoreGlobals: (() => void) | null = null;
let originalI18nGet: ((key: string) => string) | null = null;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_popup_retry=${importNonce}`;
}

function popupMarkup(initialSummary: string): string {
  return `<!doctype html>
<html>
  <body>
    <div id="pageStatePanel" data-page-state="active">
      <h2 id="pageStateTitle"></h2>
      <span id="pageStateBadge"></span>
      <p id="pageStateBody"></p>
      <div id="pageStateMeta" class="is-hidden">
        <span id="pageStateLanguage"></span>
        <span id="pageStateProfile"></span>
      </div>
    </div>
    <input id="checkboxSiteProfileInput" type="checkbox" />
    <div id="domainSectionWrapper"></div>
    <section id="siteProfileSection"></section>
    <small id="siteProfileStatus"></small>
    <details id="siteProfileDetails" class="is-hidden">
      <summary data-i18n="popup_site_profile_customize">Customize for this site</summary>
      <select id="siteLanguageSelect"></select>
      <select id="siteNumSuggestionsSelect"></select>
      <select id="siteInlineModeSelect"></select>
      <select id="sitePreferNativeAutocompleteSelect"></select>
    </details>

    <input id="checkboxDomainInput" type="checkbox" />
    <div id="checkboxDomainLabel"></div>
    <div id="checkboxDomainHint"></div>
    <input id="checkboxEnableInput" type="checkbox" />
    <select id="languageSelect"></select>
    <div id="reviewTextAction" class="is-hidden">
      <button id="reviewTextBtn" type="button"><kbd id="reviewTextShortcut" class="is-hidden"></kbd></button>
    </div>

    <div id="permissionBanner" class="is-hidden" data-permission-state="missing">
      <span id="permissionBadge"></span>
      <h2 id="permissionTitle"></h2>
      <p id="permissionBody"></p>
      <button id="grantPermissionBtn" type="button"></button>
    </div>

    <section id="productivityDashboard"></section>
    <button id="openStatsOptionsBtn" type="button"></button>
    <p id="dashboardPeriodSummary">${initialSummary}</p>

    <div id="weeklyRecapCard" class="is-hidden"></div>
    <p id="weeklyRecapTitle"></p>
    <p id="weeklyRecapSummary"></p>
    <button id="weeklyRecapDismissBtn" type="button"></button>
    <button id="weeklyRecapViewBtn" type="button"></button>
    <button id="weeklyRecapShareBtn" type="button"></button>

    <div id="dashboardMilestoneHint" class="is-hidden"></div>
    <span id="dashboardMilestoneText"></span>
    <a id="dashboardMilestoneLink"></a>
    <button id="dashboardMilestoneLaterBtn" type="button"></button>
    <button id="dashboardMilestoneDismissBtn" type="button"></button>

    <footer class="toolbar">
      <div class="toolbar-actions toolbar-actions--quiet">
        <a
          id="runOptions"
          class="toolbar-link"
          href="/options/options.html"
          target="_blank"
          rel="noopener"
          data-i18n-title="popup_advanced_options"
          title="Advanced Options"
        >
          <span data-i18n="settings">Settings</span>
        </a>
        <a
          id="reportIssueLink"
          class="toolbar-link"
          href="https://github.com/bartekplus/FluentTyper/issues"
          target="_blank"
          data-i18n-title="popup_report_issue"
          title="Report Issue"
        >
          <span class="is-sr-only" data-i18n="popup_report_issue">Report Issue</span>
        </a>
        <a
          id="githubSourceLink"
          class="toolbar-link"
          href="https://github.com/bartekplus/FluentTyper"
          target="_blank"
          data-i18n-title="popup_github_source"
          title="GitHub Source"
        >
          <span class="is-sr-only" data-i18n="popup_github_source">GitHub Source</span>
        </a>
        <a
          id="supportDevelopmentLink"
          class="toolbar-link"
          href="https://www.buymeacoffee.com/FluentTyper"
          target="_blank"
          data-i18n-title="popup_support_development"
          title="Support Development"
        >
          <span data-i18n="support_cta">Support FluentTyper</span>
        </a>
      </div>
    </footer>
  </body>
</html>`;
}

function installPopupDom(initialSummary: string): JSDOM {
  const dom = new JSDOM(popupMarkup(initialSummary), {
    pretendToBeVisual: true,
    url: "https://example.test/popup/popup.html",
  });
  const windowRef = dom.window;
  windowRef.setTimeout = setTimeout as unknown as typeof windowRef.setTimeout;
  windowRef.clearTimeout = clearTimeout as unknown as typeof windowRef.clearTimeout;
  restoreGlobals = installJsdom(dom);
  return dom;
}

function closePopupDom(): void {
  activeDom?.window.close();
  activeDom = null;
  restoreGlobals?.();
  restoreGlobals = null;
}

function createPopupStats(acceptedSuggestions: number): ProductivityDashboardStats {
  return {
    today: {
      acceptedSuggestions,
      charactersSaved: acceptedSuggestions * 3,
      estimatedMinutesSaved: acceptedSuggestions / 2,
    },
    last7Days: {
      acceptedSuggestions,
      charactersSaved: acceptedSuggestions * 7,
      estimatedMinutesSaved: acceptedSuggestions * 1.5,
    },
    lifetime: {
      acceptedSuggestions: acceptedSuggestions * 10,
      charactersSaved: acceptedSuggestions * 100,
      estimatedMinutesSaved: acceptedSuggestions * 8,
    },
    lifetimeEvents: {
      suggestionsShown: 0,
      snippetsExpanded: 0,
      charsInsertedFromSnippet: 0,
      charsTypedForTrigger: 0,
    },
    last7DaysEvents: {
      suggestionsShown: 0,
      snippetsExpanded: 0,
      charsInsertedFromSnippet: 0,
      charsTypedForTrigger: 0,
    },
    last7DaysTrend: [],
    perLanguageLifetime: [
      {
        language: "en_US",
        acceptedSuggestions: acceptedSuggestions * 10,
        charactersSaved: acceptedSuggestions * 100,
        estimatedMinutesSaved: acceptedSuggestions * 8,
      },
    ],
    perLanguageLast7Days: [
      {
        language: "en_US",
        acceptedSuggestions,
        charactersSaved: acceptedSuggestions * 7,
        estimatedMinutesSaved: acceptedSuggestions * 1.5,
      },
    ],
    topSnippets: [],
    weekOverWeekDeltaPct: null,
    milestoneProgress: {
      previousMilestoneHours: 0,
      nextMilestoneHours: 10,
      progressPct: 20,
      lifetimeHoursSaved: 2,
    },
    weeklyRecap: {
      weekKey: "2026-03-02",
      acceptedSuggestions: 0,
      charactersSaved: 0,
      estimatedMinutesSaved: 0,
      topSnippet: null,
      milestonesCrossedHours: [],
      equivalentTasks: 0,
    },
    shouldShowWeeklyRecap: false,
    donationPrompt: null,
  };
}

function createChromeMock(
  outcomes: RuntimeOutcome[],
  permissionApi?: PermissionApi,
  activeTab?: chrome.tabs.Tab,
  runtimeResponses?: Record<string, unknown>,
  storageOverrides?: Record<string, unknown>,
) {
  const pending = [...outcomes];
  const storage = new Map<string, unknown>([
    ["store.settings.enable", JSON.stringify(true)],
    ["store.settings.enabled", JSON.stringify(true)],
    ["store.settings.language", JSON.stringify("en_US")],
    ["store.settings.fallbackLanguage", JSON.stringify("en_US")],
    ["store.settings.enabled_languages", JSON.stringify(["en_US"])],
    ["store.settings.domainListMode", JSON.stringify("blackList")],
    ["store.settings.siteProfiles", JSON.stringify({})],
    ...Object.entries(storageOverrides || {}),
  ]);

  const runtime = {
    lastError: null as { message: string } | null,
    sendMessage: jest.fn(
      (message: { command?: string }, callback?: (response?: unknown) => void) => {
        if (message?.command === CMD_POPUP_GET_PRODUCTIVITY_STATS && callback) {
          const next = pending.shift();
          if (!next) {
            throw new Error("No popup runtime outcome queued.");
          }
          if (next.type === "lastError") {
            runtime.lastError = { message: next.message || "runtime unavailable" };
            callback(undefined);
            runtime.lastError = null;
            return;
          }
          runtime.lastError = null;
          callback(next.value);
          return;
        }
        if (
          message?.command &&
          runtimeResponses &&
          message.command in runtimeResponses &&
          callback
        ) {
          runtime.lastError = null;
          callback(runtimeResponses[message.command]);
          return;
        }
        if (message?.command && runtimeResponses && message.command in runtimeResponses) {
          runtime.lastError = null;
          return Promise.resolve(runtimeResponses[message.command]);
        }
        if (callback) {
          runtime.lastError = null;
          callback({ ok: true });
          return;
        }
        return Promise.resolve({ ok: true });
      },
    ),
    getURL: jest.fn((path: string) => `chrome-extension://popup-test/${path}`),
    openOptionsPage: jest.fn(),
  };

  const localStorageApi = {
    get: jest.fn(
      (key: string | string[] | null, callback: (items: Record<string, unknown>) => void) => {
        if (key === null) {
          callback(Object.fromEntries(storage));
          return;
        }
        if (Array.isArray(key)) {
          const out: Record<string, unknown> = {};
          for (const entry of key) {
            out[entry] = storage.get(entry);
          }
          callback(out);
          return;
        }
        callback({ [key]: storage.get(key) });
      },
    ),
    set: jest.fn((items: Record<string, unknown>, callback?: () => void) => {
      for (const [key, value] of Object.entries(items)) {
        storage.set(key, value);
      }
      callback?.();
    }),
    remove: jest.fn((key: string, callback?: () => void) => {
      storage.delete(key);
      callback?.();
    }),
  };

  const chromeMock = {
    runtime,
    tabs: {
      query: jest.fn(
        (query: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
          if (query.active && query.currentWindow) {
            callback(activeTab ? [activeTab] : []);
            return;
          }
          callback([]);
        },
      ),
      update: jest.fn(),
      create: jest.fn(),
      sendMessage: jest.fn(() => Promise.resolve()),
    },
    storage: {
      local: localStorageApi,
      sync: localStorageApi,
    },
    permissions: undefined,
    commands: {
      getAll: jest.fn(async () => [{ name: CMD_REVIEW_FT_ACTIVE_TAB, shortcut: "Alt+Shift+R" }]),
    },
  };

  if (permissionApi) {
    chromeMock.permissions = {
      contains: jest.fn(permissionApi.contains),
      request: jest.fn(permissionApi.request),
    };
  }

  return chromeMock;
}

async function flushAsyncWork(rounds = 12): Promise<void> {
  for (let idx = 0; idx < rounds; idx += 1) {
    await Promise.resolve();
  }
}

async function waitForCondition(
  condition: () => boolean,
  failureMessage: string,
  maxAttempts = 50,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (condition()) {
      return;
    }
    await flushAsyncWork();
  }
  throw new Error(failureMessage);
}

async function waitForPopupRender(maxAttempts = 50): Promise<void> {
  await waitForCondition(
    () => (document.getElementById("pageStateTitle")?.textContent?.trim().length ?? 0) > 0,
    "Popup UI did not finish rendering before assertions.",
    maxAttempts,
  );
}

async function advanceAndFlush(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await flushAsyncWork();
}

function textContent(id: string): string {
  return document.getElementById(id)?.textContent || "";
}

function focusElement(id: string): Element | null {
  const element = document.getElementById(id);
  element?.focus();
  return document.activeElement;
}

function dashboardStatsCallCount(chromeMock: ReturnType<typeof createChromeMock>): number {
  return chromeMock.runtime.sendMessage.mock.calls.filter(
    (call) => call[0]?.command === CMD_POPUP_GET_PRODUCTIVITY_STATS,
  ).length;
}

function createWebsiteTab(url = "https://example.com"): chrome.tabs.Tab {
  return {
    id: 17,
    url,
  };
}

async function applyTranslationOverrides(overrides?: Record<string, string>): Promise<void> {
  const { i18n } = await import("../src/ui/options/fluenttyperI18n.js");
  if (!originalI18nGet) {
    originalI18nGet = i18n.get.bind(i18n);
  }
  i18n.get = (key: string) => overrides?.[key] ?? originalI18nGet!(key);
}

async function loadPopup({
  outcomes = [{ type: "stats", value: createPopupStats(1) }],
  summary = "0",
  permissions,
  tab,
  translations,
  responses,
  storage,
}: PopupOptions = {}): Promise<ReturnType<typeof createChromeMock>> {
  closePopupDom();
  activeDom = installPopupDom(summary);
  mock.restore();
  const chromeMock = createChromeMock(outcomes, permissions, tab, responses, storage);
  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
  (window as unknown as { chrome: unknown }).chrome = chromeMock;

  await applyTranslationOverrides(translations);
  await import(freshModulePath("../src/ui/popup/popup"));
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await waitForPopupRender();
  await flushAsyncWork();
  return chromeMock;
}

describe("popup productivity dashboard retry/failure paths", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.clearAllTimers();
    jest.useRealTimers();
    closePopupDom();

    if (originalI18nGet) {
      const { i18n } = await import("../src/ui/options/fluenttyperI18n.js");
      i18n.get = originalI18nGet;
    }
  });

  test("renders dashboard immediately on first successful stats response", async () => {
    const stats = createPopupStats(6);
    const chromeMock = await loadPopup({ outcomes: [{ type: "stats", value: stats }] });

    expect(dashboardStatsCallCount(chromeMock)).toBe(1);
    expect(textContent("dashboardPeriodSummary")).toContain("6\u00a0accepted");
    expect(textContent("dashboardPeriodSummary")).toContain("42\u00a0chars");
    expect(textContent("dashboardPeriodSummary")).not.toContain("unavailable");
    expect(document.getElementById("productivityDashboard")?.tagName).toBe("SECTION");
    expect(document.querySelector("#productivityDashboard summary")).toBeNull();

    await advanceAndFlush(10000);
    expect(dashboardStatsCallCount(chromeMock)).toBe(1);
  });

  test("retries through backoff budget and renders unavailable state after repeated failures", async () => {
    const chromeMock = await loadPopup({
      outcomes: [
        { type: "response", value: { ok: false } },
        { type: "response", value: { ok: false } },
        { type: "response", value: { ok: false } },
        { type: "response", value: { ok: false } },
        { type: "response", value: { ok: false } },
        { type: "response", value: { ok: false } },
      ],
    });

    for (const delayMs of [150, 300, 600, 1200, 2400]) {
      await advanceAndFlush(delayMs);
    }

    expect(dashboardStatsCallCount(chromeMock)).toBe(6);
    expect(textContent("dashboardPeriodSummary").toLowerCase()).toContain("unavailable");
    expect(document.getElementById("weeklyRecapCard")?.classList.contains("is-hidden")).toBe(true);
    expect(document.getElementById("dashboardMilestoneHint")?.classList.contains("is-hidden")).toBe(
      true,
    );
  });

  test("uses configured retry backoff timings before succeeding", async () => {
    const chromeMock = await loadPopup({
      outcomes: [
        { type: "lastError", message: "transient failure #1" },
        { type: "response", value: { ok: false } },
        { type: "stats", value: createPopupStats(4) },
      ],
    });

    expect(dashboardStatsCallCount(chromeMock)).toBe(1);

    await advanceAndFlush(149);
    expect(dashboardStatsCallCount(chromeMock)).toBe(1);

    await advanceAndFlush(1);
    expect(dashboardStatsCallCount(chromeMock)).toBe(2);

    await advanceAndFlush(299);
    expect(dashboardStatsCallCount(chromeMock)).toBe(2);

    await advanceAndFlush(1);
    expect(dashboardStatsCallCount(chromeMock)).toBe(3);
    expect(textContent("dashboardPeriodSummary")).toContain("4\u00a0accepted");

    await advanceAndFlush(10000);
    expect(dashboardStatsCallCount(chromeMock)).toBe(3);
  });

  test("uses shared missing and granted permission states in the popup", async () => {
    const chromeMock = await loadPopup({
      permissions: { contains: async () => false, request: async () => true },
      tab: createWebsiteTab("https://translate.google.pl"),
    });

    const banner = document.getElementById("permissionBanner") as HTMLElement;
    const button = document.getElementById("grantPermissionBtn") as HTMLButtonElement;

    expect(banner.classList.contains("is-hidden")).toBe(false);
    expect(banner.dataset.permissionState).toBe("missing");
    expect(textContent("pageStateBadge")).toBe("Website access required");
    expect(textContent("pageStateTitle")).toBe("translate.google.pl");
    // The banner shows the body text.
    expect(textContent("pageStateBody")).toBe("");
    expect(document.getElementById("domainSectionWrapper")?.classList.contains("is-hidden")).toBe(
      true,
    );
    expect(document.getElementById("siteProfileSection")?.classList.contains("is-hidden")).toBe(
      true,
    );
    expect((document.getElementById("checkboxDomainInput") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((document.getElementById("checkboxSiteProfileInput") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(textContent("permissionTitle")).toBe("Allow FluentTyper on websites");
    expect(textContent("permissionBody")).toBe(
      "Everything runs on your device; nothing you type leaves your browser. FluentTyper needs access to all websites to help in their text fields.",
    );
    expect(button.textContent).toBe("Allow on all websites");
    expect(textContent("permissionTitle")).not.toContain("permission_status_");
    expect(textContent("permissionBody")).not.toContain("permission_status_");

    button.click();
    await waitForCondition(
      () => textContent("pageStateBadge") === "Active here",
      "Popup did not refresh to the granted page state after requesting access.",
    );
    await flushAsyncWork();

    expect(banner.classList.contains("is-hidden")).toBe(true);
    expect(banner.dataset.permissionState).toBe("granted");
    expect(textContent("pageStateBadge")).toBe("Active here");
    expect(textContent("pageStateTitle")).toBe("translate.google.pl");
    expect(document.getElementById("domainSectionWrapper")?.classList.contains("is-hidden")).toBe(
      false,
    );
    expect((document.getElementById("checkboxDomainInput") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(textContent("permissionTitle")).toBe("Access granted");
    expect(textContent("permissionBody")).toBe(
      "FluentTyper can now show suggestions in text fields, and everything still stays local in your browser.",
    );
    expect(button.hidden).toBe(true);
    expect(chromeMock.permissions?.contains).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(chromeMock.permissions?.request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
  });

  test("keeps the popup permission banner hidden when access is already granted", async () => {
    await loadPopup({ permissions: granted, tab: createWebsiteTab() });

    const banner = document.getElementById("permissionBanner") as HTMLElement;
    expect(banner.dataset.permissionState).toBe("granted");
    expect(banner.classList.contains("is-hidden")).toBe(true);
    expect(textContent("pageStateBadge")).toBe("Active here");
    expect(document.getElementById("domainSectionWrapper")?.classList.contains("is-hidden")).toBe(
      false,
    );
    expect((document.getElementById("checkboxDomainInput") as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  test("keeps permission-first layout ahead of site controls until access is granted", async () => {
    await loadPopup({
      permissions: { contains: async () => false },
      tab: createWebsiteTab("https://secure.example.com"),
    });

    const pageStatePanel = document.getElementById("pageStatePanel") as HTMLElement;
    const permissionBanner = document.getElementById("permissionBanner") as HTMLElement;
    const dashboard = document.getElementById("productivityDashboard") as HTMLElement;

    expect(textContent("pageStateBadge")).toBe("Website access required");
    expect(permissionBanner.classList.contains("is-hidden")).toBe(false);
    expect(document.getElementById("domainSectionWrapper")?.classList.contains("is-hidden")).toBe(
      true,
    );
    expect(document.getElementById("siteProfileSection")?.classList.contains("is-hidden")).toBe(
      true,
    );
    expect((document.getElementById("checkboxEnableInput") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((document.getElementById("languageSelect") as HTMLSelectElement).disabled).toBe(false);
    expect(
      Boolean(
        pageStatePanel.compareDocumentPosition(permissionBanner) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        permissionBanner.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  test("shows a restricted-page state instead of site toggles on browser internal pages", async () => {
    await loadPopup({ tab: { id: 11, url: "chrome://extensions" } });

    expect(textContent("pageStateBadge")).toBe("Restricted page");
    expect(textContent("pageStateTitle")).toBe("Browser internal page");
    expect(textContent("pageStateBody")).toContain("cannot run on browser internal pages");
    expect(document.getElementById("pageStateMeta")?.classList.contains("is-hidden")).toBe(true);
    expect(document.getElementById("domainSectionWrapper")?.classList.contains("is-hidden")).toBe(
      false,
    );
    expect((document.getElementById("checkboxDomainInput") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((document.getElementById("checkboxDomainInput") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(document.getElementById("siteProfileSection")?.classList.contains("is-hidden")).toBe(
      true,
    );
  });

  test("renders translated copy for every non-actionable page state", async () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, "no_page"],
      ["about:blank", "restricted"],
      ["moz-extension://abc/options.html", "extension"],
      ["file:///tmp/a.txt", "file"],
      ["ftp://example.com", "other"],
    ];
    for (const [url, state] of cases) {
      await loadPopup({ tab: { id: 12, url } });
      for (const part of ["badge", "title", "body"]) {
        const key = `popup_page_state_${state}_${part}`;
        const expected = originalI18nGet!(key);
        expect(expected).not.toBe(key);
        expect(textContent(`pageState${part[0].toUpperCase()}${part.slice(1)}`)).toBe(expected);
      }
    }
  });

  test("shows recovery copy in the popup when permission checks are unavailable", async () => {
    await loadPopup({ tab: createWebsiteTab("https://docs.example.com") });

    const banner = document.getElementById("permissionBanner") as HTMLElement;
    const button = document.getElementById("grantPermissionBtn") as HTMLButtonElement;

    expect(banner.classList.contains("is-hidden")).toBe(false);
    expect(banner.dataset.permissionState).toBe("unavailable");
    expect(textContent("pageStateBadge")).toBe("Website access unavailable");
    expect(textContent("pageStateTitle")).toBe("docs.example.com");
    expect(textContent("pageStateBody")).toBe("");
    expect(document.getElementById("domainSectionWrapper")?.classList.contains("is-hidden")).toBe(
      true,
    );
    expect((document.getElementById("checkboxDomainInput") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(textContent("permissionTitle")).toBe("Check browser access");
    expect(textContent("permissionBody")).toBe(
      "FluentTyper could not verify website access right now. Reopen FluentTyper or reload this page, then try again. Your typing still stays local in your browser.",
    );
    expect(textContent("permissionTitle")).not.toContain("permission_status_");
    expect(textContent("permissionBody")).not.toContain("permission_status_");
    expect(button.hidden).toBe(true);
  });

  test("preserves full long hostnames through compact page-state and toggle hints", async () => {
    const longDomain =
      "very-long-subdomain-name-that-keeps-going.for-compact-popup-qa.example-enterprise-suite.co.uk";
    await loadPopup({
      permissions: granted,
      tab: createWebsiteTab(`https://${longDomain}/deep/path?q=1`),
    });

    const pageStateTitle = document.getElementById("pageStateTitle") as HTMLElement;
    const domainHint = document.getElementById("checkboxDomainHint") as HTMLElement;

    expect(pageStateTitle.textContent).toBe(longDomain);
    expect(pageStateTitle.title).toBe(longDomain);
    expect(domainHint.textContent).toBe(longDomain);
    expect(domainHint.title).toBe(longDomain);
  });

  test("keeps long localized popup copy intact for compact layouts", async () => {
    const localizedCases = [
      {
        label: "de",
        overrides: {
          popup_page_state_active_body:
            "Bereit auf dieser Website mit einer deutlich laengeren deutschen Statusbeschreibung fuer das kompakte Popup.",
          popup_page_state_profile_global: "Globale Standardeinstellungen fuer diese Website",
        },
      },
      {
        label: "fr",
        overrides: {
          popup_page_state_active_body:
            "Pret sur ce site avec une formulation francaise plus longue pour verifier la mise en page compacte du popup.",
          popup_page_state_profile_global: "Parametres globaux utilises pour ce site",
        },
      },
      {
        label: "pl",
        overrides: {
          popup_page_state_active_body:
            "Gotowe na tej stronie z dluzszym polskim opisem, ktory sprawdza zachowanie zwartego ukladu popupu.",
          popup_page_state_profile_global: "Ustawienia globalne stosowane dla tej witryny",
        },
      },
    ];

    for (const localizedCase of localizedCases) {
      await loadPopup({
        permissions: granted,
        tab: createWebsiteTab("https://example.com"),
        translations: localizedCase.overrides,
      });

      const pageStateMeta = document.getElementById("pageStateMeta") as HTMLElement;
      const languageNode = document.getElementById("pageStateLanguage") as HTMLElement;
      const profileNode = document.getElementById("pageStateProfile") as HTMLElement;

      expect(textContent("pageStateBody")).toBe(
        localizedCase.overrides.popup_page_state_active_body,
      );
      expect(languageNode.title).toBe(languageNode.textContent);
      expect(profileNode.textContent).toBe(localizedCase.overrides.popup_page_state_profile_global);
      expect(profileNode.title).toBe(localizedCase.overrides.popup_page_state_profile_global);
      expect(pageStateMeta.classList.contains("is-hidden")).toBe(false);
    }
  });

  test("keeps popup controls keyboard-focusable in the redesigned layout", async () => {
    await loadPopup({
      permissions: granted,
      tab: createWebsiteTab("https://keyboard.example.com"),
    });

    const optionsLink = document.getElementById("runOptions") as HTMLAnchorElement;

    expect(optionsLink.href).toContain("options/options.html");
    expect((focusElement("checkboxDomainInput") as HTMLElement | null)?.id).toBe(
      "checkboxDomainInput",
    );
    expect((focusElement("checkboxEnableInput") as HTMLElement | null)?.id).toBe(
      "checkboxEnableInput",
    );
    expect((focusElement("languageSelect") as HTMLElement | null)?.id).toBe("languageSelect");
    expect((focusElement("openStatsOptionsBtn") as HTMLElement | null)?.id).toBe(
      "openStatsOptionsBtn",
    );
    expect((focusElement("runOptions") as HTMLElement | null)?.id).toBe("runOptions");
    expect((focusElement("reportIssueLink") as HTMLElement | null)?.id).toBe("reportIssueLink");
  });

  test("explains stable auto-detect behavior in the popup", async () => {
    await loadPopup({
      permissions: granted,
      tab: createWebsiteTab("https://example.com"),
      responses: {
        [CMD_GET_AUTO_LANGUAGE_STATUS]: {
          status: {
            language: "fr_FR",
            locked: false,
          },
        },
      },
      storage: {
        "store.settings.language": JSON.stringify("auto_detect"),
        "store.settings.fallbackLanguage": JSON.stringify("en_US"),
        "store.settings.enabled_languages": JSON.stringify(["en_US", "fr_FR"]),
      },
    });

    expect(textContent("pageStateLanguage")).toContain("Auto-detect currently using French");
    expect(textContent("pageStateBody")).toContain(
      "Switches only after sustained nearby text. Single foreign words do not flip it.",
    );
  });

  test("localizes footer action labels and keeps accessible text for icon links", async () => {
    const translations = {
      settings: "Einstellungen",
      popup_advanced_options: "Optionen avancées hybrides",
      popup_report_issue: "Probleme melden sofort",
      popup_github_source: "Code source GitHub officiel",
      popup_support_development: "Wesprzyj dalszy rozwoj projektu",
      support_cta: "Wesprzyj FluentTyper",
    };
    await loadPopup({
      permissions: granted,
      tab: createWebsiteTab("https://example.com"),
      translations,
    });

    const options = document.getElementById("runOptions") as HTMLAnchorElement;
    expect(options.title).toBe(translations.popup_advanced_options);
    expect(options.querySelector("[data-i18n='settings']")?.textContent).toBe(
      translations.settings,
    );
    expect(options.querySelector(".is-sr-only")).toBeNull();

    const footerCases = [
      { id: "reportIssueLink", srText: translations.popup_report_issue },
      { id: "githubSourceLink", srText: translations.popup_github_source },
    ];

    const support = document.querySelector("#supportDevelopmentLink [data-i18n='support_cta']");
    expect(support?.textContent).toBe(translations.support_cta);
    expect(support?.classList.contains("is-sr-only")).toBe(false);

    for (const footerCase of footerCases) {
      const link = document.getElementById(footerCase.id) as HTMLAnchorElement;
      const srOnly = link.querySelector(".is-sr-only") as HTMLElement | null;

      expect(link.title).toBe(footerCase.srText);
      expect(srOnly?.textContent).toBe(footerCase.srText);
    }
  });

  test.each(["snooze", "dismiss", "support_clicked"] as const)(
    "support prompt sends %s without claiming a payment",
    async (action) => {
      const stats = createPopupStats(1);
      stats.donationPrompt = { promptId: "first_value", kind: "first_value", milestoneHours: null };
      const chromeMock = await loadPopup({ outcomes: [{ type: "stats", value: stats }] });
      const id =
        action === "snooze"
          ? "dashboardMilestoneLaterBtn"
          : action === "dismiss"
            ? "dashboardMilestoneDismissBtn"
            : "dashboardMilestoneLink";
      (document.getElementById(id) as HTMLElement).click();
      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
        {
          command: "CMD_POPUP_ACK_DONATION_MILESTONE",
          context: { promptId: "first_value", action, milestoneHours: null },
        },
        expect.any(Function),
      );
      if (action !== "support_clicked") {
        expect(
          document.getElementById("dashboardMilestoneHint")?.classList.contains("is-hidden"),
        ).toBe(true);
      }
      expect(document.getElementById("supportDevelopmentLink")).not.toBeNull();
    },
  );

  test("advanced stats button opens the options page anchor", async () => {
    const chromeMock = await loadPopup({
      outcomes: [{ type: "stats", value: createPopupStats(2) }],
    });

    (document.getElementById("openStatsOptionsBtn") as HTMLButtonElement).click();
    await flushAsyncWork();

    expect(chromeMock.tabs.create).toHaveBeenCalledTimes(1);
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({
      url: expect.stringContaining("options/options.html#advanced_tab"),
    });
  });

  test("Review text asks the current tab to review its focused editor, then closes", async () => {
    const chromeMock = await loadPopup({ permissions: granted, tab: createWebsiteTab() });
    // Shown in the "This site" panel, with the command's shortcut.
    const action = document.getElementById("reviewTextAction") as HTMLElement;
    expect(action.classList.contains("is-hidden")).toBe(false);
    chromeMock.tabs.sendMessage.mockImplementation(() => Promise.resolve());
    const close = jest.spyOn(window, "close").mockImplementation(() => undefined);

    (document.getElementById("reviewTextBtn") as HTMLButtonElement).click();

    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(17, {
      command: CMD_REVIEW_FT_ACTIVE_TAB,
      context: { source: "popup" },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("Review text shows its shortcut and follows the site switch without reopening", async () => {
    await loadPopup({ permissions: granted, tab: createWebsiteTab() });
    await flushAsyncWork();
    const shortcut = document.getElementById("reviewTextShortcut") as HTMLElement;
    expect(shortcut.textContent).toBe("Alt+Shift+R");
    expect(shortcut.classList.contains("is-hidden")).toBe(false);
    expect((document.getElementById("reviewTextBtn") as HTMLButtonElement).title).toBe(
      "Shortcut: Alt+Shift+R",
    );

    // Turning FluentTyper off for this site hides the action at once.
    (document.getElementById("checkboxDomainInput") as HTMLInputElement).click();
    await waitForCondition(
      () => document.getElementById("reviewTextAction")!.classList.contains("is-hidden"),
      "Review text stayed visible after the site was turned off.",
    );
  });

  test("the site and global toggles ignore tabs that have no content script", async () => {
    const chromeMock = await loadPopup({ permissions: granted, tab: createWebsiteTab() });
    chromeMock.tabs.query.mockImplementation((_query, callback) => callback([createWebsiteTab()]));
    // A tab without the content script rejects; an unhandled rejection fails the test.
    chromeMock.tabs.sendMessage.mockImplementation(() =>
      Promise.reject(new Error("Could not establish connection.")),
    );

    (document.getElementById("checkboxDomainInput") as HTMLInputElement).click();
    (document.getElementById("checkboxEnableInput") as HTMLInputElement).click();
    await waitForCondition(
      () => chromeMock.tabs.sendMessage.mock.calls.length === 2,
      "The toggles did not message the tabs.",
    );
    await flushAsyncWork();
  });

  test("Review text is hidden where FluentTyper is off", async () => {
    await loadPopup({
      permissions: granted,
      tab: createWebsiteTab(),
      storage: { "store.settings.enable": JSON.stringify(false) },
    });
    expect(document.getElementById("reviewTextAction")?.classList.contains("is-hidden")).toBe(true);
  });
});
