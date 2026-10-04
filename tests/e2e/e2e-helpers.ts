import type { Browser, CDPSession, ElementHandle, Frame, Page, Target, WebWorker } from "puppeteer";
import puppeteer from "puppeteer";
import path from "path";
import { CMD_OPTIONS_PAGE_CONFIG_CHANGE } from "../../src/core/domain/constants";

const EXTENSION_PATH = path.resolve(
  process.env.E2E_EXTENSION_PATH || path.join(__dirname, "../../build/"),
);
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const TEST_PAGE_PATH = path.join(__dirname, "test-page.html");
const IS_CI = process.env.CI === "true" || process.env.CI === "1";
const IS_HEADED = process.env.E2E_HEADED === "true" || process.env.E2E_HEADED === "1";

export type BrowserType = "chrome" | "firefox";
export type E2ESuite = "smoke" | "full";

export const BROWSER_TYPE: BrowserType = (process.env.E2E_BROWSER as BrowserType) || "chrome";
export const E2E_SUITE: E2ESuite = (process.env.E2E_SUITE as E2ESuite) || "full";
export const SETTINGS_PREFIX = "store.settings.";

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

export const sleep = Bun.sleep;

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
// These waits end as soon as the page is there. Firefox's first moz-extension load after
// install can outlast 3s on CI runners, so its cap matches the suite's own Firefox budget.
const EXTENSION_NAVIGATION_RECOVERY_TIMEOUT_MS = suiteTimeout(3000, 10000);
const WORKER_REACQUIRE_TIMEOUT_MS = isFirefox() || IS_CI ? 15000 : 7000;

export function isChrome(): boolean {
  return BROWSER_TYPE === "chrome";
}

export function isFirefox(): boolean {
  return BROWSER_TYPE === "firefox";
}

let launchedBrowser: Browser | null = null;

/**
 * Launch a browser with the extension loaded.
 */
export async function launchBrowser(): Promise<Browser> {
  launchedBrowser = isFirefox() ? await launchFirefox() : await launchChrome();
  return launchedBrowser;
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

function isRetriableBackgroundContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Execution context is not available in detached frame or worker|Cannot find context with specified id|Session closed|Target closed|Connection closed|background worker is unavailable|Waiting failed|NoSuchFrameError|Browsing Context with id .* not found/i.test(
    message,
  );
}

/** Errors after which a fresh background context can repeat the same call. */
export function isRetriableWorkerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /chrome\.storage\.local is unavailable|reading 'local'|chrome\.runtime\.getURL is unavailable|runtime\.getURL|Execution context was destroyed|Execution context is not available in detached frame or worker|Cannot find context with specified id|Target closed|Session closed|Timed out after waiting \d+ms|NoSuchFrameError|Browsing Context with id .* not found/i.test(
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

/** Opens an extension page in `page` and waits until its scripts can run. */
async function gotoExtensionPage(page: Page, url: string): Promise<Page> {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: EXTENSION_NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    if (!String(error).includes("Navigation timeout")) {
      throw error;
    }
    await page.waitForFunction(
      (expectedPath) => window.location.href.includes(expectedPath),
      { timeout: EXTENSION_NAVIGATION_RECOVERY_TIMEOUT_MS },
      new URL(url).pathname,
    );
  }
  await page
    .waitForFunction(
      () =>
        document.readyState !== "loading" &&
        Boolean((globalThis as { chrome?: typeof chrome }).chrome?.storage?.local),
      { timeout: EXTENSION_NAVIGATION_RECOVERY_TIMEOUT_MS },
    )
    .catch(() => undefined);
  return page;
}

