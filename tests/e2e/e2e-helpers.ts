import type { Browser, Page, WebWorker } from "puppeteer";
import puppeteer from "puppeteer";
import path from "path";

const EXTENSION_PATH = path.resolve(
  process.env.E2E_EXTENSION_PATH || path.join(__dirname, "../../build/"),
);
const IS_CI = process.env.CI === "true" || process.env.CI === "1";
const IS_HEADED = process.env.E2E_HEADED === "true" || process.env.E2E_HEADED === "1";

export type BrowserType = "chrome" | "firefox";
export type E2ESuite = "smoke" | "full";

export const BROWSER_TYPE: BrowserType = (process.env.E2E_BROWSER as BrowserType) || "chrome";
export const E2E_SUITE: E2ESuite = (process.env.E2E_SUITE as E2ESuite) || "full";

export interface E2ETimeoutProfile {
  navigationMs: number;
  inputReadyMs: number;
  suggestionMs: number;
}

export interface WaitUntilOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

const SMOKE_TIMEOUT_PROFILE: E2ETimeoutProfile = {
  navigationMs: isFirefox() ? 5000 : 3500,
  inputReadyMs: isFirefox() ? 7000 : 6000,
  suggestionMs: isFirefox() ? 5000 : 4500,
};

const FULL_TIMEOUT_PROFILE: E2ETimeoutProfile = {
  navigationMs: isFirefox() ? 8000 : 5000,
  inputReadyMs: isFirefox() ? 10000 : 20000,
  suggestionMs: isFirefox() ? 7000 : 8000,
};

export function getTimeoutProfile(): E2ETimeoutProfile {
  return E2E_SUITE === "smoke" ? SMOKE_TIMEOUT_PROFILE : FULL_TIMEOUT_PROFILE;
}

export function suiteTimeout(chromeTimeoutMs: number, firefoxTimeoutMs: number): number {
  return isFirefox() ? firefoxTimeoutMs : chromeTimeoutMs;
}

export async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function waitUntil<T>(
  label: string,
  predicate: () => Promise<T | false> | T | false,
  options: WaitUntilOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 50;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result !== false) {
      return result;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

// Firefox extension/debug pages frequently reach the desired URL/content
// without ever resolving puppeteer's navigation lifecycle events.
// Keep these short so the fallback readiness checks can run quickly.
const EXTENSION_NAVIGATION_TIMEOUT_MS = isFirefox() ? 300 : 5000;
// Pinned moz-extension host; Firefox no longer lets automation open about:debugging to discover it.
const FIREFOX_EXTENSION_ID = "{22ce0bca-91d0-4eac-8fd3-9b2045c7a6db}";
const FIREFOX_EXTENSION_HOST = "3f1c8a52-6b7e-4d19-9a0e-5c2f7b8d4e61";
const FIREFOX_NAVIGATION_RECOVERY_TIMEOUT_MS = 3000;
const EXTENSION_NAVIGATION_RECOVERY_TIMEOUT_MS = 3000;

export function isChrome(): boolean {
  return BROWSER_TYPE === "chrome";
}

export function isFirefox(): boolean {
  return BROWSER_TYPE === "firefox";
}

/**
 * Launch a browser with the extension loaded.
 */
export async function launchBrowser(): Promise<Browser> {
  if (isFirefox()) {
    return launchFirefox();
  }
  return launchChrome();
}

async function launchChrome(): Promise<Browser> {
  const args = [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    "--allow-file-access-from-files",
  ];
  if (IS_CI) {
    args.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage");
  }
  return puppeteer.launch({
    headless: !IS_HEADED,
    args,
    defaultViewport: null,
  });
}

let firefoxExtensionHost = "";
let chromeExtensionHost = "";

function cacheChromeExtensionHost(candidate: string | null | undefined): void {
  if (!candidate) {
    return;
  }
  chromeExtensionHost = candidate;
}

function isNavigationTimeout(error: unknown): boolean {
  return String(error).includes("Navigation timeout");
}

function isRetriableRuntimeUrlError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /runtime\.getURL|Cannot read properties of undefined|Execution context was destroyed|Session closed|Target closed|Connection closed|NoSuchFrameError|Browsing Context with id .* not found/i.test(
    message,
  );
}

function isRetriableBackgroundContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Execution context is not available in detached frame or worker|Cannot find context with specified id|Session closed|Target closed|Connection closed|background worker is unavailable|Waiting failed|NoSuchFrameError|Browsing Context with id .* not found/i.test(
    message,
  );
}

function getChromeExtensionIdFromTargets(browser: Browser): string | null {
  const extensionTarget = browser
    .targets()
    .find(
      (target) =>
        target.url().startsWith("chrome-extension://") &&
        (target.type() === "service_worker" || target.type() === "page"),
    );
  if (!extensionTarget) {
    return null;
  }
  try {
    const host = new URL(extensionTarget.url()).host || null;
    cacheChromeExtensionHost(host);
    return host;
  } catch {
    return null;
  }
}

async function resolveChromeExtensionId(browser: Browser): Promise<string | null> {
  const existingId = getChromeExtensionIdFromTargets(browser) || chromeExtensionHost || null;
  if (existingId) {
    return existingId;
  }

  try {
    const extensionTarget = await browser.waitForTarget(
      (target) =>
        target.url().startsWith("chrome-extension://") &&
        (target.type() === "service_worker" || target.type() === "page"),
      { timeout: 2000 },
    );
    const host = new URL(extensionTarget.url()).host || null;
    cacheChromeExtensionHost(host);
    return host;
  } catch {
    return null;
  }
}

async function openChromeExtensionPageContext(
  browser: Browser,
  extensionId: string,
): Promise<BackgroundContext> {
  const page = await browser.newPage();
  const optionsUrl = getExtensionPageUrl(extensionId, "options/options.html");
  try {
    await page.goto(optionsUrl, {
      waitUntil: "domcontentloaded",
      timeout: EXTENSION_NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isNavigationTimeout(error)) {
      throw error;
    }
    await page.waitForFunction(
      (expectedUrl) =>
        window.location.href === expectedUrl || window.location.href.includes(expectedUrl),
      { timeout: EXTENSION_NAVIGATION_RECOVERY_TIMEOUT_MS },
      optionsUrl,
    );
  }
  await page
    .waitForFunction(
      () =>
        document.readyState !== "loading" &&
        Boolean(
          (
            globalThis as typeof globalThis & {
              chrome?: typeof chrome;
            }
          ).chrome?.storage?.local,
        ),
      {
        timeout: EXTENSION_NAVIGATION_RECOVERY_TIMEOUT_MS,
      },
    )
    .catch(() => undefined);
  return page;
}

async function wakeChromeBackgroundWorker(browser: Browser, extensionId: string): Promise<void> {
  if (!browser.isConnected()) {
    return;
  }
  let wakePage: Page | null = null;
  try {
    wakePage = await browser.newPage();
    await wakePage.goto(getExtensionPageUrl(extensionId, "options/options.html"), {
      waitUntil: "domcontentloaded",
      timeout: 1000,
    });
    await wakePage.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ type: "__FT_E2E_WAKE_BACKGROUND__" }, () => {
          // Ignore runtime errors; sending any message is enough to wake MV3 worker.
          void chrome.runtime.lastError;
          resolve();
        });
      });
    });
  } catch {
    // Best-effort wake-up path.
  } finally {
    if (wakePage && !wakePage.isClosed()) {
      await wakePage.close();
    }
  }
}

function getExtensionIdFromContextUrl(context: BackgroundContext): string | null {
  if (typeof context.url !== "function") {
    return null;
  }
  const url = context.url();
  if (!url.startsWith("chrome-extension://") && !url.startsWith("moz-extension://")) {
    return null;
  }
  try {
    const host = new URL(url).host || null;
    if (url.startsWith("chrome-extension://")) {
      cacheChromeExtensionHost(host);
    }
    return host;
  } catch {
    return null;
  }
}

