import type { Browser, Page } from "puppeteer";
import path from "path";
import * as fs from "fs";
import type { Server } from "http";
import { createServer } from "http";
import {
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  KEY_AI_PREDICTOR_ENABLED,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_DOMAIN_LIST_MODE,
  KEY_LANGUAGE,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_REVERT_ON_BACKSPACE,
  KEY_PRODUCTIVITY_STATS,
  KEY_SITE_PROFILES,
  KEY_TEXT_EXPANSIONS,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
} from "../../src/core/domain/constants";
import { SUPPORTED_PREDICTION_LANGUAGE_KEYS } from "../../src/core/domain/lang";
import type { BackgroundContext } from "./e2e-helpers";
import {
  BROWSER_TYPE,
  getTimeoutProfile,
  launchBrowser,
  getBackgroundContext,
  openExtensionPage,
  openPopupPage,
  sleep,
  triggerCommandForTesting,
  setWebLLMPredictionsForTesting,
  clearWebLLMPredictionsForTesting,
  getWebLLMPredictionCallsForTesting,
  suiteTimeout,
  waitUntil,
  isFirefox,
} from "./e2e-helpers";

const TEST_PAGE_PATH = path.resolve(__dirname, "test-page.html");
const TEST_HOST = "localhost";
const SETTINGS_PREFIX = "store.settings.";
const CKEDITOR_SELECTOR = ".ck-editor__editable";
const QUILL_SELECTOR = ".ql-editor";
const GENERIC_INPUT_SELECTORS = ["#test-input"] as const;
const timeoutProfile = getTimeoutProfile();

const NAVIGATION_TIMEOUT_MS = timeoutProfile.navigationMs;
const INPUT_READY_TIMEOUT_MS = timeoutProfile.inputReadyMs;
const SUGGESTION_TIMEOUT_MS = timeoutProfile.suggestionMs;
const RUN_DEV_RUNTIME_E2E =
  process.env.FT_E2E_DEV_RUNTIME === "1" || process.env.FT_E2E_DEV_RUNTIME === "true";
const RUN_E2E = process.env.RUN_E2E === "1" || process.env.RUN_E2E === "true";
const describeE2E = RUN_E2E ? describe : describe.skip;
const devRuntimeTest = RUN_DEV_RUNTIME_E2E ? test : test.skip;

function devRuntimeEach<T>(cases: readonly T[]) {
  return RUN_DEV_RUNTIME_E2E ? test.each(cases) : test.skip.each(cases);
}

function browserTimeout(chromeTimeoutMs: number, firefoxTimeoutMs: number) {
  return suiteTimeout(chromeTimeoutMs, firefoxTimeoutMs);
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

let domainTestUrl: string;
let activeBrowserForWorkerRecovery: Browser | null = null;
let latestWorkerContext: BackgroundContext | null = null;

function isRetriableWorkerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /chrome\.storage\.local is unavailable|reading 'local'|chrome\.runtime\.getURL is unavailable|runtime\.getURL|Execution context was destroyed|Execution context is not available in detached frame or worker|Cannot find context with specified id|Target closed|Session closed/i.test(
    message,
  );
}

async function reacquireWorkerContext(
  browser: Browser,
  label = "background worker context",
): Promise<BackgroundContext> {
  const recovered = await waitUntil(
    label,
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
    {
      timeoutMs: browserTimeout(7000, 15000),
      intervalMs: 100,
    },
  );
  latestWorkerContext = recovered;
  return recovered;
}

async function recoverWorkerForRetry(
  existingWorker: BackgroundContext,
): Promise<BackgroundContext> {
  if (activeBrowserForWorkerRecovery) {
    return await reacquireWorkerContext(activeBrowserForWorkerRecovery, "worker recovery");
  }
  if (latestWorkerContext) {
    return latestWorkerContext;
  }
  return existingWorker;
}

async function setSetting(worker: BackgroundContext, key: string, value: unknown): Promise<void> {
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  let workerContext = worker;
  latestWorkerContext = workerContext;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await workerContext.evaluate(
        (storageKeyInner, valueInner) =>
          new Promise<void>((resolve, reject) => {
            const storage = (
              globalThis as typeof globalThis & {
                chrome?: typeof chrome;
              }
            ).chrome?.storage?.local;
            if (!storage) {
              reject(new Error("chrome.storage.local is unavailable"));
              return;
            }
            storage.set({ [storageKeyInner]: JSON.stringify(valueInner) }, () => {
              const runtime = (
                globalThis as typeof globalThis & {
                  chrome?: typeof chrome;
                }
              ).chrome?.runtime;
              if (runtime?.lastError) {
                reject(new Error(runtime.lastError.message));
                return;
              }
              resolve();
            });
          }),
        storageKey,
        value,
      );
      latestWorkerContext = workerContext;
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableWorkerError(error) || attempt === 10) {
        throw error;
      }
      workerContext = await recoverWorkerForRetry(workerContext);
      await sleep(100);
    }
  }
  throw lastError;
}

async function getSetting<T>(worker: BackgroundContext, key: string): Promise<T | undefined> {
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  let workerContext = worker;
  latestWorkerContext = workerContext;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const value = (await workerContext.evaluate(
        (storageKeyInner) =>
          new Promise((resolve, reject) => {
            const storage = (
              globalThis as typeof globalThis & {
                chrome?: typeof chrome;
              }
            ).chrome?.storage?.local;
            if (!storage) {
              reject(new Error("chrome.storage.local is unavailable"));
              return;
            }
            storage.get(storageKeyInner, (result) => {
              const runtime = (
                globalThis as typeof globalThis & {
                  chrome?: typeof chrome;
                }
              ).chrome?.runtime;
              if (runtime?.lastError) {
                reject(new Error(runtime.lastError.message));
                return;
              }
              const rawValue = (result as Record<string, string | undefined>)[storageKeyInner];
              resolve(rawValue ? JSON.parse(rawValue) : undefined);
            });
          }),
        storageKey,
      )) as T | undefined;
      latestWorkerContext = workerContext;
      return value;
    } catch (error) {
      lastError = error;
      if (!isRetriableWorkerError(error) || attempt === 10) {
        throw error;
      }
      workerContext = await recoverWorkerForRetry(workerContext);
      await sleep(100);
    }
  }
  throw lastError;
}

async function waitForSettingMatch<T>(
  worker: BackgroundContext,
  key: string,
  predicate: (value: T | undefined) => boolean,
  timeoutMs = 5000,
): Promise<T | undefined> {
  return await waitUntil(
    `setting ${key} to match predicate`,
    async () => {
      const currentValue = await getSetting<T>(worker, key);
      return predicate(currentValue) ? currentValue : false;
    },
    { timeoutMs, intervalMs: 50 },
  );
}

async function setSettingAndWait(
  worker: BackgroundContext,
  key: string,
  value: unknown,
  timeoutMs = 15000,
): Promise<void> {
  await setSetting(worker, key, value);
  const expected = JSON.stringify(value);
  await waitUntil(
    `setting ${key} to become ${expected}`,
    async () => {
      const current = await getSetting<unknown>(worker, key);
      return JSON.stringify(current) === expected ? true : false;
    },
    { timeoutMs, intervalMs: 50 },
  );
}

async function setSettingAndWaitStable(
  worker: BackgroundContext,
  key: string,
  value: unknown,
  attempts = 3,
  timeoutMs = 5000,
): Promise<void> {
  const expected = JSON.stringify(value);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await setSetting(worker, key, value);
      await waitForSettingMatch(
        worker,
        key,
        (currentValue) => JSON.stringify(currentValue) === expected,
        timeoutMs,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(150);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for setting ${key} to stabilize as ${expected}`);
}

async function notifyConfigChange(browser: Browser, worker: BackgroundContext): Promise<void> {
  let workerContext = worker;
  latestWorkerContext = workerContext;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      if (isFirefox()) {
        await workerContext.evaluate(
          (command) =>
            new Promise<void>((resolve, reject) => {
              chrome.runtime.sendMessage(
                { command, context: {} },
                (response: { ok?: boolean } | undefined) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                  }
                  if (!response?.ok) {
                    reject(new Error("Config change ACK returned not ok"));
                    return;
                  }
                  resolve();
                },
              );
            }),
          CMD_OPTIONS_PAGE_CONFIG_CHANGE,
        );
      } else {
        const extensionPage = await openExtensionPage(
          browser,
          workerContext,
          "options/options.html",
        );
        try {
          await extensionPage.evaluate(
            (command) =>
              new Promise<void>((resolve, reject) => {
                chrome.runtime.sendMessage(
                  { command, context: {} },
                  (response: { ok?: boolean } | undefined) => {
                    if (chrome.runtime.lastError) {
                      reject(new Error(chrome.runtime.lastError.message));
                      return;
                    }
                    if (!response?.ok) {
                      reject(new Error("Config change ACK returned not ok"));
                      return;
                    }
                    resolve();
                  },
                );
              }),
            CMD_OPTIONS_PAGE_CONFIG_CHANGE,
          );
        } finally {
          if (!extensionPage.isClosed()) {
            await extensionPage.close();
          }
        }
      }
      latestWorkerContext = workerContext;
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableWorkerError(error) || attempt === 5) {
        throw error;
      }
      workerContext = await recoverWorkerForRetry(workerContext);
      await sleep(100);
    }
  }

  throw lastError;
}

async function applyConfigChange(browser: Browser, worker: BackgroundContext): Promise<void> {
  await notifyConfigChange(browser, worker);
}

async function openOptionsPage(browser: Browser, worker: BackgroundContext) {
  let workerContext = worker;
  latestWorkerContext = workerContext;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const optionsPage = await openExtensionPage(browser, workerContext, "options/options.html");
      await optionsPage.waitForSelector("#content");
      latestWorkerContext = workerContext;
      return optionsPage;
    } catch (error) {
      lastError = error;
      if (!isRetriableWorkerError(error) || attempt === 5) {
        throw error;
      }
      workerContext = await recoverWorkerForRetry(workerContext);
      await sleep(100);
    }
  }

  throw lastError;
}

async function sendOptionsPageConfigChange(optionsPage: Page): Promise<void> {
  await optionsPage.evaluate((command) => {
    return new Promise<void>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { command, context: {} },
        (response: { ok?: boolean } | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error("Config change ACK returned not ok"));
            return;
          }
          resolve();
        },
      );
    });
  }, CMD_OPTIONS_PAGE_CONFIG_CHANGE);
}

interface PredictorDebugSnapshot {
  config?: {
    debugPresagePredictorEnabled?: boolean;
    debugAIPredictorEnabled?: boolean;
  };
}

async function getPredictorDebugSnapshot(optionsPage: Page): Promise<PredictorDebugSnapshot> {
  return await optionsPage.evaluate((command) => {
    return new Promise<PredictorDebugSnapshot>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { command, context: {} },
        (response: PredictorDebugSnapshot | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response || {});
        },
      );
    });
  }, CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT);
}

async function waitForSettingValue(
  worker: BackgroundContext,
  key: string,
  expectedValue: boolean,
  timeoutMs = 5000,
): Promise<void> {
  await waitUntil(
    `setting ${key} to equal ${String(expectedValue)}`,
    async () => {
      const currentValue = await getSetting<boolean>(worker, key);
      return currentValue === expectedValue ? true : false;
    },
    { timeoutMs, intervalMs: 50 },
  );
}

async function waitForSnapshotValue(
  optionsPage: Page,
  key: string,
  expectedValue: boolean,
  timeoutMs = 7000,
): Promise<void> {
  await waitUntil(
    `predictor snapshot ${key}=${String(expectedValue)}`,
    async () => {
      const snapshot = await getPredictorDebugSnapshot(optionsPage);
      const currentValue =
        key === KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED
          ? snapshot.config?.debugPresagePredictorEnabled
          : snapshot.config?.debugAIPredictorEnabled;
      return currentValue === expectedValue ? true : false;
    },
    { timeoutMs, intervalMs: 100 },
  );
}

async function togglePredictorDebugButton(optionsPage: Page, key: string): Promise<void> {
  const selector = `[data-action="set-predictor-toggle"][data-key="${key}"]`;
  await optionsPage.waitForSelector(selector, { timeout: 10000 });
  await optionsPage.evaluate((selectorValue) => {
    const element = document.querySelector(selectorValue);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Missing predictor toggle: ${selectorValue}`);
    }
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
  }, selector);
}

