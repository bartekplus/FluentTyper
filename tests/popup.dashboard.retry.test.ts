import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { JSDOM } from "jsdom";
import { CMD_POPUP_GET_PRODUCTIVITY_STATS } from "../src/core/domain/constants";
import type { ProductivityDashboardStats } from "../src/core/domain/messageTypes";

type RuntimeOutcome =
  | { type: "stats"; value: ProductivityDashboardStats }
  | { type: "response"; value: { ok: boolean } }
  | { type: "lastError"; message?: string };

const baseGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  navigator: globalThis.navigator,
  Node: globalThis.Node,
  HTMLElement: globalThis.HTMLElement,
  HTMLButtonElement: globalThis.HTMLButtonElement,
  Element: globalThis.Element,
  Event: globalThis.Event,
  CustomEvent: globalThis.CustomEvent,
  MutationObserver: globalThis.MutationObserver,
  getComputedStyle: globalThis.getComputedStyle,
  chrome: (globalThis as unknown as { chrome: unknown }).chrome,
};

let importNonce = 0;
let activeDom: JSDOM | null = null;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_popup_retry=${importNonce}`;
}

function popupMarkup(initialAccepted = "0"): string {
  return `<!doctype html>
<html>
  <body>
    <div id="pageStatePanel" data-page-state="active">
      <span id="pageStateBadge"></span>
      <h2 id="pageStateTitle"></h2>
      <p id="pageStateBody"></p>
    </div>
    <input id="checkboxSiteProfileInput" type="checkbox" />
    <select id="siteLanguageSelect"></select>
    <select id="siteNumSuggestionsSelect"></select>
    <select id="siteInlineModeSelect"></select>
    <div id="domainSectionWrapper"></div>
    <section id="siteProfileSection"></section>
    <small id="siteProfileStatus"></small>
    <div id="siteProfileDetails" class="is-hidden"></div>

    <input id="checkboxDomainInput" type="checkbox" />
    <div id="checkboxDomainLabel"></div>
    <div id="checkboxDomainHint"></div>
    <input id="checkboxEnableInput" type="checkbox" />
    <select id="languageSelect"></select>
    <a id="runOptions"></a>

    <details id="productivityDashboard">
      <summary>
        <span id="dashboardCollapsedSummary">init-collapsed</span>
      </summary>
    </details>
    <button id="openStatsOptionsBtn" type="button"></button>
    <span id="metricAccepted">${initialAccepted}</span>
    <span id="metricCharsSaved">init-chars</span>
    <span id="metricMinutesSaved">init-minutes</span>
    <div id="dashboardProgressFill" style="width: 10%"></div>
    <span id="dashboardProgressLabel">init-progress</span>
    <p id="dashboardPeriodSummary">init-period</p>
    <p id="dashboardLanguageSummary">init-language</p>

    <div id="weeklyRecapCard" class="is-hidden"></div>
    <p id="weeklyRecapTitle"></p>
    <p id="weeklyRecapSummary"></p>
    <p id="weeklyRecapMilestone"></p>
    <p id="weeklyRecapEquivalent"></p>
    <p id="weeklyRecapSnippet"></p>
    <button id="weeklyRecapDismissBtn" type="button"></button>
    <button id="weeklyRecapViewBtn" type="button"></button>
    <button id="weeklyRecapShareBtn" type="button"></button>
    <a id="weeklyRecapSupportLink"></a>

    <div id="dashboardMilestoneHint" class="is-hidden"></div>
    <span id="dashboardMilestoneText"></span>
    <a id="dashboardMilestoneLink"></a>
    <button id="dashboardMilestoneLaterBtn" type="button"></button>

    <div id="permissionBanner" class="is-hidden" data-permission-state="missing">
      <span id="permissionBadge"></span>
      <h2 id="permissionTitle"></h2>
      <p id="permissionBody"></p>
      <button id="grantPermissionBtn" type="button"></button>
    </div>
  </body>