async function wakeChromeBackgroundWorker(browser: Browser, extensionId: string): Promise<void> {
  if (!browser.connected) {
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

async function assertStorageAvailable(context: BackgroundContext): Promise<void> {
  await context.evaluate(() => {
    if (!(globalThis as { chrome?: typeof chrome }).chrome?.storage?.local) {
      throw new Error("chrome.storage.local is unavailable");
    }
  });
}

async function probeServiceWorker(browser: Browser, timeout: number): Promise<WebWorker> {
  const target = await browser.waitForTarget(
    (candidate) =>
      candidate.type() === "service_worker" && candidate.url().endsWith("background.js"),
    { timeout },
  );
  const worker = await target.worker();
  if (!worker) {
    throw new Error("Chrome background worker is unavailable");
  }
  cacheChromeExtensionHost(new URL(target.url()).host || null);
  await assertStorageAvailable(worker);
  return worker;
}

/**
 * Wait for the extension's background context and return it.
 * Chrome uses a service worker, Firefox uses a background page or hidden page.
 */
export async function getBackgroundContext(browser: Browser): Promise<BackgroundContext> {
  if (isChrome()) {
    try {
      return await probeServiceWorker(browser, 1000);
    } catch (error) {
      if (!isRetriableBackgroundContextError(error)) {
        throw error;
      }
      const extensionId = await resolveChromeExtensionId(browser);
      if (!extensionId) {
        throw new Error("chrome.storage.local is unavailable", { cause: error });
      }
      await wakeChromeBackgroundWorker(browser, extensionId);
      try {
        return await probeServiceWorker(browser, 1500);
      } catch {
        // Fall back to an extension page context.
        return gotoExtensionPage(
          await browser.newPage(),
          getExtensionPageUrl(extensionId, "options/options.html"),
        );
      }
    }
  }

  if (!firefoxExtensionHost) {
    throw new Error("Firefox extension host is unavailable. Did you call launchBrowser?");
  }
  return gotoExtensionPage(
    await browser.newPage(),
    getExtensionPageUrl(firefoxExtensionHost, "options/options.html"),
  );
}

/** Polls getBackgroundContext until the extension answers again. */
export async function reacquireWorker(
  browser: Browser,
  timeoutMs = WORKER_REACQUIRE_TIMEOUT_MS,
): Promise<BackgroundContext> {
  return waitUntil(
    "background worker context",
    async () => {
      try {
        return await getBackgroundContext(browser);
      } catch (error) {
        if (!isRetriableWorkerError(error)) {
          throw error;
        }
        return false;
      }
    },
    { timeoutMs, intervalMs: 100 },
  );
}

/** `worker` while it can still reach extension storage, otherwise a fresh context. */
export async function ensureWorker(
  browser: Browser,
  worker: BackgroundContext | undefined,
  timeoutMs?: number,
): Promise<BackgroundContext> {
  if (worker && !("isClosed" in worker && worker.isClosed())) {
    try {
      await assertStorageAvailable(worker);
      return worker;
    } catch (error) {
      if (!isRetriableWorkerError(error)) {
        throw error;
      }
    }
  }
  return reacquireWorker(browser, timeoutMs);
}

/** Runs `run`, and runs it again in a fresh background context when the old one went away. */
export async function withWorker<T>(
  worker: BackgroundContext,
  run: (context: BackgroundContext) => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(worker);
    } catch (error) {
      if (!launchedBrowser || attempt >= attempts || !isRetriableWorkerError(error)) {
        throw error;
      }
      worker = await reacquireWorker(launchedBrowser);
    }
  }
}

let settingsWritten = true;

/** True when settings were written since the last call. */
export function takeSettingsWritten(): boolean {
  const written = settingsWritten;
  settingsWritten = false;
  return written;
}

/** Writes extension settings the way the options page stores them. */
export async function setSettings(
  worker: BackgroundContext,
  settings: Record<string, unknown>,
): Promise<void> {
  settingsWritten = true;
  const values = Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      `${SETTINGS_PREFIX}${key}`,
      JSON.stringify(value),
    ]),
  );
  await withWorker(worker, (context) =>
    context.evaluate((items) => chrome.storage.local.set(items), values),
  );
}

export async function setSetting(
  worker: BackgroundContext,
  key: string,
  value: unknown,
): Promise<void> {
  await setSettings(worker, { [key]: value });
}

export async function removeSettings(
  worker: BackgroundContext,
  keys: readonly string[],
): Promise<void> {
  settingsWritten = true;
  const storageKeys = keys.map((key) => `${SETTINGS_PREFIX}${key}`);
  await withWorker(worker, (context) =>
    context.evaluate((items) => chrome.storage.local.remove(items), storageKeys),
  );
}