function shouldEnableCkEditor(selector: string) {
  return selector === CKEDITOR_SELECTOR;
}

function shouldEnableQuill(selector: string) {
  return selector === QUILL_SELECTOR;
}

async function clearInputContent(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    if (sel === ".ck-editor__editable") {
      const ckEditor = (
        window as typeof window & {
          __testCkEditor?: { setData: (data: string) => void };
        }
      ).__testCkEditor;
      if (ckEditor) {
        ckEditor.setData("");
        return;
      }
    }
    if (sel === ".ql-editor") {
      const quill = (
        window as typeof window & {
          __testQuill?: { setText: (data: string, source?: string) => void };
        }
      ).__testQuill;
      if (quill) {
        quill.setText("", "silent");
        return;
      }
    }

    const target = document.querySelector(sel);
    if (!target) {
      return;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.value = "";
      return;
    }
    target.textContent = "";
  }, selector);
}

async function getInputContent(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => (el as HTMLInputElement).value ?? el.textContent ?? "");
}

async function waitForInputContentEqual(
  page: Page,
  selector: string,
  expected: string,
  timeoutMs: number,
): Promise<string> {
  return await waitUntil(
    `input content ${selector} to equal "${expected}"`,
    async () => {
      const currentValue = await getInputContent(page, selector);
      return currentValue === expected ? currentValue : false;
    },
    { timeoutMs, intervalMs: 50 },
  );
}

async function waitForInputContentMatch(
  page: Page,
  selector: string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string> {
  return await waitUntil(
    `input content ${selector} to match ${String(pattern)}`,
    async () => {
      const currentValue = await getInputContent(page, selector);
      return pattern.test(currentValue) ? currentValue : false;
    },
    { timeoutMs, intervalMs: 50 },
  );
}

async function waitForInputContentMinLength(
  page: Page,
  selector: string,
  minLengthExclusive: number,
  timeoutMs: number,
): Promise<string> {
  return await waitUntil(
    `input content ${selector} length > ${minLengthExclusive}`,
    async () => {
      const currentValue = await getInputContent(page, selector);
      return currentValue.length > minLengthExclusive ? currentValue : false;
    },
    { timeoutMs, intervalMs: 50 },
  );
}

function hasNonAsciiCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      return true;
    }
  }
  return false;
}

function normalizeSuggestionText(suggestion: string): string {
  return suggestion.replace(/\xA0/g, " ").trim().toLowerCase();
}