async function launchFirefox(): Promise<Browser> {
  const browser = await puppeteer.launch({
    browser: "firefox",
    headless: !IS_HEADED,
    defaultViewport: null,
    // Firefox's WebDriver BiDi refuses moz-extension:// navigation without this.
    args: ["--remote-allow-system-access"],
    extraPrefsFirefox: {
      "extensions.webextensions.uuids": JSON.stringify({
        [FIREFOX_EXTENSION_ID]: FIREFOX_EXTENSION_HOST,
      }),
    },
  });

  const extensionId = await browser.installExtension(EXTENSION_PATH);
  if (extensionId !== FIREFOX_EXTENSION_ID) {
    throw new Error(`Unexpected Firefox extension id: ${extensionId}`);
  }
  firefoxExtensionHost = FIREFOX_EXTENSION_HOST;
  return browser;
}

export type BackgroundContext = (Page | WebWorker) & {
  close?: () => Promise<void>;
};

/**
 * Wait for the extension's background context and return it.
 * Chrome uses a service worker, Firefox uses a background page or hidden page.
 */
export async function getBackgroundContext(browser: Browser): Promise<BackgroundContext> {
  if (isChrome()) {
    try {
      const serviceWorkerTarget = await browser.waitForTarget(
        (target) => target.type() === "service_worker" && target.url().endsWith("background.js"),
        { timeout: 1000 },
      );
      const worker = await serviceWorkerTarget.worker();
      if (!worker) {
        throw new Error("Chrome background worker is unavailable");
      }
      cacheChromeExtensionHost(new URL(serviceWorkerTarget.url()).host || null);
      await worker.evaluate(() => {
        const storage = (
          globalThis as typeof globalThis & {
            chrome?: typeof chrome;
          }
        ).chrome?.storage?.local;
        if (!storage) {
          throw new Error("chrome.storage.local is unavailable");
        }
      });
      return worker;
    } catch (error) {
      if (!isRetriableBackgroundContextError(error)) {
        throw error;
      }
      const extensionId = await resolveChromeExtensionId(browser);
      if (extensionId) {
        await wakeChromeBackgroundWorker(browser, extensionId);
        try {
          const serviceWorkerTarget = await browser.waitForTarget(
            (target) =>
              target.type() === "service_worker" && target.url().endsWith("background.js"),
            { timeout: 1500 },
          );
          const worker = await serviceWorkerTarget.worker();
          if (worker) {
            cacheChromeExtensionHost(new URL(serviceWorkerTarget.url()).host || null);
            await worker.evaluate(() => {
              const storage = (
                globalThis as typeof globalThis & {
                  chrome?: typeof chrome;
                }
              ).chrome?.storage?.local;
              if (!storage) {
                throw new Error("chrome.storage.local is unavailable", { cause: error });
              }
            });
            return worker;
          }
        } catch {
          // Fall back to an extension page context below.
        }
        return await openChromeExtensionPageContext(browser, extensionId);
      }
      throw new Error("chrome.storage.local is unavailable", {
        cause: error,
      });
    }
  }

  if (!firefoxExtensionHost) {
    throw new Error("Firefox extension host is unavailable. Did you call launchBrowser?");
  }
  const optionsUrl = getExtensionPageUrl(firefoxExtensionHost, "options/options.html");
  const page = await browser.newPage();
  try {
    await page.goto(optionsUrl, {
      waitUntil: "domcontentloaded",
      timeout: EXTENSION_NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isNavigationTimeout(error)) {
      throw error;
    }
    await page.waitForFunction(
      (expectedPath) => window.location.href.includes(expectedPath),
      { timeout: FIREFOX_NAVIGATION_RECOVERY_TIMEOUT_MS },
      "options/options.html",
    );
  }
  await page
    .waitForFunction(() => document.readyState !== "loading", {
      timeout: FIREFOX_NAVIGATION_RECOVERY_TIMEOUT_MS,
    })
    .catch(() => undefined);
  return page;
}

export async function getRuntimePageUrl(
  context: BackgroundContext,
  pagePath: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await context.evaluate((pagePathInner) => {
        const runtime = (
          globalThis as typeof globalThis & {
            chrome?: typeof chrome;
          }
        ).chrome?.runtime;
        if (!runtime?.getURL) {
          throw new Error("chrome.runtime.getURL is unavailable");
        }
        return runtime.getURL(pagePathInner);
      }, pagePath);
    } catch (error) {
      lastError = error;
      if (isChrome() && isRetriableRuntimeUrlError(error)) {
        const extensionId = getExtensionIdFromContextUrl(context);
        if (extensionId) {
          return getExtensionPageUrl(extensionId, pagePath);
        }
      }
      if (!isRetriableRuntimeUrlError(error) || attempt === 5) {
        throw error;
      }
      await sleep(100);
    }
  }
  throw lastError;
}