/** A JSON value from extension storage. */
export async function getStoredValue<T>(
  worker: BackgroundContext,
  storageKey: string,
): Promise<T | undefined> {
  const raw = await withWorker(worker, (context) =>
    context.evaluate(
      async (key) => (await chrome.storage.local.get(key))[key] as string | undefined,
      storageKey,
    ),
  );
  return raw ? (JSON.parse(raw) as T) : undefined;
}

export async function getSetting<T = unknown>(
  worker: BackgroundContext,
  key: string,
): Promise<NoInfer<T> | undefined> {
  return getStoredValue<T>(worker, `${SETTINGS_PREFIX}${key}`);
}

/** Sends a runtime command from `context` and returns the answer. */
export async function sendCommand<T = { ok?: boolean }>(
  context: BackgroundContext,
  command: string,
  payload: Record<string, unknown> = {},
  { requireOk = false } = {},
): Promise<T> {
  const response = await context.evaluate(
    (commandInner, payloadInner) =>
      chrome.runtime.sendMessage({ command: commandInner, context: payloadInner }),
    command,
    payload,
  );
  if (requireOk && !(response as { ok?: boolean } | undefined)?.ok) {
    throw new Error(`Runtime command ${command} returned not ok: ${JSON.stringify(response)}`);
  }
  return response as T;
}

/**
 * Sends a runtime command as an extension page does. A Chrome service worker cannot
 * message itself, so on Chrome the command goes through a short-lived options page.
 */