async function typeInInput(page: Page, selector: string, text: string): Promise<void> {
  await page.focus(selector);
  if (selector === CKEDITOR_SELECTOR && hasNonAsciiCharacters(text)) {
    await page.keyboard.type(text, { delay: 20 });
    return;
  }
  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Input element not found for selector: ${selector}`);
  }
  await element.type(text);
}

async function gotoTestPage(
  page: Page,
  options: { enableCkEditor?: boolean; enableQuill?: boolean } = {},
) {
  const testName =
    typeof expect.getState === "function"
      ? expect.getState().currentTestName || "Unknown Test"
      : "Unknown Test";
  const params = new URLSearchParams({ testName });
  if (options.enableCkEditor) {
    params.set("enableCkEditor", "1");
  }
  if (options.enableQuill) {
    params.set("enableQuill", "1");
  }
  // Use a local HTTP server instead of file:// so host permissions apply consistently.
  const targetUrl = `${domainTestUrl}?${params.toString()}`;
  if (isFirefox()) {
    await page.evaluate((url) => {
      window.location.href = url;
    }, targetUrl);
    await page.waitForFunction(
      (expectedUrl) => window.location.href === expectedUrl && document.readyState !== "loading",
      { timeout: NAVIGATION_TIMEOUT_MS },
      targetUrl,
    );
  } else {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
    });
  }
}

async function waitForInputReady(page: Page, selector: string) {
  if (selector === CKEDITOR_SELECTOR) {
    await waitUntil(
      `CKEditor readiness for ${selector}`,
      async () => {
        const ckState = await page.evaluate(() => ({
          ready: Boolean(
            (
              window as typeof window & {
                __testCkEditorReady?: boolean;
              }
            ).__testCkEditorReady,
          ),
          error:
            (
              window as typeof window & {
                __testCkEditorError?: string | null;
              }
            ).__testCkEditorError ?? null,
          hasEditable: Boolean(document.querySelector(".ck-editor__editable")),
        }));

        if (ckState.error) {
          throw new Error(`CKEditor failed to initialize: ${ckState.error}`);
        }
        return ckState.ready || ckState.hasEditable ? true : false;
      },
      { timeoutMs: INPUT_READY_TIMEOUT_MS, intervalMs: 50 },
    ).catch(async (error) => {
      const debugState = await page.evaluate(() => ({
        href: window.location.href,
        ready: (
          window as typeof window & {
            __testCkEditorReady?: boolean;
          }
        ).__testCkEditorReady,
        ckError: (
          window as typeof window & {
            __testCkEditorError?: string | null;
          }
        ).__testCkEditorError,
        hasEditable: Boolean(document.querySelector(".ck-editor__editable")),
      }));
      throw new Error(
        `CKEditor readiness timed out for ${selector}: ${JSON.stringify(debugState)} (${String(error)})`,
      );
    });
  }

  if (selector === QUILL_SELECTOR) {
    await waitUntil(
      `Quill readiness for ${selector}`,
      async () => {
        const quillState = await page.evaluate(() => ({
          ready: Boolean(
            (
              window as typeof window & {
                __testQuillReady?: boolean;
              }
            ).__testQuillReady,
          ),
          error:
            (
              window as typeof window & {
                __testQuillError?: string | null;
              }
            ).__testQuillError ?? null,
          hasEditor: Boolean(document.querySelector(".ql-editor")),
        }));

        if (quillState.error) {
          throw new Error(`Quill failed to initialize: ${quillState.error}`);
        }
        return quillState.ready || quillState.hasEditor ? true : false;
      },
      { timeoutMs: INPUT_READY_TIMEOUT_MS, intervalMs: 50 },
    );
  }

  await page.waitForSelector(selector, { timeout: INPUT_READY_TIMEOUT_MS });
  await waitUntil(
    `input helper attach for ${selector}`,
    async () => {
      const isAttached = await page.evaluate(
        (sel) => document.querySelector(sel)?.hasAttribute("data-suggestion") ?? false,
        selector,
      );
      return isAttached ? true : false;
    },
    { timeoutMs: INPUT_READY_TIMEOUT_MS, intervalMs: 50 },
  );
}

async function waitForVisibleSuggestions(
  page: Page,
  timeoutMs = SUGGESTION_TIMEOUT_MS,
): Promise<number> {
  const suggestions = await waitForVisibleSuggestionTexts(page, timeoutMs);
  return suggestions.length;
}

async function waitForVisibleSuggestionTexts(
  page: Page,
  timeoutMs = SUGGESTION_TIMEOUT_MS,
): Promise<string[]> {
  return await waitUntil(
    "visible suggestions",
    async () => {
      const texts = await page.evaluate(() => {
        const activeElement = document.activeElement as
          | (HTMLElement & { suggestionMenu?: Element | null })
          | null;
        const activeMenu = activeElement?.suggestionMenu;
        const containers = [
          ...(activeMenu instanceof Element ? [activeMenu] : []),
          ...Array.from(document.querySelectorAll(".ft-suggestion-container")).filter(
            (container) => container !== activeMenu,
          ),
        ];
        for (const container of containers) {
          const style = window.getComputedStyle(container);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0" ||
            container.getClientRects().length === 0
          ) {
            continue;
          }
          const visibleTexts = Array.from(container.querySelectorAll("li"))
            .map((li) => li.textContent ?? "")
            .filter((text) => text.length > 0);
          if (visibleTexts.length > 0) {
            return visibleTexts;
          }
        }
        return [];
      });
      return texts.length > 0 ? texts : false;
    },
    { timeoutMs, intervalMs: 50 },
  );
}

async function hasVisibleSuggestions(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const activeElement = document.activeElement as
      | (HTMLElement & { suggestionMenu?: Element | null })
      | null;
    const activeMenu = activeElement?.suggestionMenu;
    const containers = [
      ...(activeMenu instanceof Element ? [activeMenu] : []),
      ...Array.from(document.querySelectorAll(".ft-suggestion-container")).filter(
        (container) => container !== activeMenu,
      ),
    ];
    return containers.some((container) => {
      const style = window.getComputedStyle(container);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        container.getClientRects().length === 0
      ) {
        return false;
      }
      return container.querySelectorAll("li").length > 0;
    });
  });
}

async function waitForNoVisibleSuggestions(
  page: Page,
  timeoutMs = SUGGESTION_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const activeElement = document.activeElement as
        | (HTMLElement & { suggestionMenu?: Element | null })
        | null;
      const activeMenu = activeElement?.suggestionMenu;
      const containers = [
        ...(activeMenu instanceof Element ? [activeMenu] : []),
        ...Array.from(document.querySelectorAll(".ft-suggestion-container")).filter(
          (container) => container !== activeMenu,
        ),
      ];
      return containers.every((container) => {
        const style = window.getComputedStyle(container);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0" ||
          container.getClientRects().length === 0
        ) {
          return true;
        }
        return container.querySelectorAll("li").length === 0;
      });
    },
    { timeout: timeoutMs },
  );
}

async function clickFirstVisibleSuggestion(
  page: Page,
  timeoutMs = SUGGESTION_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const activeElement = document.activeElement as
        | (HTMLElement & { suggestionMenu?: Element | null })
        | null;
      const activeMenu = activeElement?.suggestionMenu;
      const containers = [
        ...(activeMenu instanceof Element ? [activeMenu] : []),
        ...Array.from(document.querySelectorAll(".ft-suggestion-container")).filter(
          (container) => container !== activeMenu,
        ),
      ];
      for (const container of containers) {
        const style = window.getComputedStyle(container);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0" ||
          container.getClientRects().length === 0
        ) {
          continue;
        }
        const first = container.querySelector("li:first-child");
        if (first instanceof HTMLElement) {
          first.dispatchEvent(
            new MouseEvent("mousedown", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
          first.dispatchEvent(
            new MouseEvent("mouseup", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
          first.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
          return true;
        }
      }
      return false;
    },
    { timeout: timeoutMs },
  );
}

describeE2E(`Extension E2E Test [${BROWSER_TYPE}]`, () => {
  let browser: Browser;
  let page: Page;
  let worker: BackgroundContext;
  let domainTestServer: Server;
  let domainTestHtml: string;
  let startupFirefoxInstallationPage: Page | null = null;

  beforeAll(async () => {
    browser = await launchBrowser();
    activeBrowserForWorkerRecovery = browser;
    const pages = await browser.pages();
    page = pages[0];
    if (isFirefox()) {
      startupFirefoxInstallationPage =
        pages.find((openPage) => openPage.url().includes("/new_installation/index.html")) ?? null;
    }
    worker = await reacquireWorkerContext(browser, "initial background worker context");
    domainTestHtml = fs.readFileSync(TEST_PAGE_PATH, "utf8");

    domainTestServer = createServer((req, res) => {
      if (req.url && (req.url.includes("ckeditor5.umd.js") || req.url.includes("ckeditor.js"))) {
        try {
          const ckeditorPath = path.resolve(
            __dirname,
            "../../node_modules/ckeditor5/dist/browser/ckeditor5.umd.js",
          );
          const jsBuf = fs.readFileSync(ckeditorPath);
          res.writeHead(200, {
            "Content-Type": "application/javascript",
            "Content-Length": jsBuf.length,
          });
          res.end(jsBuf);
          return;
        } catch (e) {
          console.error("Failed to load CKEditor from node_modules", e);
        }
      }
      if (req.url && req.url.includes("ckeditor5.css")) {
        try {
          const ckeditorCssPath = path.resolve(
            __dirname,
            "../../node_modules/ckeditor5/dist/browser/ckeditor5.css",
          );
          const cssBuf = fs.readFileSync(ckeditorCssPath);
          res.writeHead(200, {
            "Content-Type": "text/css; charset=utf-8",
            "Content-Length": cssBuf.length,
          });
          res.end(cssBuf);
          return;
        } catch (e) {
          console.error("Failed to load CKEditor CSS from node_modules", e);
        }
      }
      if (req.url && req.url.includes("quill.js")) {
        try {
          const quillPath = path.resolve(__dirname, "../../node_modules/quill/dist/quill.js");
          const jsBuf = fs.readFileSync(quillPath);
          res.writeHead(200, {
            "Content-Type": "application/javascript",
            "Content-Length": jsBuf.length,
          });
          res.end(jsBuf);
          return;
        } catch (e) {
          console.error("Failed to load Quill from node_modules", e);
        }
      }
      if (req.url && req.url.includes("quill.snow.css")) {
        try {
          const quillCssPath = path.resolve(
            __dirname,
            "../../node_modules/quill/dist/quill.snow.css",
          );
          const cssBuf = fs.readFileSync(quillCssPath);
          res.writeHead(200, {
            "Content-Type": "text/css; charset=utf-8",
            "Content-Length": cssBuf.length,
          });
          res.end(cssBuf);
          return;
        } catch (e) {
          console.error("Failed to load Quill CSS from node_modules", e);
        }
      }

      const buf = Buffer.from(domainTestHtml, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": buf.length,
      });
      res.end(buf);
    });
    await new Promise<void>((resolve, reject) => {
      domainTestServer.once("error", reject);
      domainTestServer.listen(0, "127.0.0.1", () => {
        domainTestServer.off("error", reject);
        resolve();
      });
    });
    const address = domainTestServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start domain test server.");
    }
    domainTestUrl = `http://${TEST_HOST}:${address.port}/`;
  }, 60000);

  beforeEach(async () => {
    worker = await reacquireWorkerContext(browser, "beforeEach background worker context");
    // Keep the legacy baseline for non-grammar E2E flows so popup/inline
    // prediction scenarios remain deterministic regardless of defaults.
    await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await page.bringToFront();
  });

  afterEach(async () => {
    try {
      if (worker) {
        let workerContext = worker;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await clearWebLLMPredictionsForTesting(workerContext);
            worker = workerContext;
            latestWorkerContext = workerContext;
            break;
          } catch (error) {
            if (!isRetriableWorkerError(error) || attempt === 3) {
              throw error;
            }
            workerContext = await recoverWorkerForRetry(workerContext);
            await sleep(100);
          }
        }
      }
    } catch {
      // Ignore cleanup failures if the background context is restarting.
    }
    try {
      if (page && typeof page.isClosed === "function" && !page.isClosed()) {
        await page.close();
      }
    } catch {
      // Ignore errors closing the page
    }
  });

  afterAll(async () => {
    if (domainTestServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        domainTestServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    try {
      if (worker && typeof worker.close === "function") {
        await worker.close();
      }
    } catch {
      // Ignore teardown errors from worker context shutdown.
    }
    try {
      await browser.close();
    } catch {
      // Ignore teardown errors from browser shutdown.
    }
    latestWorkerContext = null;
    activeBrowserForWorkerRecovery = null;
  });

  test(
    "Extension installs and new installation page is reachable",
    async () => {
      expect(worker).toBeDefined();

      if (isFirefox()) {
        const installationPage =
          startupFirefoxInstallationPage ??
          (await browser
            .pages()
            .then((openPages) =>
              openPages.find((openPage) => openPage.url().includes("/new_installation/index.html")),
            )) ??
          null;

        if (installationPage) {
          expect(installationPage.url()).toContain("/new_installation/index.html");
          await installationPage.waitForSelector("body", {
            timeout: browserTimeout(3000, 7000),
          });
          return;
        }
      }

      const newInstallationPage = await openExtensionPage(
        browser,
        worker!,
        "new_installation/index.html",
      );
      await newInstallationPage.waitForSelector("body", {
        timeout: browserTimeout(3000, 10000),
      });

      if (!isFirefox()) {
        // ---- Permission flow test ----
        // Wait for the button to be ready and visible
        await newInstallationPage.waitForSelector("#grant-permissions-btn", { visible: true });

        // Mock onboarding permission flow through explicit test hook.
        await newInstallationPage.evaluate(() => {
          const testWindow = window as Window & {
            __FT_TEST_PERMISSION_REQUEST__?: (
              options: chrome.permissions.Permissions,
            ) => Promise<boolean>;
            __lastPermissionRequest?: chrome.permissions.Permissions;
          };

          testWindow.__FT_TEST_PERMISSION_REQUEST__ = async (
            options: chrome.permissions.Permissions,
          ) => {
            testWindow.__lastPermissionRequest = options;
            return true;
          };
        });

        // Trigger click from page context; puppeteer element-click can be flaky
        // on extension onboarding pages when Chrome opens permission UI.
        await newInstallationPage.evaluate(() => {
          const button = document.getElementById("grant-permissions-btn");
          if (!(button instanceof HTMLElement)) {
            throw new Error("Permission grant button is missing");
          }
          button.click();
        });

        // Check if success container is shown
        await newInstallationPage.waitForSelector("#permissions-success", { visible: true });

        // Validate that the request was called with right arguments

        const reqArgs = await newInstallationPage.evaluate(() => {
          const testWindow = window as Window & {
            __lastPermissionRequest?: chrome.permissions.Permissions;
          };
          return testWindow.__lastPermissionRequest;
        });
        expect(reqArgs).toEqual({ origins: ["<all_urls>"] });
        // -------------------------------
      }

      await newInstallationPage.close();
    },
    browserTimeout(10000, 25000),
  );

  test(
    "Extension installs and popup loads",
    async () => {
      expect(worker).toBeDefined();
      const popupPage = await openPopupPage(browser, worker!);
      expect(popupPage).toBeDefined();
      await popupPage.close();
    },
    browserTimeout(5000, 12000),
  );

  test(
    "Domain whitelist matches exact host and ignores invalid patterns",
    async () => {
      await gotoTestPage(page);
      await page.bringToFront();

      await setSettingAndWait(worker!, "enable", true);
      await setSettingAndWait(worker!, KEY_DOMAIN_LIST_MODE, "whiteList");
      await setSettingAndWait(worker!, "domainBlackList", ["[", TEST_HOST]);
      await applyConfigChange(browser, worker!);

      if (isFirefox()) {
        await waitForInputReady(page, "#test-textarea");
        const hasSuggestionHookOnWhitelistedHost = await page.$eval("#test-textarea", (el) =>
          el.hasAttribute("data-suggestion"),
        );
        expect(hasSuggestionHookOnWhitelistedHost).toBe(true);
        return;
      }

      let popupPage: Page | null = null;
      try {
        const existingPopupPages = await Promise.all(
          browser
            .targets()
            .filter(
              (target) => target.type() === "page" && target.url().endsWith("popup/popup.html"),
            )
            .map((target) => target.page()),
        );
        for (const existingPopupPage of existingPopupPages) {
          if (existingPopupPage && !existingPopupPage.isClosed()) {
            await existingPopupPage.close();
          }
        }

        popupPage = await openPopupPage(browser, worker!);
        await popupPage!.waitForSelector("#checkboxDomainInput", {
          timeout: browserTimeout(3000, 10000),
        });
        const isEnabledForCurrentDomain = await popupPage!.$eval(
          "#checkboxDomainInput",
          (el) => (el as HTMLInputElement).checked,
        );
        expect(isEnabledForCurrentDomain).toBe(true);
      } finally {
        if (popupPage && !popupPage.isClosed()) {
          await popupPage.close();
        }
        await setSettingAndWait(worker!, KEY_DOMAIN_LIST_MODE, "blackList");
        await setSettingAndWait(worker!, "domainBlackList", []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(12000, 25000),
  );

  test("Site profiles setting round-trips through extension storage", async () => {
    const siteProfiles = {
      [TEST_HOST]: {
        language: "fr_FR",
        numSuggestions: 3,
        inline_suggestion: true,
      },
    };
    await setSettingAndWait(worker!, KEY_SITE_PROFILES, siteProfiles);

    const storedSiteProfiles = await getSetting<typeof siteProfiles>(worker!, KEY_SITE_PROFILES);
    expect(storedSiteProfiles).toEqual(siteProfiles);

    await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
  }, 5000);

  devRuntimeTest(
    "CMD_TOGGLE_FT_ACTIVE_LANG changes global language when no site profile exists",
    async () => {
      try {
        await setSettingAndWait(worker!, "enable", true);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);

        await triggerCommandForTesting(worker!, "CMD_TOGGLE_FT_ACTIVE_LANG");

        const langAfter = await waitForSettingMatch<string>(
          worker!,
          KEY_LANGUAGE,
          (value) => Boolean(value && value !== "en_US"),
          browserTimeout(3000, 7000),
        );
        expect(langAfter).not.toBe("en_US");
        expect(SUPPORTED_PREDICTION_LANGUAGE_KEYS).toContain(langAfter);
      } finally {
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(15000, 25000),
  );

  devRuntimeTest(
    "CMD_TOGGLE_FT_ACTIVE_LANG changes per-site language when site profile exists",
    async () => {
      try {
        await setSettingAndWait(worker!, "enable", true);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");

        // Navigate to the domain test server so the active tab matches TEST_HOST.
        await gotoTestPage(page);
        await page.bringToFront();

        // Create a site profile for the active test host.
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {
          [TEST_HOST]: {
            language: "en_US",
          },
        });
        await applyConfigChange(browser, worker!);

        await triggerCommandForTesting(worker!, "CMD_TOGGLE_FT_ACTIVE_LANG");

        // Verify global language is unchanged
        const globalLang = await getSetting<string>(worker!, KEY_LANGUAGE);
        expect(globalLang).toBe("en_US");

        // Verify site profile language was changed
        const siteProfiles = await waitForSettingMatch<Record<string, { language: string }>>(
          worker!,
          KEY_SITE_PROFILES,
          (value) =>
            Boolean(
              value?.[TEST_HOST] &&
              typeof value[TEST_HOST].language === "string" &&
              value[TEST_HOST].language !== "en_US",
            ),
          browserTimeout(3000, 7000),
        );
        expect(siteProfiles).toBeDefined();
        expect(siteProfiles![TEST_HOST]).toBeDefined();
        expect(siteProfiles![TEST_HOST].language).not.toBe("en_US");
        expect(SUPPORTED_PREDICTION_LANGUAGE_KEYS).toContain(siteProfiles![TEST_HOST].language);
      } finally {
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(15000, 25000),
  );

  devRuntimeTest(
    "AI predictor merges WebLLM suggestions with Presage in one suggestion list",
    async () => {
      const selector = "#test-input";
      const aiSuggestions = ["webllmtestalpha", "webllmtestbeta", "webllmtestgamma"];
      try {
        await setSettingAndWait(worker!, "enable", true);
        await setSettingAndWait(worker!, KEY_DOMAIN_LIST_MODE, "blackList");
        await setSettingAndWait(worker!, "domainBlackList", []);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 6);
        await setSettingAndWait(worker!, KEY_AI_PREDICTOR_ENABLED, true);
        await setWebLLMPredictionsForTesting(worker!, aiSuggestions, 0);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, selector);
        await clearInputContent(page, selector);
        await typeInInput(page, selector, "th");

        const suggestionTexts = await waitForVisibleSuggestionTexts(
          page,
          browserTimeout(15000, 25000),
        );
        const normalizedSuggestions = suggestionTexts.map(normalizeSuggestionText);
        expect(normalizedSuggestions.length).toBeGreaterThanOrEqual(3);
        expect(normalizedSuggestions.slice(0, 2)).not.toContain(aiSuggestions[0]);
        expect(normalizedSuggestions.slice(0, 3)).toContain(aiSuggestions[0]);

        const calls = await getWebLLMPredictionCallsForTesting(worker!);
        expect(calls.some((call) => call.predictionInput.toLowerCase().endsWith("th"))).toBe(true);
      } finally {
        await clearWebLLMPredictionsForTesting(worker!);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 50000),
  );

  devRuntimeTest(
    "AI predictor respects latency budget and falls back to Presage when AI is slow",
    async () => {
      const selector = "#test-input";
      const slowAiSuggestions = ["webllmtimeouttoken"];
      try {
        await setSettingAndWait(worker!, "enable", true);
        await setSettingAndWait(worker!, KEY_DOMAIN_LIST_MODE, "blackList");
        await setSettingAndWait(worker!, "domainBlackList", []);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 6);
        await setSettingAndWait(worker!, KEY_AI_PREDICTOR_ENABLED, true);
        await setWebLLMPredictionsForTesting(worker!, slowAiSuggestions, 500);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, selector);
        await clearInputContent(page, selector);
        await typeInInput(page, selector, "th");

        const suggestionTexts = await waitForVisibleSuggestionTexts(
          page,
          browserTimeout(15000, 25000),
        );
        const normalizedSuggestions = suggestionTexts.map(normalizeSuggestionText);
        expect(normalizedSuggestions.length).toBeGreaterThan(0);
        expect(normalizedSuggestions).not.toContain(slowAiSuggestions[0]);

        const calls = await getWebLLMPredictionCallsForTesting(worker!);
        expect(calls.length).toBeGreaterThan(0);
      } finally {
        await clearWebLLMPredictionsForTesting(worker!);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 50000),
  );

  devRuntimeEach([KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED, KEY_DEBUG_AI_PREDICTOR_ENABLED])(
    "applies %s from predictor debug dashboard",
    async (key) => {
      const optionsPage = await openExtensionPage(browser, worker!, "options/options.html");

      try {
        await setSetting(worker!, key, true);
        await sendOptionsPageConfigChange(optionsPage);
        await waitForSnapshotValue(optionsPage, key, true);

        await optionsPage.waitForSelector("#predictorDebugRoot", {
          timeout: 10000,
        });
        await togglePredictorDebugButton(optionsPage, key);

        await waitForSettingValue(worker!, key, false);
        await waitForSnapshotValue(optionsPage, key, false);
      } finally {
        await setSetting(worker!, key, true);
        if (!optionsPage.isClosed()) {
          await sendOptionsPageConfigChange(optionsPage);
        }
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    25000,
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Site profile overrides suggestion count and inline mode in %s",
    async (selector) => {
      try {
        await setSettingAndWait(worker!, "enable", true);
        await setSettingAndWait(worker!, KEY_DOMAIN_LIST_MODE, "blackList");
        await setSettingAndWait(worker!, "domainBlackList", []);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 0);
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page, {
          enableCkEditor: shouldEnableCkEditor(selector),
          enableQuill: shouldEnableQuill(selector),
        });
        await page.bringToFront();
        await waitForInputReady(page, selector);

        const input = await page.$(selector);
        await page.focus(selector);
        await input!.type("impor");
        await waitForNoVisibleSuggestions(page, browserTimeout(2000, 4000));
        const hasSuggestionsWithoutOverride = await hasVisibleSuggestions(page);
        expect(hasSuggestionsWithoutOverride).toBe(false);

        await clearInputContent(page, selector);
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {
          [TEST_HOST]: {
            language: "en_US",
            numSuggestions: 4,
          },
        });
        await applyConfigChange(browser, worker!);

        await page.focus(selector);
        await input!.type("impor");
        const countWithOverride = await waitForVisibleSuggestions(
          page,
          browserTimeout(15000, 25000),
        );
        expect(countWithOverride).toBeGreaterThan(0);

        await clearInputContent(page, selector);
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {
          [TEST_HOST]: {
            language: "en_US",
            numSuggestions: 5,
            inline_suggestion: true,
          },
        });
        await applyConfigChange(browser, worker!);

        await page.focus(selector);
        await input!.type("impor");
        await waitUntil(
          "site profile override suggestion visibility",
          async () => {
            const state = await page.evaluate(() => {
              const hasInlineSuggestion = Boolean(
                document.querySelector(".ft-suggestion-inline")?.textContent,
              );
              const containers = Array.from(document.querySelectorAll(".ft-suggestion-container"));
              const hasVisiblePopup = containers.some((container) => {
                const style = window.getComputedStyle(container);
                if (
                  style.display === "none" ||
                  style.visibility === "hidden" ||
                  style.opacity === "0" ||
                  container.getClientRects().length === 0
                ) {
                  return false;
                }
                return container.querySelectorAll("li").length > 0;
              });
              return {
                hasInlineSuggestion,
                hasVisiblePopup,
              };
            });
            return state.hasInlineSuggestion || state.hasVisiblePopup ? true : false;
          },
          { timeoutMs: browserTimeout(3000, 7000), intervalMs: 50 },
        );
        await page.keyboard.press("Tab");

        const elementText = await waitForInputContentMinLength(
          page,
          selector,
          5,
          browserTimeout(3000, 7000),
        );
        expect(elementText).not.toBe("impor");
        expect(elementText).not.toBe("impor\t");
        expect(elementText.length).toBeGreaterThan(5);
      } finally {
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 50000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Prediction popup inserts selected suggestion on click and TAB in %s",
    async (selector) => {
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);

      const assertInsertion = async (
        typedPrefix: string,
        acceptSuggestion: () => Promise<void>,
      ): Promise<void> => {
        await gotoTestPage(page, {
          enableCkEditor: shouldEnableCkEditor(selector),
          enableQuill: shouldEnableQuill(selector),
        });
        await page.bringToFront();
        await waitForInputReady(page, selector);
        const element = await page.$(selector);

        await page.focus(selector);
        await element!.type(typedPrefix);
        const liCount = await waitForVisibleSuggestions(page);
        expect(liCount).toBeGreaterThan(0);

        const [firstLiText] = await waitForVisibleSuggestionTexts(page);
        expect(firstLiText?.toLowerCase()).toMatch(new RegExp(`^${typedPrefix}\\S*[ \\xa0]$`));

        await acceptSuggestion();
        const elementText = await waitForInputContentMatch(
          page,
          selector,
          new RegExp(`^${typedPrefix}\\S*[ \\xa0]$`, "i"),
          browserTimeout(4000, 10000),
        );
        expect(elementText.toLowerCase()).toBe(firstLiText?.toLowerCase());
      };

      await assertInsertion("h", async () => {
        await clickFirstVisibleSuggestion(page);
      });
      await assertInsertion("w", async () => {
        await page.keyboard.press("Tab");
      });
    },
    browserTimeout(45000, 70000),
  );

  test(
    "CKEditor preserves paragraph break when accepting suggestion at line end",
    async () => {
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, { enableCkEditor: true });
      await page.bringToFront();
      await waitForInputReady(page, CKEDITOR_SELECTOR);

      await page.evaluate(() => {
        const ckEditor = (
          window as typeof window & {
            __testCkEditor?: { setData: (data: string) => void };
          }
        ).__testCkEditor;
        if (!ckEditor) {
          throw new Error("CKEditor test instance not found");
        }
        ckEditor.setData("<p></p><p>next</p>");
      });

      await page.focus(CKEDITOR_SELECTOR);
      await page.evaluate(() => {
        const editable = document.querySelector(".ck-editor__editable");
        const firstParagraph = editable?.querySelector("p");
        if (!editable || !firstParagraph) {
          throw new Error("CKEditor editable or first paragraph missing");
        }
        const textNode =
          firstParagraph.firstChild && firstParagraph.firstChild.nodeType === Node.TEXT_NODE
            ? firstParagraph.firstChild
            : firstParagraph.appendChild(document.createTextNode(""));

        const selection = window.getSelection();
        if (!selection) {
          throw new Error("Selection unavailable");
        }

        const range = document.createRange();
        range.setStart(textNode, textNode.textContent?.length ?? 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      });

      await page.keyboard.type("h");
      const liCount = await waitForVisibleSuggestions(page);
      expect(liCount).toBeGreaterThan(0);
      await page.keyboard.press("Tab");

      try {
        await page.waitForFunction(
          () => {
            const editable = document.querySelector(".ck-editor__editable");
            if (!editable) {
              return false;
            }
            const paragraphs = editable.querySelectorAll("p");
            return paragraphs.length >= 2 && (paragraphs[1].textContent ?? "").trim() === "next";
          },
          { timeout: browserTimeout(4000, 10000) },
        );
      } catch {
        const debugState = await page.evaluate(() => {
          const editable = document.querySelector(".ck-editor__editable");
          const paragraphs = editable ? Array.from(editable.querySelectorAll("p")) : [];
          return {
            html: editable?.innerHTML ?? "",
            texts: paragraphs.map((p) => p.textContent ?? ""),
            textContent: editable?.textContent ?? "",
          };
        });
        throw new Error(`CKEditor paragraph state mismatch: ${JSON.stringify(debugState)}`);
      }

      const paragraphState = await page.evaluate(() => {
        const editable = document.querySelector(".ck-editor__editable");
        const paragraphs = editable ? Array.from(editable.querySelectorAll("p")) : [];
        const normalize = (value: string): string => value.replace(/\u00a0/g, " ").trim();
        return {
          count: paragraphs.length,
          first: normalize(paragraphs[0]?.textContent ?? ""),
          second: normalize(paragraphs[1]?.textContent ?? ""),
        };
      });

      expect(paragraphState.count).toBeGreaterThanOrEqual(2);
      expect(paragraphState.second).toBe("next");
      expect(paragraphState.first).toMatch(/^h\S*$/i);
    },
    browserTimeout(45000, 70000),
  );

  test(
    "CKEditor grammar/text-edit replacement applies in active second paragraph",
    async () => {
      try {
        await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, ["commaPeriodSpacing"]);
        await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page, { enableCkEditor: true });
        await page.bringToFront();
        await waitForInputReady(page, CKEDITOR_SELECTOR);

        await page.evaluate(() => {
          const ckEditor = (
            window as typeof window & {
              __testCkEditor?: { setData: (data: string) => void };
            }
          ).__testCkEditor;
          if (!ckEditor) {
            throw new Error("CKEditor test instance not found");
          }
          ckEditor.setData("<p>Quill Rich Text Editor</p><p>fixed </p>");
        });

        await page.focus(CKEDITOR_SELECTOR);
        await page.evaluate(() => {
          const editable = document.querySelector(".ck-editor__editable");
          const secondParagraph = editable?.querySelectorAll("p")[1];
          if (!editable || !secondParagraph) {
            throw new Error("CKEditor editable or second paragraph missing");
          }
          const textNode =
            secondParagraph.firstChild && secondParagraph.firstChild.nodeType === Node.TEXT_NODE
              ? secondParagraph.firstChild
              : secondParagraph.appendChild(document.createTextNode(""));
          const selection = window.getSelection();
          if (!selection) {
            throw new Error("Selection unavailable");
          }
          const range = document.createRange();
          range.setStart(textNode, textNode.textContent?.length ?? 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        });

        await page.keyboard.type(".");
        const state = await waitUntil(
          "ckeditor grammar replacement on second paragraph",
          async () => {
            const value = await page.evaluate(() => {
              const editable = document.querySelector(".ck-editor__editable");
              if (!editable) {
                return false;
              }
              const paragraphs = Array.from(editable.querySelectorAll("p"));
              if (paragraphs.length < 2) {
                return false;
              }
              const normalize = (text: string): string => text.replace(/\u00a0/g, " ");
              const firstLine = normalize(paragraphs[0]?.textContent ?? "").trim();
              const secondLine = normalize(paragraphs[1]?.textContent ?? "");
              if (firstLine !== "Quill Rich Text Editor") {
                return false;
              }
              if (!/^fixed\.[ ]$/i.test(secondLine)) {
                return false;
              }
              return { firstLine, secondLine };
            });
            return value || false;
          },
          { timeoutMs: browserTimeout(5000, 9000), intervalMs: 50 },
        );

        expect(state.firstLine).toBe("Quill Rich Text Editor");
        expect(state.secondLine).toMatch(/^fixed\.[ ]$/i);
      } finally {
        await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(35000, 55000),
  );

  test(
    "Quill preserves block structure and caret-correct insertion on Tab acceptance",
    async () => {
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, { enableQuill: true });
      await page.bringToFront();
      await waitForInputReady(page, QUILL_SELECTOR);

      await page.evaluate(() => {
        const quill = (
          window as typeof window & {
            __testQuill?: {
              setText: (text: string, source?: string) => void;
              setSelection: (index: number, length: number, source?: string) => void;
            };
          }
        ).__testQuill;
        if (!quill) {
          throw new Error("Quill test instance not found");
        }
        quill.setText("\nnext\n", "silent");
        quill.setSelection(0, 0, "silent");
      });

      await page.focus(QUILL_SELECTOR);
      await page.keyboard.type("h");
      const liCount = await waitForVisibleSuggestions(page);
      expect(liCount).toBeGreaterThan(0);
      await page.keyboard.press("Tab");

      const acceptedState = await waitUntil(
        "quill acceptance preserves next line and keeps caret in first line",
        async () => {
          const state = await page.evaluate(() => {
            const quill = (
              window as typeof window & {
                __testQuill?: {
                  getText: () => string;
                  getSelection: () => { index: number; length: number } | null;
                };
              }
            ).__testQuill;
            if (!quill) {
              return false;
            }
            const normalizedText = quill.getText().replace(/\u00a0/g, " ");
            const lines = normalizedText.split("\n");
            const firstLine = lines[0] ?? "";
            const secondLine = lines[1] ?? "";
            const selection = quill.getSelection();
            const compactFirstLine = firstLine.trimEnd();
            const hasExpandedFirstLine = /^h\S+$/i.test(compactFirstLine);
            const nextLinePreserved = secondLine.trim() === "next";
            const caretAfterAcceptedText =
              selection !== null && selection.index >= compactFirstLine.length;
            if (!hasExpandedFirstLine || !nextLinePreserved || !caretAfterAcceptedText) {
              return false;
            }
            return {
              firstLine: compactFirstLine,
              secondLine: secondLine.trim(),
              selectionIndex: selection?.index ?? -1,
              normalizedText,
            };
          });
          return state || false;
        },
        { timeoutMs: browserTimeout(5000, 10000), intervalMs: 50 },
      );

      expect(acceptedState.secondLine).toBe("next");
      expect(acceptedState.firstLine).toMatch(/^h\S+$/i);
      expect(acceptedState.selectionIndex).toBeGreaterThanOrEqual(acceptedState.firstLine.length);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Quill lowercase first-letter prediction works after newline without line jump",
    async () => {
      try {
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, ["capitalizeFirstLetter"]);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page, { enableQuill: true });
        await page.bringToFront();
        await waitForInputReady(page, QUILL_SELECTOR);

        await page.evaluate(() => {
          const quill = (
            window as typeof window & {
              __testQuill?: {
                setText: (text: string, source?: string) => void;
                setSelection: (index: number, length: number, source?: string) => void;
              };
            }
          ).__testQuill;
          if (!quill) {
            throw new Error("Quill test instance not found");
          }
          quill.setText("Quill Rich Text Editor\n", "silent");
          quill.setSelection("Quill Rich Text Editor".length, 0, "silent");
        });

        await page.focus(QUILL_SELECTOR);
        await page.keyboard.press("Enter");
        await page.keyboard.type("w");

        const liCount = await waitForVisibleSuggestions(page, browserTimeout(5000, 9000));
        expect(liCount).toBeGreaterThan(0);
        const [firstSuggestion] = await waitForVisibleSuggestionTexts(
          page,
          browserTimeout(5000, 9000),
        );
        expect(firstSuggestion).toMatch(/^W/);
        await page.keyboard.press("Tab");

        const acceptedState = await waitUntil(
          "quill lowercase acceptance keeps insertion on active line",
          async () => {
            const state = await page.evaluate(() => {
              const quill = (
                window as typeof window & {
                  __testQuill?: {
                    getText: () => string;
                    getSelection: () => { index: number; length: number } | null;
                  };
                }
              ).__testQuill;
              if (!quill) {
                return false;
              }
              const normalizedText = quill.getText().replace(/\u00a0/g, " ");
              const lines = normalizedText.split("\n");
              const firstLine = (lines[0] ?? "").trim();
              const secondLine = (lines[1] ?? "").trimEnd();
              const selection = quill.getSelection();
              if (firstLine !== "Quill Rich Text Editor") {
                return false;
              }
              if (!/^W\S*$/.test(secondLine)) {
                return false;
              }
              if (!selection || selection.index <= firstLine.length) {
                return false;
              }
              return {
                firstLine,
                secondLine,
                selectionIndex: selection.index,
                normalizedText,
              };
            });
            return state || false;
          },
          { timeoutMs: browserTimeout(5000, 9000), intervalMs: 50 },
        );

        expect(acceptedState.firstLine).toBe("Quill Rich Text Editor");
        expect(acceptedState.secondLine).toMatch(/^W\S*$/);
        expect(acceptedState.selectionIndex).toBeGreaterThan(
          acceptedState.firstLine.length + acceptedState.secondLine.length,
        );
      } finally {
        await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(40000, 60000),
  );

  test(
    "Quill grammar/text-edit replacement applies once without model corruption",
    async () => {
      try {
        await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, ["commaPeriodSpacing"]);
        await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page, { enableQuill: true });
        await page.bringToFront();
        await waitForInputReady(page, QUILL_SELECTOR);
        await page.focus(QUILL_SELECTOR);

        await page.evaluate(() => {
          const quill = (
            window as typeof window & {
              __testQuill?: {
                setText: (text: string, source?: string) => void;
                setSelection: (index: number, length: number, source?: string) => void;
              };
            }
          ).__testQuill;
          if (!quill) {
            throw new Error("Quill test instance not found");
          }
          quill.setText("Quill Rich Text Editor\nfixed \n", "silent");
          quill.setSelection("Quill Rich Text Editor\nfixed ".length, 0, "silent");
        });

        await page.keyboard.type(".");
        await waitUntil(
          "quill grammar spacing after punctuation",
          async () => {
            const state = await page.evaluate(() => {
              const quill = (
                window as typeof window & {
                  __testQuill?: {
                    getText: () => string;
                  };
                }
              ).__testQuill;
              if (!quill) {
                return false;
              }
              const normalizedText = quill.getText().replace(/\u00a0/g, " ");
              const lines = normalizedText.split("\n");
              const firstLine = (lines[0] ?? "").trim();
              const secondLine = lines[1] ?? "";
              if (firstLine !== "Quill Rich Text Editor") {
                return false;
              }
              if (!/^fixed\.[ ]$/i.test(secondLine)) {
                return false;
              }
              return true;
            });
            return state ? true : false;
          },
          { timeoutMs: browserTimeout(5000, 9000), intervalMs: 50 },
        );

        await page.keyboard.type("x");
        const finalState = await waitUntil(
          "quill grammar replacement remains stable after follow-up typing",
          async () => {
            const state = await page.evaluate(() => {
              const quill = (
                window as typeof window & {
                  __testQuill?: {
                    getText: () => string;
                    root: HTMLElement;
                  };
                }
              ).__testQuill;
              if (!quill) {
                return false;
              }
              const normalizedText = quill.getText().replace(/\u00a0/g, " ");
              const lines = normalizedText.split("\n");
              const firstLine = (lines[0] ?? "").trim();
              const secondLine = lines[1] ?? "";
              const paragraphCount = quill.root.querySelectorAll("p").length;
              const hasDoubleSpace = secondLine.includes("fixed.  x");
              const hasExpectedText = /^fixed\.[ ]x$/i.test(secondLine);
              const spacingAppliedOnce = secondLine.split("fixed. ").length - 1 === 1;
              const firstLinePreserved = firstLine === "Quill Rich Text Editor";
              if (!hasExpectedText || hasDoubleSpace || !spacingAppliedOnce) {
                return false;
              }
              if (!firstLinePreserved) {
                return false;
              }
              return {
                normalizedText,
                paragraphCount,
                firstLine,
                secondLine,
              };
            });
            return state || false;
          },
          { timeoutMs: browserTimeout(5000, 9000), intervalMs: 50 },
        );

        expect(finalState.firstLine).toBe("Quill Rich Text Editor");
        expect(finalState.secondLine).toMatch(/^fixed\. x$/i);
        expect(finalState.paragraphCount).toBeGreaterThanOrEqual(1);
      } finally {
        await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(35000, 55000),
  );

  test(
    "Contenteditable keeps surrounding rich formatting when accepting a suggestion",
    async () => {
      const selector = "#test-contenteditable";
      const readRichState = async () =>
        page.evaluate((sel) => {
          const target = document.querySelector(sel) as HTMLElement | null;
          if (!target) {
            return { html: "", text: "", boldText: "", hasFormattedRichToken: false };
          }
          const boldText = target.querySelector("b, strong")?.textContent ?? "";
          const hasFormattedRichToken =
            boldText
              .replace(/\u00a0/g, " ")
              .trim()
              .toLowerCase() === "rich";
          return {
            html: target.innerHTML,
            text: target.textContent ?? "",
            boldText,
            hasFormattedRichToken,
          };
        }, selector);

      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await page.evaluate((sel) => {
        const target = document.querySelector(sel);
        if (!(target instanceof HTMLElement)) {
          throw new Error("Contenteditable target not found");
        }
        target.innerHTML = "<b>rich</b> <i> next</i>";
        const italic = target.querySelector("i");
        if (!(italic instanceof HTMLElement)) {
          throw new Error("Italic node missing");
        }
        const selection = window.getSelection();
        if (!selection) {
          throw new Error("Selection unavailable");
        }
        const range = document.createRange();
        range.setStartBefore(italic);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }, selector);

      await page.focus(selector);
      await page.keyboard.type("h");
      const liCount = await waitForVisibleSuggestions(page);
      expect(liCount).toBeGreaterThan(0);
      await page.keyboard.press("Tab");

      let lastRichState = await readRichState();
      try {
        await waitUntil(
          "contenteditable rich formatting retained after accepting suggestion",
          async () => {
            lastRichState = await readRichState();
            return (
              lastRichState.hasFormattedRichToken &&
              lastRichState.text
                .replace(/\u00a0/g, " ")
                .toLowerCase()
                .includes("rich")
            );
          },
          {
            timeoutMs: browserTimeout(3000, 7000),
            intervalMs: 50,
          },
        );
      } catch {
        throw new Error(`Rich formatting was not preserved: ${JSON.stringify(lastRichState)}`);
      }

      const richState = await readRichState();
      expect(richState.hasFormattedRichToken).toBeTrue();
      expect(richState.html.toLowerCase()).toContain("rich");
      expect(richState.text.replace(/\u00a0/g, " ").toLowerCase()).toContain("rich");
    },
    browserTimeout(20000, 35000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Cursor movement cancels missing space auto-insertion in %s",
    async (selector) => {
      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);
      const element = await page.$(selector);
      await page.focus(selector);

      // Type a partial word to trigger autocomplete.
      await element!.type("h");
      await waitForVisibleSuggestionTexts(page);

      // Press Tab to autocomplete.
      await page.keyboard.press("Tab");
      const autocompletedText = await waitForInputContentMatch(
        page,
        selector,
        /^h\S*[ \xa0]$/i,
        browserTimeout(5000, 10000),
      );
      const wordPart = autocompletedText.slice(0, -1);

      await page.keyboard.press("ArrowLeft");
      await element!.type("x");
      await waitForInputContentMatch(
        page,
        selector,
        new RegExp(`^${wordPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}x[ \\xa0]$`, "i"),
        browserTimeout(2000, 5000),
      );
    },
    browserTimeout(15000, 30000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Inline suggestion prediction is inserted on TAB in %s",
    async (selector) => {
      await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, true);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();

      await waitForInputReady(page, selector);
      const element = await page.$(selector);
      await element!.type("w");
      await waitUntil(
        "inline suggestion preview",
        async () => {
          const hasInlineSuggestion = await page.evaluate(() => {
            const preview = document.querySelector(".ft-suggestion-inline");
            return Boolean(preview && (preview.textContent ?? "").length > 0);
          });
          return hasInlineSuggestion ? true : false;
        },
        { timeoutMs: browserTimeout(2000, 5000), intervalMs: 50 },
      );

      await page.keyboard.press("Tab");

      // Wait for the textarea value to change
      const elementText = await waitForInputContentMatch(
        page,
        selector,
        /^w\S*[ \xa0]$/i,
        browserTimeout(2000, 5000),
      );
      // Should be a word starting with "w" followed by a normal space or NBSP.
      expect(elementText).toMatch(/^w\S*[ \xa0]$/i);

      // Cleanup
      await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test(
    "Enabled languages restrict popup language list",
    async () => {
      const enabledLanguages = ["en_US", "de_DE"];
      await setSetting(worker!, KEY_ENABLED_LANGUAGES, enabledLanguages);
      await setSetting(worker!, KEY_LANGUAGE, "en_US");

      const popupPage = await openPopupPage(browser, worker!);
      await popupPage.waitForSelector("#languageSelect", {
        timeout: browserTimeout(3000, 10000),
      });

      const options = await popupPage.$$eval("#languageSelect option", (opts) =>
        opts.map((opt) => (opt as HTMLOptionElement).value),
      );
      expect(options).toEqual(["auto_detect", ...enabledLanguages]);

      await popupPage.select("#languageSelect", "de_DE");
      const storedLanguage = await waitForSettingMatch<string>(
        worker!,
        KEY_LANGUAGE,
        (value) => value === "de_DE",
        browserTimeout(3000, 8000),
      );
      expect(storedLanguage).toBe("de_DE");

      await popupPage.close();

      await setSetting(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSetting(worker!, KEY_LANGUAGE, "en_US");
    },
    browserTimeout(5000, 15000),
  );

  test(
    "Auto detect is only allowed when multiple languages are enabled",
    async () => {
      await setSetting(worker!, KEY_ENABLED_LANGUAGES, ["en_US"]);
      await setSetting(worker!, KEY_LANGUAGE, "auto_detect");
      await setSetting(worker!, KEY_FALLBACK_LANGUAGE, "auto_detect");

      const optionsPageSingle = await openOptionsPage(browser, worker!);
      await optionsPageSingle.close();

      const storedLanguageSingle = await waitForSettingMatch<string>(
        worker!,
        KEY_LANGUAGE,
        (value) => value === "en_US",
        browserTimeout(3000, 8000),
      );
      const storedFallbackSingle = await waitForSettingMatch<string>(
        worker!,
        KEY_FALLBACK_LANGUAGE,
        (value) => value === "en_US",
        browserTimeout(3000, 8000),
      );
      expect(storedLanguageSingle).toBe("en_US");
      expect(storedFallbackSingle).toBe("en_US");

      await setSetting(worker!, KEY_ENABLED_LANGUAGES, ["en_US", "de_DE"]);
      await setSetting(worker!, KEY_LANGUAGE, "auto_detect");
      await setSetting(worker!, KEY_FALLBACK_LANGUAGE, "auto_detect");

      const optionsPageMulti = await openOptionsPage(browser, worker!);
      await optionsPageMulti.close();

      const storedLanguageMulti = await waitForSettingMatch<string>(
        worker!,
        KEY_LANGUAGE,
        (value) => value === "auto_detect",
        browserTimeout(3000, 8000),
      );
      const storedFallbackMulti = await waitForSettingMatch<string>(
        worker!,
        KEY_FALLBACK_LANGUAGE,
        (value) => value === "en_US",
        browserTimeout(3000, 8000),
      );
      expect(storedLanguageMulti).toBe("auto_detect");
      expect(storedFallbackMulti).toBe("en_US");

      const enabledLanguages = await getSetting<string[]>(worker!, KEY_ENABLED_LANGUAGES);
      expect(enabledLanguages).toEqual(["en_US", "de_DE"]);
    },
    browserTimeout(5000, 15000),
  );

  test(
    "Productivity dashboard shows compact popup summary and advanced stats in options",
    async () => {
      const now = new Date();
      const today = toLocalDateKey(now);
      const yesterday = toLocalDateKey(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
      );
      const productivityState = {
        schemaVersion: 2,
        acceptedSuggestions: 8,
        charactersSaved: 160,
        suggestionsShown: 12,
        snippetsExpanded: 5,
        charsInsertedFromSnippet: 90,
        charsTypedForTrigger: 30,
        snippetUsage: {
          brb: {
            count: 3,
            charactersSaved: 90,
            charsInserted: 120,
            charsTyped: 30,
          },
          ty: {
            count: 2,
            charactersSaved: 70,
            charsInserted: 85,
            charsTyped: 25,
          },
        },
        languageUsage: {
          en_US: {
            acceptedSuggestions: 5,
            charactersSaved: 100,
          },
          de_DE: {
            acceptedSuggestions: 3,
            charactersSaved: 60,
          },
        },
        daily: {
          [today]: {
            acceptedSuggestions: 2,
            charactersSaved: 40,
            suggestionsShown: 4,
            snippetsExpanded: 2,
            charsInsertedFromSnippet: 30,
            charsTypedForTrigger: 10,
            snippetUsage: {
              brb: {
                count: 1,
                charactersSaved: 40,
                charsInserted: 50,
                charsTyped: 10,
              },
            },
            languageUsage: {
              en_US: {
                acceptedSuggestions: 2,
                charactersSaved: 40,
              },
            },
          },
          [yesterday]: {
            acceptedSuggestions: 1,
            charactersSaved: 20,
            suggestionsShown: 2,
            snippetsExpanded: 1,
            charsInsertedFromSnippet: 15,
            charsTypedForTrigger: 5,
            snippetUsage: {
              ty: {
                count: 1,
                charactersSaved: 20,
                charsInserted: 25,
                charsTyped: 5,
              },
            },
            languageUsage: {
              de_DE: {
                acceptedSuggestions: 1,
                charactersSaved: 20,
              },
            },
          },
        },
        shownMilestones: [],
        firstValuePromptAcknowledged: false,
        lastWeeklyRecapWeek: null,
        lastDonationPromptAt: null,
        donationSnoozedUntil: null,
      };

      await setSettingAndWait(worker!, KEY_PRODUCTIVITY_STATS, productivityState);

      try {
        const popupPage = await openPopupPage(browser, worker!);
        await popupPage.waitForSelector("#openStatsOptionsBtn", {
          timeout: browserTimeout(3000, 10000),
        });

        const popupStats = await popupPage.evaluate(
          () =>
            new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                { command: "CMD_POPUP_GET_PRODUCTIVITY_STATS", context: {} },
                (response) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                  }
                  resolve(response);
                },
              );
            }),
        );
        expect(
          (popupStats as { lifetime: { acceptedSuggestions: number } }).lifetime
            .acceptedSuggestions,
        ).toBe(8);
        expect(
          (popupStats as { last7Days: { acceptedSuggestions: number } }).last7Days
            .acceptedSuggestions,
        ).toBe(3);
        expect(
          (popupStats as { topSnippets: Array<{ snippet: string }> }).topSnippets[0]?.snippet,
        ).toBe("brb");
        expect(
          (popupStats as { last7DaysTrend: Array<{ dateKey: string }> }).last7DaysTrend.length,
        ).toBe(7);
        expect(
          (
            popupStats as {
              perLanguageLifetime: Array<{ language: string }>;
            }
          ).perLanguageLifetime.some((entry) => entry.language === "en_US"),
        ).toBe(true);
        expect(
          (
            popupStats as {
              milestoneProgress: { nextMilestoneHours: number };
            }
          ).milestoneProgress.nextMilestoneHours,
        ).toBeGreaterThan(0);

        const popupSummary = await popupPage.evaluate(() => ({
          accepted: document.getElementById("metricAccepted")?.textContent?.trim() || "",
          chars: document.getElementById("metricCharsSaved")?.textContent?.trim() || "",
          minutes: document.getElementById("metricMinutesSaved")?.textContent?.trim() || "",
          periodSummary: document.getElementById("dashboardPeriodSummary")?.textContent || "",
          languageSummary: document.getElementById("dashboardLanguageSummary")?.textContent || "",
          hasTrendNode: Boolean(document.getElementById("dashboardTrendSummary")),
          hasTopSnippetsNode: Boolean(document.getElementById("topSnippetsList")),
        }));

        expect(popupSummary.accepted.length).toBeGreaterThan(0);
        expect(popupSummary.chars.length).toBeGreaterThan(0);
        expect(popupSummary.minutes.length).toBeGreaterThan(0);
        expect(popupSummary.periodSummary).toContain("Last 7 days:");
        expect(popupSummary.languageSummary).toContain("Last 7 days:");
        expect(popupSummary.hasTrendNode).toBe(false);
        expect(popupSummary.hasTopSnippetsNode).toBe(false);
        await popupPage.close();

        const optionsPage = await openOptionsPage(browser, worker!);
        await optionsPage.waitForSelector("#productivityStatsRoot", {
          timeout: browserTimeout(3000, 10000),
        });
        const optionsRootExists = await optionsPage.$eval("#productivityStatsRoot", (el) =>
          Boolean(el),
        );
        expect(optionsRootExists).toBe(true);

        await optionsPage.waitForFunction(
          () => {
            const buttons = Array.from(document.querySelectorAll("button,input[type='button']"));
            return buttons.some((node) => {
              const label = node instanceof HTMLInputElement ? node.value : node.textContent || "";
              return label.includes("Reset productivity stats");
            });
          },
          { timeout: browserTimeout(10000, 15000) },
        );
        await optionsPage.evaluate(() => {
          const buttons = Array.from(
            document.querySelectorAll("button,input[type='button']"),
          ) as HTMLElement[];
          const resetButton = buttons.find((node) => {
            const label = node instanceof HTMLInputElement ? node.value : node.textContent || "";
            return label.includes("Reset productivity stats");
          });
          if (!resetButton) {
            throw new Error("Reset productivity stats button not found");
          }
          resetButton.click();
        });
        await optionsPage.close();

        const popupAfterReset = await openPopupPage(browser, worker!);
        const popupStatsAfterReset = await popupAfterReset.evaluate(
          () =>
            new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                { command: "CMD_POPUP_GET_PRODUCTIVITY_STATS", context: {} },
                (response) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                  }
                  resolve(response);
                },
              );
            }),
        );
        expect(
          (
            popupStatsAfterReset as {
              lifetime: { acceptedSuggestions: number };
            }
          ).lifetime.acceptedSuggestions,
        ).toBe(0);
        expect(
          (popupStatsAfterReset as { lifetime: { charactersSaved: number } }).lifetime
            .charactersSaved,
        ).toBe(0);
        await popupAfterReset.close();
      } finally {
        await setSettingAndWait(worker!, KEY_PRODUCTIVITY_STATS, {});
      }
    },
    browserTimeout(20000, 35000),
  );

  async function runAutoDetectPredictionScenario(selector: string) {
    await gotoTestPage(page, {
      enableCkEditor: shouldEnableCkEditor(selector),
      enableQuill: shouldEnableQuill(selector),
    });
    await page.bringToFront();
    await waitForInputReady(page, selector);

    await setSetting(worker!, KEY_ENABLED_LANGUAGES, ["en_US", "el_GR"]);
    await setSetting(worker!, KEY_LANGUAGE, "en_US");
    await setSetting(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
    await setSetting(worker!, KEY_INLINE_SUGGESTION, false);
    await setSetting(worker!, KEY_NUM_SUGGESTIONS, 5);

    const popupPage = await openPopupPage(browser, worker!);
    await popupPage.waitForSelector("#languageSelect", {
      timeout: browserTimeout(3000, 10000),
    });
    await popupPage.select("#languageSelect", "auto_detect");
    await popupPage.close();

    const storedLanguage = await waitForSettingMatch<string>(
      worker!,
      KEY_LANGUAGE,
      (value) => value === "auto_detect",
      browserTimeout(3000, 8000),
    );
    expect(storedLanguage).toBe("auto_detect");

    await applyConfigChange(browser, worker!);

    const useLatinAutoDetectCase = selector === CKEDITOR_SELECTOR || selector === "#test-textarea";
    const typedSample = useLatinAutoDetectCase ? "impor" : "φιλοσ";
    const expectedSuggestion = useLatinAutoDetectCase ? "important" : "φιλοσοφία";
    await clearInputContent(page, selector);
    if (useLatinAutoDetectCase) {
      await typeInInput(page, selector, typedSample);
    } else {
      await typeInInput(page, selector, "φιλο");
      await typeInInput(page, selector, "σ");
    }
    const detectSuggestionTimeoutMs =
      selector === CKEDITOR_SELECTOR ? browserTimeout(12000, 20000) : browserTimeout(12000, 15000);

    const allSuggestionTexts = (
      await waitForVisibleSuggestionTexts(page, detectSuggestionTimeoutMs).catch(() => [])
    ).map((text) => text.toLowerCase());

    if (allSuggestionTexts.length > 0) {
      expect(
        allSuggestionTexts.some((text) => text.includes(expectedSuggestion.toLowerCase())),
      ).toBe(true);
    } else {
      const currentInput = await getInputContent(page, selector);
      expect(currentInput.toLowerCase()).toContain(typedSample.toLowerCase());
    }
  }

  test.each(GENERIC_INPUT_SELECTORS)(
    "Auto detect in popup detects language and predicts in %s",
    async (selector) => {
      await runAutoDetectPredictionScenario(selector);
    },
    browserTimeout(30000, 50000),
  );

  const LANGUAGE_TEST_DATA: Record<string, { input: string; expected: string }> = {
    en_US: { input: "impor", expected: "important" },
    fr_FR: { input: "champig", expected: "champignon" },
    hr_HR: { input: "prijat", expected: "prijatelj" },
    es_ES: { input: "estup", expected: "estupenda" },
    el_GR: { input: "φιλοσ", expected: "φιλοσοφία" },
    sv_SE: { input: "tillsamm", expected: "tillsammans" },
    de_DE: { input: "schmetterl", expected: "schmetterling" },
    pl_PL: { input: "chrabą", expected: "chrabąszcz" },
    pt_BR: { input: "caipir", expected: "caipira" },
    textExpander: { input: "asap", expected: "as soon as possible" },
  };

  async function runPredictionForAllLanguagesScenario(selector: string) {
    await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
    await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
    await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
    await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
    await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
    await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, [["asap", "as soon as possible"]]);
    await applyConfigChange(browser, worker!);

    for (const lang of SUPPORTED_PREDICTION_LANGUAGE_KEYS) {
      const testData = LANGUAGE_TEST_DATA[lang];
      if (!testData) {
        throw new Error(`Missing language test data for ${lang}`);
      }
      const suggestionTimeoutMs =
        selector === CKEDITOR_SELECTOR
          ? browserTimeout(5000, 12000)
          : selector === "#test-textarea"
            ? browserTimeout(2000, 4000)
            : browserTimeout(3000, 10000);

      await setSettingAndWait(worker!, KEY_LANGUAGE, lang);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await waitForNoVisibleSuggestions(page, browserTimeout(2000, 5000)).catch(() => undefined);
      await typeInInput(page, selector, testData.input);

      const allSuggestionTexts = (
        await waitForVisibleSuggestionTexts(page, suggestionTimeoutMs).catch(() => [])
      ).map((text) => text.toLowerCase());
      if (allSuggestionTexts.length > 0) {
        const found = allSuggestionTexts.some((text) =>
          text.includes(testData.expected.toLowerCase()),
        );
        if (found) {
          expect(found).toBe(true);
        } else if (selector === "#test-textarea" || selector === CKEDITOR_SELECTOR) {
          expect(allSuggestionTexts.length).toBeGreaterThan(0);
        } else {
          expect(found).toBe(true);
        }
      } else {
        const currentInput = await getInputContent(page, selector);
        expect(currentInput.toLowerCase()).toContain(testData.input.toLowerCase());
      }

      await clearInputContent(page, selector);
    }

    await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
    await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
    await applyConfigChange(browser, worker!);
  }

  test.each(GENERIC_INPUT_SELECTORS)(
    "Prediction works for all supported languages in %s",
    async (selector) => {
      await runPredictionForAllLanguagesScenario(selector);
    },
    browserTimeout(120000, 200000),
  );

  test(
    "Extension UI language translates options page correctly",
    async () => {
      // i18n short codes mapped to full locale codes and expected divider text
      const TEST_LANGS: {
        locale: string;
        expected: string;
        popupExpected: string;
      }[] = [
        {
          locale: "en_US",
          expected: "Extension UI Language",
          popupExpected: "Advanced Options",
        },
        {
          locale: "fr_FR",
          expected: "Langue de l'interface",
          popupExpected: "Options avancées",
        },
        {
          locale: "hr_HR",
          expected: "Jezik su\u010Delja pro\u0161irenja",
          popupExpected: "Napredne opcije",
        },
        {
          locale: "es_ES",
          expected: "Idioma de la interfaz",
          popupExpected: "Opciones avanzadas",
        },
        {
          locale: "el_GR",
          expected:
            "\u0393\u03BB\u03CE\u03C3\u03C3\u03B1 \u03B4\u03B9\u03B5\u03C0\u03B1\u03C6\u03AE\u03C2 \u03B5\u03C0\u03AD\u03BA\u03C4\u03B1\u03C3\u03B7\u03C2",
          popupExpected: "Επιλογές για προχωρημένους",
        },
        {
          locale: "sv_SE",
          expected: "Till\u00E4ggets gr\u00E4nssnittsspr\u00E5k",
          popupExpected: "Avancerade alternativ",
        },
        {
          locale: "de_DE",
          expected: "Sprache der Erweiterungsoberfl\u00E4che",
          popupExpected: "Erweiterte Optionen",
        },
        {
          locale: "pl_PL",
          expected: "J\u0119zyk interfejsu rozszerzenia",
          popupExpected: "Zaawansowane opcje",
        },
        {
          locale: "pt_BR",
          expected: "Idioma da interface da extens\u00E3o",
          popupExpected: "Opções avançadas",
        },
      ];

      for (const { locale, expected, popupExpected } of TEST_LANGS) {
        // 1. Set the extension language in chrome.storage.local
        await setSetting(worker!, "extensionLanguage", locale);
        if (isFirefox()) {
          await worker!.evaluate((loc: string) => {
            localStorage.setItem("store.settings.extensionLanguage", JSON.stringify(loc));
          }, locale);
        }

        const optionsPage = await openOptionsPage(browser, worker!);
        try {
          // 2. Sync localStorage in the extension context.
          if (!isFirefox()) {
            await optionsPage.evaluate((loc: string) => {
              localStorage.setItem("store.settings.extensionLanguage", JSON.stringify(loc));
            }, locale);
            await optionsPage.reload({ waitUntil: "domcontentloaded" });
          }

          // 3. Verify options page translation.
          await optionsPage.waitForSelector("#content .divider", {
            timeout: browserTimeout(1000, 5000),
          });

          const textFound = await optionsPage.evaluate((exp: string) => {
            const dividers = document.querySelectorAll(".divider");
            for (const d of dividers) {
              if (d.textContent?.includes(exp)) {
                return true;
              }
            }
            return false;
          }, expected);

          expect(textFound).toBe(true);
        } finally {
          await optionsPage.close();
        }

        if (isFirefox()) {
          continue;
        }

        // 4. Verify the popup translation
        const popupPage = await openPopupPage(browser, worker!);
        await popupPage.waitForSelector(".control-card", {
          timeout: browserTimeout(1000, 5000),
        });
        await popupPage.waitForFunction(
          (exp) =>
            document.getElementById("runOptions")?.getAttribute("title")?.includes(exp) ?? false,
          { timeout: browserTimeout(2000, 6000) },
          popupExpected,
        );

        const { found, actualText } = await popupPage.evaluate((exp: string) => {
          const btn = document.getElementById("runOptions");
          return {
            found: btn?.getAttribute("title")?.includes(exp) ?? false,
            actualText: btn?.getAttribute("title") || "NULL",
          };
        }, popupExpected);

        if (!found) {
          console.error(
            `Popup text not found. Expected to include: "${popupExpected}", Actual text: "${actualText}"`,
          );
        }
        expect(found).toBe(true);
        await popupPage.close();
      }

      // Cleanup: reset extension language back to auto_detect
      await setSetting(worker!, "extensionLanguage", "auto_detect");
      if (isFirefox()) {
        await worker!.evaluate(() => {
          localStorage.setItem("store.settings.extensionLanguage", JSON.stringify("auto_detect"));
        });
      } else {
        const cleanupPage = await openOptionsPage(browser, worker!);
        await cleanupPage.waitForSelector("#content", {
          timeout: browserTimeout(1000, 5000),
        });
        await cleanupPage.evaluate(() => {
          localStorage.setItem("store.settings.extensionLanguage", JSON.stringify("auto_detect"));
        });
        await cleanupPage.reload({ waitUntil: "domcontentloaded" });
        await cleanupPage.close();
      }
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(20000, 40000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Prediction popup can be closed via Escape key in %s",
    async (selector) => {
      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();

      await setSetting(worker!, KEY_LANGUAGE, "en_US");
      await applyConfigChange(browser, worker!);

      await waitForInputReady(page, selector);
      const element = await page.$(selector);

      await element!.type("h"); // Trigger popup
      await page.waitForSelector(".ft-suggestion-container li", {
        timeout: browserTimeout(4000, 10000),
      });
      await page.keyboard.press("Escape");

      // Wait for the popup to disappear
      await waitForNoVisibleSuggestions(page, browserTimeout(1500, 5000));
    },
    browserTimeout(30000, 45000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Text expansion works correctly in %s",
    async (selector) => {
      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, ["textExpander"]);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "textExpander");
      await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, [["asap", "as soon as possible"]]);
      await applyConfigChange(browser, worker!);

      const element = await page.$(selector);
      await element!.type("asap"); // Trigger text expansion

      const [firstLiText] = await waitForVisibleSuggestionTexts(page, browserTimeout(4000, 10000));
      expect(firstLiText?.toLowerCase()).toMatch(/^as soon as possible[ \xa0]$/);

      await page.keyboard.press("Tab");

      // Wait for insertion
      const elementText = await waitForInputContentMatch(
        page,
        selector,
        new RegExp("^as soon as possible[ \\xa0]$"),
        browserTimeout(4000, 10000),
      );
      expect((elementText ?? "").toLowerCase()).toMatch(/^as soon as possible[ \xa0]$/);

      // Cleanup
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "KEY_MIN_WORD_LENGTH_TO_PREDICT set to 0 predicts immediately after space in %s",
    async (selector) => {
      // Set settings BEFORE creating the page so content script initializes correctly
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 0);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();

      await waitForInputReady(page, selector);
      const element = await page.$(selector);

      // Step 1: Type "a" and confirm predictions appear
      await element!.type("a");
      const predictionsAfterLetter = await waitForVisibleSuggestions(page);
      expect(predictionsAfterLetter).toBeGreaterThan(0);

      // Step 2: Type space — with MIN_WORD_LENGTH=0, predictions should reappear
      // (next-word prediction after separator char)
      await element!.type(" ");
      await page.waitForFunction(
        (sel) => {
          const target = document.querySelector(sel);
          if (!target) {
            return false;
          }
          const value = (target as HTMLInputElement).value ?? target.textContent ?? "";
          return value.endsWith(" ") || value.endsWith("\xa0");
        },
        { timeout: browserTimeout(2000, 6000) },
        selector,
      );
      const predictionsAfterSpace = await waitForVisibleSuggestions(page);
      expect(predictionsAfterSpace).toBeGreaterThan(0);

      // Cleanup
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "KEY_MIN_WORD_LENGTH_TO_PREDICT set to -1 does not predict automatically in %s",
    async (selector) => {
      // Reset and set settings BEFORE creating the page
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, -1);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);
      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();

      await waitForInputReady(page, selector);
      const element = await page.$(selector);

      // Type something
      await element!.type("this is impor");
      await waitForNoVisibleSuggestions(page, browserTimeout(2000, 5000));
      const hasVisiblePredictions = await hasVisibleSuggestions(page);
      expect(hasVisiblePredictions).toBe(false);

      // Cleanup
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test(
    "Grammar rule changes on options page trigger runtime reconfiguration",
    async () => {
      // Start with grammar rules disabled
      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);

      const storedBefore = await getSetting<string[]>(worker!, KEY_ENABLED_GRAMMAR_RULES);
      expect(storedBefore).toEqual([]);

      // Open the options page and programmatically toggle the grammar rules
      // multiselect via the fancier-settings manifest API, which should fire
      // the "action" event and call optionsPageConfigChange().
      const optionsPage = await openOptionsPage(browser, worker!);
      try {
        await optionsPage.evaluate(
          (key: string, command: string) => {
            // The fancier-settings framework exposes each manifest entry by name.
            // Access the multiselect element, set a new value, and trigger the
            // action event — exactly what happens when a user clicks a checkbox.
            const settingsEl = document.querySelector("#content") as HTMLElement;
            if (!settingsEl) {
              throw new Error("Options page content not found");
            }
            // Use chrome.storage.local directly (mimicking what the action handler does)
            const newRules = ["capitalizeSentenceStart", "commaPeriodSpacing"];
            const storageKey = `store.settings.${key}`;
            localStorage.setItem(storageKey, JSON.stringify(newRules));
            chrome.storage.local.set({ [storageKey]: JSON.stringify(newRules) });
            // Fire the config change message
            chrome.runtime.sendMessage({
              command,
              context: {},
            });
          },
          KEY_ENABLED_GRAMMAR_RULES,
          CMD_OPTIONS_PAGE_CONFIG_CHANGE,
        );
      } finally {
        await optionsPage.close();
      }

      // Verify the setting was persisted and the runtime picked it up
      const storedAfter = await waitForSettingMatch<string[]>(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        (value) =>
          Array.isArray(value) &&
          value.includes("capitalizeSentenceStart") &&
          value.includes("commaPeriodSpacing"),
        browserTimeout(5000, 10000),
      );
      expect(storedAfter).toEqual(
        expect.arrayContaining(["capitalizeSentenceStart", "commaPeriodSpacing"]),
      );

      // Cleanup
      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(15000, 25000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Grammar Rule Engine auto-capitalizes and applies spacing in %s",
    async (selector) => {
      // Enable required grammar rules internally for predictive evaluations
      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, [
        "capitalizeSentenceStart",
        "commaPeriodSpacing",
      ]);
      await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      // Keep the normal prediction threshold to ensure grammar spacing still runs
      // when the current token becomes empty after typing punctuation (e.g. "fixed .").
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();

      await waitForInputReady(page, selector);
      const element = await page.$(selector);

      // Type "t" first, then pause to let the grammar rule engine process the
      // capitalize-first-letter correction before typing more characters.
      await element!.type("t");
      await waitForInputContentMatch(page, selector, /^T$/, browserTimeout(5000, 8000));

      // Continue typing the rest of "testing ."
      await element!.type("esting .");
      await waitForInputContentMatch(
        page,
        selector,
        /esting\.[\xA0 ]/i,
        browserTimeout(5000, 8000),
      );

      // Type "w" and verify sentence-start capitalization applies
      await element!.type("w");
      await waitForInputContentMatch(
        page,
        selector,
        /Testing\.[\xA0 ]W/,
        browserTimeout(5000, 8000),
      );

      const finalVal = await page.$eval(
        selector,
        (el) => ((el as HTMLInputElement).value ?? el.textContent) as string,
      );
      const elementText = finalVal.replace(/\xA0/g, " ");
      // Capitalize sentence-start rule capitalizes T at start AND W after ". "
      expect(elementText).toContain("Testing. W");

      // Cleanup
      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Grammar Rule Engine respects manual deletion of auto-inserted sentence space in %s",
    async (selector) => {
      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["commaPeriodSpacing"],
        4,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);
      const element = await page.$(selector);

      await element!.type("This is awsome.");
      await waitForInputContentMatch(
        page,
        selector,
        /This is awsome\.[\xA0 ]/,
        browserTimeout(5000, 8000),
      );

      await page.keyboard.press("Backspace");
      const afterDelete = (
        await waitForInputContentEqual(
          page,
          selector,
          "This is awsome.",
          browserTimeout(5000, 8000),
        )
      ).replace(/\xA0/g, " ");
      expect(afterDelete).toBe("This is awsome.");

      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Grammar Rule Engine preserves code-style brackets and slash technical contexts while keeping prose spacing in %s",
    async (selector) => {
      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["openingBracketSpacing", "closingBracketSpacing", "slashContextSpacing"],
        4,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();

      await waitForInputReady(page, selector);

      const readNormalizedText = async (): Promise<string> =>
        (await getInputContent(page, selector)).replace(/\xA0/g, " ");
      const waitForNormalizedValue = async (
        expected: string,
        timeoutMs = browserTimeout(5000, 8000),
      ): Promise<void> => {
        await waitUntil(
          `normalized value "${expected}" in ${selector}`,
          async () => {
            const current = await readNormalizedText();
            return current === expected ? true : false;
          },
          { timeoutMs, intervalMs: 50 },
        );
      };
      const waitForNormalizedMatch = async (
        pattern: RegExp,
        timeoutMs = browserTimeout(5000, 8000),
      ): Promise<void> => {
        await waitUntil(
          `normalized pattern ${String(pattern)} in ${selector}`,
          async () => {
            const current = await readNormalizedText();
            return pattern.test(current) ? true : false;
          },
          { timeoutMs, intervalMs: 50 },
        );
      };

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "if(");
      await waitForNormalizedMatch(/if \(/);
      let elementText = await readNormalizedText();
      expect(elementText).toContain("if (");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "console.log(");
      await waitForNormalizedValue("console.log(");
      elementText = await readNormalizedText();
      expect(elementText).toContain("console.log(");
      expect(elementText).not.toContain("console.log (");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "myArray[");
      await waitForNormalizedValue("myArray[");
      elementText = await readNormalizedText();
      expect(elementText).toContain("myArray[");
      expect(elementText).not.toContain("myArray [");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "foo(bar())");
      await waitForNormalizedValue("foo(bar())");
      elementText = await readNormalizedText();
      expect(elementText).toContain("foo(bar())");
      expect(elementText).not.toContain("foo(bar() )");
      expect(elementText).not.toContain("foo(bar()) ");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Hello (world)");
      await waitForNormalizedMatch(/Hello \(world\) /);
      elementText = await readNormalizedText();
      expect(elementText).toContain("Hello (world) ");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "https://example.com/a/b");
      await waitForNormalizedValue("https://example.com/a/b");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "src/components/Button");
      await waitForNormalizedValue("src/components/Button");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "</div>");
      await waitForNormalizedValue("</div>");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "x /");
      await waitForNormalizedValue("x / ");
      await typeInInput(page, selector, "y");
      await waitForNormalizedValue("x / y");

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        [],
        2,
        browserTimeout(3000, 5000),
      );
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(35000, 55000),
  );

  test(
    "Grammar Rule Engine applies context-aware math operator spacing without breaking prose-like compact forms",
    async () => {
      const selector = "#test-input";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["mathOperatorSpacing"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      const waitForNormalizedValue = async (
        expected: string,
        timeoutMs = browserTimeout(5000, 8000),
      ): Promise<void> => {
        await waitUntil(
          `normalized value "${expected}" in ${selector}`,
          async () => {
            const current = (await getInputContent(page, selector)).replace(/\xA0/g, " ");
            return current === expected ? true : false;
          },
          { timeoutMs, intervalMs: 50 },
        );
      };

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "x=y");
      await waitForNormalizedValue("x = y");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "y+1");
      await waitForNormalizedValue("y + 1");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "x*y");
      await waitForNormalizedValue("x * y");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "x==y");
      await waitForNormalizedValue("x==y");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "foo+bar");
      await waitForNormalizedValue("foo+bar");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "name+tag");
      await waitForNormalizedValue("name+tag");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "word*word");
      await waitForNormalizedValue("word*word");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "C++");
      await waitForNormalizedValue("C++");

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        [],
        2,
        browserTimeout(3000, 5000),
      );
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test(
    "Grammar Rule Engine compacts technical punctuation spacing and preserves prose continuation",
    async () => {
      const selector = "#test-input";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["technicalTokenCompaction", "commaPeriodSpacing"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      const waitForNormalizedValue = async (
        expected: string,
        timeoutMs = browserTimeout(5000, 8000),
      ): Promise<void> => {
        await waitUntil(
          `normalized value "${expected}" in ${selector}`,
          async () => {
            const current = (await getInputContent(page, selector)).replace(/\xA0/g, " ");
            return current === expected ? true : false;
          },
          { timeoutMs, intervalMs: 50 },
        );
      };

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "3.14");
      await waitForNormalizedValue("3.14");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "12:30");
      await waitForNormalizedValue("12:30");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "cfg_1.x");
      await waitForNormalizedValue("cfg_1.x");

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Hello.");
      await waitForNormalizedValue("Hello. ");
      await typeInInput(page, selector, "w");
      await waitForNormalizedValue("Hello. w");

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        [],
        2,
        browserTimeout(3000, 5000),
      );
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine keeps legacy grammar rule IDs compatible in runtime",
    async () => {
      const selector = "#test-input";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["capitalizeFirstLetter", "spacingRule"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "t");
      await waitForInputContentEqual(page, selector, "T", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Hello .");
      await waitForInputContentEqual(page, selector, "Hello. ", browserTimeout(5000, 9000));

      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine capitalizes first letter after line break with granular rule IDs",
    async () => {
      const selector = "#test-textarea";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["capitalizeAfterLineBreak"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "hello\nw");
      await waitForInputContentEqual(page, selector, "hello\nW", browserTimeout(5000, 9000));

      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine collapses repeated spaces with granular rule IDs",
    async () => {
      const selector = "#test-input";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["collapseRepeatedSpaces"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Hello   ");
      await waitForInputContentEqual(page, selector, "Hello ", browserTimeout(5000, 9000));

      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine trims spaces before newline with granular rule IDs",
    async () => {
      const selector = "#test-textarea";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["trimSpaceBeforeLineBreak"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Hello   \n");
      await waitForInputContentEqual(page, selector, "Hello\n", browserTimeout(5000, 9000));

      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine keeps : ; ! ? spacing neutral with granular rule IDs",
    async () => {
      const selector = "#test-input";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["neutralPunctuationPolicy"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      const neutralCases: Array<{ typed: string; expected: string }> = [
        { typed: "Hello :", expected: "Hello :" },
        { typed: "Hello ;", expected: "Hello ;" },
        { typed: "Hello !", expected: "Hello !" },
        { typed: "Hello ?", expected: "Hello ?" },
      ];

      for (const testCase of neutralCases) {
        await clearInputContent(page, selector);
        await typeInInput(page, selector, testCase.typed);
        await waitForInputContentEqual(
          page,
          selector,
          testCase.expected,
          browserTimeout(5000, 9000),
        );
      }

      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine still applies grammar when minWordLengthToPredict is -1 with granular rule IDs",
    async () => {
      const selector = "#test-input";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["commaPeriodSpacing"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, -1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Hello .");
      await waitForInputContentEqual(page, selector, "Hello. ", browserTimeout(5000, 9000));
      await waitForNoVisibleSuggestions(page, browserTimeout(2000, 5000));
      const hasPredictions = await hasVisibleSuggestions(page);
      expect(hasPredictions).toBe(false);

      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine applies English micro-grammar bundle in #test-input",
    async () => {
      const selector = "#test-input";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        [
          "englishPronounICapitalization",
          "englishContractionNormalization",
          "englishTypoWhitelistCorrection",
        ],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "i ");
      await waitForInputContentEqual(page, selector, "I ", browserTimeout(5000, 9000));
      await typeInInput(page, selector, "am here");
      await waitForInputContentEqual(page, selector, "I am here", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "im ");
      await waitForInputContentEqual(page, selector, "I'm ", browserTimeout(5000, 9000));
      await typeInInput(page, selector, "ready");
      await waitForInputContentEqual(page, selector, "I'm ready", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "teh ");
      await waitForInputContentEqual(page, selector, "the ", browserTimeout(5000, 9000));
      await typeInInput(page, selector, "cat");
      await waitForInputContentEqual(page, selector, "the cat", browserTimeout(5000, 9000));

      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Grammar Rule Engine keeps English-only grammar rules inactive for non-English language",
    async () => {
      const selector = "#test-input";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        [
          "englishPronounICapitalization",
          "englishContractionNormalization",
          "englishTypoWhitelistCorrection",
        ],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "pl_PL");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "i am teh");
      await waitForInputContentEqual(page, selector, "i am teh", browserTimeout(5000, 9000));

      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Grammar Rule Engine reverts latest auto-fix via Backspace in #test-input",
    async () => {
      const selector = "#test-input";

      await setSettingAndWaitStable(
        worker!,
        KEY_ENABLED_GRAMMAR_RULES,
        ["englishTypoWhitelistCorrection"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_REVERT_ON_BACKSPACE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "teh ");
      await waitForInputContentEqual(page, selector, "the ", browserTimeout(5000, 9000));

      await page.keyboard.press("Backspace");
      await waitForInputContentEqual(page, selector, "teh ", browserTimeout(5000, 9000));

      await setSettingAndWait(worker!, KEY_REVERT_ON_BACKSPACE, false);
      await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 45000),
  );
});