/**
 * Build an extension page URL for the current browser.
 * Chrome: chrome-extension://<id>/<path>
 * Firefox: moz-extension://<id>/<path>
 */
export function getExtensionPageUrl(extensionId: string, pagePath: string): string {
  const protocol = isFirefox() ? "moz-extension" : "chrome-extension";
  return `${protocol}://${extensionId}/${pagePath}`;
}

export async function openExtensionPage(
  browser: Browser,
  context: BackgroundContext,
  pagePath: string,
): Promise<import("puppeteer").Page> {
  const url = await getRuntimePageUrl(context, pagePath);
  const page = await browser.newPage();
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: EXTENSION_NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isNavigationTimeout(error)) {
      throw error;
    }
    await page.waitForFunction(
      (expectedPath) => window.location.href.includes(expectedPath),
      { timeout: EXTENSION_NAVIGATION_RECOVERY_TIMEOUT_MS },
      pagePath,
    );
  }
  await page
    .waitForFunction(() => document.readyState !== "loading", {
      timeout: EXTENSION_NAVIGATION_RECOVERY_TIMEOUT_MS,
    })
    .catch(() => undefined);
  return page;
}

export async function openPopupPage(
  browser: Browser,
  context: BackgroundContext,
): Promise<import("puppeteer").Page> {
  if (isChrome()) {
    try {
      const popupTargetPromise = browser.waitForTarget(
        (target) => target.type() === "page" && target.url().endsWith("popup/popup.html"),
        { timeout: 2000 },
      );
      await context.evaluate("chrome.action.openPopup();");
      const popupTarget = await popupTargetPromise;
      const popupPage = await popupTarget.asPage();
      if (popupPage) {
        return popupPage;
      }
    } catch {
      // Fall back to direct navigation.
    }
  }
  return openExtensionPage(browser, context, "popup/popup.html");
}

export async function triggerCommandForTesting(
  context: BackgroundContext,
  command: string,
): Promise<void> {
  await context.evaluate((commandInner) => {
    return new Promise<void>((resolve, reject) => {
      const hook = (
        globalThis as typeof globalThis & {
          triggerCommandForTesting?: (command: string) => Promise<void> | void;
        }
      ).triggerCommandForTesting;
      if (typeof hook === "function") {
        Promise.resolve(hook(commandInner)).then(resolve, reject);
        return;
      }
      chrome.runtime.sendMessage(
        { type: "TEST_TRIGGER_COMMAND", command: commandInner },
        (response: { ok?: boolean } | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error("Test command ACK returned not ok"));
            return;
          }
          resolve();
        },
      );
    });
  }, command);
}

export interface WebLLMTestPredictionCall {
  lang: string;
  predictionInput: string;
  numSuggestions: number;
}