export async function sendExtensionCommand<T = { ok?: boolean }>(
  browser: Browser,
  worker: BackgroundContext,
  command: string,
  options: { requireOk?: boolean } = {},
): Promise<T> {
  return withWorker(worker, async (context) => {
    if (isFirefox()) {
      return sendCommand<T>(context, command, {}, options);
    }
    const page = await openExtensionPage(browser, context, "options/options.html");
    try {
      return await sendCommand<T>(page, command, {}, options);
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}

/** Tells the background that the stored settings changed, as the options page does. */
export async function notifyConfigChange(
  browser: Browser,
  worker: BackgroundContext,
): Promise<void> {
  await sendExtensionCommand(browser, worker, CMD_OPTIONS_PAGE_CONFIG_CHANGE, { requireOk: true });
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

/**
 * The URL of an extension page, from `chrome.runtime.getURL` in the background context.
 * Do not derive it from the context URL: on Firefox that URL has no extension host.
 */
export async function getRuntimePageUrl(
  context: BackgroundContext,
  pagePath: string,
): Promise<string> {
  try {
    return await context.evaluate((path) => chrome.runtime.getURL(path), pagePath);
  } catch (error) {
    // A restarting Chrome worker cannot answer, but its URL still holds the extension id.
    const host = isChrome() ? new URL(context.url()).host : "";
    if (!host) {
      throw error;
    }
    return getExtensionPageUrl(host, pagePath);
  }
}

export async function openExtensionPage(
  browser: Browser,
  context: BackgroundContext,
  pagePath: string,
): Promise<Page> {
  return gotoExtensionPage(await browser.newPage(), await getRuntimePageUrl(context, pagePath));
}

export async function openPopupPage(browser: Browser, context: BackgroundContext): Promise<Page> {
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

/** Serves one HTML page on a free local port. */
export function serveHtml(html: string): { port: number; stop(force?: boolean): unknown } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  // A TCP server always has a port.
  return { port: server.port!, stop: (force) => server.stop(force) };
}

/**
 * Presses the native undo or redo shortcut: Ctrl+Z (Cmd+Z on macOS), with Shift for redo.
 * Synthetic key events skip the macOS key bindings, so the event also names the editing command.
 */
async function pressEditShortcut(page: Page, command: "Undo" | "Redo"): Promise<void> {
  const isMac = process.platform === "darwin";
  const modifier = isMac ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  if (command === "Redo") await page.keyboard.down("Shift");
  await page.keyboard.press("z", isMac ? { commands: [command] } : undefined);
  if (command === "Redo") await page.keyboard.up("Shift");
  await page.keyboard.up(modifier);
}

/** Focuses `selector` (if given) and presses the native undo shortcut. */
export async function pressUndo(page: Page, selector?: string): Promise<void> {
  if (selector) await page.focus(selector);
  await pressEditShortcut(page, "Undo");
}

export function pressRedo(page: Page): Promise<void> {
  return pressEditShortcut(page, "Redo");
}

/**
 * Serves test-page.html for every path except `routes` and files below /node_modules/.
 * The page is served over HTTP, not file://, so host permissions apply as on real sites.
 */
export function startTestPageServer(routes: Record<string, Blob> = {}): {
  url: string;
  stop(): Promise<void>;
} {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request: Request) {
      const { pathname } = new URL(request.url);
      const route = routes[pathname];
      if (route) {
        return new Response(route);
      }
      if (!pathname.startsWith("/node_modules/")) {
        return new Response(Bun.file(TEST_PAGE_PATH));
      }
      const file = Bun.file(path.join(REPOSITORY_ROOT, pathname));
      return (await file.exists()) ? new Response(file) : new Response(null, { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}/`, stop: () => server.stop(true) };
}

// ------------------------------------------------------------ suggestion menu

export interface VisibleSuggestionMenu {
  texts: string[];
  backgroundColor: string;
  overrideCssText: string | null;
}

/**
 * Runs in the page. The first visible suggestion menu with rows, the menu of the
 * focused field first. With `click`, it also clicks the first row.
 */
function findVisibleSuggestionMenu(click: boolean): VisibleSuggestionMenu | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  const activeMenu = document.getElementById(
    `ft-menu-${active?.getAttribute("data-ft-suggestion-id")}`,
  );
  for (const menu of [activeMenu, ...document.querySelectorAll('[id^="ft-menu-"]')]) {
    if (!menu) continue;
    const style = getComputedStyle(menu);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      menu.getClientRects().length === 0
    ) {
      continue;
    }
    const root = menu.shadowRoot ?? menu;
    const rows = Array.from(root.querySelectorAll("li[data-index]"));
    if (rows.length === 0) continue;
    if (click) {
      for (const type of ["mousedown", "mouseup", "click"]) {
        rows[0].dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, view: window }),
        );
      }
    }
    return {
      texts: rows
        .map((row) => (row.querySelector(".ft-suggestion-label") ?? row).textContent ?? "")
        .filter((text) => text.length > 0),
      backgroundColor: getComputedStyle(root.querySelector(".ft-suggestion-panel") ?? menu)
        .backgroundColor,
      overrideCssText: document.getElementById("fluent-typer-theme-overrides")?.textContent ?? null,
    };
  }
  return null;
}

export async function getVisibleSuggestionMenu(
  page: Page | Frame,
): Promise<VisibleSuggestionMenu | null> {
  return page.evaluate(findVisibleSuggestionMenu, false);
}

export async function getVisibleSuggestionTexts(page: Page | Frame): Promise<string[]> {
  return (await getVisibleSuggestionMenu(page))?.texts ?? [];
}

export async function hasVisibleSuggestions(page: Page | Frame): Promise<boolean> {
  return (await getVisibleSuggestionMenu(page)) !== null;
}

export async function waitForVisibleSuggestionMenu(
  page: Page | Frame,
  timeoutMs = getTimeoutProfile().suggestionMs,
): Promise<VisibleSuggestionMenu> {
  return waitUntil(
    "visible suggestions",
    async () => (await getVisibleSuggestionMenu(page)) ?? false,
    { timeoutMs },
  );
}

export async function waitForVisibleSuggestionTexts(
  page: Page | Frame,
  timeoutMs = getTimeoutProfile().suggestionMs,
): Promise<string[]> {
  return waitUntil(
    "visible suggestion texts",
    async () => {
      const texts = await getVisibleSuggestionTexts(page);
      return texts.length > 0 ? texts : false;
    },
    { timeoutMs },
  );
}

export async function waitForNoVisibleSuggestions(
  page: Page | Frame,
  timeoutMs = getTimeoutProfile().suggestionMs,
): Promise<void> {
  await waitUntil("no visible suggestions", async () => !(await hasVisibleSuggestions(page)), {
    timeoutMs,
  });
}

export async function clickFirstVisibleSuggestion(
  page: Page | Frame,
  timeoutMs = getTimeoutProfile().suggestionMs,
): Promise<void> {
  await waitUntil(
    "a visible suggestion to click",
    async () => (await page.evaluate(findVisibleSuggestionMenu, true)) !== null,
    { timeoutMs },
  );
}

// ---------------------------------------------------------------- review mode

export const REVIEW_HOST_SELECTOR = "[data-fluenttyper-review]";

export interface ReviewPanelSnapshot {
  open: boolean;
  status: string;
  notes: string;
  /** "checking" while suggestions for unknown words may still join the results. */
  spelling: string;
  checking: string;
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

export async function readReviewPanel(page: Page | Frame): Promise<ReviewPanelSnapshot> {
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
      spelling: root?.querySelector<HTMLElement>(".panel")?.dataset.spelling ?? "",
      checking: root?.querySelector<HTMLElement>(".panel")?.dataset.checking ?? "",
      items: Array.from(root?.querySelectorAll<HTMLElement>(".item") ?? []).map((item) => ({
        id: item.dataset.id ?? "",
        text: item.querySelector(".change")?.textContent ?? "",
        category: item.dataset.category ?? "",
        current: item.getAttribute("aria-current") === "true",
      })),
      fixAll: {
        text: fixAll?.textContent ?? "",
        disabled: fixAll?.disabled ?? true,
        hidden: fixAll?.hidden !== false,
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
  page: Page | Frame,
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
        // Results are final once the dictionary check has answered too.
        const success = /No issues found|All found issues/.test(last.status);
        return last.spelling !== "checking" &&
          (!success || last.checking === "checked") &&
          predicate(last)
          ? last
          : false;
      },
      { timeoutMs, intervalMs: 40 },
    );
  } catch (error) {
    throw new Error(`${String(error)}; last panel: ${JSON.stringify(last)}`, { cause: error });
  }
}

/** A real mouse click on a control inside the review UI. */
export async function clickReviewControl(page: Page | Frame, selector: string): Promise<void> {
  if (!("mouse" in page)) {
    const handle = await waitUntil(`enabled frame Review control ${selector}`, async () => {
      const value = await page.evaluateHandle(
        (hostSelector, innerSelector) => {
          const element = document
            .querySelector(hostSelector)
            ?.shadowRoot?.querySelector<HTMLElement>(innerSelector);
          return element &&
            !element.matches(":disabled") &&
            element.getAttribute("aria-disabled") !== "true"
            ? element
            : null;
        },
        REVIEW_HOST_SELECTOR,
        selector,
      );
      const element = value.asElement() as ElementHandle<HTMLElement> | null;
      if (element) return element;
      await value.dispose();
      return false;
    });
    try {
      const frameElement = await page.frameElement();
      if (!frameElement) throw new Error("The editor frame is unavailable.");
      try {
        await frameElement.evaluate((element) => element.scrollIntoView({ block: "start" }));
        const point = await handle.evaluate(async (element) => {
          element.scrollIntoView({ block: "nearest" });
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const rect = element.getBoundingClientRect();
          const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const hit = (element.getRootNode() as ShadowRoot).elementFromPoint(point.x, point.y);
          if (!hit || !element.contains(hit))
            throw new Error("The frame Review control is covered.");
          return point;
        });
        // The child viewport can exceed the visible parent viewport.
        await frameElement.evaluate((element, local) => {
          const box = element.getBoundingClientRect();
          const x = box.left + local.x;
          const y = box.top + local.y;
          element.ownerDocument.defaultView?.scrollBy({
            left: x < 0 ? x - 20 : x > innerWidth ? x - innerWidth + 20 : 0,
            top: y < 0 ? y - 20 : y > innerHeight ? y - innerHeight + 20 : 0,
            behavior: "instant",
          });
        }, point);
        const mapped = await frameElement.evaluate((element, local) => {
          const frame = element as HTMLElement;
          const box = frame.getBoundingClientRect();
          const scaleX = box.width / frame.offsetWidth;
          const scaleY = box.height / frame.offsetHeight;
          const point = {
            x: box.left + (local.x + frame.clientLeft) * scaleX,
            y: box.top + (local.y + frame.clientTop) * scaleY,
          };
          const hit = element.ownerDocument.elementFromPoint(point.x, point.y);
          if (hit !== element)
            throw new Error(
              `The editor frame is covered at the Review control: ${hit?.outerHTML.slice(0, 200)}`,
            );
          return point;
        }, point);
        await page.page().mouse.click(mapped.x, mapped.y);
      } finally {
        await frameElement.dispose();
      }
    } finally {
      await handle.dispose();
    }
    return;
  }
  const point = await waitUntil(`enabled Review control ${selector}`, () =>
    page.evaluate(
      async (hostSelector, selectorInner) => {
        const element = document
          .querySelector(hostSelector)
          ?.shadowRoot?.querySelector<HTMLElement>(selectorInner);
        // Dictionary/preferences changes can still be rechecking after their cards disappear.
        if (
          !element ||
          element.matches(":disabled") ||
          element.getAttribute("aria-disabled") === "true"
        )
          return false;
        element.scrollIntoView({ block: "nearest" });
        // Opening More queues a details toggle that repositions the card. Wait
        // for stable geometry before sending a real mouse click to its coordinates.
        const before = element.getBoundingClientRect();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (!element.isConnected) return false;
        const rect = element.getBoundingClientRect();
        if (
          before.x !== rect.x ||
          before.y !== rect.y ||
          before.width !== rect.width ||
          before.height !== rect.height
        )
          return false;
        let left = Math.max(0, rect.left);
        let right = Math.min(innerWidth, rect.right);
        let top = Math.max(0, rect.top);
        let bottom = Math.min(innerHeight, rect.bottom);
        // A long finding can exceed its scrolling list: its center may be under the footer.
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const box = parent.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            left = Math.max(left, box.left + parent.clientLeft);
            right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
          }
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
            top = Math.max(top, box.top + parent.clientTop);
            bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight);
          }
        }
        if (right <= left || bottom <= top)
          throw new Error(`Review control is clipped: ${selectorInner}`);
        const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
        const hit = (element.getRootNode() as ShadowRoot).elementFromPoint(point.x, point.y);
        if (!hit || !element.contains(hit))
          throw new Error(`Review control is covered: ${selectorInner}`);
        return point;
      },
      REVIEW_HOST_SELECTOR,
      selector,
    ),
  );
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

// -------------------------------------------------------------- local AI review

export interface ReviewAiSnapshot {
  /** Correct/Rewrite switch shown. */
  modes: boolean;
  /** Any Local AI block (status line, setup offer, pause/settings) shown. */
  ai: boolean;
  line: string;
  setup: boolean;
  setupSize: string;
  pause: boolean;
  settings: boolean;
  /** Findings tagged as coming from Local AI. */
  aiItems: string[];
}

/** The Local AI parts of the review panel, as a user sees them (hidden = absent). */
export async function readReviewAi(page: Page): Promise<ReviewAiSnapshot> {
  return page.evaluate((hostSelector) => {
    const root = document.querySelector(hostSelector)?.shadowRoot ?? null;
    const shown = (selector: string) => {
      const element = root?.querySelector<HTMLElement>(selector);
      return !!element && !element.closest("[hidden]");
    };
    const text = (selector: string) =>
      shown(selector) ? (root?.querySelector(selector)?.textContent ?? "") : "";
    return {
      modes: shown(".modes"),
      ai: shown(".ai"),
      line: text(".ai-line"),
      setup: shown(".setup"),
      setupSize: text(".setup-size"),
      pause: shown("[data-action=ai-pause]"),
      settings: shown("[data-action=ai-settings]"),
      aiItems: Array.from(root?.querySelectorAll<HTMLElement>(".item") ?? [])
        .filter((item) => !!item.querySelector(".why .tag"))
        .map((item) => item.querySelector(".change")?.textContent ?? ""),
    };
  }, REVIEW_HOST_SELECTOR);
}

export interface RecordedRequest {
  url: string;
  /** Kind and URL of the target (page, service worker, worker) that sent it. */
  targetType: string;
  targetUrl: string;
}

/**
 * Opens a CDP session on every target (pages, the service worker), existing and
 * new, and hands it to `attach`.
 * Chrome only. A target created later may send its very first requests
 * before `attach` finishes.
 */
export async function watchTargets(
  browser: Browser,
  attach: (session: CDPSession, target: Target) => Promise<void>,
): Promise<() => void> {
  const sessions: CDPSession[] = [];
  let stopped = false;
  const watch = async (target: Target) => {
    if (stopped || target.type() === "browser") return;
    try {
      // Let puppeteer finish initializing the target first; an extra session on
      // a target still waiting for the debugger stalls it.
      if (target.type() === "service_worker") await target.worker();
      else if (target.type() === "page") await target.page();
      const session = await target.createCDPSession();
      sessions.push(session);
      await attach(session, target);
    } catch {
      // The target closed before it could be watched.
    }
  };
  const onTarget = (target: Target) => void watch(target);
  browser.on("targetcreated", onTarget);
  await Promise.all(browser.targets().map(watch));
  return () => {
    stopped = true;
    browser.off("targetcreated", onTarget);
    for (const session of sessions) void session.detach().catch(() => undefined);
  };
}

/** Records the URL (only) of every network request from every target. Chrome only. */
export async function recordNetworkRequests(
  browser: Browser,
): Promise<{ requests: RecordedRequest[]; stop(): void }> {
  const requests: RecordedRequest[] = [];
  const stop = await watchTargets(browser, async (session, target) => {
    session.on("Network.requestWillBeSent", (event) => {
      requests.push({ url: event.request.url, targetType: target.type(), targetUrl: target.url() });
    });
    await session.send("Network.enable");
  });
  return { requests, stop };
}

/**
 * Evaluates `expression` in the extension's own content-script world of the
 * page's main frame (the isolated world whose origin is the extension), so
 * chrome.runtime messages carry the content script's sender. Chrome only.
 */
export async function evaluateInContentScript<T>(page: Page, expression: string): Promise<T> {
  const session = await page.createCDPSession();
  try {
    const contexts: Array<{
      id: number;
      origin: string;
      name: string;
      auxData?: { frameId?: string; type?: string };
    }> = [];
    session.on("Runtime.executionContextCreated", (event) => contexts.push(event.context));
    await session.send("Runtime.enable");
    const { frameTree } = await session.send("Page.getFrameTree");
    const context = await waitUntil("content script world", () => {
      return (
        contexts.find(
          (candidate) =>
            candidate.auxData?.type === "isolated" &&
            candidate.auxData.frameId === frameTree.frame.id &&
            candidate.origin.startsWith("chrome-extension://"),
        ) ?? false
      );
    });
    const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
      expression,
      contextId: context.id,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(`Content script evaluation failed: ${exceptionDetails.text}`);
    }
    return result.value as T;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

export interface LayoutOverflow {
  element: string;
  container: string;
  overflowPx: number;
}

/**
 * Elements that poke out of their surface (card, header, toolbar or the page itself), plus
 * the page scrolling sideways. `maxHeight` also flags vertical page scroll (e.g. popups).
 */
export async function findLayoutOverflow(
  page: Page,
  maxHeight?: number,
): Promise<LayoutOverflow[]> {
  return page.evaluate((heightLimit) => {
    const surfaces =
      ".popup-card, .settings-inline-card, .popup-header, .toolbar, .popup-stats-row";
    const describe = (el: Element) =>
      el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
    const found: Array<{ element: string; container: string; overflowPx: number }> = [];
    const root = document.documentElement;
    if (root.scrollWidth > window.innerWidth + 0.5) {
      found.push({
        element: "document",
        container: "viewport",
        overflowPx: root.scrollWidth - window.innerWidth,
      });
    }
    // Content height, not the window: Firefox opens the popup as a full tab.
    const contentHeight = document.body.scrollHeight;
    if (heightLimit !== undefined && contentHeight > heightLimit + 0.5) {
      found.push({
        element: "document",
        container: `height ${heightLimit}`,
        overflowPx: contentHeight - heightLimit,
      });
    }
    for (const el of document.body.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || el.closest(".sr-only, .is-sr-only")) continue;
      // A closed <details> still lays out its body; only its summary is on screen.
      const closed = el.closest("details:not([open])");
      if (closed && !el.closest("summary") && el !== closed) continue;
      const surface = el.parentElement?.closest(surfaces);
      if (!surface) continue;
      const box = surface.getBoundingClientRect();
      const overflowPx = Math.max(
        box.left - rect.left,
        rect.right - box.right,
        box.top - rect.top,
        rect.bottom - box.bottom,
      );
      if (overflowPx > 0.5) {
        found.push({ element: describe(el), container: describe(surface), overflowPx });
      }
    }
    return found;
  }, maxHeight);
}