</html>`;
}

function installPopupDom(initialAccepted = "0"): JSDOM {
  const dom = new JSDOM(popupMarkup(initialAccepted), {
    pretendToBeVisual: true,
    url: "https://example.test/popup/popup.html",
  });
  const windowRef = dom.window;

  (globalThis as unknown as { window: Window }).window = windowRef as unknown as Window;
  (globalThis as unknown as { document: Document }).document = windowRef.document;
  (globalThis as unknown as { navigator: Navigator }).navigator = windowRef.navigator;
  (globalThis as unknown as { Node: typeof Node }).Node = windowRef.Node as unknown as typeof Node;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    windowRef.HTMLElement as unknown as typeof HTMLElement;
  (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement =
    windowRef.HTMLButtonElement as unknown as typeof HTMLButtonElement;
  (globalThis as unknown as { Element: typeof Element }).Element =
    windowRef.Element as unknown as typeof Element;
  (globalThis as unknown as { Event: typeof Event }).Event =
    windowRef.Event as unknown as typeof Event;
  (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent =
    windowRef.CustomEvent as unknown as typeof CustomEvent;
  (globalThis as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver =
    windowRef.MutationObserver as unknown as typeof MutationObserver;
  (globalThis as unknown as { getComputedStyle: typeof getComputedStyle }).getComputedStyle =
    windowRef.getComputedStyle.bind(windowRef) as unknown as typeof getComputedStyle;

  windowRef.setTimeout = setTimeout as unknown as typeof windowRef.setTimeout;
  windowRef.clearTimeout = clearTimeout as unknown as typeof windowRef.clearTimeout;
  return dom;
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
  permissionApi?: {
    contains?: (options: chrome.permissions.Permissions) => Promise<boolean> | boolean;
    request?: (options: chrome.permissions.Permissions) => Promise<boolean> | boolean;
  },
  activeTab?: chrome.tabs.Tab,
) {
  const pending = [...outcomes];
  const storage = new Map<string, unknown>();

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
        if (callback) {
          runtime.lastError = null;
          callback({ ok: true });
        }
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
      sendMessage: jest.fn(),
    },
    storage: {
      local: localStorageApi,
      sync: localStorageApi,
    },
    permissions: undefined,
  };

  if (permissionApi) {
    chromeMock.permissions = {
      contains: jest.fn(permissionApi.contains),
      request: jest.fn(permissionApi.request),
    };
  }

  return chromeMock;
}

async function flushAsyncWork(rounds = 6): Promise<void> {
  for (let idx = 0; idx < rounds; idx += 1) {
    await Promise.resolve();
  }
}

async function advanceAndFlush(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await flushAsyncWork();
}

function textContent(id: string): string {
  return document.getElementById(id)?.textContent || "";
}

function dashboardStatsCallCount(chromeMock: ReturnType<typeof createChromeMock>): number {
  return chromeMock.runtime.sendMessage.mock.calls.filter(
    (call) => call[0]?.command === CMD_POPUP_GET_PRODUCTIVITY_STATS,
  ).length;
}

async function loadPopupWithOutcomes(
  outcomes: RuntimeOutcome[],
  initialAccepted = "0",
  permissionApi?: {
    contains?: (options: chrome.permissions.Permissions) => Promise<boolean> | boolean;
    request?: (options: chrome.permissions.Permissions) => Promise<boolean> | boolean;
  },
  activeTab?: chrome.tabs.Tab,
): Promise<ReturnType<typeof createChromeMock>> {
  activeDom = installPopupDom(initialAccepted);
  const chromeMock = createChromeMock(outcomes, permissionApi, activeTab);
  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
  (window as unknown as { chrome: unknown }).chrome = chromeMock;

  await import(freshModulePath("../src/ui/popup/popup"));
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flushAsyncWork();
  return chromeMock;
}

describe("popup productivity dashboard retry/failure paths", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();

    if (activeDom) {
      activeDom.window.close();
      activeDom = null;
    }

    (globalThis as unknown as { window: Window }).window = baseGlobals.window;
    (globalThis as unknown as { document: Document }).document = baseGlobals.document;
    (globalThis as unknown as { navigator: Navigator }).navigator = baseGlobals.navigator;
    (globalThis as unknown as { Node: typeof Node }).Node = baseGlobals.Node;
    (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
      baseGlobals.HTMLElement;
    (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement =
      baseGlobals.HTMLButtonElement;
    (globalThis as unknown as { Element: typeof Element }).Element = baseGlobals.Element;
    (globalThis as unknown as { Event: typeof Event }).Event = baseGlobals.Event;
    (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent =
      baseGlobals.CustomEvent;
    (globalThis as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver =
      baseGlobals.MutationObserver;
    (globalThis as unknown as { getComputedStyle: typeof getComputedStyle }).getComputedStyle =
      baseGlobals.getComputedStyle;
    (globalThis as unknown as { chrome: unknown }).chrome = baseGlobals.chrome;
  });

  test("renders dashboard immediately on first successful stats response", async () => {
    const stats = createPopupStats(6);
    const chromeMock = await loadPopupWithOutcomes([{ type: "stats", value: stats }]);

    expect(dashboardStatsCallCount(chromeMock)).toBe(1);
    expect(textContent("metricAccepted")).toBe("60");
    expect(textContent("dashboardPeriodSummary")).not.toContain("unavailable");
    expect(textContent("dashboardCollapsedSummary")).toContain("Last 7 days:");

    await advanceAndFlush(10000);
    expect(dashboardStatsCallCount(chromeMock)).toBe(1);
  });

  test("retries through backoff budget and renders unavailable state after repeated failures", async () => {
    const chromeMock = await loadPopupWithOutcomes([
      { type: "response", value: { ok: false } },
      { type: "response", value: { ok: false } },
      { type: "response", value: { ok: false } },
      { type: "response", value: { ok: false } },
      { type: "response", value: { ok: false } },
      { type: "response", value: { ok: false } },
    ]);

    for (const delayMs of [150, 300, 600, 1200, 2400]) {
      await advanceAndFlush(delayMs);
    }

    expect(dashboardStatsCallCount(chromeMock)).toBe(6);
    expect(textContent("metricAccepted")).toBe("--");
    expect(textContent("metricCharsSaved")).toBe("--");
    expect(textContent("metricMinutesSaved")).toBe("--");
    expect(textContent("dashboardProgressLabel")).toBe("--");
    expect((document.getElementById("dashboardProgressFill") as HTMLElement).style.width).toBe(
      "0%",
    );
    expect(textContent("dashboardPeriodSummary").toLowerCase()).toContain("unavailable");
    expect(textContent("dashboardLanguageSummary").toLowerCase()).toContain("unavailable");
    expect(document.getElementById("weeklyRecapCard")?.classList.contains("is-hidden")).toBe(true);
    expect(document.getElementById("dashboardMilestoneHint")?.classList.contains("is-hidden")).toBe(
      true,
    );
  });

  test("uses configured retry backoff timings before succeeding", async () => {
    const chromeMock = await loadPopupWithOutcomes([
      { type: "lastError", message: "transient failure #1" },
      { type: "response", value: { ok: false } },
      { type: "stats", value: createPopupStats(4) },
    ]);

    expect(dashboardStatsCallCount(chromeMock)).toBe(1);

    await advanceAndFlush(149);
    expect(dashboardStatsCallCount(chromeMock)).toBe(1);

    await advanceAndFlush(1);
    expect(dashboardStatsCallCount(chromeMock)).toBe(2);

    await advanceAndFlush(299);
    expect(dashboardStatsCallCount(chromeMock)).toBe(2);

    await advanceAndFlush(1);
    expect(dashboardStatsCallCount(chromeMock)).toBe(3);
    expect(textContent("metricAccepted")).toBe("40");

    await advanceAndFlush(10000);
    expect(dashboardStatsCallCount(chromeMock)).toBe(3);
  });

  test("cancels pending retries on unload", async () => {
    const chromeMock = await loadPopupWithOutcomes(
      [
        { type: "response", value: { ok: false } },
        { type: "stats", value: createPopupStats(5) },
      ],
      "init-accepted",
    );

    expect(dashboardStatsCallCount(chromeMock)).toBe(1);
    window.dispatchEvent(new window.Event("unload"));
    await flushAsyncWork();

    await advanceAndFlush(5000);
    expect(dashboardStatsCallCount(chromeMock)).toBe(1);
    expect(textContent("metricAccepted")).toBe("init-accepted");
    expect(textContent("dashboardPeriodSummary")).toBe("init-period");
  });

  test("uses shared missing and granted permission states in the popup", async () => {
    const chromeMock = await loadPopupWithOutcomes(
      [{ type: "stats", value: createPopupStats(1) }],
      "0",
      {
        contains: async () => false,
        request: async () => true,
      },
    );

    const banner = document.getElementById("permissionBanner") as HTMLElement;
    const button = document.getElementById("grantPermissionBtn") as HTMLButtonElement;

    expect(banner.classList.contains("is-hidden")).toBe(false);
    expect(banner.dataset.permissionState).toBe("missing");
    expect(textContent("permissionTitle")).toBe("Allow page access");
    expect(textContent("permissionBody")).toBe(
      "FluentTyper needs website access to show suggestions in text fields, and everything stays local in your browser.",
    );
    expect(button.textContent).toBe("Allow page access");
    expect(textContent("permissionTitle")).not.toContain("permission_status_");
    expect(textContent("permissionBody")).not.toContain("permission_status_");

    button.click();
    await flushAsyncWork();

    expect(banner.dataset.permissionState).toBe("granted");
    expect(textContent("permissionTitle")).toBe("Access granted");
    expect(textContent("permissionBody")).toBe(
      "FluentTyper can now show suggestions in text fields, and everything still stays local in your browser.",
    );
    expect(button.hidden).toBe(true);
    expect(chromeMock.permissions?.contains).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(chromeMock.permissions?.request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
  });

  test("shows a restricted-page state instead of site toggles on browser internal pages", async () => {
    await loadPopupWithOutcomes([{ type: "stats", value: createPopupStats(1) }], "0", undefined, {
      id: 11,
      url: "chrome://extensions",
    });

    expect(textContent("pageStateBadge")).toBe("Restricted page");
    expect(textContent("pageStateTitle")).toBe("Browser internal page");
    expect(textContent("pageStateBody")).toContain("cannot run on browser internal pages");
    expect(document.getElementById("domainSectionWrapper")?.classList.contains("is-hidden")).toBe(
      true,
    );
  });

  test("shows recovery copy in the popup when permission checks are unavailable", async () => {
    await loadPopupWithOutcomes([{ type: "stats", value: createPopupStats(1) }]);

    const banner = document.getElementById("permissionBanner") as HTMLElement;
    const button = document.getElementById("grantPermissionBtn") as HTMLButtonElement;

    expect(banner.classList.contains("is-hidden")).toBe(false);
    expect(banner.dataset.permissionState).toBe("unavailable");
    expect(textContent("permissionTitle")).toBe("Check browser access");
    expect(textContent("permissionBody")).toBe(
      "FluentTyper could not verify website access right now. Reopen FluentTyper or reload this page, then try again. Your typing still stays local in your browser.",
    );
    expect(textContent("permissionTitle")).not.toContain("permission_status_");
    expect(textContent("permissionBody")).not.toContain("permission_status_");
    expect(button.hidden).toBe(true);
  });
});