async function sendTestRuntimeMessage(
  context: BackgroundContext,
  message: Record<string, unknown>,
  failureMessage: string,
): Promise<Record<string, unknown> | undefined> {
  return await context.evaluate(
    (messageInner, failureMessageInner) => {
      return new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const testGlobals = globalThis as typeof globalThis & {
          triggerCommandForTesting?: (command: string) => Promise<void> | void;
          __fluentTyperWebLLMTestOverride__?: {
            predictions: string[];
            delayMs: number;
            calls: Array<{
              lang: string;
              predictionInput: string;
              numSuggestions: number;
            }>;
          };
        };
        const messageType = messageInner.type;
        if (
          typeof messageType === "string" &&
          typeof testGlobals.triggerCommandForTesting === "function"
        ) {
          if (messageType === "TEST_SET_WEBLLM_PREDICTIONS") {
            const predictions = Array.isArray(messageInner.predictions)
              ? messageInner.predictions
                  .filter((item): item is string => typeof item === "string")
                  .map((item) => item.trim())
                  .filter((item) => item.length > 0)
              : [];
            const delayMs =
              typeof messageInner.delayMs === "number" && Number.isFinite(messageInner.delayMs)
                ? Math.max(0, Math.round(messageInner.delayMs))
                : 0;
            testGlobals.__fluentTyperWebLLMTestOverride__ = {
              predictions,
              delayMs,
              calls: [],
            };
            resolve({ ok: true });
            return;
          }
          if (messageType === "TEST_CLEAR_WEBLLM_PREDICTIONS") {
            delete testGlobals.__fluentTyperWebLLMTestOverride__;
            resolve({ ok: true });
            return;
          }
          if (messageType === "TEST_GET_WEBLLM_PREDICTION_CALLS") {
            resolve({
              ok: true,
              calls: testGlobals.__fluentTyperWebLLMTestOverride__?.calls?.slice() ?? [],
            });
            return;
          }
        }

        chrome.runtime.sendMessage(
          messageInner,
          (response: Record<string, unknown> | undefined) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response || response.ok !== true) {
              reject(new Error(failureMessageInner));
              return;
            }
            resolve(response);
          },
        );
      });
    },
    message,
    failureMessage,
  );
}

export async function setWebLLMPredictionsForTesting(
  context: BackgroundContext,
  predictions: string[],
  delayMs = 0,
): Promise<void> {
  await sendTestRuntimeMessage(
    context,
    {
      type: "TEST_SET_WEBLLM_PREDICTIONS",
      predictions,
      delayMs,
    },
    "Failed to set test WebLLM predictions",
  );
}

export async function clearWebLLMPredictionsForTesting(context: BackgroundContext): Promise<void> {
  await sendTestRuntimeMessage(
    context,
    { type: "TEST_CLEAR_WEBLLM_PREDICTIONS" },
    "Failed to clear test WebLLM predictions",
  );
}

export async function getWebLLMPredictionCallsForTesting(
  context: BackgroundContext,
): Promise<WebLLMTestPredictionCall[]> {
  const response = await sendTestRuntimeMessage(
    context,
    { type: "TEST_GET_WEBLLM_PREDICTION_CALLS" },
    "Failed to read test WebLLM prediction calls",
  );
  if (!response || !Array.isArray(response.calls)) {
    return [];
  }
  return response.calls
    .map((call) => {
      if (
        typeof call !== "object" ||
        !call ||
        typeof (call as Record<string, unknown>).lang !== "string" ||
        typeof (call as Record<string, unknown>).predictionInput !== "string" ||
        typeof (call as Record<string, unknown>).numSuggestions !== "number"
      ) {
        return null;
      }
      return {
        lang: (call as Record<string, unknown>).lang as string,
        predictionInput: (call as Record<string, unknown>).predictionInput as string,
        numSuggestions: (call as Record<string, unknown>).numSuggestions as number,
      };
    })
    .filter((call): call is WebLLMTestPredictionCall => call !== null);
}

// ---------------------------------------------------------------- review mode

export const REVIEW_HOST_SELECTOR = "[data-fluenttyper-review]";

export interface ReviewPanelSnapshot {
  open: boolean;
  status: string;
  notes: string;
  items: Array<{ id: string; text: string; category: string; current: boolean }>;
  fixAll: { text: string; disabled: boolean; hidden: boolean };
  card: { open: boolean; text: string; applyDisabled: boolean };
  marks: Array<{ category: string; left: number; top: number; width: number; height: number }>;
  highlights: string[];
  focus: string | null;
}

/**
 * Sends exactly what the review keyboard command sends (CommandRouter): the
 * review request to every frame of the active tab.
 */
export async function triggerReview(
  context: BackgroundContext,
  source: "command" | "popup" = "command",
): Promise<void> {
  await context.evaluate(async (sourceInner) => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs.find((candidate) => /^https?:/.test(candidate.url ?? "")) ?? tabs[0];
    if (typeof tab?.id !== "number") throw new Error("No active tab");
    await chrome.tabs
      .sendMessage(tab.id, {
        command: "CMD_REVIEW_FT_ACTIVE_TAB",
        context: { source: sourceInner },
      })
      .catch(() => undefined);
  }, source);
}

export async function readReviewPanel(page: Page): Promise<ReviewPanelSnapshot> {
  return page.evaluate((hostSelector) => {
    const host = document.querySelector(hostSelector);
    const root = host?.shadowRoot ?? null;
    const text = (selector: string) => root?.querySelector(selector)?.textContent ?? "";
    const fixAll = root?.querySelector<HTMLButtonElement>("[data-action=fix-all]");
    const card = root?.querySelector<HTMLElement>(".card");
    const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS
      ?.highlights;
    const focused = root?.activeElement as HTMLElement | null | undefined;
    return {
      open: !!root,
      status: text(".status"),
      notes: text(".notes"),
      items: Array.from(root?.querySelectorAll<HTMLElement>(".item") ?? []).map((item) => ({
        id: item.dataset.id ?? "",
        text: item.querySelector(".change")?.textContent ?? "",
        category: item.dataset.category ?? "",
        current: item.getAttribute("aria-current") === "true",
      })),
      fixAll: {
        text: fixAll?.textContent ?? "",
        disabled: fixAll?.disabled ?? true,
        hidden: fixAll?.hidden ?? true,
      },
      card: {
        open: !!card && !card.hidden,
        text: card?.textContent ?? "",
        applyDisabled:
          card?.querySelector<HTMLButtonElement>("[data-action=apply]")?.disabled ?? true,
      },
      marks: Array.from(root?.querySelectorAll<HTMLElement>(".mark") ?? []).map((mark) => {
        const rect = mark.getBoundingClientRect();
        return {
          category: mark.dataset.category ?? "",
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }),
      highlights: registry
        ? Array.from(registry.keys()).filter((name) => name.startsWith("fluenttyper-review-"))
        : [],
      focus: focused
        ? `${focused.tagName.toLowerCase()}${focused.dataset.action ? `[${focused.dataset.action}]` : ""}${focused.classList.contains("item") ? ".item" : ""}`
        : null,
    };
  }, REVIEW_HOST_SELECTOR);
}

export async function waitForReview(
  page: Page,
  label: string,
  predicate: (panel: ReviewPanelSnapshot) => boolean,
  timeoutMs = 8000,
): Promise<ReviewPanelSnapshot> {
  let last: ReviewPanelSnapshot | null = null;
  try {
    return await waitUntil(
      label,
      async () => {
        last = await readReviewPanel(page);
        return predicate(last) ? last : false;
      },
      { timeoutMs, intervalMs: 40 },
    );
  } catch (error) {
    throw new Error(`${String(error)}; last panel: ${JSON.stringify(last)}`, { cause: error });
  }
}

/** A real mouse click on a control inside the review UI. */
export async function clickReviewControl(page: Page, selector: string): Promise<void> {
  const point = await page.evaluate(
    (hostSelector, selectorInner) => {
      const element = document
        .querySelector(hostSelector)
        ?.shadowRoot?.querySelector<HTMLElement>(selectorInner);
      if (!element) return null;
      element.scrollIntoView({ block: "nearest" });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    REVIEW_HOST_SELECTOR,
    selector,
  );
  if (!point) throw new Error(`Review control not found: ${selector}`);
  await page.mouse.click(point.x, point.y);
}

/** Center of the n-th occurrence (1-based) of `needle` in an editor's text nodes. */
export async function textPoint(
  page: Page,
  editorSelector: string,
  needle: string,
  occurrence = 1,
): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    (selector, needleInner, occurrenceInner) => {
      const root = document.querySelector(selector);
      if (!root) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data;
        for (
          let index = data.indexOf(needleInner);
          index >= 0;
          index = data.indexOf(needleInner, index + 1)
        ) {
          seen += 1;
          if (seen === occurrenceInner) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + needleInner.length);
            const rect = range.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
        }
      }
      return null;
    },
    editorSelector,
    needle,
    occurrence,
  );
  if (!point) throw new Error(`Text not found: ${needle}`);
  return point;
}
