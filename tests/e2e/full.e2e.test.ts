import {
  HOST_EDITOR_REQUEST_EVENT,
  HOST_EDITOR_REQUEST_ATTR,
} from "../../src/adapters/chrome/content-script/suggestions/HostEditorBridgeProtocol";
import type Quill from "quill";
import type { Browser, Frame, Page } from "puppeteer";
import path from "path";
import * as fs from "fs";
import type { Server } from "http";
import { createServer } from "http";
import { PERSONALIZATION_STORAGE_KEY } from "../../src/core/application/personalization/PersonalizationRepository";
import {
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  CMD_OPTIONS_CLEAR_PERSONALIZATION,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_AUTO_LANGUAGE_SITE_PRIORS,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_DOMAIN_LIST_MODE,
  KEY_LANGUAGE,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_PERSONALIZATION_ENABLED,
  KEY_PREFIX_ONLY_MODE,
  KEY_PRODUCTIVITY_STATS,
  KEY_SITE_PROFILES,
  KEY_TEXT_EXPANSIONS,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_REVIEW_RULE_OVERRIDES,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_CODE_MODE,
} from "../../src/core/domain/constants";
import { SUPPORTED_PREDICTION_LANGUAGE_KEYS } from "../../src/core/domain/lang";
import { grammarRuleSelectionToOverrides } from "../../src/core/domain/grammar/GrammarRuleSettings";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";
import type { BackgroundContext } from "./e2e-helpers";
import {
  BROWSER_TYPE,
  getTimeoutProfile,
  launchBrowser,
  getBackgroundContext,
  getRuntimePageUrl,
  openExtensionPage,
  openPopupPage,
  sleep,
  triggerCommandForTesting,
  suiteTimeout,
  waitUntil,
  isFirefox,
  clickReviewControl,
  readReviewPanel,
  textPoint,
  triggerReview,
  waitForReview,
} from "./e2e-helpers";

const TEST_PAGE_PATH = path.resolve(__dirname, "test-page.html");
const TEST_HOST = "localhost";
const SETTINGS_PREFIX = "store.settings.";
const CKEDITOR_SELECTOR = ".ck-editor__editable";
const QUILL_SELECTOR = ".ql-editor";
const LEXICAL_SELECTOR = "#test-lexical-editor";
const PROSEMIRROR_SELECTOR = "#test-prosemirror-editor";
const GENERIC_INPUT_SELECTORS = ["#test-input"] as const;
const timeoutProfile = getTimeoutProfile();

const NAVIGATION_TIMEOUT_MS = timeoutProfile.navigationMs;
const INPUT_READY_TIMEOUT_MS = timeoutProfile.inputReadyMs;
const SUGGESTION_TIMEOUT_MS = timeoutProfile.suggestionMs;
const RUN_DEV_RUNTIME_E2E =
  process.env.FT_E2E_DEV_RUNTIME === "1" || process.env.FT_E2E_DEV_RUNTIME === "true";
const RUN_E2E = process.env.RUN_E2E === "1" || process.env.RUN_E2E === "true";
const IS_CI = process.env.CI === "true" || process.env.CI === "1";
const describeE2E = RUN_E2E ? describe : describe.skip;
const WORKER_REACQUIRE_TIMEOUT_MS = isFirefox() ? 15000 : IS_CI ? 15000 : 7000;
const ONBOARDING_VIEWPORT = { width: 1280, height: 900 } as const;

function browserTimeout(chromeTimeoutMs: number, firefoxTimeoutMs: number) {
  return suiteTimeout(chromeTimeoutMs, firefoxTimeoutMs);
}

async function bundleTestEditor(
  editor: "lexical" | "prosemirror" | "tinymce" | "react-controlled",
): Promise<Buffer> {
  const buildResult = await Bun.build({
    entrypoints: [path.resolve(__dirname, "fixtures", `${editor}-test-editor.ts`)],
    target: "browser",
    format: "iife",
    minify: false,
    sourcemap: "none",
    write: false,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });
  if (!buildResult.success) {
    const errors = buildResult.logs
      .map((log) => {
        const location = log.position
          ? `${log.position.file}:${log.position.line}:${log.position.column}`
          : "unknown";
        return `[${log.level}] ${location} ${log.message}`;
      })
      .join("\n");
    throw new Error(`Failed to bundle ${editor} test editor:\n${errors}`);
  }

  const bundle = buildResult.outputs[0];
  if (!bundle) {
    throw new Error(`${editor} test editor bundle output is missing`);
  }

  return Buffer.from(await bundle.arrayBuffer());
}

type OnboardingViewportSnapshot = {
  viewportWidth: number;
  viewportHeight: number;
  permissionInViewport: boolean;
  rationaleInViewport: boolean;
  nextActionInViewport: boolean;
};

type TestNameContext = {
  fullName?: string;
  name?: string;
};

type TrackedTestCallback = (...args: unknown[]) => unknown;
type TestRegistrarLike = {
  (name: string, fn: TrackedTestCallback, timeout?: number): unknown;
  (name: string, options: unknown, fn: TrackedTestCallback, timeout?: number): unknown;
  each: (
    cases: readonly unknown[],
  ) => (name: string, fn: TrackedTestCallback, timeout?: number) => unknown;
  skip?: TestRegistrarLike;
};

let currentE2ETestName = "Unknown Test";

function wrapTrackedTestCallback(
  fallbackName: string,
  callback: TrackedTestCallback,
): TrackedTestCallback {
  return async (...args: unknown[]) => {
    const [context] = args as [TestNameContext | undefined];
    currentE2ETestName = context?.fullName || context?.name || fallbackName || "Unknown Test";
    return await callback(...args);
  };
}

function createTrackedSkipRegistrar(base: TestRegistrarLike): TestRegistrarLike {
  const tracked = ((
    name: string,
    optionsOrFn: unknown,
    maybeFn?: unknown,
    maybeTimeout?: number,
  ) => {
    if (typeof optionsOrFn === "function") {
      return base(name, wrapTrackedTestCallback(name, optionsOrFn), maybeFn);
    }
    if (typeof maybeFn === "function") {
      return base(name, optionsOrFn, wrapTrackedTestCallback(name, maybeFn), maybeTimeout);
    }
    return base(name, optionsOrFn, maybeFn as TrackedTestCallback, maybeTimeout);
  }) as TestRegistrarLike;

  tracked.each = ((cases: readonly unknown[]) => {
    const eachBase = base.each(cases);
    return (name: string, callback: TrackedTestCallback, timeout?: number) =>
      eachBase(name, wrapTrackedTestCallback(name, callback), timeout);
  }) as TestRegistrarLike["each"];

  return tracked;
}

function createTrackedTestRegistrar(base: TestRegistrarLike): TestRegistrarLike {
  const tracked = createTrackedSkipRegistrar(base);
  if (base.skip) {
    tracked.skip = createTrackedSkipRegistrar(base.skip);
  }
  return tracked;
}

const test = createTrackedTestRegistrar(globalThis.test as unknown as TestRegistrarLike);
const devRuntimeTest = RUN_DEV_RUNTIME_E2E ? test : test.skip;

function devRuntimeEach<T>(cases: readonly T[]) {
  return RUN_DEV_RUNTIME_E2E ? test.each(cases) : test.skip.each(cases);
}

async function captureOnboardingViewportSnapshot(page: Page): Promise<OnboardingViewportSnapshot> {
  return await page.evaluate(() => {
    const permissionButton = document.getElementById("grant-permissions-btn");
    const rationale = document.getElementById("permissions-copy");
    const nextAction = document.getElementById("practice-help");

    const isMeaningfullyVisibleInViewport = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);

      return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth &&
        visibleHeight >= Math.min(rect.height, 32)
      );
    };

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      permissionInViewport: isMeaningfullyVisibleInViewport(permissionButton),
      rationaleInViewport: isMeaningfullyVisibleInViewport(rationale),
      nextActionInViewport: isMeaningfullyVisibleInViewport(nextAction),
    };
  });
}

async function openOnboardingPageWithPermissionHooks(
  browser: Browser,
  worker: BackgroundContext,
  hooks: {
    contains?: boolean;
    request?: boolean;
  },
): Promise<Page> {
  const url = await getRuntimePageUrl(worker, "new_installation/index.html");
  const page = await browser.newPage();
  await page.setViewport(ONBOARDING_VIEWPORT);

  await page.evaluateOnNewDocument((hookConfig) => {
    const testWindow = window as Window & {
      __FT_TEST_PERMISSION_CONTAINS__?: (
        options: chrome.permissions.Permissions,
      ) => Promise<boolean>;
      __FT_TEST_PERMISSION_REQUEST__?: (
        options: chrome.permissions.Permissions,
      ) => Promise<boolean>;
      __lastPermissionContainsRequest?: chrome.permissions.Permissions;
      __lastPermissionRequest?: chrome.permissions.Permissions;
    };

    if (typeof hookConfig.contains === "boolean") {
      testWindow.__FT_TEST_PERMISSION_CONTAINS__ = async (
        options: chrome.permissions.Permissions,
      ) => {
        testWindow.__lastPermissionContainsRequest = options;
        return hookConfig.contains;
      };
    }

    if (typeof hookConfig.request === "boolean") {
      testWindow.__FT_TEST_PERMISSION_REQUEST__ = async (
        options: chrome.permissions.Permissions,
      ) => {
        testWindow.__lastPermissionRequest = options;
        return hookConfig.request;
      };
    }
  }, hooks);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: browserTimeout(3000, 10000),
  });
  await page.waitForSelector("body", {
    timeout: browserTimeout(3000, 10000),
  });
  await page.waitForFunction(() => document.body.textContent?.includes("Ctrl+Z") ?? false, {
    timeout: browserTimeout(3000, 10000),
  });

  return page;
}

let domainTestUrl: string;
let activeBrowserForWorkerRecovery: Browser | null = null;
let latestWorkerContext: BackgroundContext | null = null;
let settingsDirty = true;

function isClosedPageContext(context: BackgroundContext | null): boolean {
  if (!context || typeof (context as Page).isClosed !== "function") {
    return false;
  }
  return (context as Page).isClosed();
}

function isRetriableWorkerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /chrome\.storage\.local is unavailable|reading 'local'|chrome\.runtime\.getURL is unavailable|runtime\.getURL|Execution context was destroyed|Execution context is not available in detached frame or worker|Cannot find context with specified id|Target closed|Session closed|Timed out after waiting \d+ms|NoSuchFrameError|Browsing Context with id .* not found/i.test(
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
      timeoutMs: WORKER_REACQUIRE_TIMEOUT_MS,
      intervalMs: 100,
    },
  );
  latestWorkerContext = recovered;
  return recovered;
}

async function ensureWorkerContext(
  browser: Browser,
  currentWorker: BackgroundContext | undefined,
): Promise<BackgroundContext> {
  if (currentWorker && !isClosedPageContext(currentWorker)) {
    try {
      await currentWorker.evaluate(() => {
        const storage = (
          globalThis as typeof globalThis & {
            chrome?: typeof chrome;
          }
        ).chrome?.storage?.local;
        if (!storage) {
          throw new Error("chrome.storage.local is unavailable");
        }
      });
      latestWorkerContext = currentWorker;
      return currentWorker;
    } catch (error) {
      if (!isRetriableWorkerError(error)) {
        throw error;
      }
    }
  }

  return await reacquireWorkerContext(browser, "reused background worker context");
}

async function ensurePrimaryPage(browser: Browser): Promise<Page> {
  const nextPage = await browser.newPage();
  nextPage.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  await nextPage.bringToFront();
  return nextPage;
}

async function recoverWorkerForRetry(
  existingWorker: BackgroundContext,
): Promise<BackgroundContext> {
  if (activeBrowserForWorkerRecovery) {
    try {
      return await reacquireWorkerContext(activeBrowserForWorkerRecovery, "worker recovery");
    } catch (error) {
      if (!isRetriableWorkerError(error) || isFirefox()) {
        throw error;
      }
      try {
        const controlPage = await openExtensionPage(
          activeBrowserForWorkerRecovery,
          existingWorker,
          "options/options.html",
        );
        latestWorkerContext = controlPage;
        return controlPage;
      } catch (fallbackError) {
        if (!isRetriableWorkerError(fallbackError)) {
          throw fallbackError;
        }
      }
    }
  }
  if (latestWorkerContext && !isClosedPageContext(latestWorkerContext)) {
    return latestWorkerContext;
  }
  return existingWorker;
}

async function setSetting(worker: BackgroundContext, key: string, value: unknown): Promise<void> {
  settingsDirty = true;
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

async function getLocalStorageValue<T>(
  worker: BackgroundContext,
  storageKey: string,
): Promise<T | undefined> {
  return (await worker.evaluate(
    (storageKeyInner) =>
      new Promise((resolve, reject) => {
        chrome.storage.local.get(storageKeyInner, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          const rawValue = (result as Record<string, string | undefined>)[storageKeyInner];
          resolve(rawValue ? JSON.parse(rawValue) : undefined);
        });
      }),
    storageKey,
  )) as T | undefined;
}

async function sendRuntimeCommand(
  browser: Browser,
  worker: BackgroundContext,
  command: string,
): Promise<void> {
  const extensionPage = await openExtensionPage(browser, worker, "options/options.html");
  try {
    await extensionPage.evaluate((commandInner) => {
      return new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { command: commandInner, context: {} },
          (response: { ok?: boolean } | undefined) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response?.ok) {
              reject(new Error(`Runtime command ${commandInner} returned not ok`));
              return;
            }
            resolve();
          },
        );
      });
    }, command);
  } finally {
    if (!extensionPage.isClosed()) {
      await extensionPage.close();
    }
  }
}

async function restartExtensionRuntime(
  browser: Browser,
  worker: BackgroundContext,
): Promise<BackgroundContext> {
  if (!isFirefox() && typeof worker.close === "function") {
    const wakePage = await openExtensionPage(browser, worker, "options/options.html");
    try {
      await worker.close();
      await sleep(100);
      await wakePage.evaluate((command) => {
        return new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage(
            { command, context: {} },
            (response: { ok?: boolean } | undefined) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!response?.ok) {
                reject(new Error("Restart wake command returned not ok"));
                return;
              }
              resolve();
            },
          );
        });
      }, CMD_OPTIONS_PAGE_CONFIG_CHANGE);
      return await reacquireWorkerContext(browser, "restarted extension runtime");
    } finally {
      await wakePage.close();
    }
  } else {
    try {
      await worker.evaluate(() => {
        chrome.runtime.reload();
      });
    } catch (error) {
      if (!isRetriableWorkerError(error)) {
        throw error;
      }
    }
  }
  await sleep(250);
  return await reacquireWorkerContext(browser, "restarted extension runtime");
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

async function setGrammarRulesAndWait(
  worker: BackgroundContext,
  selection: readonly string[],
  timeoutMs = 15000,
): Promise<void> {
  await setSettingAndWait(
    worker,
    KEY_ENABLED_GRAMMAR_RULES,
    grammarRuleSelectionToOverrides(selection),
    timeoutMs,
  );
}

async function setGrammarRulesAndWaitStable(
  worker: BackgroundContext,
  selection: readonly string[],
  attempts = 3,
  timeoutMs = 5000,
): Promise<void> {
  await setSettingAndWaitStable(
    worker,
    KEY_ENABLED_GRAMMAR_RULES,
    grammarRuleSelectionToOverrides(selection),
    attempts,
    timeoutMs,
  );
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
                    reject(
                      new Error(`Config change ACK returned not ok: ${JSON.stringify(response)}`),
                    );
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
                      reject(
                        new Error(`Config change ACK returned not ok: ${JSON.stringify(response)}`),
                      );
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
            reject(new Error(`Config change ACK returned not ok: ${JSON.stringify(response)}`));
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
  };
  traces?: Array<{
    traceId?: string;
    lang?: string;
    text?: string;
    predictionInput?: string;
    doPrediction?: boolean;
    timestampMs?: number;
    requestId?: number | null;
    finalPredictions?: string[];
  }>;
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

type PredictorDebugTrace = NonNullable<PredictorDebugSnapshot["traces"]>[number];

async function waitForPredictorTrace(
  optionsPage: Page,
  predicate: (trace: PredictorDebugTrace) => boolean,
  timeoutMs = browserTimeout(5000, 10000),
): Promise<PredictorDebugTrace> {
  try {
    return await waitUntil(
      "predictor debug trace",
      async () => {
        const snapshot = await getPredictorDebugSnapshot(optionsPage);
        const traces = Array.isArray(snapshot.traces) ? snapshot.traces : [];
        const matchingTrace = traces.find(predicate);
        return matchingTrace || false;
      },
      { timeoutMs, intervalMs: 100 },
    );
  } catch (error) {
    const snapshot = await getPredictorDebugSnapshot(optionsPage).catch(() => ({}));
    const recentTraces = Array.isArray(snapshot.traces)
      ? snapshot.traces.slice(0, 5).map((trace) => ({
          traceId: trace.traceId,
          lang: trace.lang,
          text: trace.text,
          predictionInput: trace.predictionInput,
          doPrediction: trace.doPrediction,
        }))
      : [];
    throw new Error(
      `Failed to match predictor trace: ${String(error)} recent=${JSON.stringify(recentTraces)}`,
      { cause: error },
    );
  }
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
      return snapshot.config?.debugPresagePredictorEnabled === expectedValue;
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

async function pressNativeUndo(page: Page, selector: string): Promise<void> {
  await page.focus(selector);
  const isMac = process.platform === "darwin";
  const modifier = isMac ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  // macOS maps Cmd+Z to undo in the OS key bindings, which synthetic key events
  // skip; name the editing command so native fields undo like a real keypress.
  await page.keyboard.press("z", isMac ? { commands: ["Undo"] } : undefined);
  await page.keyboard.up(modifier);
}

async function pressNativeRedo(page: Page): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  await page.keyboard.down("Shift");
  await page.keyboard.press(
    "z",
    process.platform === "darwin" ? { commands: ["Redo"] } : undefined,
  );
  await page.keyboard.up("Shift");
  await page.keyboard.up(modifier);
}

async function gotoTestPage(
  page: Page,
  options: {
    enableCkEditor?: boolean;
    enableQuill?: boolean;
    enableLexical?: boolean;
    enableProseMirror?: boolean;
    tinyMceMode?: "iframe" | "inline";
  } = {},
) {
  const params = new URLSearchParams({ testName: currentE2ETestName });
  if (options.enableCkEditor) {
    params.set("enableCkEditor", "1");
  }
  if (options.enableQuill) {
    params.set("enableQuill", "1");
  }
  if (options.enableLexical) {
    params.set("enableLexical", "1");
  }
  if (options.enableProseMirror) {
    params.set("enableProseMirror", "1");
  }
  if (options.tinyMceMode) {
    params.set("tinyMceMode", options.tinyMceMode);
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

async function waitForInputReady(page: Page | Frame, selector: string) {
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

  if (selector === LEXICAL_SELECTOR) {
    await waitUntil(
      `Lexical readiness for ${selector}`,
      async () => {
        const lexicalState = await page.evaluate(() => ({
          ready: Boolean(
            (
              window as typeof window & {
                __testLexicalReady?: boolean;
              }
            ).__testLexicalReady,
          ),
          error:
            (
              window as typeof window & {
                __testLexicalError?: string | null;
              }
            ).__testLexicalError ?? null,
          hasParagraph: document.querySelectorAll("#test-lexical-editor p").length > 0,
          isContentEditable:
            document.querySelector("#test-lexical-editor") instanceof HTMLElement
              ? (document.querySelector("#test-lexical-editor") as HTMLElement).isContentEditable
              : false,
        }));

        if (lexicalState.error) {
          throw new Error(`Lexical failed to initialize: ${lexicalState.error}`);
        }
        return lexicalState.ready && lexicalState.hasParagraph && lexicalState.isContentEditable;
      },
      { timeoutMs: INPUT_READY_TIMEOUT_MS, intervalMs: 50 },
    ).catch(async (error) => {
      const debugState = await page.evaluate(() => ({
        href: window.location.href,
        ready: (
          window as typeof window & {
            __testLexicalReady?: boolean;
          }
        ).__testLexicalReady,
        lexicalError: (
          window as typeof window & {
            __testLexicalError?: string | null;
          }
        ).__testLexicalError,
        html: document.querySelector("#test-lexical-editor")?.innerHTML ?? null,
        isContentEditable:
          document.querySelector("#test-lexical-editor") instanceof HTMLElement
            ? (document.querySelector("#test-lexical-editor") as HTMLElement).isContentEditable
            : false,
      }));
      throw new Error(
        `Lexical readiness timed out for ${selector}: ${JSON.stringify(debugState)} (${String(error)})`,
      );
    });
  }

  await page.waitForSelector(selector, { timeout: INPUT_READY_TIMEOUT_MS });
  await waitUntil(
    `input helper attach for ${selector}`,
    async () => {
      const isAttached = await page.evaluate((sel) => {
        const target = document.querySelector(sel);
        const stateHost = target === document.body ? document.documentElement : target;
        return stateHost?.hasAttribute("data-suggestion") ?? false;
      }, selector);
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

async function getVisibleSuggestionTexts(page: Page | Frame): Promise<string[]> {
  return await page.evaluate(() => {
    const getMenuRoot = (container: Element): ParentNode =>
      (container as HTMLElement).shadowRoot ?? container;
    const getDeepActiveElement = (): HTMLElement | null => {
      let active: Element | null = document.activeElement;
      while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      return active instanceof HTMLElement ? active : null;
    };
    const getMenuHostId = (entryId: string): string => `ft-menu-${entryId}`;
    const collectManagedElements = (root: ParentNode): HTMLElement[] => [
      ...Array.from(root.querySelectorAll<HTMLElement>('[data-suggestion="true"]')),
      ...Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((element) =>
        element.shadowRoot ? collectManagedElements(element.shadowRoot) : [],
      ),
    ];
    const getKnownMenus = (): Element[] => {
      const seen = new Set<Element>();
      return [
        ...collectManagedElements(document)
          .map((element) => element.getAttribute("data-ft-suggestion-id"))
          .filter((entryId): entryId is string => typeof entryId === "string" && entryId.length > 0)
          .map((entryId) => document.getElementById(getMenuHostId(entryId)))
          .filter((menu): menu is Element => menu instanceof Element),
        ...Array.from(document.querySelectorAll<HTMLElement>('[id^="ft-menu-"]')),
      ]
        .filter((menu): menu is Element => menu instanceof Element)
        .filter((menu) => {
          if (seen.has(menu)) {
            return false;
          }
          seen.add(menu);
          return true;
        });
    };
    const activeElement = getDeepActiveElement();
    const activeEntryId = activeElement?.getAttribute("data-ft-suggestion-id");
    const activeMenu =
      typeof activeEntryId === "string"
        ? document.getElementById(getMenuHostId(activeEntryId))
        : null;
    const containers = [
      ...(activeMenu instanceof Element ? [activeMenu] : []),
      ...getKnownMenus().filter((container) => container !== activeMenu),
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
      const visibleTexts = Array.from(getMenuRoot(container).querySelectorAll("li[data-index]"))
        .map((li) => (li.querySelector(".ft-suggestion-label") ?? li).textContent ?? "")
        .filter((text) => text.length > 0);
      if (visibleTexts.length > 0) {
        return visibleTexts;
      }
    }
    return [];
  });
}

async function waitForVisibleSuggestionTexts(
  page: Page | Frame,
  timeoutMs = SUGGESTION_TIMEOUT_MS,
): Promise<string[]> {
  return await waitUntil(
    "visible suggestions",
    async () => {
      const texts = await getVisibleSuggestionTexts(page);
      return texts.length > 0 ? texts : false;
    },
    { timeoutMs, intervalMs: 50 },
  );
}

async function highlightSuggestion(
  page: Page,
  text: string,
  context: Page | Frame = page,
): Promise<void> {
  await waitUntil(
    `highlighted suggestion ${text}`,
    async () => {
      const next = await context.evaluate((expected) => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        const stateHost = active === document.body ? document.documentElement : active;
        const entryId = stateHost?.getAttribute("data-ft-suggestion-id");
        const menu = document.getElementById(`ft-menu-${entryId}`);
        if (!menu || getComputedStyle(menu).display === "none") return false;
        const rows = Array.from((menu.shadowRoot ?? menu).querySelectorAll("li[data-index]"));
        const target = rows.find(
          (row) =>
            ((row.querySelector(".ft-suggestion-label") ?? row).textContent ?? "")
              .replace(/\xA0/g, " ")
              .trim()
              .toLowerCase() === expected,
        );
        if (!target) return false;
        if (target.getAttribute("aria-selected") === "true") return true;
        return menu.getAttribute("data-ft-placement") === "above" &&
          menu.getAttribute("data-ft-layout") !== "horizontal"
          ? "ArrowUp"
          : "ArrowDown";
      }, normalizeSuggestionText(text));
      if (next === true) return true;
      if (next) await page.keyboard.press(next);
      return false;
    },
    { timeoutMs: SUGGESTION_TIMEOUT_MS },
  );
}

async function hasVisibleSuggestions(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const getMenuRoot = (container: Element): ParentNode =>
      (container as HTMLElement).shadowRoot ?? container;
    const getDeepActiveElement = (): HTMLElement | null => {
      let active: Element | null = document.activeElement;
      while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      return active instanceof HTMLElement ? active : null;
    };
    const getMenuHostId = (entryId: string): string => `ft-menu-${entryId}`;
    const collectManagedElements = (root: ParentNode): HTMLElement[] => [
      ...Array.from(root.querySelectorAll<HTMLElement>('[data-suggestion="true"]')),
      ...Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((element) =>
        element.shadowRoot ? collectManagedElements(element.shadowRoot) : [],
      ),
    ];
    const getKnownMenus = (): Element[] => {
      const seen = new Set<Element>();
      return [
        ...collectManagedElements(document)
          .map((element) => element.getAttribute("data-ft-suggestion-id"))
          .filter((entryId): entryId is string => typeof entryId === "string" && entryId.length > 0)
          .map((entryId) => document.getElementById(getMenuHostId(entryId)))
          .filter((menu): menu is Element => menu instanceof Element),
        ...Array.from(document.querySelectorAll<HTMLElement>('[id^="ft-menu-"]')),
      ]
        .filter((menu): menu is Element => menu instanceof Element)
        .filter((menu) => {
          if (seen.has(menu)) {
            return false;
          }
          seen.add(menu);
          return true;
        });
    };
    const activeElement = getDeepActiveElement();
    const activeEntryId = activeElement?.getAttribute("data-ft-suggestion-id");
    const activeMenu =
      typeof activeEntryId === "string"
        ? document.getElementById(getMenuHostId(activeEntryId))
        : null;
    const containers = [
      ...(activeMenu instanceof Element ? [activeMenu] : []),
      ...getKnownMenus().filter((container) => container !== activeMenu),
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
      return getMenuRoot(container).querySelectorAll("li[data-index]").length > 0;
    });
  });
}

async function waitForNoVisibleSuggestions(
  page: Page,
  timeoutMs = SUGGESTION_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const getMenuRoot = (container: Element): ParentNode =>
        (container as HTMLElement).shadowRoot ?? container;
      const getDeepActiveElement = (): HTMLElement | null => {
        let active: Element | null = document.activeElement;
        while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
          active = active.shadowRoot.activeElement;
        }
        return active instanceof HTMLElement ? active : null;
      };
      const getMenuHostId = (entryId: string): string => `ft-menu-${entryId}`;
      const collectManagedElements = (root: ParentNode): HTMLElement[] => [
        ...Array.from(root.querySelectorAll<HTMLElement>('[data-suggestion="true"]')),
        ...Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((element) =>
          element.shadowRoot ? collectManagedElements(element.shadowRoot) : [],
        ),
      ];
      const getKnownMenus = (): Element[] => {
        const seen = new Set<Element>();
        return [
          ...collectManagedElements(document)
            .map((element) => element.getAttribute("data-ft-suggestion-id"))
            .filter(
              (entryId): entryId is string => typeof entryId === "string" && entryId.length > 0,
            )
            .map((entryId) => document.getElementById(getMenuHostId(entryId)))
            .filter((menu): menu is Element => menu instanceof Element),
          ...Array.from(document.querySelectorAll<HTMLElement>('[id^="ft-menu-"]')),
        ]
          .filter((menu): menu is Element => menu instanceof Element)
          .filter((menu) => {
            if (seen.has(menu)) {
              return false;
            }
            seen.add(menu);
            return true;
          });
      };
      const activeElement = getDeepActiveElement();
      const activeEntryId = activeElement?.getAttribute("data-ft-suggestion-id");
      const activeMenu =
        typeof activeEntryId === "string"
          ? document.getElementById(getMenuHostId(activeEntryId))
          : null;
      const containers = [
        ...(activeMenu instanceof Element ? [activeMenu] : []),
        ...getKnownMenus().filter((container) => container !== activeMenu),
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
        return getMenuRoot(container).querySelectorAll("li[data-index]").length === 0;
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
      const getMenuRoot = (container: Element): ParentNode =>
        (container as HTMLElement).shadowRoot ?? container;
      const getDeepActiveElement = (): HTMLElement | null => {
        let active: Element | null = document.activeElement;
        while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
          active = active.shadowRoot.activeElement;
        }
        return active instanceof HTMLElement ? active : null;
      };
      const getMenuHostId = (entryId: string): string => `ft-menu-${entryId}`;
      const collectManagedElements = (root: ParentNode): HTMLElement[] => [
        ...Array.from(root.querySelectorAll<HTMLElement>('[data-suggestion="true"]')),
        ...Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((element) =>
          element.shadowRoot ? collectManagedElements(element.shadowRoot) : [],
        ),
      ];
      const getKnownMenus = (): Element[] => {
        const seen = new Set<Element>();
        return [
          ...collectManagedElements(document)
            .map((element) => element.getAttribute("data-ft-suggestion-id"))
            .filter(
              (entryId): entryId is string => typeof entryId === "string" && entryId.length > 0,
            )
            .map((entryId) => document.getElementById(getMenuHostId(entryId)))
            .filter((menu): menu is Element => menu instanceof Element),
          ...Array.from(document.querySelectorAll<HTMLElement>('[id^="ft-menu-"]')),
        ]
          .filter((menu): menu is Element => menu instanceof Element)
          .filter((menu) => {
            if (seen.has(menu)) {
              return false;
            }
            seen.add(menu);
            return true;
          });
      };
      const activeElement = getDeepActiveElement();
      const activeEntryId = activeElement?.getAttribute("data-ft-suggestion-id");
      const activeMenu =
        typeof activeEntryId === "string"
          ? document.getElementById(getMenuHostId(activeEntryId))
          : null;
      const containers = [
        ...(activeMenu instanceof Element ? [activeMenu] : []),
        ...getKnownMenus().filter((container) => container !== activeMenu),
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
        const first = getMenuRoot(container).querySelector("li[data-index]");
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
  const editorBundles = new Map<string, Buffer>();
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
    page = await ensurePrimaryPage(browser);
    domainTestHtml = fs.readFileSync(TEST_PAGE_PATH, "utf8");
    for (const editor of ["lexical", "prosemirror", "tinymce", "react-controlled"] as const) {
      editorBundles.set(`/test-${editor}-editor.js`, await bundleTestEditor(editor));
    }

    domainTestServer = createServer((req, res) => {
      const editorBundle = editorBundles.get(req.url ?? "");
      if (editorBundle) {
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Content-Length": editorBundle.length,
        });
        res.end(editorBundle);
        return;
      }
      if (req.url?.startsWith("/tinymce-skin/")) {
        const filename = path.basename(req.url);
        if (["skin.min.css", "content.min.css", "content.inline.min.css"].includes(filename)) {
          const css = fs.readFileSync(
            path.resolve(__dirname, "../../node_modules/tinymce/skins/ui/oxide", filename),
          );
          res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
          res.end(css);
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }
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
    try {
      worker = await ensureWorkerContext(browser, worker);
    } catch (error) {
      if (!isRetriableWorkerError(error)) {
        throw error;
      }
      worker = await recoverWorkerForRetry(worker);
    }
    if (settingsDirty) {
      // Keep the legacy baseline for non-grammar E2E flows so popup/inline
      // prediction scenarios remain deterministic regardless of defaults.
      await setGrammarRulesAndWait(worker!, []);
      settingsDirty = false;
    }
    page = await ensurePrimaryPage(browser);
  });

  afterEach(async () => {
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
      if (page && typeof page.isClosed === "function" && !page.isClosed()) {
        await page.close();
      }
    } catch {
      // Ignore teardown errors from page shutdown.
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
    "Native datalists only hold writing fields while usable options exist",
    async () => {
      await gotoTestPage(page);
      await waitForInputReady(page, "#test-input");
      await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>("#test-native-list")!;
        input.list!.replaceChildren();
      });
      await waitForInputReady(page, "#test-native-list");
      await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>("#test-native-list")!;
        const option = document.createElement("option");
        option.value = "Example";
        input.list!.append(option);
      });
      await page.waitForFunction(
        () => !document.querySelector("#test-native-list")!.hasAttribute("data-suggestion"),
      );
      expect(
        await page.$eval(
          "#test-native-list",
          (element) => !!element.parentElement!.querySelector(".ft-manual-attach-button"),
        ),
      ).toBe(true);
      await page.evaluate(
        () =>
          ((
            document.querySelector<HTMLInputElement>("#test-native-list")!.list!
              .firstElementChild as HTMLOptionElement
          ).disabled = true),
      );
      await waitForInputReady(page, "#test-native-list");
      await page.evaluate(() =>
        document.querySelector<HTMLInputElement>("#test-native-list")!.list!.remove(),
      );
      await typeInInput(page, "#test-native-list", "th");
      expect(await waitForVisibleSuggestions(page)).toBeGreaterThan(0);
    },
    browserTimeout(10000, 15000),
  );

  test(
    "Writing fields automatically yield to site suggestions and resume after closure",
    async () => {
      await gotoTestPage(page);
      await waitForInputReady(page, "#test-input");
      await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>("#test-input")!;
        input.setAttribute("aria-autocomplete", "list");
        input.setAttribute("aria-controls", "writing-choices");
        const popup = document.createElement("div");
        popup.id = "writing-choices";
        popup.setAttribute("role", "listbox");
        popup.innerHTML = '<div role="option">Website choice</div>';
        popup.hidden = true;
        input.parentElement!.append(popup);
      });
      await typeInInput(page, "#test-input", "th");
      await waitForVisibleSuggestions(page);
      const before = await getInputContent(page, "#test-input");
      const keyState = await page.evaluate(() => {
        document.querySelector<HTMLElement>("#writing-choices")!.hidden = false;
        // Same task, before MutationObserver: Tab must remain the website's.
        const input = document.querySelector<HTMLInputElement>("#test-input")!;
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        input.dispatchEvent(event);
        return {
          prevented: event.defaultPrevented,
          attached: input.hasAttribute("data-suggestion"),
          value: input.value,
        };
      });
      expect(keyState).toEqual({ prevented: false, attached: true, value: before });
      await waitForNoVisibleSuggestions(page);
      await page.evaluate(() => document.querySelector("#writing-choices")!.remove());
      await page.keyboard.press("Escape");
      await waitForNoVisibleSuggestions(page);
      await page.type("#test-input", "e");
      expect(await waitForVisibleSuggestions(page)).toBeGreaterThan(0);
      // These widgets keep options and layout rectangles after visually collapsing.
      for (const style of [
        "position:fixed;left:-10000px;top:10px",
        "clip-path:inset(50%)",
        "height:0;overflow:hidden",
      ]) {
        await page.evaluate((css) => {
          const wrapper = document.createElement("div");
          wrapper.id = "collapsed-widget";
          wrapper.style.cssText = css;
          wrapper.innerHTML =
            '<div id="writing-choices" role="listbox"><div role="option">Website choice</div></div>';
          document.querySelector("#test-input")!.parentElement!.append(wrapper);
        }, style);
        await typeInInput(page, "#test-input", "th");
        expect(await waitForVisibleSuggestions(page)).toBeGreaterThan(0);
        await page.evaluate(() => document.querySelector("#collapsed-widget")!.remove());
      }
    },
    browserTimeout(12000, 20000),
  );

  test(
    "Google-style search suggestions inside linked wrappers pause FluentTyper",
    async () => {
      await gotoTestPage(page);
      await page.evaluate(() => {
        const field = document.createElement("textarea");
        field.id = "google-search";
        field.setAttribute("role", "combobox");
        field.setAttribute("aria-autocomplete", "both");
        field.setAttribute("aria-controls", "google-choices");
        field.setAttribute("aria-owns", "google-choices");
        const wrapper = document.createElement("div");
        wrapper.id = "google-choices";
        wrapper.setAttribute("role", "presentation");
        wrapper.hidden = true;
        wrapper.innerHTML =
          '<div role="presentation"><ul role="listbox"><li role="presentation"><div role="option">Website choice</div></li></ul></div>';
        document.body.prepend(field, wrapper);
      });
      await waitForInputReady(page, "#google-search");
      await typeInInput(page, "#google-search", "th");
      await waitForVisibleSuggestions(page);
      const before = await getInputContent(page, "#google-search");
      const keyState = await page.evaluate(() => {
        document.querySelector<HTMLElement>("#google-choices")!.hidden = false;
        const field = document.querySelector<HTMLTextAreaElement>("#google-search")!;
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        field.dispatchEvent(event);
        return { prevented: event.defaultPrevented, value: field.value };
      });
      expect(keyState).toEqual({ prevented: false, value: before });
      await waitForNoVisibleSuggestions(page);
      await page.evaluate(() => {
        document.querySelector<HTMLElement>("#google-choices")!.hidden = true;
      });
      await page.type("#google-search", "e");
      expect(await waitForVisibleSuggestions(page)).toBeGreaterThan(0);
    },
    browserTimeout(10000, 15000),
  );

  test(
    "Remembered writing fields survive reload and can be forgotten in settings",
    async () => {
      await setSetting(worker!, "fieldPreferences", []);
      await applyConfigChange(browser, worker!);
      await gotoTestPage(page);
      await waitForInputReady(page, "#test-input");
      const selector = "#test-semantic-email";
      await page.waitForFunction(
        () =>
          !!document
            .querySelector("#test-semantic-email")
            ?.parentElement?.querySelector(".ft-manual-attach-button"),
      );
      await page.evaluate(() =>
        (
          document
            .querySelector("#test-semantic-email")!
            .parentElement!.querySelector(".ft-manual-attach-button") as HTMLButtonElement
        ).click(),
      );
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          (button) => button.textContent === "Remember for this field",
        ),
      );
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
          .find((button) => button.textContent === "Remember for this field")!
          .click(),
      );
      await waitUntil(
        "field preference saved",
        async () => (await getSetting<unknown[]>(worker!, "fieldPreferences"))?.length === 1,
        { timeoutMs: 7000, intervalMs: 50 },
      );
      await gotoTestPage(page);
      await waitForInputReady(page, selector);
      const settingsPage = await openOptionsPage(browser, worker!);
      try {
        const response = await settingsPage.evaluate(async () =>
          chrome.runtime.sendMessage({
            command: "CMD_FIELD_PREFERENCES",
            context: { action: "list" },
          }),
        );
        expect(response.ok).toBe(true);
        const record = response.records[0];
        expect(record.signature).toMatch(/^[a-f0-9]{64}$/);
        expect(record.topOrigin).not.toContain("?");
        const removed = await settingsPage.evaluate(
          async (entry) =>
            chrome.runtime.sendMessage({
              command: "CMD_FIELD_PREFERENCES",
              context: {
                action: "forget",
                topOrigin: entry.topOrigin,
                frameOrigin: entry.frameOrigin,
                signature: entry.signature,
              },
            }),
          record,
        );
        expect(removed.ok).toBe(true);
        await page.waitForFunction(
          () => !document.querySelector("#test-semantic-email")?.hasAttribute("data-suggestion"),
        );
      } finally {
        await settingsPage.close();
      }
    },
    browserTimeout(20000, 30000),
  );

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
      // Firefox BiDi rejects setViewport on extension (privileged) pages.
      if (!isFirefox()) {
        await newInstallationPage.setViewport(ONBOARDING_VIEWPORT);
      }
      await newInstallationPage.waitForSelector("body", {
        timeout: browserTimeout(3000, 10000),
      });
      await newInstallationPage.waitForFunction(
        () => document.body.textContent?.includes("Ctrl+Z") ?? false,
        {
          timeout: browserTimeout(3000, 10000),
        },
      );

      if (!isFirefox()) {
        // ---- Permission flow test ----
        // Wait for the button to be ready and visible
        await newInstallationPage.waitForSelector("#grant-permissions-btn", { visible: true });
        // The welcome offers a direct setup action and three explorable examples.
        for (const feature of ["popup", "inline", "review"]) {
          await newInstallationPage.click(`label:has(input[value="${feature}"])`);
          expect(
            await newInstallationPage.$$eval(".feature-panel", (panels) =>
              panels
                .filter((panel) => getComputedStyle(panel).display !== "none")
                .map((panel) => panel.getAttribute("aria-labelledby")),
            ),
          ).toEqual([`${feature}-title`]);
        }
        await newInstallationPage.click('a.button[href="#setup"]');
        await newInstallationPage.waitForFunction(
          () => (document.getElementById("setup")?.getBoundingClientRect().top ?? Infinity) < 100,
        );

        const viewportSnapshot = await captureOnboardingViewportSnapshot(newInstallationPage);
        expect(viewportSnapshot).toMatchObject({
          permissionInViewport: true,
          rationaleInViewport: true,
          nextActionInViewport: true,
        });

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

        await newInstallationPage.waitForFunction(() => {
          const permissionContainer = document.getElementById("permissions-container");
          return permissionContainer?.getAttribute("data-permission-state") === "granted";
        });

        const activeElementId = await newInstallationPage.evaluate(
          () => document.activeElement?.id ?? null,
        );
        expect(activeElementId).toBe("try-me-textarea");

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
    "New installation page shows activation-ready state when permissions are already granted",
    async () => {
      expect(worker).toBeDefined();

      if (isFirefox()) {
        return;
      }

      const onboardingPage = await openOnboardingPageWithPermissionHooks(browser, worker!, {
        contains: true,
      });

      await onboardingPage.waitForFunction(() => {
        const permissionContainer = document.getElementById("permissions-container");
        return permissionContainer?.getAttribute("data-permission-state") === "granted";
      });

      const onboardingState = await onboardingPage.evaluate(() => {
        const testWindow = window as Window & {
          __lastPermissionContainsRequest?: chrome.permissions.Permissions;
        };
        const permissionsContainer = document.getElementById("permissions-container");
        return {
          activeElementId: document.activeElement?.id ?? null,
          permissionState: permissionsContainer?.getAttribute("data-permission-state") ?? null,
          permissionButtonHidden:
            document.getElementById("grant-permissions-btn") instanceof HTMLButtonElement
              ? (document.getElementById("grant-permissions-btn") as HTMLButtonElement).hidden
              : null,
          containsRequest: testWindow.__lastPermissionContainsRequest,
          scrollY: window.scrollY,
        };
      });

      expect(onboardingState).toEqual({
        scrollY: 0,
        activeElementId: "",
        permissionState: "granted",
        permissionButtonHidden: true,
        containsRequest: { origins: ["<all_urls>"] },
      });

      await onboardingPage.keyboard.press("Tab");
      expect(
        await onboardingPage.evaluate(() => document.activeElement?.matches(".skip-link")),
      ).toBe(true);

      await onboardingPage.close();
    },
    browserTimeout(5000, 12000),
  );

  test(
    "New installation page keeps permission CTA visible when access is denied",
    async () => {
      expect(worker).toBeDefined();

      if (isFirefox()) {
        return;
      }

      const onboardingPage = await openOnboardingPageWithPermissionHooks(browser, worker!, {
        contains: false,
        request: false,
      });

      await onboardingPage.waitForSelector("#grant-permissions-btn", { visible: true });

      await onboardingPage.evaluate(() => {
        const button = document.getElementById("grant-permissions-btn");
        if (!(button instanceof HTMLElement)) {
          throw new Error("Permission grant button is missing");
        }
        button.click();
      });

      await onboardingPage.waitForFunction(() => {
        const testWindow = window as Window & {
          __lastPermissionRequest?: chrome.permissions.Permissions;
        };
        return Boolean(testWindow.__lastPermissionRequest);
      });

      const onboardingState = await onboardingPage.evaluate(() => {
        const testWindow = window as Window & {
          __lastPermissionContainsRequest?: chrome.permissions.Permissions;
          __lastPermissionRequest?: chrome.permissions.Permissions;
        };
        const permissionsContainer = document.getElementById("permissions-container");
        return {
          permissionState: permissionsContainer?.getAttribute("data-permission-state") ?? null,
          permissionButtonHidden:
            document.getElementById("grant-permissions-btn") instanceof HTMLButtonElement
              ? (document.getElementById("grant-permissions-btn") as HTMLButtonElement).hidden
              : null,
          containsRequest: testWindow.__lastPermissionContainsRequest,
          permissionRequest: testWindow.__lastPermissionRequest,
        };
      });

      expect(onboardingState).toEqual({
        permissionState: "missing",
        permissionButtonHidden: false,
        containsRequest: { origins: ["<all_urls>"] },
        permissionRequest: { origins: ["<all_urls>"] },
      });

      await onboardingPage.close();
    },
    browserTimeout(5000, 12000),
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

  devRuntimeEach([KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED])(
    "applies %s from predictor debug dashboard",
    async (key) => {
      const optionsPage = await openExtensionPage(browser, worker!, "options/options.html");

      try {
        await setSetting(worker!, key, true);
        await sendOptionsPageConfigChange(optionsPage);
        await waitForSnapshotValue(optionsPage, key, true);
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
              const getMenuRoot = (container: Element): ParentNode =>
                (container as HTMLElement).shadowRoot ?? container;
              const getDeepActiveElement = (): HTMLElement | null => {
                let active: Element | null = document.activeElement;
                while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
                  active = active.shadowRoot.activeElement;
                }
                return active instanceof HTMLElement ? active : null;
              };
              const getMenuHostId = (entryId: string): string => `ft-menu-${entryId}`;
              const collectManagedElements = (root: ParentNode): HTMLElement[] => [
                ...Array.from(root.querySelectorAll<HTMLElement>('[data-suggestion="true"]')),
                ...Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((element) =>
                  element.shadowRoot ? collectManagedElements(element.shadowRoot) : [],
                ),
              ];
              const getKnownMenus = (): Element[] => {
                const seen = new Set<Element>();
                return [
                  ...collectManagedElements(document)
                    .map((element) => element.getAttribute("data-ft-suggestion-id"))
                    .filter(
                      (entryId): entryId is string =>
                        typeof entryId === "string" && entryId.length > 0,
                    )
                    .map((entryId) => document.getElementById(getMenuHostId(entryId)))
                    .filter((menu): menu is Element => menu instanceof Element),
                  ...Array.from(document.querySelectorAll<HTMLElement>('[id^="ft-menu-"]')),
                ]
                  .filter((menu): menu is Element => menu instanceof Element)
                  .filter((menu) => {
                    if (seen.has(menu)) {
                      return false;
                    }
                    seen.add(menu);
                    return true;
                  });
              };
              const hasInlineSuggestion = Boolean(
                document.querySelector(".ft-suggestion-inline")?.textContent,
              );
              const activeElement = getDeepActiveElement();
              const activeEntryId = activeElement?.getAttribute("data-ft-suggestion-id");
              const activeMenu =
                typeof activeEntryId === "string"
                  ? document.getElementById(getMenuHostId(activeEntryId))
                  : null;
              const containers = [
                ...(activeMenu instanceof Element ? [activeMenu] : []),
                ...getKnownMenus().filter((container) => container !== activeMenu),
              ];
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
                return getMenuRoot(container).querySelectorAll("li[data-index]").length > 0;
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
    "ProseMirror predictions and expansions update the model, preserve formatting and undo",
    async () => {
      const readModel = () =>
        page.evaluate(() => {
          const doc = window.__testProseMirror!.state.doc;
          return {
            first: doc.child(0).toJSON(),
            blocks: Array.from(
              { length: doc.childCount },
              (_, index) => doc.child(index).textContent,
            ),
          };
        });
      try {
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, [
          ["ftsig", "Other signature"],
          ["ftsignature", "Best regards"],
        ]);
        await setGrammarRulesAndWaitStable(worker!, [], 3, browserTimeout(5000, 7000));
        await applyConfigChange(browser, worker!);
        await gotoTestPage(page, { enableProseMirror: true });
        await page.bringToFront();
        await waitForInputReady(page, PROSEMIRROR_SELECTOR);
        // Keep the caret near the viewport edge: an above-caret menu reverses arrow navigation.
        await page.$eval(PROSEMIRROR_SELECTOR, (editor) => {
          Object.assign((editor as HTMLElement).style, {
            position: "fixed",
            bottom: "20px",
            width: "600px",
          });
        });
        await page.evaluate(() => window.__testProseMirror!.focus());
        const original = await readModel();

        await page.keyboard.type("w");
        const prediction = await waitUntil(
          "ProseMirror prediction for the typed prefix",
          async () => {
            const text = (await getVisibleSuggestionTexts(page))[0];
            return text && /^w\S*[ \xa0]$/i.test(text) ? text : false;
          },
          { timeoutMs: SUGGESTION_TIMEOUT_MS },
        );
        await page.evaluate(() => window.__testProseMirrorCloseHistory!());
        await page.keyboard.press("Tab");
        await waitUntil(
          "ProseMirror model contains accepted prediction",
          async () =>
            normalizeSuggestionText((await readModel()).blocks[1]) ===
            normalizeSuggestionText(prediction),
          { timeoutMs: SUGGESTION_TIMEOUT_MS },
        ).catch(async (error) => {
          throw new Error(
            `${String(error)}: ${JSON.stringify({ prediction, model: await readModel(), dom: await page.$eval(PROSEMIRROR_SELECTOR, (el) => el.innerHTML) })}`,
          );
        });
        expect(
          await page.$eval(`${PROSEMIRROR_SELECTOR} p:nth-child(2)`, (el) => el.textContent),
        ).toBe((await readModel()).blocks[1]);
        expect((await readModel()).blocks[1]).toMatch(/[ \xa0]$/);
        expect((await readModel()).first).toEqual(original.first);

        expect(await page.evaluate(() => window.__testProseMirrorUndo!())).toBe(true);
        await waitUntil(
          "ProseMirror undo restores prefix",
          async () => (await readModel()).blocks[1] === "w",
        ).catch(async (error) => {
          throw new Error(`${String(error)}: ${JSON.stringify(await readModel())}`);
        });
        await page.keyboard.press("Enter");
        await waitUntil(
          "ProseMirror Enter creates a paragraph",
          async () => (await readModel()).blocks.length === 3,
        );
        await page.keyboard.type("ftsig");
        await highlightSuggestion(page, "Best regards");
        expect(
          (await getVisibleSuggestionTexts(page))
            .map(normalizeSuggestionText)
            .indexOf("best regards"),
        ).toBeGreaterThan(0);
        expect(
          await page.evaluate(() =>
            document
              .getElementById(
                `ft-menu-${document.activeElement?.getAttribute("data-ft-suggestion-id")}`,
              )
              ?.getAttribute("data-ft-placement"),
          ),
        ).toBe("above");
        await page.evaluate(() => window.__testProseMirrorCloseHistory!());
        await page.keyboard.press("Tab");
        await waitUntil(
          "ProseMirror model contains expansion in the new paragraph",
          async () => (await readModel()).blocks[2]?.trim() === "Best regards",
          { timeoutMs: SUGGESTION_TIMEOUT_MS },
        );
        expect((await readModel()).blocks.slice(0, 2).map(normalizeSuggestionText)).toEqual([
          "original reference",
          "w",
        ]);
        expect((await readModel()).first).toEqual(original.first);
        await page.evaluate(() => window.__testProseMirrorUndo!());
        await waitUntil(
          "ProseMirror expansion undo restores shortcut",
          async () => (await readModel()).blocks[2] === "ftsig",
        );
      } finally {
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 50000),
  );

  test.each(["iframe", "inline"] as const)(
    "TinyMCE %s predictions and expansions preserve formatting and undo",
    async (mode) => {
      try {
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, [["ftsig", "Best regards"]]);
        await setGrammarRulesAndWait(worker!, []);
        await applyConfigChange(browser, worker!);
        await gotoTestPage(page, { tinyMceMode: mode });
        await page.bringToFront();
        await waitUntil(
          "TinyMCE initialization",
          async () =>
            page.evaluate(() => {
              if (window.__testTinyMCEError) throw new Error(window.__testTinyMCEError);
              return !!window.__testTinyMCE;
            }),
          { timeoutMs: INPUT_READY_TIMEOUT_MS },
        );
        const editorPage: Page | Frame =
          mode === "inline"
            ? page
            : await waitUntil(
                "TinyMCE editing frame",
                async () => (await (await page.$("#test-tinymce_ifr"))?.contentFrame()) ?? false,
                { timeoutMs: INPUT_READY_TIMEOUT_MS },
              );
        const selector = mode === "inline" ? "#test-tinymce" : "body";
        if (mode === "iframe") await page.waitForSelector(".tox-tinymce", { visible: true });
        await waitForInputReady(editorPage, selector);
        await editorPage.click(`${selector} p:last-child`);
        await page.evaluate(() => {
          const editor = window.__testTinyMCE!;
          editor.selection.setCursorLocation(editor.getBody().lastElementChild!, 0);
        });
        const readContent = () =>
          page.evaluate(() => {
            const editor = window.__testTinyMCE!;
            return {
              html: editor.getContent(),
              blocks: Array.from(editor.getBody().children, (el) => el.textContent ?? ""),
              first: editor.getBody().firstElementChild!.innerHTML,
            };
          });
        const original = await readContent();
        await page.keyboard.type("w");
        const prediction = await waitUntil(
          "TinyMCE prediction for the typed prefix",
          async () => {
            const text = (await getVisibleSuggestionTexts(editorPage))[0];
            return text && /^w\S*[ \xa0]$/i.test(text) ? text : false;
          },
          { timeoutMs: SUGGESTION_TIMEOUT_MS },
        ).catch(async (error) => {
          throw new Error(
            `${String(error)}: ${JSON.stringify({ content: await readContent(), suggestions: await getVisibleSuggestionTexts(editorPage), focused: await editorPage.evaluate(() => document.hasFocus()) })}`,
          );
        });
        await page.evaluate(() => window.__testTinyMCE!.undoManager.add());
        await page.keyboard.press("Tab");
        await waitUntil(
          "TinyMCE contains accepted prediction",
          async () =>
            normalizeSuggestionText((await readContent()).blocks[1]) ===
            normalizeSuggestionText(prediction),
          { timeoutMs: SUGGESTION_TIMEOUT_MS },
        ).catch(async (error) => {
          throw new Error(
            `${String(error)}: ${JSON.stringify({ prediction, content: await readContent() })}`,
          );
        });
        expect((await readContent()).first).toBe(original.first);
        expect(normalizeSuggestionText((await readContent()).html)).toContain(
          normalizeSuggestionText(prediction),
        );
        expect((await readContent()).blocks[1]).toMatch(/[ \xa0]$/);

        await page.evaluate(() => window.__testTinyMCE!.undoManager.undo());
        await waitUntil(
          "TinyMCE undo restores prefix",
          async () => (await readContent()).blocks[1] === "w",
        );
        await editorPage.click(`${selector} p:last-child`);
        await page.evaluate(() => {
          const editor = window.__testTinyMCE!;
          editor.selection.setCursorLocation(editor.getBody().lastElementChild!, 1);
        });
        await page.keyboard.press("Enter");
        await waitUntil(
          "TinyMCE Enter creates a paragraph",
          async () => (await readContent()).blocks.length === 3,
        );
        await page.keyboard.type("ftsig");
        await highlightSuggestion(page, "Best regards", editorPage);
        await page.evaluate(() => window.__testTinyMCE!.undoManager.add());
        await page.keyboard.press("Tab");
        await waitUntil(
          "TinyMCE contains expansion in the new paragraph",
          async () => (await readContent()).blocks[2]?.trim() === "Best regards",
          { timeoutMs: SUGGESTION_TIMEOUT_MS },
        );
        expect((await readContent()).blocks.slice(0, 2).map(normalizeSuggestionText)).toEqual([
          "original reference",
          "w",
        ]);
        expect((await readContent()).first).toBe(original.first);
        await page.evaluate(() => window.__testTinyMCE!.undoManager.undo());
        await waitUntil(
          "TinyMCE expansion undo restores shortcut",
          async () => (await readContent()).blocks[2] === "ftsig",
        ).catch(async (cause) => {
          throw new Error(`TinyMCE undo left ${JSON.stringify(await readContent())}`, { cause });
        });
      } finally {
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Personalized menu and inline ranking survives runtime restart and clears locally",
    async () => {
      type PersonalizationStoreSnapshot = {
        languages?: Record<string, Record<string, { score?: number }>>;
      };

      const waitForLearnedScore = async (minimumScore: number): Promise<number> => {
        return await waitUntil(
          `personalization score for through >= ${minimumScore}`,
          async () => {
            const store = await getLocalStorageValue<PersonalizationStoreSnapshot>(
              worker!,
              PERSONALIZATION_STORAGE_KEY,
            );
            const score = store?.languages?.en_US?.through?.score;
            return typeof score === "number" && score >= minimumScore ? score : false;
          },
          { timeoutMs: browserTimeout(5000, 10000), intervalMs: 50 },
        );
      };

      const openReadyInput = async (): Promise<void> => {
        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, "#test-input");
      };

      const acceptThroughFromMenu = async (minimumScore: number): Promise<void> => {
        await openReadyInput();
        await typeInInput(page, "#test-input", "th");
        const suggestions = await waitUntil(
          "personalization training candidate through",
          async () => {
            const texts = await getVisibleSuggestionTexts(page);
            return texts.map(normalizeSuggestionText).includes("through") ? texts : false;
          },
          { timeoutMs: SUGGESTION_TIMEOUT_MS, intervalMs: 50 },
        );
        const throughIndex = suggestions.map(normalizeSuggestionText).indexOf("through");
        expect(throughIndex).toBeGreaterThanOrEqual(0);

        await highlightSuggestion(page, "through");
        await page.keyboard.press("Tab");
        await waitUntil(
          "menu acceptance to insert through",
          async () =>
            normalizeSuggestionText(await getInputContent(page, "#test-input")) === "through"
              ? true
              : false,
          { timeoutMs: browserTimeout(4000, 10000), intervalMs: 50 },
        );
        await waitForLearnedScore(minimumScore);
      };

      const expectFirstMenuSuggestion = async (expected: string): Promise<void> => {
        await openReadyInput();
        await typeInInput(page, "#test-input", "th");
        // Typing "th" can show the response for "t" before the final request settles.
        const firstSuggestion = await waitUntil(
          `first personalized menu suggestion ${expected}`,
          async () => {
            const [first] = await getVisibleSuggestionTexts(page);
            return normalizeSuggestionText(first ?? "") === expected ? first : false;
          },
          { timeoutMs: SUGGESTION_TIMEOUT_MS, intervalMs: 50 },
        );
        expect(normalizeSuggestionText(firstSuggestion)).toBe(expected);
      };

      const expectInlineThrough = async (): Promise<void> => {
        await openReadyInput();
        await typeInInput(page, "#test-input", "th");
        const suffix = await waitUntil(
          "personalized inline suggestion",
          async () => {
            const text = await page.evaluate(
              () => document.querySelector(".ft-suggestion-inline")?.textContent ?? "",
            );
            return normalizeSuggestionText(text) === "rough" ? text : false;
          },
          { timeoutMs: browserTimeout(5000, 10000), intervalMs: 50 },
        );
        expect(normalizeSuggestionText(suffix)).toBe("rough");
      };

      try {
        await sendRuntimeCommand(browser, worker!, CMD_OPTIONS_CLEAR_PERSONALIZATION);
        await setSettingAndWait(worker!, KEY_PERSONALIZATION_ENABLED, true);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 10);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_PREFIX_ONLY_MODE, false);
        await setSettingAndWait(worker!, KEY_AUTOCOMPLETE_ON_TAB, true);
        await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, false);
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);

        // Three deliberate selections put the decayed score safely above the
        // two-acceptance promotion threshold even on slower E2E machines.
        await acceptThroughFromMenu(1);
        await acceptThroughFromMenu(1.9);
        await acceptThroughFromMenu(2.9);

        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 3);
        await applyConfigChange(browser, worker!);
        await expectFirstMenuSuggestion("through");

        worker = await restartExtensionRuntime(browser, worker!);
        await expectFirstMenuSuggestion("through");

        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, true);
        await applyConfigChange(browser, worker!);
        await expectInlineThrough();
        await page.keyboard.press("Tab");
        await waitUntil(
          "inline acceptance to insert through",
          async () =>
            normalizeSuggestionText(await getInputContent(page, "#test-input")) === "through"
              ? true
              : false,
          { timeoutMs: browserTimeout(4000, 10000), intervalMs: 50 },
        );
        await waitForLearnedScore(3.8);
        await expectInlineThrough();

        const optionsPage = await openOptionsPage(browser, worker!);
        try {
          await optionsPage.evaluate(() => {
            window.confirm = () => true;
          });
          await optionsPage.waitForSelector('input[type="button"][value="Clear learned words"]', {
            timeout: browserTimeout(5000, 10000),
          });
          await sleep(100);
          await optionsPage.evaluate(() => {
            const button = document.querySelector<HTMLInputElement>(
              'input[type="button"][value="Clear learned words"]',
            );
            if (!button) {
              throw new Error("Clear learned words button not found");
            }
            button.click();
          });
          await waitUntil(
            "personalization storage to clear",
            async () =>
              (await getLocalStorageValue(worker!, PERSONALIZATION_STORAGE_KEY)) === undefined
                ? true
                : false,
            { timeoutMs: browserTimeout(5000, 10000), intervalMs: 50 },
          );
        } finally {
          await optionsPage.close();
        }

        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await applyConfigChange(browser, worker!);
        await expectFirstMenuSuggestion("the");
      } finally {
        await sendRuntimeCommand(browser, worker!, CMD_OPTIONS_CLEAR_PERSONALIZATION).catch(
          () => undefined,
        );
        await setSettingAndWait(worker!, KEY_PERSONALIZATION_ENABLED, false);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_PREFIX_ONLY_MODE, false);
        await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(120000, 180000),
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
    "CKEditor popup dismisses immediately when Enter is pressed",
    async () => {
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, { enableCkEditor: true });
      await page.bringToFront();
      await waitForInputReady(page, CKEDITOR_SELECTOR);

      await page.focus(CKEDITOR_SELECTOR);
      await page.keyboard.type("h");

      // Wait for the suggestion popup to appear
      const liCount = await waitForVisibleSuggestions(page);
      expect(liCount).toBeGreaterThan(0);

      // Pressing Enter should move the caret to a new block and dismiss the popup
      await page.keyboard.press("Enter");

      // The popup must disappear promptly — predictions for the old line are invalid
      await waitForNoVisibleSuggestions(page, browserTimeout(2000, 4000));
    },
    browserTimeout(30000, 50000),
  );

  test(
    "CKEditor grammar/text-edit replacement applies in active second paragraph",
    async () => {
      try {
        await setGrammarRulesAndWait(worker!, ["commaPeriodSpacing"]);
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

          const debugWindow = window as typeof window & {
            __ftDebugInputs?: Array<{ inputType: string; data: string; text: string }>;
            __ftDebugKeys?: string[];
          };
          debugWindow.__ftDebugInputs = [];
          debugWindow.__ftDebugKeys = [];
          editable.addEventListener("keydown", (event) => {
            const keyEvent = event as KeyboardEvent;
            debugWindow.__ftDebugKeys?.push(keyEvent.key);
          });
          editable.addEventListener("input", (event) => {
            const inputEvent = event as InputEvent;
            debugWindow.__ftDebugInputs?.push({
              inputType: inputEvent.inputType ?? "",
              data: inputEvent.data ?? "",
              text: editable.textContent ?? "",
            });
          });
        });

        await page.keyboard.type(",");
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
              if (!/^fixed,[ ]$/i.test(secondLine)) {
                return false;
              }
              return { firstLine, secondLine };
            });
            return value || false;
          },
          { timeoutMs: browserTimeout(5000, 9000), intervalMs: 50 },
        );

        expect(state.firstLine).toBe("Quill Rich Text Editor");
        expect(state.secondLine).toMatch(/^fixed,[ ]$/i);
      } finally {
        await setGrammarRulesAndWait(worker!, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(35000, 55000),
  );

  test(
    "CKEditor capitalizes at the start of an existing paragraph without touching the previous paragraph",
    async () => {
      try {
        await setGrammarRulesAndWait(worker!, ["capitalizeFirstLetter"]);
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
          ckEditor.setData("<p>First line</p><p>The</p>");
        });

        const clickTarget = await page.evaluate(() => {
          const editable = document.querySelector(".ck-editor__editable");
          const secondParagraph = editable?.querySelectorAll("p")[1];
          const textNode = secondParagraph?.firstChild;
          if (!(textNode instanceof Text)) {
            throw new Error("CKEditor second paragraph text node missing");
          }
          secondParagraph.scrollIntoView({ block: "center", inline: "nearest" });
          const range = document.createRange();
          range.setStart(textNode, 0);
          range.setEnd(textNode, 1);
          const rect = range.getBoundingClientRect();
          return {
            x: rect.left + 1,
            y: rect.top + rect.height / 2,
          };
        });

        await page.mouse.click(clickTarget.x, clickTarget.y);
        await page.keyboard.type("d ");

        try {
          await page.waitForFunction(
            () => {
              const editable = document.querySelector(".ck-editor__editable");
              if (!editable) {
                return false;
              }
              const paragraphs = Array.from(editable.querySelectorAll("p"));
              if (paragraphs.length < 2) {
                return false;
              }
              const normalize = (text: string): string =>
                text
                  .replace(/\u00a0/g, " ")
                  .replace(/\u200b/g, "")
                  .trim();
              return (
                normalize(paragraphs[0]?.textContent ?? "") === "First line" &&
                normalize(paragraphs[1]?.textContent ?? "") === "D The"
              );
            },
            { timeout: browserTimeout(1500, 3000) },
          );
        } catch {
          const debugState = await page.evaluate(() => {
            const editable = document.querySelector(".ck-editor__editable");
            const paragraphs = editable ? Array.from(editable.querySelectorAll("p")) : [];
            const normalize = (text: string): string =>
              text.replace(/\u00a0/g, " ").replace(/\u200b/g, "");
            return {
              html: editable?.innerHTML ?? "",
              textContent: normalize(editable?.textContent ?? ""),
              paragraphs: paragraphs.map((paragraph) => normalize(paragraph.textContent ?? "")),
            };
          });
          throw new Error(
            `CKEditor paragraph-start capitalization mismatch: ${JSON.stringify(debugState)}`,
          );
        }
      } finally {
        await setGrammarRulesAndWait(worker!, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Quill code predictions keep lowercase through Tab and restore prose casing",
    async () => {
      try {
        await setGrammarRulesAndWait(worker!, ["capitalizeSentenceStart"]);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_AUTOCOMPLETE_ON_TAB, true);
        await applyConfigChange(browser, worker!);
        await gotoTestPage(page, { enableQuill: true });
        await page.bringToFront();
        await waitForInputReady(page, QUILL_SELECTOR);
        await page.focus(QUILL_SELECTOR);
        await page.evaluate(() => {
          const quill = (window as typeof window & { __testQuill?: Quill }).__testQuill;
          if (!quill) throw new Error("Quill test instance not found");
          quill.setText("what . \nwhat . \n", "silent");
          quill.formatLine(0, 1, "code-block", true, "api");
          quill.setSelection("what . ".length, 0, "api");
          if (!document.querySelector(".ql-editor .ql-code-block"))
            throw new Error("Missing actual Quill code block");
        });
        for (const expected of ["was", "Was"]) {
          if (expected === "Was") {
            await page.keyboard.press("Escape");
            await page.evaluate(() => {
              const quill = (window as typeof window & { __testQuill?: Quill }).__testQuill;
              if (!quill) throw new Error("Quill test instance not found");
              quill.setSelection(quill.getText().indexOf("\n") + 1 + "what . ".length, 0, "api");
            });
          }
          await page.keyboard.type("wa");
          await waitUntil(
            `Quill offers ${expected} with context-correct casing`,
            async () => {
              const suggestions = await getVisibleSuggestionTexts(page);
              const found = suggestions.findIndex((text) => text.trim() === expected);
              return found >= 0 ? { value: found } : false;
            },
            { timeoutMs: browserTimeout(5000, 10000), intervalMs: 50 },
          );
          await highlightSuggestion(page, expected);
          await page.keyboard.press("Tab");
          await waitUntil(
            `Quill inserts ${expected} without changing code casing`,
            async () =>
              page.evaluate((inProse) => {
                const quill = (window as typeof window & { __testQuill?: Quill }).__testQuill;
                const lines = quill
                  ?.getText()
                  .replace(/\u00a0/g, " ")
                  .split("\n");
                const code = document
                  .querySelector(".ql-editor .ql-code-block")
                  ?.textContent?.trimEnd();
                return (
                  code === "what . was" &&
                  lines?.[0]?.trimEnd() === "what . was" &&
                  lines?.[1]?.trimEnd() === (inProse ? "what . Was" : "what .")
                );
              }, expected === "Was"),
            { timeoutMs: browserTimeout(5000, 10000), intervalMs: 50 },
          );
        }
      } finally {
        await setGrammarRulesAndWait(worker!, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(45000, 70000),
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
        await setGrammarRulesAndWait(worker!, ["capitalizeFirstLetter"]);
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

        const immediateGrammarState = await waitUntil(
          "quill lowercase first letter stays on the new line",
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
              if (secondLine !== "w") {
                return false;
              }
              return {
                firstLine,
                secondLine,
                normalizedText,
              };
            });
            return state || false;
          },
          { timeoutMs: browserTimeout(1000, 2500), intervalMs: 25 },
        );

        expect(immediateGrammarState.firstLine).toBe("Quill Rich Text Editor");
        expect(immediateGrammarState.secondLine).toBe("w");

        const liCount = await waitForVisibleSuggestions(page, browserTimeout(5000, 9000));
        expect(liCount).toBeGreaterThan(0);
        const [firstSuggestion] = await waitForVisibleSuggestionTexts(
          page,
          browserTimeout(5000, 9000),
        );
        expect(firstSuggestion).toMatch(/^w/i);
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
              if (!/^w\S*$/i.test(secondLine)) {
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
        expect(acceptedState.secondLine).toMatch(/^w\S*$/i);
        expect(acceptedState.selectionIndex).toBeGreaterThan(
          acceptedState.firstLine.length + acceptedState.secondLine.length,
        );
      } finally {
        await setGrammarRulesAndWait(worker!, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(40000, 60000),
  );

  test(
    "Quill grammar/text-edit replacement applies once without model corruption",
    async () => {
      try {
        await setGrammarRulesAndWait(worker!, ["commaPeriodSpacing"]);
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

        await page.keyboard.type(",");
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
              if (!/^fixed,[ ]$/i.test(secondLine)) {
                return false;
              }
              return true;
            });
            return state ? true : false;
          },
          { timeoutMs: browserTimeout(5000, 9000), intervalMs: 50 },
        ).catch(async (cause) => {
          throw new Error(
            `Quill grammar left ${JSON.stringify(await page.evaluate(() => ({ model: window.__testQuill!.getText(), html: window.__testQuill!.root.innerHTML, selection: window.__testQuill!.getSelection() })))}`,
            { cause },
          );
        });

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
              const hasDoubleSpace = secondLine.includes("fixed,  x");
              const hasExpectedText = /^fixed,[ ]x$/i.test(secondLine);
              const spacingAppliedOnce = secondLine.split("fixed, ").length - 1 === 1;
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
        expect(finalState.secondLine).toMatch(/^fixed, x$/i);
        expect(finalState.paragraphCount).toBeGreaterThanOrEqual(1);
      } finally {
        await setGrammarRulesAndWait(worker!, []);
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

  // Reads text-bearing predictor traces, which only development builds keep.
  devRuntimeTest(
    "block-local prediction in Lexical/Reddit contenteditable",
    async () => {
      const selector = "#test-contenteditable";
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, selector);

      const optionsPage = await openOptionsPage(browser, worker!);
      try {
        const baselineSnapshot = await getPredictorDebugSnapshot(optionsPage);
        const baselineTraceIds = new Set(
          (baselineSnapshot.traces ?? [])
            .map((trace) => trace.traceId)
            .filter((traceId): traceId is string => typeof traceId === "string"),
        );

        await page.evaluate((sel) => {
          const target = document.querySelector(sel);
          if (!(target instanceof HTMLElement)) {
            throw new Error("Contenteditable target not found");
          }

          target.innerHTML =
            '<div class="lexical-wrapper"><p class="first" dir="auto"><span data-lexical-text="true">FirstBlockAlpha</span></p><p class="second" dir="auto"><span data-lexical-text="true">S</span></p></div>';
          target.focus();

          const secondText = target.querySelector("p.second span")?.firstChild;
          if (!(secondText instanceof Text)) {
            throw new Error("Second paragraph text node not found");
          }

          const selection = window.getSelection();
          if (!selection) {
            throw new Error("Selection unavailable");
          }

          const range = document.createRange();
          range.setStart(secondText, secondText.textContent?.length ?? 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }, selector);

        await page.bringToFront();
        await page.keyboard.type("x");

        const trace = await waitForPredictorTrace(
          optionsPage,
          (candidate) => {
            if (!candidate.traceId || baselineTraceIds.has(candidate.traceId)) {
              return false;
            }
            const predictionInput = candidate.predictionInput?.toLowerCase() ?? "";
            const requestText = candidate.text?.toLowerCase() ?? "";
            return predictionInput.includes("sx") || requestText.includes("sx");
          },
          browserTimeout(5000, 12000),
        );

        expect(trace.text?.toLowerCase()).toContain("sx");
        expect(trace.text?.toLowerCase()).not.toContain("firstblockalpha");
        expect(trace.predictionInput?.toLowerCase()).toContain("sx");
        expect(trace.predictionInput?.toLowerCase()).not.toContain("firstblockalpha");
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    browserTimeout(20000, 35000),
  );

  // Reads text-bearing predictor traces, which only development builds keep.
  devRuntimeTest(
    "restores prediction immediately after Enter in Lexical/Reddit contenteditable",
    async () => {
      const selector = "#test-contenteditable";
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, selector);

      const optionsPage = await openOptionsPage(browser, worker!);
      try {
        const baselineSnapshot = await getPredictorDebugSnapshot(optionsPage);
        const baselineTraceIds = new Set(
          (baselineSnapshot.traces ?? [])
            .map((trace) => trace.traceId)
            .filter((traceId): traceId is string => typeof traceId === "string"),
        );

        await page.evaluate((sel) => {
          const target = document.querySelector(sel);
          if (!(target instanceof HTMLElement)) {
            throw new Error("Contenteditable target not found");
          }

          target.innerHTML =
            '<div class="lexical-wrapper"><p class="first" dir="auto"><span data-lexical-text="true">FirstBlockAlpha</span></p></div>';
          target.focus();

          const firstText = target.querySelector("p.first span")?.firstChild;
          if (!(firstText instanceof Text)) {
            throw new Error("First paragraph text node not found");
          }

          const selection = window.getSelection();
          if (!selection) {
            throw new Error("Selection unavailable");
          }

          const range = document.createRange();
          range.setStart(firstText, firstText.textContent?.length ?? 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }, selector);

        await page.bringToFront();
        await page.keyboard.press("Enter");

        await page.evaluate((sel) => {
          const target = document.querySelector(sel);
          if (!(target instanceof HTMLElement)) {
            throw new Error("Contenteditable target not found");
          }
          const wrapper = target.querySelector(".lexical-wrapper");
          if (!(wrapper instanceof HTMLElement)) {
            throw new Error("Lexical wrapper not found");
          }

          wrapper.insertAdjacentHTML(
            "beforeend",
            '<p class="second" dir="auto"><span data-lexical-text="true"></span></p>',
          );

          const selection = window.getSelection();
          if (!selection) {
            throw new Error("Selection unavailable");
          }

          const range = document.createRange();
          range.setStart(wrapper, 1);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          target.dispatchEvent(new Event("input", { bubbles: true }));
        }, selector);

        const trace = await waitForPredictorTrace(
          optionsPage,
          (candidate) => {
            if (!candidate.traceId || baselineTraceIds.has(candidate.traceId)) {
              return false;
            }
            const predictionInput = candidate.predictionInput?.toLowerCase() ?? "";
            const requestText = candidate.text?.toLowerCase() ?? "";
            return predictionInput === "firstblockalpha" || requestText === "firstblockalpha";
          },
          browserTimeout(5000, 12000),
        );

        expect(trace.text?.toLowerCase()).toBe("firstblockalpha");
        expect(trace.predictionInput?.toLowerCase()).toBe("firstblockalpha");
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    browserTimeout(20000, 35000),
  );

  // Reads text-bearing predictor traces, which only development builds keep.
  devRuntimeTest(
    "keeps second-line prediction block-local in br-separated contenteditable",
    async () => {
      const selector = "#test-contenteditable";
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, selector);

      const optionsPage = await openOptionsPage(browser, worker!);
      try {
        const baselineSnapshot = await getPredictorDebugSnapshot(optionsPage);
        const baselineTraceIds = new Set(
          (baselineSnapshot.traces ?? [])
            .map((trace) => trace.traceId)
            .filter((traceId): traceId is string => typeof traceId === "string"),
        );

        await page.evaluate((sel) => {
          const target = document.querySelector(sel);
          if (!(target instanceof HTMLElement)) {
            throw new Error("Contenteditable target not found");
          }

          target.innerHTML =
            '<p class="fb-linebreak" dir="auto"><span data-lexical-text="true">Wan</span><br><span data-lexical-text="true"></span></p>';
          target.addEventListener(
            "input",
            () => {
              const paragraph = target.querySelector("p.fb-linebreak");
              if (!(paragraph instanceof HTMLElement)) {
                return;
              }
              const spans = paragraph.querySelectorAll("span[data-lexical-text='true']");
              const firstSpan = spans.item(0);
              const secondSpan = spans.item(1);
              if (!(firstSpan instanceof HTMLElement) || !(secondSpan instanceof HTMLElement)) {
                return;
              }

              const firstLineText =
                firstSpan.dataset.initialFirstLine ?? firstSpan.textContent ?? "";
              const fullText = paragraph.textContent ?? "";
              const secondLineText = fullText.startsWith(firstLineText)
                ? fullText.slice(firstLineText.length)
                : fullText;

              firstSpan.textContent = firstLineText;
              secondSpan.textContent = secondLineText;

              const existingBreak = paragraph.querySelector("br");
              if (!(existingBreak instanceof HTMLBRElement)) {
                const lineBreak = document.createElement("br");
                paragraph.insertBefore(lineBreak, secondSpan);
              } else if (existingBreak.nextSibling !== secondSpan) {
                paragraph.insertBefore(existingBreak, secondSpan);
              }

              const childNodes = Array.from(paragraph.childNodes);
              for (const child of childNodes) {
                if (child === firstSpan || child === secondSpan || child.nodeName === "BR") {
                  continue;
                }
                paragraph.removeChild(child);
              }

              const selection = window.getSelection();
              if (!selection) {
                return;
              }
              const secondTextNode =
                secondSpan.firstChild instanceof Text
                  ? secondSpan.firstChild
                  : secondSpan.appendChild(document.createTextNode(secondLineText));
              const range = document.createRange();
              range.setStart(secondTextNode, secondTextNode.textContent?.length ?? 0);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
            },
            { capture: true },
          );
          const firstSpan = target.querySelector("span[data-lexical-text='true']");
          if (firstSpan instanceof HTMLElement) {
            firstSpan.dataset.initialFirstLine = firstSpan.textContent ?? "";
          }
          target.focus();

          const secondSpan = target.querySelectorAll("span")[1];
          if (!(secondSpan instanceof HTMLElement)) {
            throw new Error("Second-line span not found");
          }
          const secondText = secondSpan.appendChild(document.createTextNode(""));

          const selection = window.getSelection();
          if (!selection) {
            throw new Error("Selection unavailable");
          }

          const range = document.createRange();
          range.setStart(secondText, 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }, selector);

        await page.bringToFront();
        await page.keyboard.type("t");
        await page.evaluate((sel) => {
          const target = document.querySelector(sel);
          if (!(target instanceof HTMLElement)) {
            throw new Error("Contenteditable target not found");
          }
          const secondSpan = target.querySelectorAll("span")[1];
          if (!(secondSpan instanceof HTMLElement)) {
            throw new Error("Second-line span not found after typing");
          }
          const secondText =
            secondSpan.firstChild instanceof Text
              ? secondSpan.firstChild
              : secondSpan.appendChild(document.createTextNode(""));
          const selection = window.getSelection();
          if (!selection) {
            throw new Error("Selection unavailable");
          }
          const range = document.createRange();
          range.setStart(secondText, secondText.textContent?.length ?? 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          target.dispatchEvent(new Event("input", { bubbles: true }));
        }, selector);

        const trace = await waitForPredictorTrace(
          optionsPage,
          (candidate) => {
            if (!candidate.traceId || baselineTraceIds.has(candidate.traceId)) {
              return false;
            }
            const predictionInput = candidate.predictionInput?.toLowerCase() ?? "";
            const requestText = candidate.text?.toLowerCase() ?? "";
            return predictionInput === "t" || requestText === "t";
          },
          browserTimeout(5000, 12000),
        );

        expect(trace.text?.toLowerCase()).toBe("t");
        expect(trace.text?.toLowerCase()).not.toContain("wan");
        expect(trace.predictionInput?.toLowerCase()).toBe("t");
        expect(trace.predictionInput?.toLowerCase()).not.toContain("wan");
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    browserTimeout(20000, 35000),
  );

  // Reads text-bearing predictor traces, which only development builds keep.
  devRuntimeTest(
    "keeps second-line prediction block-local after Enter in real Lexical editor",
    async () => {
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, { enableLexical: true });
      await page.bringToFront();
      await waitForInputReady(page, LEXICAL_SELECTOR);
      await page.focus(LEXICAL_SELECTOR);
      await page.keyboard.type("FirstBlockAlpha");
      await waitUntil(
        "Lexical first paragraph text",
        async () =>
          await page.evaluate(
            () =>
              document.querySelector("#test-lexical-editor p")?.textContent === "FirstBlockAlpha",
          ),
        {
          timeoutMs: browserTimeout(3000, 7000),
          intervalMs: 50,
        },
      );
      await page.evaluate(() => {
        const target = document.querySelector("#test-lexical-editor");
        if (!(target instanceof HTMLElement)) {
          throw new Error("Lexical editor not found");
        }

        target.focus();

        const firstText = target.querySelector("p span[data-lexical-text='true']")?.firstChild;
        if (!(firstText instanceof Text)) {
          throw new Error("Lexical first paragraph text node not found");
        }

        const selection = window.getSelection();
        if (!selection) {
          throw new Error("Selection unavailable");
        }

        const range = document.createRange();
        range.setStart(firstText, firstText.textContent?.length ?? 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.keyboard.press("Enter");
      await waitUntil(
        "Lexical creates second paragraph after Enter",
        async () =>
          await page.evaluate(() => {
            const paragraphs = Array.from(document.querySelectorAll("#test-lexical-editor p"));
            if (paragraphs.length < 2) {
              return false;
            }
            const texts = paragraphs.map((paragraph) => paragraph.textContent ?? "");
            return texts[0] === "FirstBlockAlpha" && texts[1].trim() === "";
          }),
        {
          timeoutMs: browserTimeout(3000, 7000),
          intervalMs: 50,
        },
      );

      const optionsPage = await openOptionsPage(browser, worker!);
      try {
        const baselineSnapshot = await getPredictorDebugSnapshot(optionsPage);
        const baselineTraceIds = new Set(
          (baselineSnapshot.traces ?? [])
            .map((trace) => trace.traceId)
            .filter((traceId): traceId is string => typeof traceId === "string"),
        );

        await page.bringToFront();
        await page.evaluate(() => {
          const target = document.querySelector("#test-lexical-editor");
          if (!(target instanceof HTMLElement)) {
            throw new Error("Lexical editor not found");
          }

          const paragraphs = target.querySelectorAll("p");
          const secondParagraph = paragraphs.item(1);
          if (!(secondParagraph instanceof HTMLElement)) {
            throw new Error("Lexical second paragraph not found");
          }

          target.focus();

          const selection = window.getSelection();
          if (!selection) {
            throw new Error("Selection unavailable");
          }

          const range = document.createRange();
          range.setStart(secondParagraph, 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        });
        await page.keyboard.type("s");

        const trace = await waitForPredictorTrace(
          optionsPage,
          (candidate) => {
            if (!candidate.traceId || baselineTraceIds.has(candidate.traceId)) {
              return false;
            }
            const predictionInput = candidate.predictionInput?.toLowerCase() ?? "";
            const requestText = candidate.text?.toLowerCase() ?? "";
            return predictionInput.includes("s") || requestText.includes("s");
          },
          browserTimeout(5000, 12000),
        );

        expect(trace.text?.toLowerCase()).toContain("s");
        expect(trace.text?.toLowerCase()).not.toContain("firstblockalpha");
        expect(trace.predictionInput?.toLowerCase()).toContain("s");
        expect(trace.predictionInput?.toLowerCase()).not.toContain("firstblockalpha");
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
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
    "Contenteditable inline completion keeps the accepted text baseline",
    async () => {
      const selector = "#test-contenteditable";
      try {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, true);
        await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, false);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await applyConfigChange(browser, worker!);

        // Fractional leading reproduces the README offset. Normal and tight
        // line heights also need the browser's actual text metrics.
        for (const font of [
          "24px/1.65 system-ui, sans-serif",
          "20px Georgia, serif",
          "24px/0.8 Arial, sans-serif",
        ]) {
          await gotoTestPage(page);
          await page.bringToFront();
          await waitForInputReady(page, selector);
          await page.$eval(
            selector,
            (element, font) => {
              const editor = element as HTMLElement;
              editor.style.font = font;
              editor.style.whiteSpace = "pre-wrap";
              editor.textContent = "Thanks for the ";
              editor.focus();
              const range = document.createRange();
              range.selectNodeContents(editor);
              range.collapse(false);
              getSelection()!.removeAllRanges();
              getSelection()!.addRange(range);
            },
            font,
          );
          await page.keyboard.type("rep");
          await waitForInlineGhostText("inline baseline preview");
          const preview = await page.evaluate((selector) => {
            const ghost = document.querySelector(".ft-suggestion-inline")!;
            const range = document.createRange();
            range.selectNodeContents(ghost);
            const rect = range.getClientRects()[0];
            return {
              before: document.querySelector(selector)!.textContent!,
              suffix: ghost.textContent!,
              top: rect.top,
              left: rect.left,
              height: rect.height,
            };
          }, selector);
          await page.keyboard.press("Tab");
          await waitUntil(
            "accepted inline suffix",
            async () =>
              (await page.$eval(selector, (element) => element.textContent)) ===
              preview.before + preview.suffix,
            { timeoutMs: browserTimeout(3000, 6000) },
          );
          const accepted = await page.$eval(
            selector,
            (element, preview) => {
              const range = document.createRange();
              range.setStart(element.firstChild!, preview.before.length);
              range.setEnd(element.firstChild!, preview.before.length + preview.suffix.length);
              const rect = range.getBoundingClientRect();
              return { top: rect.top, left: rect.left, height: rect.height };
            },
            preview,
          );
          expect(Math.abs(preview.top - accepted.top)).toBeLessThan(0.1);
          expect(Math.abs(preview.height - accepted.height)).toBeLessThan(0.1);
          expect(Math.abs(preview.left - accepted.left)).toBeLessThan(1);
        }
      } finally {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 45000),
  );

  async function enableArabicInlineSuggestions() {
    await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
    await setSettingAndWait(worker!, KEY_LANGUAGE, "ar_SA");
    await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
    await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
    await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, true);
    await applyConfigChange(browser, worker!);
  }

  async function resetArabicInlineSuggestions() {
    await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
    await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
    await applyConfigChange(browser, worker!);
  }

  async function waitForInlineGhostText(label: string): Promise<string> {
    return waitUntil(
      label,
      async () => {
        const text = await page.evaluate(
          () => document.querySelector(".ft-suggestion-inline")?.textContent ?? "",
        );
        return text.length > 0 ? text : false;
      },
      { timeoutMs: browserTimeout(5000, 10000), intervalMs: 50 },
    );
  }

  test(
    "Arabic inline ghost in an RTL textarea anchors at the caret and accepts on TAB",
    async () => {
      const selector = "#test-textarea";
      try {
        await enableArabicInlineSuggestions();
        await gotoTestPage(page);
        await page.bringToFront();
        await page.evaluate(() =>
          document.getElementById("test-textarea")!.setAttribute("dir", "rtl"),
        );
        await waitForInputReady(page, selector);
        await clearInputContent(page, selector);
        await typeInInput(page, selector, "الي");
        await waitForInlineGhostText("RTL Arabic inline ghost");

        const geometry = await page.evaluate(() => {
          const textarea = document.getElementById("test-textarea") as HTMLTextAreaElement;
          const ghost = document.querySelector(".ft-suggestion-inline") as HTMLElement;
          // Measure the caret with a throwaway mirror: in an RTL paragraph the
          // caret after the typed run sits at the run's LEFT edge.
          const computed = getComputedStyle(textarea);
          const probe = document.createElement("div");
          for (const prop of [
            "boxSizing",
            "width",
            "paddingTop",
            "paddingRight",
            "paddingBottom",
            "paddingLeft",
            "borderTopWidth",
            "borderRightWidth",
            "borderBottomWidth",
            "borderLeftWidth",
            "borderStyle",
            "fontFamily",
            "fontSize",
            "fontWeight",
            "letterSpacing",
            "direction",
            "textAlign",
          ] as const) {
            (probe.style as unknown as Record<string, string>)[prop] = computed[prop];
          }
          const rect = textarea.getBoundingClientRect();
          Object.assign(probe.style, {
            position: "fixed",
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            whiteSpace: "pre-wrap",
            visibility: "hidden",
          });
          const run = document.createElement("span");
          run.textContent = textarea.value;
          probe.appendChild(run);
          document.body.appendChild(probe);
          const caretX = run.getBoundingClientRect().left;
          probe.remove();
          const ghostRect = ghost.getBoundingClientRect();
          return {
            isMirror: ghost.children.length > 0,
            caretX,
            ghostLeft: ghostRect.left,
            ghostRight: ghostRect.right,
            editorLeft: rect.left,
            editorRight: rect.right,
          };
        });
        // A floating ghost (not the mirror) grows leftward from the caret.
        expect(geometry.isMirror).toBe(false);
        expect(Math.abs(geometry.ghostRight - geometry.caretX)).toBeLessThanOrEqual(4);
        expect(geometry.ghostLeft).toBeGreaterThanOrEqual(geometry.editorLeft - 1);
        expect(geometry.ghostRight).toBeLessThanOrEqual(geometry.editorRight + 1);

        await page.keyboard.press("Tab");
        const accepted = await waitForInputContentMatch(
          page,
          selector,
          /^اليوم[ \xa0]?$/,
          browserTimeout(3000, 6000),
        );
        expect(accepted).toMatch(/^اليوم[ \xa0]?$/);
      } finally {
        await resetArabicInlineSuggestions();
      }
    },
    browserTimeout(30000, 45000),
  );

  test(
    "Arabic in an LTR input previews through the mirror without overlapping typed text",
    async () => {
      const selector = "#test-input";
      try {
        await enableArabicInlineSuggestions();
        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, selector);
        await clearInputContent(page, selector);
        await typeInInput(page, selector, "الي");
        await waitForInlineGhostText("LTR-input Arabic mirror preview");

        const layout = await page.evaluate(() => {
          const mirror = document.querySelector(".ft-suggestion-inline") as HTMLElement;
          const [before, suffix] = Array.from(mirror.children) as HTMLElement[];
          // Measure only the letters: a trailing (auto-space) NBSP resolves to
          // the LTR paragraph direction and sits right of the Arabic run.
          const lettersRect = (span: HTMLElement | undefined) => {
            const node = span?.firstChild;
            if (!node || !node.textContent) {
              return null;
            }
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, node.textContent.replace(/[\s\u00a0]+$/u, "").length);
            return range.getBoundingClientRect();
          };
          const beforeRect = lettersRect(before);
          const suffixRect = lettersRect(suffix);
          return {
            spanCount: mirror.children.length,
            beforeText: before?.textContent ?? "",
            suffixText: suffix?.textContent ?? "",
            beforeLeft: beforeRect?.left ?? 0,
            suffixRight: suffixRect?.right ?? Number.POSITIVE_INFINITY,
          };
        });
        // The opposing-direction run uses the mirror (before | suffix | after).
        expect(layout.spanCount).toBe(3);
        expect(layout.beforeText).toBe("الي");
        expect(layout.suffixText.length).toBeGreaterThan(0);
        // Bidi lays the Arabic continuation to the LEFT of the typed run.
        expect(layout.suffixRight).toBeLessThanOrEqual(layout.beforeLeft + 1);

        await page.keyboard.press("Tab");
        const accepted = await waitForInputContentMatch(
          page,
          selector,
          /^اليوم[ \xa0]?$/,
          browserTimeout(3000, 6000),
        );
        expect(accepted).toMatch(/^اليوم[ \xa0]?$/);
      } finally {
        await resetArabicInlineSuggestions();
      }
    },
    browserTimeout(30000, 45000),
  );

  test(
    "CKEditor inline preview hides trailing word chars when caret is mid-word",
    async () => {
      try {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, true);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, false);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page, { enableCkEditor: true });
        await page.bringToFront();
        await waitForInputReady(page, CKEDITOR_SELECTOR);

        // Seed the editor with "The dog walked the street".
        await page.evaluate(() => {
          const ckEditor = (
            window as typeof window & {
              __testCkEditor?: { setData: (data: string) => void };
            }
          ).__testCkEditor;
          if (!ckEditor) {
            throw new Error("CKEditor test instance not found");
          }
          ckEditor.setData("<p>The dog walked the street</p>");
        });

        await page.focus(CKEDITOR_SELECTOR);
        // Place the caret inside the first word, after "Th".
        await page.evaluate(() => {
          const editable = document.querySelector(".ck-editor__editable");
          const firstParagraph = editable?.querySelector("p");
          const textNode = firstParagraph?.firstChild;
          if (!(textNode instanceof Text)) {
            throw new Error("CKEditor first paragraph text node missing");
          }
          const selection = window.getSelection();
          if (!selection) {
            throw new Error("Selection unavailable");
          }
          const range = document.createRange();
          range.setStart(textNode, 2); // "Th|e dog walked the street"
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        });

        // Type "r" so the text becomes "Thr|e dog walked the street".
        await page.keyboard.type("r");

        // Wait for the inline preview to render.
        const previewText = await waitUntil(
          "CKEditor inline preview for mid-word typing",
          async () => {
            const text = await page.evaluate(() => {
              const preview = document.querySelector(".ft-suggestion-inline");
              const raw = preview?.textContent ?? "";
              return raw.replace(/\u00a0/g, " ");
            });
            return text.length > 0 ? text : false;
          },
          { timeoutMs: browserTimeout(3000, 6000), intervalMs: 50 },
        );

        // The preview must read as the post-acceptance text: a single word
        // starting with "Thr" followed by " dog walked the street" with no
        // stale "e" from the original word leaking through after the ghost
        // suffix (the pre-fix bug produced "Threee dog walked the street").
        expect(previewText).toMatch(/^thr\S* dog walked the street$/i);

        // Accepting the suggestion yields the exact text the preview showed,
        // validating the "WYSIWYG" invariant the preview is supposed to
        // guarantee (with insert-space-after-accept disabled so we can
        // compare directly).
        await page.keyboard.press("Tab");
        const finalText = await waitUntil(
          "CKEditor first-paragraph text after accepting inline suggestion",
          async () => {
            const text = await page.evaluate(() => {
              const editable = document.querySelector(".ck-editor__editable");
              const firstParagraph = editable?.querySelector("p");
              return (firstParagraph?.textContent ?? "").replace(/\u00a0/g, " ").trim();
            });
            return text === previewText ? text : false;
          },
          { timeoutMs: browserTimeout(3000, 6000), intervalMs: 50 },
        );
        expect(finalText).toBe(previewText);
      } finally {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(45000, 70000),
  );

  // Regression for #397: a text expansion replaces its shortcut. The preview
  // keeps the shortcut and annotates the expansion after it (visibly, even in
  // a narrow input); Tab replaces the shortcut with the expansion.
  test(
    "Inline text expansion previews and replaces the shortcut mid-text in a narrow input",
    async () => {
      const selector = "#test-input";
      try {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, true);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "textExpander");
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, [["longshortcutxx", "OK"]]);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, selector);
        await page.evaluate(() => {
          const input = document.getElementById("test-input") as HTMLInputElement;
          Object.assign(input.style, {
            boxSizing: "border-box",
            width: "190px",
            font: "20px/24px monospace",
            padding: "2px",
            border: "1px solid",
          });
          input.value = "longshortcutx rest";
          input.focus();
          input.setSelectionRange(13, 13);
        });
        await page.keyboard.type("x");

        const preview = await waitUntil(
          "visible inline text expansion preview",
          async () =>
            page.evaluate(() => {
              const mirror = document.querySelector(".ft-suggestion-inline") as HTMLElement | null;
              const ghost = mirror?.children[1];
              if (!mirror || !ghost || !(ghost.textContent ?? "").includes("OK")) {
                return false;
              }
              const mirrorRect = mirror.getBoundingClientRect();
              const ghostRect = ghost.getBoundingClientRect();
              const visible =
                ghostRect.left >= mirrorRect.left - 1 && ghostRect.right <= mirrorRect.right + 1;
              return visible ? (mirror.textContent ?? "").replace(/\u00a0/g, " ") : false;
            }),
          { timeoutMs: browserTimeout(3000, 6000), intervalMs: 50 },
        );
        // The typed shortcut stays visible, with the expansion annotated after it.
        expect(preview).toBe("longshortcutxx → OK rest");

        await page.keyboard.press("Tab");
        const finalText = await waitForInputContentMatch(
          page,
          selector,
          /^OK[ \xa0]+rest$/,
          browserTimeout(3000, 6000),
        );
        expect(finalText).toMatch(/^OK[ \xa0]+rest$/);
      } finally {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 45000),
  );

  // A text expansion that starts with its shortcut is a plain continuation:
  // no arrow, just the ghost suffix, and Tab completes it.
  test(
    "Inline text expansion extending the shortcut previews a plain continuation",
    async () => {
      const selector = "#test-input";
      try {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, true);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "textExpander");
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, [["sig", "signature block"]]);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, selector);
        await clearInputContent(page, selector);
        await typeInInput(page, selector, "sig");

        const ghostText = await waitUntil(
          "inline continuation preview",
          async () => {
            const text = await page.evaluate(
              () => document.querySelector(".ft-suggestion-inline")?.textContent ?? "",
            );
            return text.length > 0 ? text.replace(/ /g, " ") : false;
          },
          { timeoutMs: browserTimeout(3000, 6000), intervalMs: 50 },
        );
        expect(ghostText).not.toContain("→");
        expect(ghostText.trimEnd()).toBe("nature block");

        await page.keyboard.press("Tab");
        const finalText = await waitForInputContentMatch(
          page,
          selector,
          /^signature block[ \xa0]?$/,
          browserTimeout(3000, 6000),
        );
        expect(finalText).toMatch(/^signature block[ \xa0]?$/);
      } finally {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 45000),
  );

  // Regression: in a contenteditable (e.g. Gmail) a later block such as a
  // signature must not make the caret look mid-text and disarm Tab.
  test(
    "Inline text expansion is accepted on Tab above a contenteditable signature block",
    async () => {
      const selector = "#test-contenteditable";
      const readBlocks = () =>
        page.evaluate((sel) => {
          const target = document.querySelector(sel) as HTMLElement;
          return {
            blocks: Array.from(target.children, (child) =>
              (child.textContent ?? "").replace(/ /g, " "),
            ),
            focused: document.activeElement === target,
          };
        }, selector);
      try {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, true);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "textExpander");
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, [["brb", "be right back"]]);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, selector);
        await page.evaluate((sel) => {
          const target = document.querySelector(sel) as HTMLElement;
          target.innerHTML = "<div>ok br</div><div>-- Bart</div>";
          target.focus();
          const range = document.createRange();
          range.setStart(target.firstChild!.firstChild!, 5);
          range.collapse(true);
          window.getSelection()!.removeAllRanges();
          window.getSelection()!.addRange(range);
        }, selector);
        await page.keyboard.type("b");

        try {
          await waitUntil(
            "inline text expansion preview above the signature",
            async () =>
              page.evaluate(() =>
                (document.querySelector(".ft-suggestion-inline")?.textContent ?? "").includes(
                  "be right back",
                ),
              ),
            { timeoutMs: browserTimeout(3000, 6000), intervalMs: 50 },
          );
        } catch (error) {
          const diagnostics = await page.evaluate((sel) => {
            const target = document.querySelector(sel) as HTMLElement;
            const selection = window.getSelection();
            const anchor = selection?.anchorNode;
            return {
              html: target.innerHTML,
              anchor: anchor ? `${anchor.nodeName}:${anchor.textContent}` : null,
              anchorOffset: selection?.anchorOffset,
              inline: document.querySelector(".ft-suggestion-inline")?.textContent ?? null,
              menu: document.querySelector(".ft-suggestion-menu, [class*='suggestion']")
                ?.textContent,
            };
          }, selector);
          const optionsPage = await openOptionsPage(browser, worker!);
          const traces = ((await getPredictorDebugSnapshot(optionsPage)).traces ?? [])
            .toSorted((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0))
            .slice(0, 4)
            .map(
              ({
                text,
                lang,
                predictionInput,
                doPrediction,
                requestId,
                timestampMs,
                finalPredictions,
              }) => ({
                finalPredictions,
                text,
                lang,
                predictionInput,
                doPrediction,
                requestId,
                timestampMs,
              }),
            );
          await optionsPage.close();
          throw new Error(`${String(error)} ${JSON.stringify({ ...diagnostics, traces })}`, {
            cause: error,
          });
        }

        await page.keyboard.press("Tab");
        const state = await waitUntil(
          "text expansion inserted above the signature",
          async () => {
            const current = await readBlocks();
            return /^ok be right back ?$/.test(current.blocks[0] ?? "") ? current : false;
          },
          { timeoutMs: browserTimeout(3000, 6000), intervalMs: 50 },
        );
        expect(state.blocks[1]).toBe("-- Bart");
        expect(state.focused).toBeTrue();
      } finally {
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_TEXT_EXPANSIONS, []);
        await applyConfigChange(browser, worker!);
      }
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
    "Support prompts can be dismissed permanently while support stays visible",
    async () => {
      await setSettingAndWait(worker!, KEY_PRODUCTIVITY_STATS, {
        acceptedSuggestions: 50,
        charactersSaved: 3600,
        daily: {},
      });
      try {
        const popup = await openPopupPage(browser, worker!);
        await popup.waitForSelector("#dashboardMilestoneHint:not(.is-hidden)");
        expect(await popup.$eval("#supportDevelopmentLink", (el) => el.textContent)).toContain(
          "Support FluentTyper",
        );
        expect(await popup.$eval("#dashboardMilestoneText", (el) => el.textContent)).toContain(
          "estimated",
        );
        // Firefox BiDi cannot dispatch pointer input inside extension pages.
        await popup.$eval("#dashboardMilestoneDismissBtn", (el) =>
          (el as HTMLButtonElement).click(),
        );
        await waitForSettingMatch<{ donationPromptsDisabled: boolean }>(
          worker!,
          KEY_PRODUCTIVITY_STATS,
          (value) => value?.donationPromptsDisabled === true,
        );
        await popup.close();
        const reopened = await openPopupPage(browser, worker!);
        await reopened.waitForSelector("#supportDevelopmentLink", { visible: true });
        await reopened.waitForFunction(() =>
          document.getElementById("dashboardPeriodSummary")?.textContent?.includes("Last 7 days:"),
        );
        expect(
          await reopened.$eval("#dashboardMilestoneHint", (el) =>
            el.classList.contains("is-hidden"),
          ),
        ).toBe(true);
        await reopened.close();
        const options = await openOptionsPage(browser, worker!);
        if (!isFirefox()) await options.setViewport({ width: 1200, height: 900 });
        await options.$eval('a[href="#advanced_tab"]', (el) => (el as HTMLAnchorElement).click());
        await options.waitForSelector(".support-card", { visible: true });
        expect(
          await options.$eval(
            ".support-card",
            (el) => el.getBoundingClientRect().top < window.innerHeight,
          ),
        ).toBe(true);
        await options.close();
      } finally {
        await setSettingAndWait(worker!, KEY_PRODUCTIVITY_STATS, {});
      }
    },
    browserTimeout(10000, 20000),
  );

  test(
    "Productivity dashboard shows compact popup summary and advanced stats in options",
    async () => {
      const { today, yesterday } = await worker!.evaluate(() => {
        const toLocalDateKey = (date: Date): string => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          return `${year}-${month}-${day}`;
        };
        const now = new Date();
        const previousDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        return {
          today: toLocalDateKey(now),
          yesterday: toLocalDateKey(previousDay),
        };
      });
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
          periodSummary: document.getElementById("dashboardPeriodSummary")?.textContent || "",
          hasTrendNode: Boolean(document.getElementById("dashboardTrendSummary")),
          hasTopSnippetsNode: Boolean(document.getElementById("topSnippetsList")),
        }));

        expect(popupSummary.periodSummary).toContain("Last 7 days:");
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

  test(
    "Auto-detect keeps the stored global language while typing in a detected language",
    async () => {
      const selector = "#test-input";
      try {
        await setSettingAndWait(worker!, "enable", true);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, ["en_US", "el_GR"]);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "auto_detect");
        await setSettingAndWait(worker!, KEY_FALLBACK_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_AUTO_LANGUAGE_SITE_PRIORS, {});
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, selector);
        await clearInputContent(page, selector);
        await typeInInput(page, selector, "φιλο");
        await typeInInput(page, selector, "σ");
        const greekSuggestions = await waitForVisibleSuggestionTexts(
          page,
          browserTimeout(12000, 15000),
        ).catch(() => []);
        if (greekSuggestions.length > 0) {
          expect(greekSuggestions.some((text) => text.toLowerCase().includes("φιλοσοφία"))).toBe(
            true,
          );
        } else {
          expect((await getInputContent(page, selector)).toLowerCase()).toContain("φιλοσ");
        }
        expect(await getSetting<string>(worker!, KEY_LANGUAGE)).toBe("auto_detect");
      } finally {
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_FALLBACK_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_AUTO_LANGUAGE_SITE_PRIORS, {});
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(20000, 35000),
  );

  test(
    "Auto-detect switches to Arabic for Arabic-script typing",
    async () => {
      const selector = "#test-input";
      try {
        await setSettingAndWait(worker!, "enable", true);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, ["en_US", "ar_SA"]);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "auto_detect");
        await setSettingAndWait(worker!, KEY_FALLBACK_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_AUTO_LANGUAGE_SITE_PRIORS, {});
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, selector);
        await clearInputContent(page, selector);
        await typeInInput(page, selector, "الي");
        let latest: string[] = [];
        await waitUntil(
          "Arabic auto-detect suggestion",
          async () => {
            latest = await getVisibleSuggestionTexts(page).catch(() => []);
            return latest.some((text) => text.includes("اليوم")) ? latest : false;
          },
          { timeoutMs: browserTimeout(12000, 15000), intervalMs: 50 },
        ).catch(() => {
          throw new Error(
            `Expected an Arabic suggestion containing "اليوم", got: ${latest.join(" | ")}`,
          );
        });
        expect(await getSetting<string>(worker!, KEY_LANGUAGE)).toBe("auto_detect");
      } finally {
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_FALLBACK_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_AUTO_LANGUAGE_SITE_PRIORS, {});
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(20000, 35000),
  );

  devRuntimeTest(
    "CMD_TOGGLE_FT_ACTIVE_LANG creates an auto-detect session lock without persisting site overrides",
    async () => {
      const selector = "#test-input";
      try {
        await setSettingAndWait(worker!, "enable", true);
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, ["en_US", "el_GR"]);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "auto_detect");
        await setSettingAndWait(worker!, KEY_FALLBACK_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_AUTO_LANGUAGE_SITE_PRIORS, {});
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
        await applyConfigChange(browser, worker!);

        await gotoTestPage(page);
        await page.bringToFront();
        await waitForInputReady(page, selector);
        await clearInputContent(page, selector);
        await typeInInput(page, selector, "φιλο");
        await typeInInput(page, selector, "σ");
        const greekSuggestions = await waitForVisibleSuggestionTexts(
          page,
          browserTimeout(12000, 15000),
        ).catch(() => []);
        if (greekSuggestions.length > 0) {
          expect(greekSuggestions.some((text) => text.toLowerCase().includes("φιλοσοφία"))).toBe(
            true,
          );
        } else {
          expect((await getInputContent(page, selector)).toLowerCase()).toContain("φιλοσ");
        }
        await triggerCommandForTesting(worker!, "CMD_TOGGLE_FT_ACTIVE_LANG");

        const globalLanguage = await waitForSettingMatch<string>(
          worker!,
          KEY_LANGUAGE,
          (value) => value === "auto_detect",
          browserTimeout(3000, 7000),
        );
        expect(globalLanguage).toBe("auto_detect");

        const siteProfiles = await getSetting<Record<string, unknown>>(worker!, KEY_SITE_PROFILES);
        expect(siteProfiles ?? {}).toEqual({});

        const sitePriors = await waitForSettingMatch<Record<string, Record<string, number>>>(
          worker!,
          KEY_AUTO_LANGUAGE_SITE_PRIORS,
          (value) =>
            Boolean(
              value?.[TEST_HOST] &&
              typeof value[TEST_HOST].en_US === "number" &&
              value[TEST_HOST].en_US > 0,
            ),
          browserTimeout(3000, 7000),
        );
        expect(sitePriors?.[TEST_HOST]?.en_US).toBeGreaterThan(0);

        await page.bringToFront();
        await clearInputContent(page, selector);
        await typeInInput(page, selector, "φιλο");
        await typeInInput(page, selector, "σ");
        const lockedGreekSuggestions = await waitForVisibleSuggestionTexts(
          page,
          browserTimeout(12000, 15000),
        ).catch(() => []);
        if (lockedGreekSuggestions.length > 0) {
          expect(lockedGreekSuggestions.length).toBeGreaterThan(0);
        } else {
          expect((await getInputContent(page, selector)).toLowerCase()).toContain("φιλοσ");
        }
      } finally {
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_FALLBACK_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_AUTO_LANGUAGE_SITE_PRIORS, {});
        await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(30000, 50000),
  );

  // `strict` languages must show the expected word in #test-input; the rest
  // tolerate a slow engine (input still holds the typed text).
  const LANGUAGE_TEST_DATA: Record<string, { input: string; expected: string; strict?: boolean }> =
    {
      en_US: { input: "impor", expected: "important" },
      fr_FR: { input: "champig", expected: "champignon" },
      hr_HR: { input: "prijat", expected: "prijatelj" },
      es_ES: { input: "estup", expected: "estupenda" },
      el_GR: { input: "φιλοσ", expected: "φιλοσοφία" },
      sv_SE: { input: "tillsamm", expected: "tillsammans" },
      de_DE: { input: "schmetterl", expected: "schmetterling" },
      pl_PL: { input: "chrabą", expected: "chrabąszcz" },
      pt_BR: { input: "caipir", expected: "caipira" },
      ar_SA: { input: "الي", expected: "اليوم", strict: true },
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

      let latestSuggestionTexts: string[] = [];
      await waitUntil(
        `prediction for ${lang} in ${selector}`,
        async () => {
          const visibleSuggestionTexts = (
            await getVisibleSuggestionTexts(page).catch(() => [])
          ).map((text) => text.toLowerCase());
          if (visibleSuggestionTexts.length === 0) {
            return false;
          }
          latestSuggestionTexts = visibleSuggestionTexts;
          if (selector === "#test-textarea" || selector === CKEDITOR_SELECTOR) {
            return visibleSuggestionTexts;
          }
          return visibleSuggestionTexts.some((text) =>
            text.includes(testData.expected.toLowerCase()),
          )
            ? visibleSuggestionTexts
            : false;
        },
        { timeoutMs: suggestionTimeoutMs, intervalMs: 50 },
      ).catch(() => undefined);

      const allSuggestionTexts = latestSuggestionTexts;
      if (allSuggestionTexts.length > 0) {
        const found = allSuggestionTexts.some((text) =>
          text.includes(testData.expected.toLowerCase()),
        );
        if (found) {
          expect(found).toBe(true);
        } else if (selector === "#test-textarea" || selector === CKEDITOR_SELECTOR) {
          expect(allSuggestionTexts.length).toBeGreaterThan(0);
        } else {
          throw new Error(
            `Expected ${lang} suggestion containing "${testData.expected}" in ${selector}, got: ${allSuggestionTexts.join(" | ")}`,
          );
        }
      } else if (testData.strict && selector === "#test-input") {
        throw new Error(
          `Expected ${lang} suggestion containing "${testData.expected}" in ${selector}, got none`,
        );
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
      // i18n short codes mapped to full locale codes and expected visible options copy
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
          await optionsPage.waitForSelector("#content", {
            timeout: browserTimeout(1000, 5000),
          });

          const textFound = await optionsPage.evaluate((exp: string) => {
            return document.body.textContent?.includes(exp) ?? false;
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
        await popupPage.waitForSelector("#pageStatePanel", {
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
      await waitForVisibleSuggestionTexts(page, browserTimeout(4000, 10000));
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
    "Grammar rule options inherit defaults and persist an explicit override",
    async () => {
      let optionsPage = await openOptionsPage(browser, worker!);
      try {
        settingsDirty = true;
        await setSettingAndWait(worker!, KEY_ENABLED_GRAMMAR_RULES, {});
        expect(
          await getSetting<Record<string, boolean>>(worker!, KEY_ENABLED_GRAMMAR_RULES),
        ).toEqual({});
      } finally {
        await optionsPage.close();
      }

      optionsPage = await openOptionsPage(browser, worker!);
      try {
        const selector =
          'input[data-setting="enabledGrammarRules"][value="measurementUnitFormatting"]';
        await optionsPage.waitForSelector(selector);
        await optionsPage.waitForFunction(
          (inputSelector) =>
            (document.querySelector(inputSelector) as HTMLInputElement | null)?.checked === true,
          {},
          selector,
        );
        await optionsPage.$eval(selector, (input) => (input as HTMLInputElement).click());

        const storedAfter = await waitForSettingMatch<Record<string, boolean>>(
          worker!,
          KEY_ENABLED_GRAMMAR_RULES,
          (value) => value?.measurementUnitFormatting === false,
          browserTimeout(5000, 10000),
        );
        expect(storedAfter).toEqual({ measurementUnitFormatting: false });
      } finally {
        await optionsPage.close();
      }

      optionsPage = await openOptionsPage(browser, worker!);
      try {
        const selector =
          'input[data-setting="enabledGrammarRules"][value="measurementUnitFormatting"]';
        const readySelector =
          'input[data-setting="enabledGrammarRules"][value="capitalizeSentenceStart"]';
        await optionsPage.waitForSelector(selector);
        await optionsPage.waitForFunction(
          (inputSelector, loadedSelector) => {
            const input = document.querySelector(inputSelector) as HTMLInputElement | null;
            const loaded = document.querySelector(loadedSelector) as HTMLInputElement | null;
            return input?.checked === false && loaded?.checked === true;
          },
          {},
          selector,
          readySelector,
        );
      } finally {
        await optionsPage.close();
      }

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(15000, 25000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Grammar Rule Engine auto-capitalizes and applies spacing in %s",
    async (selector) => {
      // Enable required grammar rules internally for predictive evaluations
      await setGrammarRulesAndWait(worker!, ["capitalizeSentenceStart", "commaPeriodSpacing"]);
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

      // The first word is capitalized once its boundary is typed.
      await element!.type("testing ");
      await waitForInputContentMatch(
        page,
        selector,
        /^Testing[\xA0 ]$/,
        browserTimeout(5000, 8000),
      );

      // A stray space before the period is tidied once the user's own space
      // confirms the sentence end.
      await element!.type(". ");
      await waitForInputContentMatch(
        page,
        selector,
        /^Testing\.[\xA0 ]$/,
        browserTimeout(5000, 8000),
      );

      // The next word is capitalized at its boundary too.
      await element!.type("world ");
      await waitForInputContentMatch(
        page,
        selector,
        /^Testing\.[\xA0 ]World[\xA0 ]$/,
        browserTimeout(5000, 8000),
      );

      const finalVal = await page.$eval(
        selector,
        (el) => ((el as HTMLInputElement).value ?? el.textContent) as string,
      );
      const elementText = finalVal.replace(/\xA0/g, " ");
      expect(elementText).toContain("Testing. World");

      // Cleanup
      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test(
    "Grammar Rule Engine capitalizes the final word when Enter submits without inserting text",
    async () => {
      const selector = "#test-input";
      await setGrammarRulesAndWait(worker!, ["capitalizeSentenceStart"]);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      // Enter has to reach the grammar pass, not the suggestion popup; accepting
      // a suggestion on Enter is covered elsewhere and must keep winning.
      await setSettingAndWait(worker!, KEY_AUTOCOMPLETE_ON_ENTER, false);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page);
      await page.bringToFront();

      await waitForInputReady(page, selector);
      const element = await page.$(selector);

      // A bare text input never turns Enter into text, which is the chat-box
      // submit case: without the keydown pass the word would stay lowercase.
      await element!.type("hello");
      await waitForInputContentMatch(page, selector, /^hello$/, browserTimeout(5000, 8000));

      await page.keyboard.press("Enter");
      await waitForInputContentMatch(page, selector, /^Hello$/, browserTimeout(5000, 8000));

      // Cleanup
      await setSettingAndWait(worker!, KEY_AUTOCOMPLETE_ON_ENTER, true);
      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Grammar Rule Engine respects manual deletion of auto-inserted sentence space in %s",
    async (selector) => {
      await setGrammarRulesAndWaitStable(
        worker!,
        ["commaPeriodSpacing"],
        4,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, []);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
        enableQuill: shouldEnableQuill(selector),
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);
      const element = await page.$(selector);

      await element!.type("This is awsome,");
      await waitForInputContentMatch(
        page,
        selector,
        /This is awsome,[\xA0 ]/,
        browserTimeout(5000, 8000),
      );

      await page.keyboard.press("Backspace");
      const afterDelete = (
        await waitForInputContentEqual(
          page,
          selector,
          "This is awsome,",
          browserTimeout(5000, 8000),
        )
      ).replace(/\xA0/g, " ");
      expect(afterDelete).toBe("This is awsome,");

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test.each(GENERIC_INPUT_SELECTORS)(
    "Grammar Rule Engine preserves attached brackets and slash technical contexts while keeping prose spacing in %s",
    async (selector) => {
      await setGrammarRulesAndWaitStable(
        worker!,
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
      await typeInInput(page, selector, "console.log(");
      await waitForNormalizedValue("console.log(");
      let elementText = await readNormalizedText();
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

      await setGrammarRulesAndWaitStable(worker!, [], 2, browserTimeout(3000, 5000));
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(35000, 55000),
  );

  test(
    "Grammar Rule Engine applies context-aware math operator spacing without breaking prose-like compact forms",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
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

      await setGrammarRulesAndWaitStable(worker!, [], 2, browserTimeout(3000, 5000));
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 45000),
  );

  test(
    "Grammar Rule Engine compacts numeric punctuation spacing and preserves prose continuation",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
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
      // A period is never spaced by the rule: "Hello." may still become
      // "Hello.world". The user's own space confirms the sentence end.
      await typeInInput(page, selector, "Hello.");
      await waitForNormalizedValue("Hello.");
      await typeInInput(page, selector, "world ");
      await waitForNormalizedValue("Hello.world ");

      await clearInputContent(page, selector);
      // capitalizeSentenceStart is not among this test's enabled rules, so the
      // leading word stays as typed; the point here is that the dotted token
      // survives commaPeriodSpacing untouched.
      await typeInInput(page, selector, "go to google.com now ");
      await waitForNormalizedValue("go to google.com now ");

      await clearInputContent(page, selector);
      // Prime an already-authored abbreviation so this isolates typing after its trailing space.
      await page.$eval(selector, (element) => {
        if (!(element instanceof HTMLInputElement)) {
          throw new Error("Expected test input");
        }
        element.value = "9 a.m. ";
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
      });
      await typeInInput(page, selector, "and ");
      await waitForNormalizedValue("9 a.m. and ");

      await setGrammarRulesAndWaitStable(worker!, [], 2, browserTimeout(3000, 5000));
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine formats measurement units only in verified prose typing",
    async () => {
      const selector = "#test-input";
      await setGrammarRulesAndWaitStable(
        worker!,
        ["measurementUnitFormatting"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await applyConfigChange(browser, worker!);
      await gotoTestPage(page, { enableCkEditor: false });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Mass: 10kg ");
      await waitUntil(
        "measurement separator",
        async () => (await getInputContent(page, selector)) === "Mass: 10\u00a0kg ",
        { timeoutMs: browserTimeout(5000, 8000), intervalMs: 50 },
      );

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Path: /tmp/10kg ");
      expect(await getInputContent(page, selector)).toBe("Path: /tmp/10kg ");

      await setSettingAndWait(worker!, KEY_LANGUAGE, "pl_PL");
      await setGrammarRulesAndWaitStable(
        worker!,
        ["measurementUnitFormatting", "commaPeriodSpacing", "mathOperatorSpacing"],
        3,
        browserTimeout(5000, 7000),
      );
      await applyConfigChange(browser, worker!);
      await gotoTestPage(page, { enableCkEditor: false });
      await waitForInputReady(page, selector);
      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Masa: 1,50kg ");
      await waitUntil(
        "Polish decimal measurement",
        async () => (await getInputContent(page, selector)) === "Masa: 1,50\u00a0kg ",
        { timeoutMs: browserTimeout(5000, 8000), intervalMs: 50 },
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");

      await setGrammarRulesAndWaitStable(worker!, [], 2, browserTimeout(3000, 5000));
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine keeps legacy grammar rule IDs compatible in runtime",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
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
      // The first letter is capitalized once the word is complete; "u" may
      // still become "user.save()".
      await typeInInput(page, selector, "t ");
      await waitForInputContentEqual(page, selector, "T ", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "user.save() ");
      await waitForInputContentEqual(page, selector, "user.save() ", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Hello . ");
      await waitForInputContentEqual(page, selector, "Hello. ", browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine capitalizes first letter after line break with granular rule IDs",
    async () => {
      const selector = "#test-textarea";

      await setGrammarRulesAndWaitStable(
        worker!,
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
      await typeInInput(page, selector, "hello\nworld ");
      await waitForInputContentEqual(page, selector, "hello\nWorld ", browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine collapses repeated spaces with granular rule IDs",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
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

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine trims spaces before newline with granular rule IDs",
    async () => {
      const selector = "#test-textarea";

      await setGrammarRulesAndWaitStable(
        worker!,
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

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine still applies grammar when minWordLengthToPredict is -1 with granular rule IDs",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
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
      await typeInInput(page, selector, "Hello . ");
      await waitForInputContentEqual(page, selector, "Hello. ", browserTimeout(5000, 9000));
      try {
        await waitForNoVisibleSuggestions(page, browserTimeout(2000, 5000));
      } catch {
        // Firefox can occasionally keep a stale suggestion popup visible briefly.
        // Dismiss once and verify the popup remains hidden.
        await page.keyboard.press("Escape").catch(() => undefined);
        await waitForNoVisibleSuggestions(page, browserTimeout(2000, 5000));
      }
      const hasPredictions = await hasVisibleSuggestions(page);
      expect(hasPredictions).toBe(false);

      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 40000),
  );

  test(
    "Grammar Rule Engine applies English micro-grammar bundle in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
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
      // A lone "i " could still be a loop variable ("for i in range"), so the
      // capital waits for the word that identifies it as the pronoun.
      await typeInInput(page, selector, "i ");
      await waitForInputContentEqual(page, selector, "i ", browserTimeout(5000, 9000));
      await typeInInput(page, selector, "am here");
      await waitForInputContentEqual(page, selector, "I am here", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "im ");
      await waitForInputContentEqual(page, selector, "I'm ", browserTimeout(5000, 9000));
      await typeInInput(page, selector, "ready");
      await waitForInputContentEqual(page, selector, "I'm ready", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "ID ");
      await waitForInputContentEqual(page, selector, "ID ", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "teh ");
      await waitForInputContentEqual(page, selector, "the ", browserTimeout(5000, 9000));
      await typeInInput(page, selector, "cat");
      await waitForInputContentEqual(page, selector, "the cat", browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Grammar Rule Engine keeps English-only grammar rules inactive for non-English language",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
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
      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Prediction acceptance reverts latest extension change via Cmd/Ctrl+Z in #test-input",
    async () => {
      const selector = "#test-input";

      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setGrammarRulesAndWait(worker!, []);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "th");
      const [firstSuggestion] = await waitForVisibleSuggestionTexts(
        page,
        browserTimeout(5000, 9000),
      );
      expect(firstSuggestion).toBeDefined();

      await page.keyboard.press("Tab");
      await waitForInputContentEqual(page, selector, firstSuggestion!, browserTimeout(5000, 9000));

      await pressNativeUndo(page, selector);
      await waitForInputContentEqual(page, selector, "th", browserTimeout(5000, 9000));
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Grammar Rule Engine reverts latest auto-fix via Cmd/Ctrl+Z in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["englishAlotCorrection"],
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
      await typeInInput(page, selector, "alot ");
      await waitForInputContentEqual(page, selector, "a lot ", browserTimeout(5000, 9000));

      await pressNativeUndo(page, selector);
      await waitForInputContentEqual(page, selector, "alot ", browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Grammar Rule Engine blocks immediate reapply after manual revert until token context changes in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["englishAlotCorrection"],
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
      await typeInInput(page, selector, "alot ");
      await waitForInputContentEqual(page, selector, "a lot ", browserTimeout(5000, 9000));

      await pressNativeUndo(page, selector);
      await waitForInputContentEqual(page, selector, "alot ", browserTimeout(5000, 9000));

      await sleep(400);
      await waitForInputContentEqual(page, selector, "alot ", browserTimeout(5000, 9000));

      await typeInInput(page, selector, "x alot ");
      await waitForInputContentEqual(page, selector, "alot x a lot ", browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Extension undo does not trigger after an intervening user edit in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["englishAlotCorrection"],
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
      await typeInInput(page, selector, "alot ");
      await waitForInputContentEqual(page, selector, "a lot ", browserTimeout(5000, 9000));

      await typeInInput(page, selector, "x");
      await waitForInputContentEqual(page, selector, "a lot x", browserTimeout(5000, 9000));

      await pressNativeUndo(page, selector);
      await waitUntil(
        "intervening edit undo to avoid extension-owned stale revert",
        async () => {
          const currentValue = await getInputContent(page, selector);
          return ["a lot x", "a lot ", "alot "].includes(currentValue) ? currentValue : false;
        },
        {
          timeoutMs: browserTimeout(5000, 9000),
          intervalMs: 50,
        },
      );

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Backspace remains native after accepting a prediction in #test-input",
    async () => {
      const selector = "#test-input";

      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setGrammarRulesAndWait(worker!, []);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "th");
      const [firstSuggestion] = await waitForVisibleSuggestionTexts(
        page,
        browserTimeout(5000, 9000),
      );
      expect(firstSuggestion).toBeDefined();

      await page.keyboard.press("Tab");
      const acceptedValue = await waitForInputContentEqual(
        page,
        selector,
        firstSuggestion!,
        browserTimeout(5000, 9000),
      );
      expect(acceptedValue.length).toBeGreaterThan(1);

      await page.keyboard.press("Backspace");
      await waitForInputContentEqual(
        page,
        selector,
        acceptedValue.slice(0, -1),
        browserTimeout(5000, 9000),
      );
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Backspace remains native after grammar auto-fix in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["englishAlotCorrection"],
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
      await typeInInput(page, selector, "alot ");
      await waitForInputContentEqual(page, selector, "a lot ", browserTimeout(5000, 9000));

      await page.keyboard.press("Backspace");
      await waitForInputContentEqual(page, selector, "a lot", browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Grammar Rule Engine applies V3 safe rules (double-space + alot) in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["doubleSpaceToPeriod", "englishAlotCorrection"],
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
      await typeInInput(page, selector, "alot ");
      await waitForInputContentEqual(page, selector, "a lot ", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Hello  ");
      await waitForInputContentEqual(page, selector, "Hello. ", browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(25000, 45000),
  );

  test(
    "Grammar Rule Engine applies V3 advanced typography shortcuts in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["ellipsisShortcut", "emdashShortcut", "smartQuoteNormalization"],
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
      await typeInInput(page, selector, "...");
      await waitForInputContentEqual(page, selector, "…", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "word--");
      await waitForInputContentEqual(page, selector, "word—", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, '"');
      await waitForInputContentEqual(page, selector, "“", browserTimeout(5000, 9000));

      await clearInputContent(page, selector);
      await typeInInput(page, selector, 'hello"');
      await waitForInputContentEqual(page, selector, "hello”", browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Grammar Rule Engine collapses duplicate punctuation across trailing-space continuation in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["duplicatePunctuationCollapse"],
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
      await typeInInput(page, selector, "It do not work as expected,,, ");
      await waitForInputContentEqual(
        page,
        selector,
        "It do not work as expected, ",
        browserTimeout(5000, 9000),
      );

      await typeInInput(page, selector, ",");
      await waitForInputContentEqual(
        page,
        selector,
        "It do not work as expected, ",
        browserTimeout(5000, 9000),
      );

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Grammar Rule Engine collapses duplicate punctuation across trailing-space continuation in #test-contenteditable",
    async () => {
      const selector = "#test-contenteditable";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["duplicatePunctuationCollapse"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
        enableQuill: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "This is awseome,, ");
      await waitForInputContentMatch(
        page,
        selector,
        /^This is awseome,[ \xa0]$/,
        browserTimeout(5000, 9000),
      );

      await typeInInput(page, selector, " ,");
      await waitForInputContentMatch(
        page,
        selector,
        /^This is awseome,[ \xa0]$/,
        browserTimeout(5000, 9000),
      );

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "This is,,,,,,,,,,,, ");
      await waitForInputContentMatch(
        page,
        selector,
        /^This is,[ \xa0]$/,
        browserTimeout(5000, 9000),
      );

      await typeInInput(page, selector, ",");
      await waitForInputContentMatch(
        page,
        selector,
        /^This is,[ \xa0]$/,
        browserTimeout(5000, 9000),
      );

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Grammar Rule Engine avoids repeated comma-space bursts on rapid comma typing in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["commaPeriodSpacing", "duplicatePunctuationCollapse"],
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
      await typeInInput(page, selector, "What the fewer ");
      await typeInInput(page, selector, ",,,,,,,,,,");
      await waitForInputContentEqual(
        page,
        selector,
        "What the fewer, ",
        browserTimeout(5000, 9000),
      );

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Grammar Rule Engine keeps V3 advanced shortcuts inactive for URL and Markdown code contexts in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["ellipsisShortcut", "emdashShortcut", "smartQuoteNormalization"],
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
      await typeInInput(page, selector, "https://example.com...");
      await waitForInputContentEqual(
        page,
        selector,
        "https://example.com...",
        browserTimeout(5000, 9000),
      );

      await clearInputContent(page, selector);
      await typeInInput(page, selector, "https://example.com--");
      await waitForInputContentEqual(
        page,
        selector,
        "https://example.com--",
        browserTimeout(5000, 9000),
      );

      await clearInputContent(page, selector);
      await typeInInput(page, selector, 'Run `s = "');
      await waitForInputContentEqual(page, selector, 'Run `s = "', browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Grammar Rule Engine keeps V3 English safe rules inactive for non-English language in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        [
          "englishModalOfCorrection",
          "englishYourWelcomeCorrection",
          "englishTheirThereBeVerb",
          "englishAlotCorrection",
          "englishPronounVerbWhitelistAgreement",
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
      await typeInInput(page, selector, "alot could of your welcome their is I is ");
      await waitForInputContentEqual(
        page,
        selector,
        "alot could of your welcome their is I is ",
        browserTimeout(5000, 9000),
      );

      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Grammar Rule Engine auto-closes brackets and places cursor between them in #test-input",
    async () => {
      const selector = "#test-input";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["autoBracketClose"],
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

      // Test auto-close for parentheses: typing "(" should produce "()"
      await clearInputContent(page, selector);
      await typeInInput(page, selector, "hello (");
      await waitForInputContentEqual(page, selector, "hello ()", browserTimeout(5000, 9000));

      // Verify cursor is BETWEEN the brackets by typing a character:
      // if cursor is inside "(|)", typing "x" produces "(x)".
      // if cursor is at end "()|", typing "x" produces "()x".
      await typeInInput(page, selector, "x");
      await waitForInputContentEqual(page, selector, "hello (x)", browserTimeout(5000, 9000));

      // Test auto-close for double quotes
      await clearInputContent(page, selector);
      await typeInInput(page, selector, 'say "');
      await waitForInputContentEqual(page, selector, 'say ""', browserTimeout(5000, 9000));

      await typeInInput(page, selector, "hi");
      await waitForInputContentEqual(page, selector, 'say "hi"', browserTimeout(5000, 9000));

      // Test overtype: typing closing bracket when it's already ahead should skip over
      await clearInputContent(page, selector);
      await typeInInput(page, selector, "test (");
      await waitForInputContentEqual(page, selector, "test ()", browserTimeout(5000, 9000));
      await typeInInput(page, selector, "ok");
      await waitForInputContentEqual(page, selector, "test (ok)", browserTimeout(5000, 9000));
      await typeInInput(page, selector, ")");
      await waitForInputContentEqual(page, selector, "test (ok)", browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Grammar Rule Engine auto-closes brackets in #test-contenteditable",
    async () => {
      const selector = "#test-contenteditable";

      await setGrammarRulesAndWaitStable(
        worker!,
        ["autoBracketClose"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: false,
        enableQuill: false,
      });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      // Auto-close parentheses
      await clearInputContent(page, selector);
      await typeInInput(page, selector, "hello (");
      await waitForInputContentMatch(page, selector, /^hello \(\)$/, browserTimeout(5000, 9000));

      // Verify cursor position: typing after auto-close should insert between
      // brackets. Plain contenteditable repositions the caret synchronously, so
      // an immediate keystroke must land inside the brackets (no settle needed).
      await typeInInput(page, selector, "x");
      await waitForInputContentMatch(page, selector, /^hello \(x\)$/, browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Grammar Rule Engine auto-closes brackets in Lexical editor",
    async () => {
      const selector = LEXICAL_SELECTOR;

      await setGrammarRulesAndWaitStable(
        worker!,
        ["autoBracketClose"],
        3,
        browserTimeout(5000, 7000),
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
      await applyConfigChange(browser, worker!);

      await gotoTestPage(page, { enableLexical: true });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      await page.focus(selector);
      await page.keyboard.type("hello (");
      await waitForInputContentMatch(page, selector, /^hello \(\)$/, browserTimeout(5000, 9000));

      // Wait for deferred cursor repositioning (rAF + setTimeout in content script)
      await sleep(200);

      // Verify cursor is between brackets by typing a character:
      // if cursor is inside "(|)", typing "x" produces "(x)".
      await page.keyboard.type("x");
      await waitForInputContentMatch(page, selector, /^hello \(x\)$/, browserTimeout(5000, 9000));

      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
    },
    browserTimeout(30000, 50000),
  );

  // ------------------------------------------------------------ review mode

  // Synthetic demo text: known errors in every category, a deliberately correct
  // technical name (GitHub) and inline code that must never change.
  const REVIEW_DEMO =
    "i think teh GitHub release is ready , but their is one problem. We could of shipped on monday with alot of fixes. Run `teh build` first.";
  const REVIEW_DEMO_FIXED =
    "I think the GitHub release is ready, but there is one problem. We could have shipped on Monday with a lot of fixes. Run `teh build` first.";

  async function prepareReviewPage(
    options: { enableQuill?: boolean; enableLexical?: boolean; enableProseMirror?: boolean } = {},
  ) {
    await setGrammarRulesAndWaitStable(
      worker!,
      DEFAULT_CURRENT_GRAMMAR_RULES,
      3,
      browserTimeout(5000, 7000),
    );
    await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
    await applyConfigChange(browser, worker!);
    await gotoTestPage(page, { enableCkEditor: false, ...options });
    await page.bringToFront();
    await waitForInputReady(page, "#test-textarea");
  }

  async function applyIndividualReviewFix(text: string) {
    let panel = await readReviewPanel(page);
    if (panel.card.open) {
      await page.keyboard.press("Escape");
      panel = await waitForReview(page, "card closed before individual fix", (p) => !p.card.open);
    }
    const item = panel.items.find((finding) => finding.text === text);
    if (!item) throw new Error(`Missing Review finding: ${text}`);
    await clickReviewControl(page, `.item[data-id="${item.id}"]`);
    await waitForReview(page, "individual fix card", (p) => p.card.open);
    await clickReviewControl(page, ".card [data-action=apply]");
    return waitForReview(
      page,
      "individual fix completed",
      (p) =>
        /Issues:|All found issues|No issues found/.test(p.status) &&
        p.items.filter((finding) => finding.text === text).length <
          panel.items.filter((finding) => finding.text === text).length,
    );
  }

  test(
    "Apply All uses one native rich-text transaction with Undo and redo",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      const before = "<p><b>We saw teh cat and teh dog and teh bird.</b></p>";
      const after = before.replaceAll("teh", "the");
      await page.$eval(
        selector,
        (root, html) => {
          root.innerHTML = html;
          (root as HTMLElement).focus();
        },
        before,
      );
      await triggerReview(worker!);
      await waitForReview(
        page,
        "native batch ready",
        (p) => p.fixAll.text === "Fix all safe (3)" && !p.fixAll.disabled,
      );
      await clickReviewControl(page, "[data-action=fix-all]");
      await waitForReview(page, "native batch complete", (p) =>
        p.status.startsWith("All found issues"),
      );
      expect(await page.$eval(selector, (root) => root.innerHTML)).toBe(after);
      await pressNativeUndo(page, selector);
      await waitUntil(
        "native batch one-step Undo",
        async () => (await page.$eval(selector, (root) => root.innerHTML)) === before,
        { timeoutMs: 5000 },
      );
      await pressNativeRedo(page);
      await waitUntil(
        "native batch redo",
        async () => (await page.$eval(selector, (root) => root.innerHTML)) === after,
        { timeoutMs: 5000 },
      );
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Native rich-text batches preserve whitespace and refuse noneditable islands",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      for (const island of [false, true]) {
        const before =
          "<p>We saw teh  cat and teh\t dog. 🙂 é&nbsp; " +
          (island ? '<span contenteditable="false">@Ann</span>' : "") +
          "We saw teh bird. <code>teh build</code></p>";
        await page.$eval(
          selector,
          (root, html) => {
            (root as HTMLElement).style.whiteSpace = "pre-wrap";
            root.innerHTML = html;
            (root as HTMLElement).focus();
          },
          before,
        );
        await triggerReview(worker!);
        await waitForReview(
          page,
          "protected batch ready",
          (p) => p.fixAll.text === "Fix all safe (3)" && !p.fixAll.disabled,
        );
        await clickReviewControl(page, "[data-action=fix-all]");
        await waitForReview(page, "protected batch result", (p) =>
          island
            ? p.status.includes("The editor refused the change.")
            : p.status.startsWith("Fixed: 3."),
        );
        const after = before
          .replaceAll("teh", "the")
          .replace("<code>the build</code>", "<code>teh build</code>");
        expect(await page.$eval(selector, (root) => root.innerHTML)).toBe(island ? before : after);
        if (!island) {
          await pressNativeUndo(page, selector);
          await waitUntil(
            "whitespace batch Undo",
            async () => (await page.$eval(selector, (root) => root.innerHTML)) === before,
            { timeoutMs: 5000 },
          );
        }
        await page.keyboard.press("Escape");
      }
      await page.$eval(selector, (root) =>
        (root as HTMLElement).style.removeProperty("white-space"),
      );
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Native batches preserve lists, outside nodes and preceding typing",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      await page.$eval(selector, (root) => {
        root.innerHTML =
          '<p id="keep">Keep this.</p><ul><li>Keep this item.</li><li><a href="/keep">We saw teh cat and teh dog.</a></li></ul><p id="footer">Keep this too.</p>';
        (root as HTMLElement & { originalNode?: Element | null }).originalNode =
          root.firstElementChild;
        (root as HTMLElement).focus();
        const last = root.querySelector("li:last-child")!;
        document.getSelection()!.collapse(last, last.childNodes.length);
      });
      await page.keyboard.type(" More.");
      const html = () => page.$eval(selector, (root) => root.innerHTML);
      const before = await html();
      await triggerReview(worker!);
      await waitForReview(
        page,
        "list batch ready",
        (p) => p.fixAll.text === "Fix all safe (2)" && !p.fixAll.disabled,
      );
      await clickReviewControl(page, "[data-action=fix-all]");
      await waitForReview(page, "list batch complete", (p) =>
        p.status.startsWith("All found issues"),
      );
      expect(await html()).toBe(before.replaceAll("teh", "the"));
      expect(
        await page.$eval(
          selector,
          (root) =>
            root.firstElementChild ===
            (root as HTMLElement & { originalNode?: Element }).originalNode,
        ),
      ).toBe(true);
      await pressNativeUndo(page, selector);
      await waitUntil("batch Undo retains prior typing", async () => (await html()) === before, {
        timeoutMs: 5000,
      });
      await pressNativeRedo(page);
      await waitUntil(
        "list batch redo",
        async () => (await html()) === before.replaceAll("teh", "the"),
        { timeoutMs: 5000 },
      );
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Native batch refusal preserves direct listeners and host state on untouched inline nodes",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      for (const [before, count] of [
        ["<p>We saw teh <span>cat</span> and teh dog.</p>", 2],
        ["<p>We saw teh <a>cat</a> and teh dog.</p>", 2],
        ["<p>We saw <span>te</span><span>h</span> cat.</p>", 1],
      ] as const) {
        await page.$eval(
          selector,
          (root, html) => {
            root.innerHTML = html;
            const node = root.querySelector("span,a") as HTMLElement;
            const state = { clicks: 0 };
            Object.assign(node, { hostState: state });
            node.addEventListener("click", () => {
              state.clicks += 1;
            });
            Object.assign(root, { stateNode: node });
            (root as HTMLElement).focus();
          },
          before,
        );
        await triggerReview(worker!);
        await waitForReview(
          page,
          "stateful batch ready",
          (p) => p.fixAll.text === `Fix all safe (${count})` && !p.fixAll.disabled,
        );
        await clickReviewControl(page, "[data-action=fix-all]");
        await waitForReview(page, "stateful batch refused", (p) =>
          p.status.includes("The editor refused the change."),
        );
        expect(await page.$eval(selector, (root) => root.innerHTML)).toBe(before);
        expect(
          await page.$eval(selector, (root) => {
            const node = root.querySelector("span,a") as HTMLElement & {
              hostState: { clicks: number };
            };
            node.click();
            return {
              same: node === (root as HTMLElement & { stateNode?: Element }).stateNode,
              clicks: node.hostState.clicks,
            };
          }),
        ).toEqual({ same: true, clicks: 1 });
        await page.keyboard.press("Escape");
      }
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Apply All uses one Quill Delta with formatting, protected code, Undo and redo",
    async () => {
      await prepareReviewPage({ enableQuill: true });
      await waitForInputReady(page, QUILL_SELECTOR);
      const before = [
        { insert: "We saw teh cat " },
        {
          insert: {
            image: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          },
        },
        { insert: " and " },
        { insert: "teh", attributes: { bold: true } },
        { insert: " dog and " },
        { insert: "teh", attributes: { link: "https://example.invalid/" } },
        { insert: " bird.\nRun " },
        { insert: "teh build é", attributes: { code: true } },
        { insert: " carefully. 👨‍👩‍👧\n" },
      ];
      await page.evaluate((ops) => {
        const quill = (window as typeof window & { __testQuill: Quill }).__testQuill;
        quill.setContents(ops);
        quill.history.clear();
        quill.focus();
        quill.setSelection(quill.getLength() - 1, 0);
      }, before);
      const contents = () =>
        page.evaluate(
          () => (window as typeof window & { __testQuill: Quill }).__testQuill.getContents().ops,
        );
      await page.keyboard.type(" More.");
      const original = await contents();
      await triggerReview(worker!);
      await waitForReview(
        page,
        "Quill batch ready",
        (p) => p.fixAll.text === "Fix all safe (3)" && !p.fixAll.disabled,
      );
      await clickReviewControl(page, "[data-action=fix-all]");
      await waitForReview(page, "Quill batch complete", (p) =>
        p.status.startsWith("All found issues"),
      );
      const after = original.map((op) => ({
        ...op,
        insert:
          op.attributes?.code || typeof op.insert !== "string"
            ? op.insert
            : op.insert.replaceAll("teh", "the"),
      }));
      expect(await contents()).toEqual(after);
      await pressNativeUndo(page, QUILL_SELECTOR);
      await waitUntil(
        "Quill batch one-step Undo",
        async () => JSON.stringify(await contents()) === JSON.stringify(original),
        { timeoutMs: 5000 },
      );
      await pressNativeRedo(page);
      await waitUntil(
        "Quill batch redo",
        async () => JSON.stringify(await contents()) === JSON.stringify(after),
        { timeoutMs: 5000 },
      );
      await page.keyboard.type("X");
      expect(JSON.stringify(await contents())).toContain("the");
      expect(
        await page.$eval(QUILL_SELECTOR, (root) => root.querySelector("code")?.textContent),
      ).toBe("teh build é");
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Quill bridge refuses fields made ineligible by a page capture listener",
    async () => {
      await prepareReviewPage({ enableQuill: true });
      await waitForInputReady(page, QUILL_SELECTOR);
      for (const [attribute, value] of [
        ["inert", ""],
        ["aria-readonly", "true"],
        ["autocomplete", "cc-number"],
        ["hidden", ""],
        ["aria-hidden", "true"],
        ["style", "visibility:hidden"],
        ["style", "display:none"],
      ]) {
        await page.evaluate(() => {
          const quill = (window as typeof window & { __testQuill: Quill }).__testQuill;
          for (const name of [
            "inert",
            "aria-readonly",
            "autocomplete",
            "hidden",
            "aria-hidden",
            "style",
            "data-test-race",
          ])
            quill.root.removeAttribute(name);
          quill.setText("We saw teh cat.\n");
          quill.history.clear();
          quill.focus();
        });
        await triggerReview(worker!);
        await waitForReview(
          page,
          "Quill eligibility race ready",
          (p) => p.fixAll.text === "Fix all safe (1)" && !p.fixAll.disabled,
        );
        await page.evaluate(
          ({ eventName, requestAttribute, attribute, value }) => {
            const listener = (event: Event) => {
              const root = event.target as HTMLElement;
              const request = JSON.parse(root.getAttribute(requestAttribute) ?? "{}");
              if (request.action !== "applyQuill") return;
              window.removeEventListener(eventName, listener, true);
              root.setAttribute(attribute, value);
              root.dataset.testRace = "fired";
            };
            window.addEventListener(eventName, listener, true);
          },
          {
            eventName: HOST_EDITOR_REQUEST_EVENT,
            requestAttribute: HOST_EDITOR_REQUEST_ATTR,
            attribute,
            value,
          },
        );
        await clickReviewControl(page, "[data-action=fix-all]");
        await waitForReview(
          page,
          "Quill eligibility race refused",
          (p) => p.status === "This field can't be reviewed.",
        );
        expect(
          await page.evaluate(() => {
            const quill = (window as typeof window & { __testQuill: Quill }).__testQuill;
            return {
              text: quill.getText(),
              html: quill.root.innerHTML,
              fired: quill.root.dataset.testRace,
              history: quill.history.stack.undo.length,
            };
          }),
        ).toEqual({
          text: "We saw teh cat.\n",
          html: "<p>We saw teh cat.</p>",
          fired: "fired",
          history: 0,
        });
        await page.keyboard.press("Escape");
      }
      await page.$eval(QUILL_SELECTOR, (root) => {
        for (const name of [
          "inert",
          "aria-readonly",
          "autocomplete",
          "hidden",
          "aria-hidden",
          "style",
          "data-test-race",
        ])
          root.removeAttribute(name);
      });
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Quill reconciliation detects formatting changed after bridge verification",
    async () => {
      await prepareReviewPage({ enableQuill: true });
      await waitForInputReady(page, QUILL_SELECTOR);
      await page.evaluate(() => {
        const quill = (window as typeof window & { __testQuill: Quill }).__testQuill;
        quill.setText("We saw teh cat.\n");
        quill.history.clear();
        quill.focus();
      });
      await triggerReview(worker!);
      await waitForReview(
        page,
        "Quill formatting race ready",
        (p) => p.fixAll.text === "Fix all safe (1)" && !p.fixAll.disabled,
      );
      await page.evaluate(
        ({ eventName, requestAttribute }) => {
          const listener = (event: Event) => {
            const root = event.target as HTMLElement;
            const request = JSON.parse(root.getAttribute(requestAttribute) ?? "{}");
            if (request.action !== "applyQuill") return;
            window.removeEventListener(eventName, listener);
            const quill = (window as typeof window & { __testQuill: Quill }).__testQuill;
            quill.formatText(0, 2, "bold", true, "user");
          };
          window.addEventListener(eventName, listener);
        },
        { eventName: HOST_EDITOR_REQUEST_EVENT, requestAttribute: HOST_EDITOR_REQUEST_ATTR },
      );
      await clickReviewControl(page, "[data-action=fix-all]");
      await waitForReview(page, "Quill formatting race detected", (p) =>
        p.status.startsWith(
          "The editor didn't confirm the change. Check the text; nothing was retried.",
        ),
      );
      expect(
        await page.evaluate(() => {
          const quill = (window as typeof window & { __testQuill: Quill }).__testQuill;
          return { text: quill.getText(), bold: quill.getFormat(0, 2).bold };
        }),
      ).toEqual({ text: "We saw the cat.\n", bold: true });
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  async function finishReview() {
    await page.keyboard.press("Escape").catch(() => undefined);
    await setGrammarRulesAndWait(worker!, []);
    await applyConfigChange(browser, worker!);
  }

  async function setTextarea(value: string, selection: [number, number] = [0, 0]) {
    await page.evaluate(
      (valueInner, [start, end]) => {
        const field = document.querySelector("#test-textarea") as HTMLTextAreaElement;
        field.value = valueInner;
        field.focus();
        field.setSelectionRange(start, end);
      },
      value,
      selection,
    );
  }

  const textareaValue = () =>
    page.$eval("#test-textarea", (el) => (el as HTMLTextAreaElement).value);

  test("Word Review reads its model, highlights, batches fixes and rechecks model changes", async () => {
    await prepareReviewPage();
    // Page-only API: the isolated content script must use the production MAIN-world bridge.
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "WACViewPanel";
      host.innerHTML =
        '<div class="Header InactiveBoxRendering"><p class="Paragraph">We saw teh cat and teh dog.</p></div><p class="Paragraph"><b>We saw teh cat and teh dog.</b></p><div class="Footer InactiveBoxRendering"><p class="Paragraph"> </p></div><div id="WACViewPanel_EditingElement" contenteditable="true" tabindex="0" style="height:24px"></div>';
      const container = document.createElement("div");
      container.id = "EditorContainer";
      container.append(host);
      document.body.prepend(container);
      const empty = { length: () => 0 };
      let transactionActive = false;
      let commit: (() => void)[] = [];
      const history: string[] = [];
      host.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "z" && history.length) {
          event.preventDefault();
          paragraph.text = history.pop()!;
          host.querySelector("b")!.textContent = paragraph.text;
        }
      });
      const paragraph = {
        text: "We saw teh cat and teh dog.",
        uniqueLocalId: "word-paragraph-1",
        fields: empty,
        contentControls: empty,
        inlinePictures: empty,
        footnotes: empty,
        endnotes: empty,
        parentContentControlOrNullObject: { isNullObject: true },
        getRange() {
          return range;
        },
        getSubrange(start: number, length: number) {
          return {
            get text() {
              return paragraph.text.slice(start, start + length);
            },
            insertText(text: string, location: number) {
              if (location !== 4 || !transactionActive) throw new Error("invalid native write");
              commit.push(() => {
                paragraph.text =
                  paragraph.text.slice(0, start) + text + paragraph.text.slice(start + length);
                host.querySelector("b")!.textContent = paragraph.text;
              });
            },
          };
        },
      };
      const range = {
        isEmpty: true,
        text: "",
        getRange() {
          return this;
        },
        expandTo() {
          return this;
        },
      };
      const body = {
        type: 0,
        get text() {
          return paragraph.text;
        },
        paragraphs: { length: () => 1, getFirst: () => paragraph },
        getRange: () => range,
      };
      (window as Window & { WordEditor?: unknown }).WordEditor = {
        Extension: {
          AutomationTransaction: class {
            constructor() {
              transactionActive = true;
            }
            dispose() {
              transactionActive = false;
              if (commit.length) history.push(paragraph.text);
              commit.forEach((write) => write());
              commit = [];
            }
          },
          AutomationUtility: {
            getDocument: () => ({
              changeTrackingMode: 0,
              body,
              getSelection: () => ({ ...range, parentBody: body }),
            }),
          },
        },
      };
      document.getElementById("WACViewPanel_EditingElement")!.focus();
    });
    await triggerReview(worker!);
    const panel = await waitForReview(
      page,
      "Word model findings",
      (p) => p.items.filter((item) => item.text === "teh → the").length === 2,
    );
    expect(panel.fixAll.hidden || panel.fixAll.disabled).toBe(false);
    expect(panel.marks.length).toBeGreaterThan(0);
    const finding = panel.items.filter((item) => item.text === "teh → the")[1];
    await clickReviewControl(page, `.item[data-id="${finding.id}"]`);
    await waitForReview(page, "Word individual card", (p) => p.card.open && !p.card.applyDisabled);
    // Caret/selection repainting changes the DOM continually, but not the text.
    // An animation frame lets each mutation observer run; no fixed sleep.
    await page.evaluate(async () => {
      const host = document.getElementById("WACViewPanel")!;
      for (let i = 0; i < 12; i++) {
        host.classList.toggle("word-caret-blink");
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    });
    expect((await readReviewPanel(page)).card.open).toBe(true);
    expect((await readReviewPanel(page)).status).toBe("Issues: 2");
    await clickReviewControl(page, '.card [data-action="apply"]');
    const value = () => page.$eval("#EditorContainer b", (el) => el.textContent);
    await waitUntil(
      "Word exact model replacement",
      async () => (await value()) === "We saw teh cat and the dog.",
    );
    expect(await page.$eval("#WACViewPanel_EditingElement", (el) => el.textContent)).toBe("");
    expect(
      await page.$eval("#WACViewPanel_EditingElement", (el) =>
        el.hasAttribute("data-fluenttyper-managed"),
      ),
    ).toBe(false);
    expect(await page.$$("[data-fluenttyper-field-icon]")).toHaveLength(0);
    await waitForReview(page, "Word remaining issue", (p) =>
      p.items.some((item) => item.text === "teh → the"),
    );
    // A collaborator changes only the model; polling must invalidate the visible finding.
    await page.evaluate(() => {
      const win = window as Window & {
        WordEditor?: {
          Extension: {
            AutomationUtility: {
              getDocument(): { body: { paragraphs: { getFirst(): { text: string } } } };
            };
          };
        };
      };
      win.WordEditor!.Extension.AutomationUtility.getDocument().body.paragraphs.getFirst().text =
        "We saw the cat and the dog.";
    });
    await waitForReview(
      page,
      "Word collaborator change",
      (p) => p.items.length === 0 && p.status === "All found issues are resolved. Fixed: 1.",
    );
    expect(await value()).toBe("We saw teh cat and the dog."); // Rendered DOM was intentionally unchanged.
    // Restore two findings through the page model, then exercise the real Fix all UI.
    await page.evaluate(() => {
      const win = window as Window & {
        WordEditor?: {
          Extension: {
            AutomationUtility: {
              getDocument(): { body: { paragraphs: { getFirst(): { text: string } } } };
            };
          };
        };
      };
      win.WordEditor!.Extension.AutomationUtility.getDocument().body.paragraphs.getFirst().text =
        "We saw teh cat and teh dog.";
      document.querySelector("#EditorContainer b")!.textContent = "We saw teh cat and teh dog.";
    });
    await waitForReview(
      page,
      "Word batch ready",
      (p) => p.items.length === 2 && !p.fixAll.disabled,
    );
    await clickReviewControl(page, "[data-action=fix-all]");
    await waitUntil(
      "Word batch applied",
      async () => (await value()) === "We saw the cat and the dog.",
    );
    await pressNativeUndo(page, "#WACViewPanel_EditingElement");
    await waitUntil(
      "Word single transaction undo",
      async () => (await value()) === "We saw teh cat and teh dog.",
    );
    await finishReview();
  }, 30000);

  test(
    "FT-INV-1/5 Review keeps real React controlled inputs synchronized with native undo and submission",
    async () => {
      await prepareReviewPage();
      await page.addScriptTag({
        url: new URL("test-react-controlled-editor.js", domainTestUrl).href,
      });
      for (const kind of ["input", "textarea"] as const) {
        const selector = `#test-react-${kind}`;
        await waitForInputReady(page, selector);
        await page.focus(selector);
        await page.keyboard.type("We is ready.");
        await triggerReview(worker!);
        const panel = await waitForReview(page, "React finding", (p) => p.items.length > 0);
        await clickReviewControl(page, `.item[data-id="${panel.items[0].id}"]`);
        await waitForReview(page, "React correction card", (p) => p.card.open);
        await clickReviewControl(page, ".card [data-action=apply]");
        const snapshot = () =>
          page.evaluate((key) => {
            const field = document.querySelector(`#test-react-${key}`) as HTMLInputElement;
            return { visible: field.value, model: window.__testReactControlled[key] };
          }, kind);
        await waitUntil(
          "React state matches native correction",
          async () =>
            JSON.stringify(await snapshot()) ===
            JSON.stringify({ visible: "We are ready.", model: "We are ready." }),
          { timeoutMs: 5000 },
        );
        await pressNativeUndo(page, selector);
        await waitUntil(
          "React native undo",
          async () => (await snapshot()).model === "We is ready.",
          { timeoutMs: 5000 },
        );
        await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
        await page.keyboard.down("Shift");
        await page.keyboard.press(
          "z",
          process.platform === "darwin" ? { commands: ["Redo"] } : undefined,
        );
        await page.keyboard.up("Shift");
        await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
        await waitUntil(
          "React native redo",
          async () => (await snapshot()).model === "We are ready.",
          { timeoutMs: 5000 },
        );
        await page.keyboard.press("Escape");
      }
      await page.$eval("#test-react-form", (form) => (form as HTMLFormElement).requestSubmit());
      const state = await page.evaluate(() => window.__testReactControlled);
      expect(JSON.parse(state.submitted)).toEqual({ input: state.input, textarea: state.textarea });
      expect(state.inputEvents).toBeGreaterThan(0);
      expect(state.beforeInputEvents).toBeGreaterThan(0);
      await finishReview();
    },
    browserTimeout(50000, 70000),
  );

  test(
    "FT-INV-1/4/5 concurrent large contenteditable Review preserves host text and converges",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      const prefix = "This paragraph is ready. ".repeat(420);
      const source = prefix + "We saw teh cat. ".repeat(9);
      const visible = () => page.$eval(selector, (el) => el.textContent ?? "");
      await page.evaluate((value) => {
        const root = document.querySelector("#test-contenteditable") as HTMLElement;
        root.textContent = value;
        root.focus();
        const form = document.createElement("form");
        form.id = "stress-form";
        const hidden = document.createElement("input");
        hidden.name = "draft";
        hidden.value = value;
        form.append(hidden);
        document.body.append(form);
        root.addEventListener("input", () => {
          hidden.value = root.textContent ?? "";
        });
      }, source);
      await triggerReview(worker!);
      await waitForReview(
        page,
        "large findings",
        (p) => p.items.filter((i) => i.text === "teh → the").length === 9,
      );
      // Host re-render plus new typing while the existing review is active.
      const edited = "Yesterday 😀 e\u0301. " + source;
      await page.evaluate((value) => {
        const root = document.querySelector("#test-contenteditable")!;
        const span = document.createElement("span");
        span.textContent = value;
        root.replaceChildren(span);
        const range = document.createRange();
        range.selectNodeContents(span);
        range.collapse(false);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      }, edited);
      let panel = await waitForReview(
        page,
        "rerender rechecked",
        (p) =>
          p.items.filter((i) => i.text === "teh → the").length === 9 && p.status.includes("Issues"),
      );
      let expected = edited;
      for (const index of [6, 1, 5, 0]) {
        const findings = panel.items.filter((i) => i.text === "teh → the");
        await clickReviewControl(page, `.item[data-id="${findings[index].id}"]`);
        await waitForReview(page, "stress card", (p) => p.card.open);
        await clickReviewControl(page, ".card [data-action=apply]");
        let occurrence = -1;
        let start = -1;
        do {
          start = expected.indexOf("teh", start + 1);
          occurrence++;
        } while (occurrence < index);
        expected = expected.slice(0, start) + "the" + expected.slice(start + 3);
        await waitUntil("random occurrence corrected", async () => (await visible()) === expected, {
          timeoutMs: 5000,
        });
        panel = await waitForReview(
          page,
          "stress refreshed",
          (p) => p.items.filter((i) => i.text === "teh → the").length === findings.length - 1,
        );
        if (panel.card.open) {
          await page.keyboard.press("Escape");
          panel = await waitForReview(page, "stress card closed", (p) => !p.card.open && p.open);
        }
      }
      const beforeUndo = expected;
      await pressNativeUndo(page, selector);
      await waitUntil("stress undo changes text", async () => (await visible()) !== beforeUndo, {
        timeoutMs: 5000,
      });
      const undone = await visible();
      expect(undone.replaceAll("teh", "the")).toBe(edited.replaceAll("teh", "the"));
      await page.focus(selector);
      await page.$eval(selector, (root) => {
        const range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      });
      await page.keyboard.type(" Done.");
      const afterTyping = await visible();
      await waitForReview(
        page,
        "stress undo and typing rechecked",
        (p) => p.status.includes("Issues") && !p.fixAll.hidden,
      );
      for (
        let remaining = (await readReviewPanel(page)).items.filter(
          (i) => i.text === "teh → the",
        ).length;
        remaining > 0;
        remaining -= 1
      )
        await applyIndividualReviewFix("teh → the");
      await waitUntil(
        "stress fixes converge",
        async () => (await visible()) === afterTyping.replaceAll("teh", "the"),
        { timeoutMs: 5000 },
      ).catch(async (cause) => {
        throw new Error(
          `Stress fix mismatch ${JSON.stringify({ actual: await visible(), expected: afterTyping.replaceAll("teh", "the"), panel: await readReviewPanel(page) })}`,
          { cause },
        );
      });
      await page.keyboard.press("Escape");
      await triggerReview(worker!);
      await waitForReview(
        page,
        "stress no reversed corrections",
        (p) => p.items.every((i) => i.text !== "teh → the") && p.status !== "Reviewing…",
      );
      const submitted = await page.$eval("#stress-form", (form) =>
        new FormData(form as HTMLFormElement).get("draft"),
      );
      expect(submitted).toBe(await visible());
      await finishReview();
    },
    browserTimeout(60000, 90000),
  );

  test(
    "Review mode reviews a textarea read-only, paints categorized marks and fixes all safe issues as one undo step",
    async () => {
      await prepareReviewPage();
      await setTextarea(REVIEW_DEMO);
      const requests: string[] = [];
      page.on("request", (request) => {
        if (!request.url().endsWith("/favicon.ico")) requests.push(request.url());
      });

      await triggerReview(worker!);
      const panel = await waitForReview(page, "textarea findings", (p) =>
        /^Issues: \d+$/.test(p.status),
      );
      // Starting a review changes nothing.
      expect(await textareaValue()).toBe(REVIEW_DEMO);
      expect(panel.items.map((item) => item.text)).toEqual([
        "i → I",
        "teh → the",
        "␣, → ,",
        "their is → there is",
        "could of → could have",
        "monday → Monday",
        "alot → a␣lot",
      ]);
      expect(new Set(panel.marks.map((mark) => mark.category))).toEqual(
        new Set(["spelling", "grammar", "punctuation", "typography"]),
      );
      expect(panel.marks).toHaveLength(panel.items.length);
      expect(panel.notes).toContain("Skipped as code or protected text: 11 characters.");
      expect(panel.fixAll).toMatchObject({ text: "Fix all safe (7)", disabled: false });

      await clickReviewControl(page, "[data-action=fix-all]");
      await waitUntil("fixed textarea", async () => (await textareaValue()) === REVIEW_DEMO_FIXED, {
        timeoutMs: 5000,
      });
      await waitForReview(
        page,
        "all resolved",
        (p) => p.status === "All found issues are resolved. Fixed: 7.",
      );

      // One native undo step restores the text as it was.
      await pressNativeUndo(page, "#test-textarea");
      await waitUntil("undone batch", async () => (await textareaValue()) === REVIEW_DEMO, {
        timeoutMs: 5000,
      });
      // Review is fully offline.
      expect(requests).toEqual([]);
      await finishReview();
    },
    browserTimeout(40000, 60000),
  );

  test(
    "Review native grammar applies individual edits with native undo",
    async () => {
      for (const [source, expected, highlight] of [
        ["I opened the the report.", "I opened the report.", "the␣the → the"],
        ["Did she went home?", "Did she go home?", "Did she went → Did she go"],
        [
          "This version is faster then the old version.",
          "This version is faster than the old version.",
          "then → than",
        ],
        ["They forgot there own password.", "They forgot their own password.", "there → their"],
        ["Your going to like this.", "You're going to like this.", "Your → You're"],
        ["The box is to heavy to lift.", "The box is too heavy to lift.", "to → too"],
        ["One of the device failed.", "One of the devices failed.", "device → devices"],
        [
          "We found two error in the report.",
          "We found two errors in the report.",
          "error → errors",
        ],
        ["Those file are missing.", "Those files are missing.", "file → files"],
        ["I have went through the report.", "I have gone through the report.", "went → gone"],
        ["She has wrote the summary.", "She has written the summary.", "wrote → written"],
        ["We had took the wrong turn.", "We had taken the wrong turn.", "took → taken"],
        ["We need fix this bug.", "We need to fix this bug.", "fix → to␣fix"],
        ["They plan deploy tomorrow.", "They plan to deploy tomorrow.", "deploy → to␣deploy"],
        ["I look forward to meet you.", "I look forward to meeting you.", "meet → meeting"],
        ["Despite of the delay, we finished.", "Despite the delay, we finished.", "of␣ → "],
        ["We discussed about the release.", "We discussed the release.", "about␣ → "],
        ["I am interested on learning Rust.", "I am interested in learning Rust.", "on → in"],
        ["The router lost it's connection.", "The router lost its connection.", "it's → its"],
        ["Its ready to use.", "It's ready to use.", "Its → It's"],
        ["Lets try again.", "Let's try again.", "Lets → Let's"],
        ["This is someone elses folder.", "This is someone else's folder.", "elses → else's"],
        ["They has the updated files.", "They have the updated files.", "has → have"],
        ["We was ready.", "We were ready.", "was → were"],
        ["She have a new keyboard.", "She has a new keyboard.", "have → has"],
        ["There is two errors in the report.", "There are two errors in the report.", "is → are"],
      ]) {
        await prepareReviewPage();
        await setTextarea(source);
        await triggerReview(worker!);
        const panel = await waitForReview(page, "native grammar", (p) =>
          p.items.some((item) => item.text === highlight),
        );
        expect(await textareaValue()).toBe(source);
        expect(panel.fixAll).toMatchObject({ text: "Fix all safe (0)", disabled: true });
        await clickReviewControl(page, ".item");
        await waitForReview(page, "grammar card", (p) => p.card.open);
        await clickReviewControl(page, ".card [data-action=apply]");
        await waitUntil("individual repair", async () => (await textareaValue()) === expected, {
          timeoutMs: 5000,
        });
        await pressNativeUndo(page, "#test-textarea");
        await waitUntil("undone repair", async () => (await textareaValue()) === source, {
          timeoutMs: 5000,
        });
        await finishReview();
      }
    },
    browserTimeout(30000, 45000),
  );

  test.each([
    [
      "For all intensive purposes, the test is complete.",
      "For all intents and purposes, the test is complete.",
      "intensive → intents␣and",
    ],
    ["They are one in the same.", "They are one and the same.", "in → and"],
    ["That feature peaked my interest.", "That feature piqued my interest.", "peaked → piqued"],
    [
      "This approach is more easier to test.",
      "This approach is easier to test.",
      "more␣easier → easier",
    ],
    ["The revised result is more better.", "The revised result is better.", "more␣better → better"],
    ["This is the most fastest option.", "This is the fastest option.", "most␣fastest → fastest"],
    [
      "The page contains useful informations.",
      "The page contains useful information.",
      "informations → information",
    ],
    ["Thanks for the helpful advices.", "Thanks for the helpful advice.", "advices → advice"],
    ["This is one important criteria.", "This is one important criterion.", "criteria → criterion"],
    ["We need the new equipments.", "We need the new equipment.", "equipments → equipment"],
    ["We host the project on github.", "We host the project on GitHub.", "github → GitHub"],
    [
      "The implementation uses javascript.",
      "The implementation uses JavaScript.",
      "javascript → JavaScript",
    ],
    ["The transport is based on webrtc.", "The transport is based on WebRTC.", "webrtc → WebRTC"],
    ["iphone sales increased.", "iPhone sales increased.", "iphone → iPhone"],
    ["I use this tool everyday.", "I use this tool every day.", "everyday → every␣day"],
    ["Please login to continue.", "Please log in to continue.", "login → log␣in"],
    ["We need to setup the environment.", "We need to set up the environment.", "setup → set␣up"],
    ["The feature look promising.", "The feature looks promising.", "look → looks"],
  ])(
    "Review bounded grammar applies individual edits with native undo: %s",
    async (source, expected, highlight) => {
      await prepareReviewPage();
      await setTextarea(source);
      await triggerReview(worker!);
      const panel = await waitForReview(page, "grammar finding", (p) =>
        p.items.some((item) => item.text === highlight),
      );
      expect(panel.items).toHaveLength(1);
      expect(panel.fixAll).toMatchObject({ text: "Fix all safe (0)", disabled: true });
      expect(await textareaValue()).toBe(source);
      await clickReviewControl(page, ".item");
      await waitForReview(page, "grammar card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=apply]");
      await waitUntil("grammar repair", async () => (await textareaValue()) === expected, {
        timeoutMs: 5000,
      });
      await waitForReview(page, "grammar recheck", (p) => p.items.length === 0);
      await pressNativeUndo(page, "#test-textarea");
      await waitUntil("grammar undo", async () => (await textareaValue()) === source, {
        timeoutMs: 5000,
      });
      await finishReview();
    },
    browserTimeout(15000, 25000),
  );

  test(
    "Readability settings persist a validated threshold and recheck without enabling advice",
    async () => {
      const key = "reviewLongSentenceWords";
      const previous = await getSetting(worker!, key);
      const overrides = await getSetting(worker!, KEY_REVIEW_RULE_OVERRIDES);
      await setSettingAndWait(worker!, key, 35);
      await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, {});
      await prepareReviewPage();
      const source =
        "The team reviewed every part of the detailed proposal before recording all of their conclusions.";
      await setTextarea(source);
      await triggerReview(worker!);
      await waitForReview(
        page,
        "initial default",
        (p) => p.status === "No issues found by the review checks.",
      );
      let options = await openOptionsPage(browser, worker!);
      const selector = "#review-long-sentence-words";
      try {
        await options.$eval('a[href="#grammar_tab"]', (el) => (el as HTMLElement).click());
        await options.waitForSelector(selector);
        expect(await options.$eval(selector, (e) => (e as HTMLInputElement).value)).toBe("35");
        const change = async (value: string) =>
          options.$eval(
            selector,
            (e, value) => {
              const input = e as HTMLInputElement;
              input.value = value;
              input.dispatchEvent(new Event("change", { bubbles: true }));
            },
            value,
          );
        await change("9");
        expect(await getSetting(worker!, key)).toBe(35);
        await change("10");
        await waitUntil("threshold saved", async () => (await getSetting(worker!, key)) === 10, {
          timeoutMs: 5000,
        });
        expect(await getSetting(worker!, KEY_REVIEW_RULE_OVERRIDES)).toEqual({});
        await page.bringToFront();
        await waitForReview(
          page,
          "advice still off",
          (p) => p.items.length === 0 && !p.status.includes("Style advice"),
        );
        await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, { styleLongSentence: true });
        await applyConfigChange(browser, worker!);
        await page.bringToFront();
        await waitForReview(
          page,
          "threshold ten warning",
          (p) => p.items.length === 1 && p.items[0].category === "style",
        );
        await change("200");
        await waitUntil(
          "larger threshold saved",
          async () => (await getSetting(worker!, key)) === 200,
          { timeoutMs: 5000 },
        );
        await page.bringToFront();
        await waitForReview(page, "threshold rechecks active Review", (p) => p.items.length === 0);
        expect(await textareaValue()).toBe(source);
        await options.close();
        options = await openOptionsPage(browser, worker!);
        await options.$eval('a[href="#grammar_tab"]', (el) => (el as HTMLElement).click());
        await options.waitForSelector(selector);
        expect(await options.$eval(selector, (e) => (e as HTMLInputElement).value)).toBe("200");
      } finally {
        await options.close();
        await finishReview();
        await setSettingAndWait(worker!, key, previous ?? 35);
        await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, overrides ?? {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(25000, 35000),
  );

  test(
    "Optional style advice stays off by default and separates counts warnings and native undo",
    async () => {
      const previous = await getSetting(worker!, KEY_REVIEW_RULE_OVERRIDES);
      await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, {});
      await prepareReviewPage();
      const source =
        "Use your PIN number. The team reviewed every part of the detailed proposal and carefully considered all of the important information before making any decision about the next stage of the project because there were still several questions about the final report.";
      try {
        await setTextarea(source);
        await triggerReview(worker!);
        await waitForReview(
          page,
          "style disabled",
          (p) => p.status === "No issues found by the review checks." && p.items.length === 0,
        );
        await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, {
          styleRedundancy: true,
          styleLongSentence: true,
        });
        await applyConfigChange(browser, worker!);
        const panel = await waitForReview(
          page,
          "style enabled",
          (p) => p.items.length === 2 && p.items.every((i) => i.category === "style"),
        );
        expect(panel.status).toContain("No issues found");
        expect(panel.status).toContain("Style advice: 2.");
        expect(panel.fixAll.disabled).toBe(true);
        await clickReviewControl(page, '.filter[data-category="style"]');
        await waitForReview(page, "style filter off", (p) => p.items.length === 0);
        await clickReviewControl(page, '.filter[data-category="style"]');
        await waitForReview(page, "style filter on", (p) => p.items.length === 2);
        await clickReviewControl(page, '.item[data-id*="styleRedundancy"]');
        await waitForReview(page, "style repair card", (p) => p.card.open);
        await clickReviewControl(page, '.card [data-action="apply"]');
        await waitUntil(
          "style repair",
          async () => (await textareaValue()) === source.replace("PIN number", "PIN"),
          { timeoutMs: 5000 },
        );
        await waitForReview(page, "style recheck", (p) => p.items.length === 1);
        await pressNativeUndo(page, "#test-textarea");
        await waitForReview(page, "style undo", (p) => p.items.length === 2);
        expect(await textareaValue()).toBe(source);
        await clickReviewControl(page, '.item[data-id*="styleLongSentence"]');
        const warning = await waitForReview(
          page,
          "readability warning",
          (p) => p.card.open && p.card.text.includes("word threshold"),
        );
        expect(warning.card.applyDisabled).toBe(true);
        expect(
          await page.evaluate(
            () =>
              document
                .querySelector("[data-fluenttyper-review]")
                ?.shadowRoot?.querySelectorAll('.card [data-action="apply"]').length,
          ),
        ).toBe(0);
        await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, {});
        await applyConfigChange(browser, worker!);
        await waitForReview(
          page,
          "style disabled again",
          (p) => p.items.length === 0 && !p.status.includes("Style advice"),
        );
      } finally {
        await finishReview();
        await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, previous ?? {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(25000, 35000),
  );

  test(
    "Long Review rechecks preserve native apply undo and invalidate an opening code fence",
    async () => {
      await prepareReviewPage();
      const source =
        "We discussed about the plan.\n\n" +
        "The team reviewed the evidence today.\n\n".repeat(260);
      await setTextarea(source);
      await triggerReview(worker!);
      const panel = await waitForReview(page, "long native finding", (p) =>
        p.items.some((i) => i.text === "about␣ → "),
      );
      expect(panel.items).toHaveLength(1);
      await clickReviewControl(page, ".item");
      await waitForReview(page, "long finding card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=apply]");
      await waitUntil(
        "long individual repair",
        async () => (await textareaValue()) === source.replace("about ", ""),
        { timeoutMs: 5000 },
      );
      await waitForReview(page, "long recheck", (p) => p.items.length === 0);
      await pressNativeUndo(page, "#test-textarea");
      await waitForReview(page, "long native undo", (p) => p.items.length === 1);
      expect(await textareaValue()).toBe(source);
      await page.evaluate(() => {
        const field = document.querySelector("#test-textarea") as HTMLTextAreaElement;
        field.value = "```\n" + field.value;
        field.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: "```\n" }),
        );
      });
      await waitForReview(
        page,
        "fence invalidation",
        (p) => p.items.length === 0 && p.notes.includes("Skipped as code or protected text"),
      );
      expect(await textareaValue()).toBe("```\n" + source);
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Terminology settings author, edit, import and remove entries without changing text assets",
    async () => {
      await prepareReviewPage();
      const key = "preferredTerminology";
      const previous = await getSetting(worker!, key);
      const dictionary = await getSetting(worker!, "userDictionaryList");
      const expansions = await getSetting(worker!, "textExpansions");
      await setSettingAndWait(worker!, key, { version: 1, enabled: false, entries: [] });
      const options = await openOptionsPage(browser, worker!);
      try {
        await options.$eval('a[href="#grammar_tab"]', (el) => (el as HTMLElement).click());
        const root = "#preferred-terminology";
        await options.waitForSelector(`${root} [name=source]`, { visible: true });
        // Firefox BiDi cannot synthesize keyboard actions in extension pages.
        for (const [name, value] of [
          ["source", "Acme Suite"],
          ["replacement", "Acme Workspace"],
          ["explanation", "Our preferred name."],
        ]) {
          await options.$eval(
            `${root} [name=${name}]`,
            (el, value) => {
              (el as HTMLInputElement).value = value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
            },
            value,
          );
        }
        await options.$eval(`${root} [data-terms-action=save]`, (el) =>
          (el as HTMLElement).click(),
        );
        await waitUntil(
          "authored terminology saved",
          async () =>
            (await getSetting<{ entries: unknown[] }>(worker!, key))?.entries.length === 1,
          { timeoutMs: 5000 },
        );
        const saved = await getSetting<{
          version: number;
          enabled: boolean;
          entries: Array<{ id: string; source: string; replacement: string; explanation: string }>;
        }>(worker!, key);
        expect(saved.enabled).toBe(false);
        await options.$eval(`${root} [data-terms-action=enabled]`, (el) =>
          (el as HTMLElement).click(),
        );
        await options.$eval(`${root} [data-terms-action=edit]`, (el) =>
          (el as HTMLElement).click(),
        );
        await options.$eval(`${root} [name=explanation]`, (el) => {
          (el as HTMLInputElement).value = "A local explanation.";
        });
        await options.$eval(`${root} [data-terms-action=save]`, (el) =>
          (el as HTMLElement).click(),
        );
        await waitUntil(
          "terminology edit saved",
          async () =>
            (await getSetting<typeof saved>(worker!, key)).entries[0].explanation ===
            "A local explanation.",
          { timeoutMs: 5000 },
        );
        const edited = await getSetting<typeof saved>(worker!, key);
        expect(edited.entries[0].id).toBe(saved.entries[0].id);
        expect(edited.enabled).toBe(true);
        await options.$eval(`${root} [data-terms-action=remove]`, (el) =>
          (el as HTMLElement).click(),
        );
        await waitUntil(
          "terminology removed",
          async () => (await getSetting<typeof saved>(worker!, key)).entries.length === 0,
          { timeoutMs: 5000 },
        );
        // Firefox BiDi cannot set files in extension pages; exercise the real change handler.
        await options.$eval(
          `${root} [data-terms-action=import-file]`,
          (el, content) => {
            const transfer = new DataTransfer();
            transfer.items.add(
              new File([content], "terminology.json", { type: "application/json" }),
            );
            (el as HTMLInputElement).files = transfer.files;
            el.dispatchEvent(new Event("change", { bubbles: true }));
          },
          JSON.stringify(edited),
        );
        await waitUntil(
          "terminology import",
          async () => (await getSetting<typeof saved>(worker!, key)).entries.length === 1,
          { timeoutMs: 5000 },
        );
        expect(await getSetting(worker!, key)).toEqual(edited);
        await page.bringToFront();
        await setTextarea("We use Acme Suite.");
        await triggerReview(worker!);
        await waitForReview(page, "UI-authored term reaches Review", (p) =>
          p.items.some((i) => i.text === "Acme Suite → Acme Workspace"),
        );
        await options.$eval(`${root} [data-terms-action=remove]`, (el) =>
          (el as HTMLElement).click(),
        );
        await waitUntil(
          "UI removes imported term",
          async () => (await getSetting<typeof saved>(worker!, key)).entries.length === 0,
          { timeoutMs: 5000 },
        );
        await page.bringToFront();
        await waitForReview(page, "UI removal clears active Review", (p) => p.items.length === 0);
        await finishReview();
        expect(await getSetting(worker!, "userDictionaryList")).toEqual(dictionary);
        expect(await getSetting(worker!, "textExpansions")).toEqual(expansions);
      } finally {
        await options.close();
        await setSettingAndWait(
          worker!,
          key,
          previous ?? { version: 1, enabled: false, entries: [] },
        );
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(25000, 35000),
  );

  test(
    "Review authored terminology applies safely and disappears when removed",
    async () => {
      await prepareReviewPage();
      const key = "preferredTerminology";
      const previous = await getSetting(worker!, key);
      const source = "We use Acme Suite.";
      const config = {
        version: 1,
        enabled: true,
        entries: [
          {
            id: "acme",
            source: "Acme Suite",
            replacement: "Acme Workspace",
            casePolicy: "exact",
            explanation: '<img src=x onerror="alert(1)">',
            language: "en_US",
            scope: "all-prose",
            enabled: true,
          },
        ],
      };
      try {
        await setSettingAndWait(worker!, key, config);
        await applyConfigChange(browser, worker!);
        await setTextarea(source);
        await triggerReview(worker!);
        const panel = await waitForReview(page, "authored term", (p) =>
          p.items.some((i) => i.text === "Acme Suite → Acme Workspace"),
        );
        expect(panel.items).toHaveLength(1);
        expect(panel.fixAll.disabled).toBe(true);
        await clickReviewControl(page, ".item");
        const card = await waitForReview(page, "authored term card", (p) => p.card.open);
        expect(card.card.text).toContain('<img src=x onerror="alert(1)">');
        expect(
          await page.evaluate(
            () =>
              document
                .querySelector("[data-fluenttyper-review]")
                ?.shadowRoot?.querySelectorAll(".card img").length,
          ),
        ).toBe(0);
        await clickReviewControl(page, ".card [data-action=apply]");
        await waitUntil(
          "preferred repair",
          async () => (await textareaValue()) === "We use Acme Workspace.",
          { timeoutMs: 5000 },
        );
        await waitForReview(page, "preferred recheck", (p) => p.items.length === 0);
        await pressNativeUndo(page, "#test-textarea");
        await waitForReview(page, "preferred undo", (p) =>
          p.items.some((i) => i.text === "Acme Suite → Acme Workspace"),
        );
        expect(await textareaValue()).toBe(source);
        await setSettingAndWait(worker!, key, { version: 1, enabled: true, entries: [] });
        await applyConfigChange(browser, worker!);
        await waitForReview(page, "preference removed", (p) => p.items.length === 0);
        expect(await textareaValue()).toBe(source);
      } finally {
        await finishReview();
        await setSettingAndWait(
          worker!,
          key,
          previous ?? { version: 1, enabled: false, entries: [] },
        );
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Review canonical casing refuses native node replacement",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      const original = "<p>We use <b>java</b><i>script</i>.</p>";
      await page.evaluate(
        ({ selector, original }) => {
          const root = document.querySelector(selector) as HTMLElement;
          root.innerHTML = original;
          root.focus();
        },
        { selector, original },
      );
      await triggerReview(worker!);
      await waitForReview(page, "formatted canonical name", (p) =>
        p.items.some((i) => i.text === "javascript → JavaScript"),
      );
      await clickReviewControl(page, ".item");
      await waitForReview(page, "canonical card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=apply]");
      await waitForReview(page, "split correction refused", (p) =>
        p.status.includes("The editor refused the change."),
      );
      expect(await page.$eval(selector, (el) => el.innerHTML)).toBe(original);
      await finishReview();
    },
    browserTimeout(15000, 25000),
  );

  test(
    "Review compound insertion preserves a formatted word boundary",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      const original = "<p>We need to <b>set</b><i>up</i> the environment.</p>";
      await page.evaluate(
        ({ selector, original }) => {
          const root = document.querySelector(selector) as HTMLElement;
          root.innerHTML = original;
          root.focus();
        },
        { selector, original },
      );
      await triggerReview(worker!);
      await waitForReview(page, "formatted compound", (p) =>
        p.items.some((item) => item.text === "setup → set␣up"),
      );
      await clickReviewControl(page, ".item");
      await waitForReview(page, "formatted compound card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=apply]");
      await waitUntil(
        "formatted compound repair",
        async () =>
          await page.$eval(
            selector,
            (el) =>
              el.textContent?.replace(/\u00a0/g, " ") === "We need to set up the environment.",
          ),
        { timeoutMs: 5000 },
      );
      expect(
        await page.$eval(selector, (el) => [
          el.querySelector("b")?.textContent?.replace(/\u00a0/g, " "),
          el.querySelector("i")?.textContent,
        ]),
      ).toEqual(["set ", "up"]);
      await pressNativeUndo(page, selector);
      await waitUntil(
        "formatted compound undo",
        async () => (await page.$eval(selector, (el) => el.innerHTML)) === original,
        { timeoutMs: 5000 },
      );
      await finishReview();
    },
    browserTimeout(15000, 25000),
  );

  test(
    "Review usage phrase replacement preserves split formatting",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      const original = "<p>For all <b>int</b><i>ensive</i> purposes, the test is complete.</p>";
      await page.evaluate(
        ({ selector, original }) => {
          const root = document.querySelector(selector) as HTMLElement;
          root.innerHTML = original;
          root.focus();
        },
        { selector, original },
      );
      await triggerReview(worker!);
      await waitForReview(page, "formatted usage phrase", (p) =>
        p.items.some((item) => item.text === "intensive → intents␣and"),
      );
      await clickReviewControl(page, ".item");
      await waitForReview(page, "formatted usage phrase card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=apply]");
      await waitUntil(
        "formatted usage phrase repair",
        async () =>
          await page.$eval(
            selector,
            (el) =>
              el.textContent?.replace(/\u00a0/g, " ") ===
              "For all intents and purposes, the test is complete.",
          ),
        { timeoutMs: 5000 },
      );
      expect(
        await page.$eval(selector, (el) => [
          el.querySelector("b")?.textContent?.replace(/\u00a0/g, " "),
          el.querySelector("i")?.textContent,
        ]),
      ).toEqual(["int", "ents and"]);
      await pressNativeUndo(page, selector);
      await waitUntil(
        "formatted usage phrase undo",
        async () => (await page.$eval(selector, (el) => el.innerHTML)) === original,
        { timeoutMs: 5000 },
      );
      await finishReview();
    },
    browserTimeout(15000, 25000),
  );

  test(
    "Review degree deletion preserves the formatted comparison",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      const original = "<p>This approach is <b>more </b><i>easier</i> to test.</p>";
      await page.evaluate(
        ({ selector, original }) => {
          const root = document.querySelector(selector) as HTMLElement;
          root.innerHTML = original;
          root.focus();
        },
        { selector, original },
      );
      await triggerReview(worker!);
      await waitForReview(page, "formatted degree", (p) =>
        p.items.some((item) => item.text === "more␣easier → easier"),
      );
      await clickReviewControl(page, ".item");
      await waitForReview(page, "formatted degree card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=apply]");
      await waitUntil(
        "formatted degree repair",
        async () =>
          await page.$eval(
            selector,
            (el) => el.textContent?.replace(/\u00a0/g, " ") === "This approach is easier to test.",
          ),
        { timeoutMs: 5000 },
      );
      expect(await page.$eval(selector, (el) => el.querySelector("i")?.textContent)).toBe("easier");
      await pressNativeUndo(page, selector);
      await waitUntil(
        "formatted degree undo",
        async () => (await page.$eval(selector, (el) => el.innerHTML)) === original,
        { timeoutMs: 5000 },
      );
      await finishReview();
    },
    browserTimeout(15000, 25000),
  );

  test(
    "Review noun-number alternatives require a choice and preserve the chosen quantity",
    async () => {
      for (const [index, expected] of [
        [0, "Those files failed."],
        [1, "That file failed."],
      ] as const) {
        await prepareReviewPage();
        const source = "Those file failed.";
        await setTextarea(source);
        await triggerReview(worker!);
        const panel = await waitForReview(page, "number alternatives", (p) =>
          p.items.some((item) => item.text === "Those file → Those files / That file"),
        );
        expect(panel.fixAll).toMatchObject({ text: "Fix all safe (0)", disabled: true });
        await clickReviewControl(page, ".item");
        const card = await waitForReview(page, "number choice", (p) => p.card.open);
        expect(card.card.text).toContain("Choose singular or plural");
        expect(await textareaValue()).toBe(source);
        await clickReviewControl(page, `.card button.suggestion[data-index="${index}"]`);
        await waitUntil("chosen number", async () => (await textareaValue()) === expected, {
          timeoutMs: 5000,
        });
        await waitForReview(page, "number rechecked", (p) => p.items.length === 0);
        await pressNativeUndo(page, "#test-textarea");
        await waitUntil("number undo", async () => (await textareaValue()) === source, {
          timeoutMs: 5000,
        });
        await finishReview();
      }
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Review missing-to insertion preserves a split formatted verb and native undo",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      const original = "<p>We need <b>f</b><i>ix</i> this bug.</p>";
      await page.evaluate(
        ({ selector, original }) => {
          const root = document.querySelector(selector) as HTMLElement;
          root.innerHTML = original;
          root.focus();
        },
        { selector, original },
      );
      await triggerReview(worker!);
      const panel = await waitForReview(page, "split complement", (p) =>
        p.items.some((item) => item.text === "fix → to␣fix"),
      );
      expect(panel.fixAll).toMatchObject({ text: "Fix all safe (0)", disabled: true });
      await clickReviewControl(page, ".item");
      await waitForReview(page, "split complement card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=apply]");
      await waitUntil(
        "split insertion",
        async () =>
          (await page.$eval(selector, (el) => el.textContent)) === "We need to fix this bug.",
        { timeoutMs: 5000 },
      ).catch(async (cause) => {
        throw new Error(
          `Split insertion left ${await page.$eval(selector, (el) => el.innerHTML)}`,
          { cause },
        );
      });
      expect(await page.$eval(selector, (el) => el.innerHTML)).toBe(
        "<p>We need <b>to f</b><i>ix</i> this bug.</p>",
      );
      await waitForReview(page, "insertion recheck", (p) => p.items.length === 0);
      await pressNativeUndo(page, selector);
      await waitUntil(
        "split insertion undo",
        async () => (await page.$eval(selector, (el) => el.innerHTML)) === original,
        { timeoutMs: 5000 },
      );
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Review quotation warnings support keyboard and filters without Apply or batch edits",
    async () => {
      await prepareReviewPage();
      const source = "He wrote, “The build is ready.";
      await setTextarea(source);
      await triggerReview(worker!);
      let panel = await waitForReview(page, "quotation warning", (p) => p.status === "Issues: 1");
      expect(panel.items[0].text).toBe("Warning: “");
      expect(panel.fixAll).toMatchObject({ text: "Fix all safe (0)", disabled: true });
      await clickReviewControl(page, '.filter[data-category="punctuation"]');
      await waitForReview(page, "warning filtered", (p) => p.items.length === 0);
      await clickReviewControl(page, '.filter[data-category="punctuation"]');
      await waitForReview(page, "warning restored", (p) => p.items.length === 1);
      for (let i = 0; i < 12 && (await readReviewPanel(page)).focus !== "button.item"; i++) {
        await page.keyboard.press("Tab");
      }
      expect((await readReviewPanel(page)).focus).toBe("button.item");
      await page.keyboard.press("Enter");
      panel = await waitForReview(page, "warning card", (p) => p.card.open);
      expect(panel.card.text).toContain("no matching closing mark");
      expect(panel.focus).not.toBe("button.item");
      expect(
        await page.evaluate(() => {
          const root = document.querySelector("[data-fluenttyper-review]")?.shadowRoot;
          return !!root?.querySelector('.card [data-action="apply"]');
        }),
      ).toBe(false);
      await page.keyboard.press("Escape");
      await waitForReview(page, "warning card closed", (p) => !p.card.open && p.open);
      expect(await textareaValue()).toBe(source);
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Review matching ignores remap, reset and expire on close without persisting prose",
    async () => {
      await prepareReviewPage();
      const prefix = "Plain context. ".repeat(9);
      const source = `${prefix}The the cat. ${prefix}The the cat. ${prefix}A a cat.`;
      const dictionary = await getLocalStorageValue<string[]>(
        worker!,
        `${SETTINGS_PREFIX}userDictionaryList`,
      );
      const overrides = await getSetting(worker!, KEY_REVIEW_RULE_OVERRIDES);
      await setTextarea(source);
      await triggerReview(worker!);
      const initial = await waitForReview(
        page,
        "three repeated words",
        (p) => p.items.length === 3,
      );
      await clickReviewControl(page, `.item[data-id="${initial.items[0].id}"]`);
      await waitForReview(page, "matching-ignore card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=more]");
      await clickReviewControl(page, "[data-action=ignore-matching]");
      const ignored = await waitForReview(
        page,
        "two matching occurrences ignored",
        (p) => p.items.length === 1 && p.notes.includes("Ignored: 2"),
      );
      expect(ignored.items[0].text).toBe("A␣a → A");
      expect(ignored.fixAll).toMatchObject({ text: "Fix all safe (0)", disabled: true });
      expect(await textareaValue()).toBe(source);
      await page.focus("#test-textarea");
      await page.$eval("#test-textarea", (el) =>
        (el as HTMLTextAreaElement).setSelectionRange(0, 0),
      );
      await page.keyboard.type("Hello. ");
      await waitForReview(
        page,
        "ignored evidence moved",
        (p) => p.items.length === 1 && p.notes.includes("Ignored: 2"),
      );
      expect(await textareaValue()).toBe("Hello. " + source);
      await clickReviewControl(page, "[data-action=reset-ignores]");
      const restored = await waitForReview(
        page,
        "all ignored findings restored",
        (p) => p.items.length === 3 && !p.notes.includes("Ignored:"),
      );
      await clickReviewControl(page, `.item[data-id="${restored.items[0].id}"]`);
      await waitForReview(page, "ignore again", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=more]");
      await clickReviewControl(page, "[data-action=ignore-matching]");
      await waitForReview(page, "ignored again", (p) => p.items.length === 1);
      await clickReviewControl(page, "[data-action=close]");
      await page.focus("#test-textarea");
      await triggerReview(worker!);
      await waitForReview(
        page,
        "new session has no ignores",
        (p) => p.items.length === 3 && !p.notes.includes("Ignored:"),
      );
      expect(
        await getLocalStorageValue<string[]>(worker!, `${SETTINGS_PREFIX}userDictionaryList`),
      ).toEqual(dictionary);
      expect(await getSetting(worker!, KEY_REVIEW_RULE_OVERRIDES)).toEqual(overrides);
      expect(
        JSON.stringify(await worker!.evaluate(async () => await chrome.storage.local.get(null))),
      ).not.toContain("Plain context");
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Review keeps a disabled rule disabled after reopening in an iframe",
    async () => {
      await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, {});
      await prepareReviewPage();
      try {
        await page.evaluate(() => {
          const iframe = document.createElement("iframe");
          iframe.id = "review-frame";
          iframe.style.cssText =
            "position: fixed; inset: 0; width: 100%; height: 100%; border: 0; z-index: 2147483647;";
          iframe.src = window.location.href;
          document.body.prepend(iframe);
        });
        const frame = await waitUntil(
          "review iframe",
          async () => (await (await page.$("#review-frame"))?.contentFrame()) || false,
        );
        await frame.waitForSelector("#test-textarea[data-suggestion]");
        await frame.$eval("#test-textarea", (el) => {
          const field = el as HTMLTextAreaElement;
          field.value = "I opened the the report. He can works remotely.";
          field.focus();
          field.setSelectionRange(0, 0);
        });
        const click = async (selector: string) => {
          const button = await frame.waitForSelector(`pierce/${selector}:not(:disabled)`);
          await button!.click();
        };
        await triggerReview(worker!);
        await waitForReview(frame, "iframe findings", (p) => p.items.length === 2);
        await click(".item");
        await waitForReview(frame, "iframe card", (p) => p.card.open);
        await click("[data-action=more]");
        await frame.waitForFunction(() => {
          const button = document
            .querySelector("[data-fluenttyper-review]")
            ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-action=disable-rule]");
          return button && !button.disabled;
        });
        await click("[data-action=disable-rule]");
        await waitForReview(frame, "iframe rule disabled", (p) => p.items.length === 1);
        await click("[data-action=close]");
        await waitForReview(frame, "iframe closed", (p) => !p.open);
        await frame.focus("#test-textarea");
        await triggerReview(worker!);
        await waitForReview(
          frame,
          "iframe reopened without disabled rule",
          (p) => p.items.length === 1 && p.items[0].text.includes("works"),
        );
        expect(await getSetting(worker!, KEY_REVIEW_RULE_OVERRIDES)).toEqual({
          englishRepeatedWords: false,
        });
        const options = await openOptionsPage(browser, worker!);
        try {
          await options.$eval('a[href="#grammar_tab"]', (el) => (el as HTMLElement).click());
          const selector =
            'input[data-setting="reviewRuleOverrides"][value="englishRepeatedWords"]';
          // Rule categories start folded; open the one holding this rule.
          await options.$eval(selector, (el) => {
            el.closest("details")!.open = true;
          });
          await options.waitForSelector(selector, { visible: true });
          await options.$eval(selector, (el) => (el as HTMLElement).click());
          await page.bringToFront();
          await waitForReview(
            frame,
            "settings restore the iframe rule live",
            (p) => p.items.length === 2,
          );
        } finally {
          await options.close();
        }
        await page.bringToFront();
        await click("[data-action=close]");
        await waitForReview(frame, "iframe closed after settings", (p) => !p.open);
        await frame.focus("#test-textarea");
        await triggerReview(worker!);
        await waitForReview(
          frame,
          "iframe reopened with restored rule",
          (p) => p.items.length === 2,
        );
      } finally {
        await page.$eval("#review-frame", (el) => el.remove());
        await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, {});
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(25000, 35000),
  );

  test(
    "Review rule controls persist one disabled check and restore it from settings",
    async () => {
      await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, {});
      await prepareReviewPage();
      const source = "I opened the the report. He can works remotely.";
      const typing = await getSetting(worker!, KEY_ENABLED_GRAMMAR_RULES);
      try {
        await setTextarea(source);
        await triggerReview(worker!);
        await waitForReview(page, "two native findings", (p) => p.items.length === 2);
        await clickReviewControl(page, ".item");
        await waitForReview(page, "rule card", (p) => p.card.open);
        await clickReviewControl(page, ".card [data-action=more]");
        await clickReviewControl(page, "[data-action=disable-rule]");
        await waitForReview(
          page,
          "only auxiliary remains",
          (p) => p.items.length === 1 && p.items[0].text.includes("works"),
        );
        expect(await getSetting(worker!, KEY_REVIEW_RULE_OVERRIDES)).toEqual({
          englishRepeatedWords: false,
        });
        expect(await getSetting(worker!, KEY_ENABLED_GRAMMAR_RULES)).toEqual(typing);
        expect(await textareaValue()).toBe(source);
        await page.keyboard.press("Escape");
        await setTextarea(source);
        await triggerReview(worker!);
        await waitForReview(
          page,
          "disabled after reopen",
          (p) => p.items.length === 1 && p.items[0].text.includes("works"),
        );
        const options = await openOptionsPage(browser, worker!);
        try {
          await options.$eval('a[href="#grammar_tab"]', (el) => (el as HTMLElement).click());
          const selector =
            'input[data-setting="reviewRuleOverrides"][value="englishRepeatedWords"]';
          // Rule categories start folded; open the one holding this rule.
          await options.$eval(selector, (el) => {
            el.closest("details")!.open = true;
          });
          await options.waitForSelector(selector, { visible: true });
          expect(await options.$eval(selector, (el) => (el as HTMLInputElement).checked)).toBe(
            false,
          );
          await options.$eval(selector, (el) => (el as HTMLElement).click());
          await waitUntil(
            "restored Review preference",
            async () =>
              (await getSetting<Record<string, boolean>>(worker!, KEY_REVIEW_RULE_OVERRIDES))
                ?.englishRepeatedWords === true,
            { timeoutMs: 5000 },
          );
        } finally {
          await options.close();
        }
        await page.bringToFront();
        await waitForReview(page, "restored live findings", (p) => p.items.length === 2);
        await setGrammarRulesAndWait(worker!, []);
        await applyConfigChange(browser, worker!);
        await waitForReview(page, "typing disable stays separate", (p) => p.items.length === 2);
        expect(await textareaValue()).toBe(source);
      } finally {
        await setSettingAndWait(worker!, KEY_REVIEW_RULE_OVERRIDES, {});
        await applyConfigChange(browser, worker!);
        await finishReview();
      }
    },
    browserTimeout(35000, 50000),
  );

  test(
    "Review mode offers suggestions for an unknown word and changes nothing until one is picked",
    async () => {
      await prepareReviewPage();
      await setTextarea("Where wa it?");
      const requests: string[] = [];
      page.on("request", (request) => {
        if (!request.url().endsWith("/favicon.ico")) requests.push(request.url());
      });
      await triggerReview(worker!);
      // Looked up in the extension's own dictionary engine; no default.
      let panel = await waitForReview(page, "spelling finding", (p) => p.items.length > 0);
      expect(panel.items).toHaveLength(1);
      expect(panel.items[0].category).toBe("spelling");
      expect(panel.items[0].text).toStartWith("wa \u2192 was / way /");
      expect(panel.fixAll).toMatchObject({ text: "Fix all safe (0)", disabled: true });
      expect(await textareaValue()).toBe("Where wa it?");

      await clickReviewControl(page, ".item");
      panel = await waitForReview(page, "choice card", (p) => p.card.open);
      expect(panel.card.text).toContain("This word is not in the dictionary.");
      expect(panel.card.text).toContain("Nothing changes until you pick a word.");
      expect(await textareaValue()).toBe("Where wa it?");

      // The user picks "was": one native edit, and one undo step restores the word.
      await clickReviewControl(page, '.card button.suggestion[data-index="0"]');
      await waitUntil("picked", async () => (await textareaValue()) === "Where was it?", {
        timeoutMs: 5000,
      });
      await waitForReview(
        page,
        "resolved",
        (p) => p.status === "All found issues are resolved. Fixed: 1.",
      );
      await pressNativeUndo(page, "#test-textarea");
      await waitUntil("undone", async () => (await textareaValue()) === "Where wa it?", {
        timeoutMs: 5000,
      });
      expect(requests).toEqual([]);
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Review button in the focused text box reviews only that box; the setting turns it off",
    async () => {
      await prepareReviewPage();
      await setTextarea("We saw the cat and the dog.");
      await page.evaluate(() => {
        const second = document.createElement("textarea");
        second.id = "second-textarea";
        second.rows = 4;
        second.cols = 40;
        second.value = "Another box with teh typo.";
        document.querySelector("#test-textarea")!.after(second);
      });
      const launcher = () =>
        page.evaluate(() => {
          const button = document
            .querySelector("[data-fluenttyper-review-launcher]")
            ?.shadowRoot?.querySelector<HTMLButtonElement>("button");
          if (!button || button.hidden) return null;
          const rect = button.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
      const box = (selector: string) =>
        page.$eval(selector, (el) => {
          const rect = el.getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        });

      // The button sits inside the focused box, in its corner; the page's layout is untouched.
      const paddingBefore = await page.$eval(
        "#second-textarea",
        (el) => getComputedStyle(el).paddingRight,
      );
      // The button hides while its corner is off-screen; the window's height varies by OS.
      await page.$eval("#second-textarea", (el) => el.scrollIntoView({ block: "center" }));
      await page.focus("#second-textarea");
      await waitUntil("review button", async () => (await launcher()) !== null, {
        timeoutMs: 5000,
      });
      const point = (await launcher())!;
      const second = await box("#second-textarea");
      expect(point.x).toBeGreaterThan(second.left);
      expect(point.x).toBeLessThan(second.right);
      expect(point.y).toBeGreaterThan(second.top);
      expect(point.y).toBeLessThan(second.bottom);
      expect(await page.$eval("#second-textarea", (el) => getComputedStyle(el).paddingRight)).toBe(
        paddingBefore,
      );

      // Typing hides it until a pause.
      await page.keyboard.press("End");
      await page.keyboard.type(" More", { delay: 20 });
      expect(await launcher()).toBeNull();
      await waitUntil("button back after typing", async () => (await launcher()) !== null, {
        timeoutMs: 5000,
      });

      // A click reviews this box only, and the button steps aside while its review is open.
      const target = (await launcher())!;
      await page.mouse.click(target.x, target.y);
      const panel = await waitForReview(page, "second box review", (p) => p.status === "Issues: 1");
      expect(panel.items.map((item) => item.text)).toEqual(["teh \u2192 the"]);
      expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("test-textarea");
      expect(await launcher()).toBeNull();
      await clickReviewControl(page, "[data-action=fix-all]");
      await waitUntil(
        "fixed second box",
        async () =>
          (await page.$eval("#second-textarea", (el) => (el as HTMLTextAreaElement).value)) ===
          "Another box with the typo. More",
        { timeoutMs: 5000 },
      );
      expect(await textareaValue()).toBe("We saw the cat and the dog.");
      await page.keyboard.press("Escape");
      await waitForReview(page, "closed", (p) => !p.open);

      // Inside a modal dialog (the page behind it is inert), the button still works.
      await page.evaluate(() => {
        const dialog = document.createElement("dialog");
        dialog.id = "launcher-dialog";
        const field = document.createElement("textarea");
        field.id = "dialog-textarea";
        field.rows = 4;
        field.cols = 40;
        field.value = "In a dialog with teh typo.";
        dialog.append(field);
        document.body.append(dialog);
        dialog.showModal();
        field.focus();
      });
      await waitUntil("dialog button", async () => (await launcher()) !== null, {
        timeoutMs: 5000,
      });
      const inDialog = (await launcher())!;
      await page.mouse.click(inDialog.x, inDialog.y);
      await waitForReview(page, "dialog review", (p) => p.status === "Issues: 1");
      await page.keyboard.press("Escape");
      await waitForReview(page, "dialog review closed", (p) => !p.open);
      await page.evaluate(() => {
        const dialog = document.querySelector<HTMLDialogElement>("#launcher-dialog")!;
        dialog.close();
        dialog.remove();
      });

      // Turned off in settings: no button anywhere.
      await setSettingAndWait(worker!, "showReviewButton", false);
      await applyConfigChange(browser, worker!);
      await page.focus("#test-textarea");
      await sleep(1200);
      expect(await launcher()).toBeNull();
      await setSettingAndWait(worker!, "showReviewButton", true);
      await applyConfigChange(browser, worker!);
      await finishReview();
    },
    browserTimeout(30000, 45000),
  );

  test(
    "Grammar proposals while typing are shown after a pause and applied only when picked",
    async () => {
      await prepareReviewPage();
      await setTextarea("");
      // The proposal row of the visible popup: its text and whether it is selected.
      const proposal = () =>
        page.evaluate(() => {
          for (const menu of Array.from(document.querySelectorAll('[id^="ft-menu-"]'))) {
            if (getComputedStyle(menu).display === "none") continue;
            const row = (menu.shadowRoot ?? menu).querySelector("li[data-proposal]");
            if (row) {
              return {
                text: row.querySelector(".ft-suggestion-label")?.textContent ?? "",
                selected: row.getAttribute("aria-selected") === "true",
              };
            }
          }
          return null;
        });

      await page.keyboard.type("We is ready. ");
      await waitUntil("proposal shown", async () => (await proposal()) !== null, {
        timeoutMs: SUGGESTION_TIMEOUT_MS,
      });
      expect(await proposal()).toEqual({ text: "is → are", selected: false });
      expect(await textareaValue()).toBe("We is ready. ");

      // Only once selected does an accept key apply it.
      for (let step = 0; step < 12 && !(await proposal())?.selected; step += 1) {
        await page.keyboard.press("ArrowDown");
      }
      expect((await proposal())?.selected).toBe(true);
      await page.keyboard.press("Tab");
      await waitUntil(
        "proposal applied",
        async () => (await textareaValue()) === "We are ready. ",
        {
          timeoutMs: SUGGESTION_TIMEOUT_MS,
        },
      );
      expect(await proposal()).toBeNull();

      // Esc dismisses it, and the same span is not offered again.
      await page.keyboard.type("They has left. ");
      await waitUntil("second proposal", async () => (await proposal())?.text === "has → have", {
        timeoutMs: SUGGESTION_TIMEOUT_MS,
      });
      await page.keyboard.press("Escape");
      await page.keyboard.type("So");
      // Absence can only be seen after the typing pause (220 ms) has passed.
      await sleep(600);
      expect(await proposal()).toBeNull();
      expect(await textareaValue()).toBe("We are ready. They has left. So");

      // Turned off in settings: nothing is proposed.
      await setSettingAndWait(worker!, "liveGrammarProposals", false);
      await applyConfigChange(browser, worker!);
      await setTextarea("");
      await page.keyboard.type("We is ready. ");
      await sleep(600);
      expect(await proposal()).toBeNull();
      await setSettingAndWait(worker!, "liveGrammarProposals", true);
      await finishReview();
    },
    browserTimeout(30000, 45000),
  );

  test(
    "Review mode never writes stale offsets when focusing the field changes it",
    async () => {
      await prepareReviewPage();
      await setTextarea("We saw teh cat.");
      await triggerReview(worker!);
      await waitForReview(page, "textarea finding", (p) => p.status === "Issues: 1");
      // The panel has focus now. The page rewrites the field as soon as it is focused again.
      await page.evaluate(() => {
        const field = document.querySelector("#test-textarea") as HTMLTextAreaElement;
        field.addEventListener("focus", () => (field.value = `PREFIX: ${field.value}`), {
          once: true,
        });
      });
      await clickReviewControl(page, ".item");
      await waitForReview(page, "card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=apply]");
      await waitForReview(page, "rechecked after the refused write", (p) =>
        /Issues: 1$/.test(p.status),
      );
      // Not "PREFIX: We saw the cat." written at the old offsets, and not rewritten at all.
      expect(await textareaValue()).toBe("PREFIX: We saw teh cat.");
      await finishReview();
    },
    browserTimeout(20000, 30000),
  );

  test(
    "Review mode uses native defaults independently of typing and disables them in code mode",
    async () => {
      const selector = "#test-textarea";
      const launcherShown = () =>
        page.evaluate(() => {
          const button = document
            .querySelector("[data-fluenttyper-review-launcher]")
            ?.shadowRoot?.querySelector<HTMLButtonElement>("button");
          return !!button && !button.hidden;
        });
      // duplicatePunctuationCollapse is off for typing by default.
      expect(DEFAULT_CURRENT_GRAMMAR_RULES).not.toContain("duplicatePunctuationCollapse");
      await prepareReviewPage();

      // Typing leaves ".." alone: the space after it, where the rule would act, is already typed.
      await clearInputContent(page, selector);
      await typeInInput(page, selector, "Hello world.. Next");
      await waitForInputContentEqual(
        page,
        selector,
        "Hello world.. Next",
        browserTimeout(5000, 9000),
      );

      // Review finds it anyway, and changes nothing until asked.
      await triggerReview(worker!);
      let panel = await waitForReview(page, "off-for-typing rule", (p) => p.status === "Issues: 1");
      expect(panel.items.map((item) => [item.text, item.category])).toEqual([
        [".. \u2192 .", "punctuation"],
      ]);
      expect(await textareaValue()).toBe("Hello world.. Next");
      await page.keyboard.press("Escape");
      await waitForReview(page, "closed", (p) => !p.open);

      // With every rule off for typing, review and its in-field button still work.
      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
      await setTextarea("We saw teh cat.. Then left.");
      await waitUntil("review button with typing rules off", launcherShown, { timeoutMs: 5000 });
      await triggerReview(worker!);
      panel = await waitForReview(page, "all typing rules off", (p) => p.status === "Issues: 2");
      expect(panel.items.map((item) => item.text)).toEqual(["teh \u2192 the", ".. \u2192 ."]);
      await page.keyboard.press("Escape");
      await waitForReview(page, "closed again", (p) => !p.open);

      // Code mode keeps review's rules off: nothing to check, no button.
      try {
        await setSettingAndWait(worker!, KEY_CODE_MODE, true);
        await applyConfigChange(browser, worker!);
        await setTextarea("We saw teh cat.. Then left.");
        await waitUntil("no review button in code mode", async () => !(await launcherShown()), {
          timeoutMs: 5000,
        });
        await triggerReview(worker!);
        // The (empty) check is asked of the background: wait past "Checking…".
        panel = await waitForReview(
          page,
          "code mode",
          (p) => p.open && p.status !== "" && p.status !== "Checking…",
        );
        expect(panel.status).toBe("No review checks run in code mode.");
        expect(panel.items).toEqual([]);
        expect(await textareaValue()).toBe("We saw teh cat.. Then left.");
      } finally {
        await page.keyboard.press("Escape").catch(() => undefined);
        await setSettingAndWait(worker!, KEY_CODE_MODE, false);
        await applyConfigChange(browser, worker!);
      }
      await finishReview();
    },
    browserTimeout(40000, 60000),
  );

  test(
    "Review mode card flow in contenteditable: individual fixes, ignore, dictionary, undo and formatting",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      await page.evaluate((sel) => {
        const root = document.querySelector(sel) as HTMLElement;
        root.innerHTML =
          '<p>We saw <b>teh</b> cat and teh dog , <a href="#link">recieve</a> it.</p>' +
          "<ul><li>their is one item</li></ul><p>Run <code>teh build</code> alot.</p>";
        root.focus();
      }, selector);
      await triggerReview(worker!);
      let panel = await waitForReview(page, "contenteditable findings", (p) =>
        /^Issues: \d+$/.test(p.status),
      );
      expect(panel.items.map((item) => item.text)).toEqual([
        "teh → the",
        "teh → the",
        "␣, → ,",
        "recieve → receive",
        "t → T",
        "their is → there is",
        "alot → a␣lot",
      ]);
      // Painted with namespaced CSS Custom Highlights; no element added to the editor.
      expect(panel.highlights.sort()).toEqual([
        "fluenttyper-review-grammar",
        "fluenttyper-review-punctuation",
        "fluenttyper-review-spelling",
        "fluenttyper-review-typography",
      ]);
      expect(await page.$eval(selector, (el) => el.querySelectorAll("span, mark").length)).toBe(0);

      // Click the SECOND "teh": the card opens for that occurrence only.
      const point = await textPoint(page, selector, "teh", 2);
      await page.mouse.click(point.x, point.y);
      panel = await waitForReview(page, "card", (p) => p.card.open);
      expect(panel.card.text).toContain("This is a common misspelling.");
      await clickReviewControl(page, ".card [data-action=apply]");
      await waitUntil(
        "one fix",
        async () =>
          (await page.$eval(selector, (el) => el.textContent)) ===
          "We saw teh cat and the dog , recieve it.their is one itemRun teh build alot.",
        { timeoutMs: 5000 },
      );

      // Ignore the remaining "teh" (this occurrence, this session only).
      panel = await waitForReview(page, "after apply", (p) => p.status === "Fixed: 1. Issues: 6");
      // The next finding's card opened in place of the applied one; close it to use the list.
      await waitForReview(page, "next card after apply", (p) => p.card.open);
      await page.keyboard.press("Escape");
      await waitForReview(page, "next card closed", (p) => !p.card.open && p.open);
      await clickReviewControl(page, `.item[data-id="${panel.items[0].id}"]`);
      await waitForReview(page, "card for ignore", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=ignore]");
      panel = await waitForReview(page, "ignored", (p) => p.items.length === 5 && p.card.open);
      expect(panel.notes).toContain("Ignored: 1");
      await page.keyboard.press("Escape");
      await waitForReview(page, "card after ignore closed", (p) => !p.card.open && p.open);

      // Add "recieve" to the user dictionary through the existing settings path.
      const recieve = panel.items.find((item) => item.text.startsWith("recieve"))!;
      await clickReviewControl(page, `.item[data-id="${recieve.id}"]`);
      await waitForReview(page, "card for dictionary", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=more]");
      await clickReviewControl(page, ".card [data-action=dictionary]");
      await waitForReview(
        page,
        "dictionary word gone",
        (p) => p.items.length === 4 && p.items.every((item) => !item.text.startsWith("recieve")),
      );
      await waitUntil(
        "stored dictionary word",
        async () =>
          (
            (await getLocalStorageValue<string[]>(
              worker!,
              `${SETTINGS_PREFIX}userDictionaryList`,
            )) ?? []
          ).includes("recieve"),
        { timeoutMs: 5000 },
      );

      expect((await readReviewPanel(page)).fixAll.hidden).toBe(false);
      for (const text of ["␣, → ,", "their is → there is", "alot → a␣lot"])
        await applyIndividualReviewFix(text);
      // The line-start capital is individual-only and stays for the user to decide.
      panel = await waitForReview(
        page,
        "remaining fixed",
        (p) => p.items.length === 1 && /Issues: 1$/.test(p.status),
      );
      expect(panel.items.map((item) => item.text)).toEqual(["t → T"]);
      const html = await page.$eval(selector, (el) => el.innerHTML);
      // Structure, bold, link, list and code are untouched. Native editing may turn
      // the space beside </code> into a no-break space; review accepts only that.
      expect(html.replace("</code>&nbsp;", "</code> ")).toBe(
        '<p>We saw <b>teh</b> cat and the dog, <a href="#link">recieve</a> it.</p>' +
          "<ul><li>there is one item</li></ul><p>Run <code>teh build</code> a lot.</p>",
      );

      // Native undo reverts review fixes (one per edit in plain contenteditable).
      await pressNativeUndo(page, selector);
      await waitUntil(
        "one fix undone",
        async () => (await page.$eval(selector, (el) => el.innerHTML)) !== html,
        { timeoutMs: 5000 },
      );
      expect(await page.$eval(selector, (el) => el.querySelector("code")?.textContent)).toBe(
        "teh build",
      );
      await setSettingAndWait(worker!, "userDictionaryList", []);
      await finishReview();
    },
    browserTimeout(50000, 70000),
  );

  test(
    "Review mode fixes a whole formatted word and link text in place, keeping the spaces around them, and undo restores them",
    async () => {
      await prepareReviewPage();
      const selector = "#test-contenteditable";
      const original =
        "<p>Well, <em>i</em> agree.</p><p>We could <b>of</b> shipped it.</p>" +
        '<p>He said <a href="#link">alot</a> of things.</p>';
      const html = () => page.$eval(selector, (el) => el.innerHTML);
      await page.evaluate(
        (sel, value) => {
          const root = document.querySelector(sel) as HTMLElement;
          root.innerHTML = value;
          root.focus();
        },
        selector,
        original,
      );
      await triggerReview(worker!);
      const panel = await waitForReview(page, "findings", (p) => p.status === "Issues: 3");
      expect(panel.items.map((item) => item.text)).toEqual([
        "i → I",
        "could of → could have",
        "alot → a␣lot",
      ]);

      // One fix: the word stays in its <em>, and the space after it stays a space.
      await clickReviewControl(page, `.item[data-id="${panel.items[0].id}"]`);
      await waitForReview(page, "card", (p) => p.card.open);
      await clickReviewControl(page, ".card [data-action=apply]");
      if (isFirefox()) {
        await waitForReview(page, "whole-node correction refused", (p) =>
          p.status.includes("The editor refused the change."),
        );
        expect(await html()).toBe(original);
      } else {
        await waitForReview(page, "one fixed", (p) => p.status === "Fixed: 1. Issues: 2");
        expect(await html()).toBe(original.replace("<em>i</em>", "<em>I</em>"));
        await pressNativeUndo(page, selector);
        await waitUntil("one-step formatted Undo", async () => (await html()) === original, {
          timeoutMs: 5000,
        });
        await waitForReview(page, "rechecked after undo", (p) => /Issues: 3$/.test(p.status));
      }
      expect((await readReviewPanel(page)).fixAll.hidden).toBe(false);
      await applyIndividualReviewFix("alot → a␣lot");
      expect(await html()).toBe(original.replace("alot", "a lot"));
      await pressNativeUndo(page, selector);
      await waitUntil("one-step link Undo", async () => (await html()) === original, {
        timeoutMs: 5000,
      });
      await finishReview();
    },
    browserTimeout(40000, 60000),
  );

  test(
    "Review mode keeps the real Quill model and formatting with individual fixes and native Undo",
    async () => {
      await prepareReviewPage({ enableQuill: true });
      await waitForInputReady(page, QUILL_SELECTOR);
      await page.evaluate(() => {
        const quill = (window as typeof window & { __testQuill: Quill }).__testQuill;
        quill.setContents([
          { insert: "i think " },
          { insert: "teh", attributes: { bold: true } },
          { insert: " plan is ready , but their is a " },
          { insert: "link", attributes: { link: "https://example.invalid/" } },
          { insert: ".\nRun " },
          { insert: "teh build", attributes: { code: true } },
          { insert: " with alot of care.\n" },
        ]);
        // Seeded text is the user's existing document, not an undoable change.
        quill.history.clear();
        quill.focus();
        quill.setSelection(0, 0);
      });
      const quillText = () =>
        page.evaluate(() =>
          (window as typeof window & { __testQuill: Quill }).__testQuill.getText(),
        );
      const original = await quillText();
      await triggerReview(worker!);
      await waitForReview(page, "quill findings", (p) => p.items.length === 5);
      expect((await readReviewPanel(page)).fixAll.hidden).toBe(false);
      await applyIndividualReviewFix("teh → the");
      const contents = await page.evaluate(
        () => (window as typeof window & { __testQuill: Quill }).__testQuill.getContents().ops,
      );
      expect(contents).toEqual([
        { insert: "i think " },
        { insert: "the", attributes: { bold: true } },
        { insert: " plan is ready , but their is a " },
        { insert: "link", attributes: { link: "https://example.invalid/" } },
        { insert: ".\nRun " },
        { insert: "teh build", attributes: { code: true } },
        { insert: " with alot of care.\n" },
      ]);
      // One correction uses the real Quill history.
      await pressNativeUndo(page, QUILL_SELECTOR);
      await waitUntil("quill undo", async () => (await quillText()) === original, {
        timeoutMs: 5000,
      });
      await finishReview();
    },
    browserTimeout(40000, 60000),
  );

  test(
    "Review mode keyboard flow: panel focus, list, card, Escape order, and Tab is never captured",
    async () => {
      await prepareReviewPage();
      await setTextarea("We saw teh cat and teh dog.");
      await triggerReview(worker!);
      let panel = await waitForReview(page, "panel focused", (p) => p.status === "Issues: 2");
      expect(panel.focus).toBe("h2");
      // Tab moves through review controls to the first issue.
      for (let i = 0; i < 12 && (await readReviewPanel(page)).focus !== "button.item"; i += 1) {
        await page.keyboard.press("Tab");
      }
      await page.keyboard.press("Enter");
      panel = await waitForReview(page, "card from keyboard", (p) => p.card.open);
      expect(panel.focus).toBe("button[apply]");
      await page.keyboard.press("Enter");
      await waitUntil(
        "keyboard apply",
        async () => (await textareaValue()) === "We saw the cat and teh dog.",
        { timeoutMs: 5000 },
      );
      // The next finding's card opens with its Apply focused.
      await waitForReview(
        page,
        "next card after apply",
        (p) => p.card.open && p.focus === "button[apply]",
      );
      // Escape closes the card first, then the review.
      await page.keyboard.press("Escape");
      panel = await waitForReview(page, "card closed", (p) => !p.card.open);
      expect(panel.open).toBe(true);
      await page.keyboard.press("Escape");
      await waitForReview(page, "review closed", (p) => !p.open);
      expect(await textareaValue()).toBe("We saw the cat and teh dog.");

      // With a review open but the editor focused, Tab leaves the editor as usual.
      await setTextarea("We saw teh cat.", [3, 3]);
      await triggerReview(worker!);
      await waitForReview(page, "second review", (p) => p.status === "Issues: 1");
      await page.focus("#test-textarea");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("test-input");
      expect(await textareaValue()).toBe("We saw teh cat.");
      await page.focus("#test-textarea");
      await page.keyboard.press("Escape");
      await waitForReview(page, "closed from editor", (p) => !p.open);
      await finishReview();
    },
    browserTimeout(40000, 60000),
  );

  test(
    "Review mode reviews only the selection, rechecks after edits, and follows scrolling",
    async () => {
      await prepareReviewPage();
      await setTextarea("Teh one. Teh two. Teh three.", [9, 17]);
      await triggerReview(worker!);
      let panel = await waitForReview(page, "selection scope", (p) => p.status === "Issues: 1");
      expect(panel.items[0].text).toBe("Teh → The");
      await clickReviewControl(page, "[data-action=fix-all]");
      await waitUntil(
        "scoped fix",
        async () => (await textareaValue()) === "Teh one. The two. Teh three.",
        { timeoutMs: 5000 },
      );

      // An edit invalidates at once and rechecks after a pause (whole-field review).
      await page.keyboard.press("Escape");
      await setTextarea("Short.", [6, 6]);
      await triggerReview(worker!);
      await waitForReview(
        page,
        "clean",
        (p) => p.status === "No issues found by the review checks.",
      );
      await page.focus("#test-textarea");
      // Suggestions keep working in the reviewed editor; Escape closes their
      // popup first, then the review.
      await page.keyboard.type(" h");
      await waitForVisibleSuggestions(page);
      await page.keyboard.press("Escape");
      await waitForNoVisibleSuggestions(page);
      expect((await readReviewPanel(page)).open).toBe(true);
      await page.keyboard.press("Escape");
      await waitForReview(page, "closed after popup", (p) => !p.open);

      await setTextarea("Short.", [6, 6]);
      await triggerReview(worker!);
      await waitForReview(
        page,
        "clean again",
        (p) => p.status === "No issues found by the review checks.",
      );
      await page.focus("#test-textarea");
      await page.keyboard.type(" Teh");
      await waitForReview(page, "recheck after typing", (p) => p.status === "Issues: 1");
      expect(await textareaValue()).toBe("Short. Teh");
      await clickReviewControl(page, "[data-action=close]");
      await waitForReview(page, "closed", (p) => !p.open);

      // Marks follow the textarea's own scrolling.
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i} is fine.`).join("\n");
      await setTextarea(`${lines}\nFinal teh line.`, [0, 0]);
      await page.$eval("#test-textarea", (el) => ((el as HTMLTextAreaElement).scrollTop = 0));
      await triggerReview(worker!);
      await waitForReview(page, "scroll finding", (p) => p.items.length === 1);
      expect((await readReviewPanel(page)).marks).toHaveLength(0);
      await page.$eval("#test-textarea", (el) => ((el as HTMLTextAreaElement).scrollTop = 10000));
      panel = await waitForReview(page, "mark after scroll", (p) => p.marks.length === 1);
      const box = await page.$eval("#test-textarea", (el) => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      });
      expect(panel.marks[0].top).toBeGreaterThan(box.top);
      expect(panel.marks[0].top + panel.marks[0].height).toBeLessThan(box.bottom);
      await finishReview();
    },
    browserTimeout(50000, 70000),
  );

  test(
    "ProseMirror typing correction preserves marks and native undo without replay",
    async () => {
      await prepareReviewPage({ enableProseMirror: true });
      await setGrammarRulesAndWait(worker!, ["englishTypoWhitelistCorrection"]);
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 20);
      await applyConfigChange(browser, worker!);
      await page.evaluate(() => {
        const view = window.__testProseMirror!;
        const doc = view.state.schema.nodeFromJSON({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "We saw ",
                  marks: [
                    { type: "strong" },
                    { type: "link", attrs: { href: "https://example.com/keep", title: "Keep" } },
                  ],
                },
              ],
            },
          ],
        });
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
        view.focus();
      });
      await page.keyboard.press("End");
      await page.keyboard.type("teh ");
      await waitUntil(
        "ProseMirror live correction updates model",
        async () =>
          await page.evaluate(
            () => window.__testProseMirror!.state.doc.textContent === "We saw the ",
          ),
      );
      expect(
        await page.evaluate(() =>
          window
            .__testProseMirror!.state.doc.child(0)
            .child(0)
            .marks.map((mark) => mark.toJSON()),
        ),
      ).toEqual([
        { type: "link", attrs: { href: "https://example.com/keep", title: "Keep" } },
        { type: "strong" },
      ]);
      expect(
        await page.evaluate(() => window.__testProseMirror!.state.doc.child(0).lastChild!.toJSON()),
      ).toEqual({ type: "text", text: "the ", marks: [{ type: "strong" }] });
      await pressNativeUndo(page, PROSEMIRROR_SELECTOR);
      await waitUntil(
        "ProseMirror correction undo keeps typed text",
        async () =>
          await page.evaluate(
            () => window.__testProseMirror!.state.doc.textContent === "We saw teh ",
          ),
      );
      await page.keyboard.type("cat.");
      await waitUntil(
        "ProseMirror typing after undo stays consistent",
        async () =>
          await page.evaluate(
            () => window.__testProseMirror!.state.doc.textContent === "We saw teh cat.",
          ),
      );
      await finishReview();
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
    },
    browserTimeout(30000, 50000),
  );

  test(
    "ProseMirror Review applies individual and batch corrections with split marks, model integrity and native history",
    async () => {
      await prepareReviewPage({ enableProseMirror: true });
      await page.evaluate(() => {
        const view = window.__testProseMirror!;
        const schema = view.state.schema;
        const doc = schema.nodeFromJSON({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "We saw " },
                { type: "text", text: "te", marks: [{ type: "strong" }] },
                { type: "text", text: "h", marks: [{ type: "em" }] },
                { type: "text", text: " cat and " },
                {
                  type: "text",
                  text: "teh",
                  marks: [
                    { type: "link", attrs: { href: "https://example.com/keep", title: "Keep" } },
                  ],
                },
                { type: "text", text: " dog." },
              ],
            },
            { type: "code_block", content: [{ type: "text", text: "teh protected" }] },
            {
              type: "paragraph",
              content: [
                { type: "image", attrs: { src: "/favicon.ico", alt: "keep", title: "keep" } },
              ],
            },
          ],
        });
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
      });
      // Real browser click, not the fixture's view.focus(): exercise normal discovery.
      await page.click(`${PROSEMIRROR_SELECTOR} p`);
      const model = () => page.evaluate(() => window.__testProseMirror!.state.doc.toJSON());
      const original = await model();
      await triggerReview(worker!);
      const panel = await waitForReview(
        page,
        "ProseMirror findings",
        (p) => p.items.filter((item) => item.text === "teh → the").length === 2,
      );
      expect(panel.notes).not.toContain("Review only");
      expect(panel.fixAll.hidden).toBe(false);
      const finding = panel.items.find((item) => item.text === "teh → the")!;
      await clickReviewControl(page, `.item[data-id="${finding.id}"]`);
      await waitForReview(
        page,
        "ProseMirror individual card",
        (p) => p.card.open && !p.card.applyDisabled,
      );
      await clickReviewControl(page, '.card [data-action="apply"]');
      await waitUntil(
        "ProseMirror individual corrected in model",
        async () =>
          await page.evaluate(
            () =>
              window.__testProseMirror!.state.doc.child(0).textContent ===
              "We saw the cat and teh dog.",
          ),
      );
      const individual = await model();
      expect(individual.content[0].content.slice(1, 3)).toEqual([
        { type: "text", text: "th", marks: [{ type: "strong" }] },
        { type: "text", text: "e", marks: [{ type: "em" }] },
      ]);
      await finishReview();
      await page.focus(PROSEMIRROR_SELECTOR);
      await pressNativeUndo(page, PROSEMIRROR_SELECTOR);
      await waitUntil(
        "ProseMirror individual native undo",
        async () => JSON.stringify(await model()) === JSON.stringify(original),
      );
      await setGrammarRulesAndWaitStable(
        worker!,
        DEFAULT_CURRENT_GRAMMAR_RULES,
        3,
        browserTimeout(5000, 7000),
      );
      await applyConfigChange(browser, worker!);
      await page.focus(PROSEMIRROR_SELECTOR);
      await triggerReview(worker!);
      await waitForReview(
        page,
        "ProseMirror batch ready",
        (p) =>
          !p.fixAll.disabled && p.items.filter((item) => item.text === "teh → the").length === 2,
      );
      await clickReviewControl(page, '[data-action="fix-all"]');
      await waitUntil(
        "ProseMirror batch corrected in model",
        async () =>
          await page.evaluate(
            () =>
              window.__testProseMirror!.state.doc.child(0).textContent ===
              "We saw the cat and the dog.",
          ),
      );
      const corrected = await model();
      expect(corrected.content.slice(1)).toEqual(original.content.slice(1));
      expect(
        corrected.content[0].content.find((node: { marks?: { type: string }[] }) =>
          node.marks?.some((mark) => mark.type === "link"),
        ),
      ).toEqual({
        type: "text",
        text: "the",
        marks: [{ type: "link", attrs: { href: "https://example.com/keep", title: "Keep" } }],
      });
      await page.evaluate(() => {
        const view = window.__testProseMirror!;
        view.updateState(view.state.reconfigure({ plugins: view.state.plugins }));
      });
      expect(await model()).toEqual(corrected);
      await finishReview();
      await pressNativeUndo(page, PROSEMIRROR_SELECTOR);
      await waitUntil(
        "ProseMirror batch native undo",
        async () => JSON.stringify(await model()) === JSON.stringify(original),
      );
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(modifier);
      await page.keyboard.down("Shift");
      await page.keyboard.press("z");
      await page.keyboard.up("Shift");
      await page.keyboard.up(modifier);
      await waitUntil(
        "ProseMirror batch native redo",
        async () => JSON.stringify(await model()) === JSON.stringify(corrected),
      );
    },
    browserTimeout(50000, 70000),
  );

  test(
    "Review mode refuses sensitive fields and model-backed editors stay review-only",
    async () => {
      await prepareReviewPage({ enableLexical: true });
      await page.evaluate(() => {
        const input = document.createElement("input");
        input.type = "password";
        input.id = "test-review-password";
        input.value = "teh secret";
        document.querySelector(".container")!.append(input);
        input.focus();
      });
      await triggerReview(worker!);
      let panel = await waitForReview(page, "sensitive notice", (p) => p.open);
      expect(panel.status).toContain("excluded from review");
      expect(panel.items).toEqual([]);
      await page.keyboard.press("Escape");
      await waitForReview(page, "notice closed", (p) => !p.open);

      // Type with live grammar off (it would correct "teh"), then review with it on.
      await setGrammarRulesAndWait(worker!, []);
      await applyConfigChange(browser, worker!);
      await waitForInputReady(page, LEXICAL_SELECTOR);
      await page.focus(LEXICAL_SELECTOR);
      await page.keyboard.type("We saw teh cat.");
      await setGrammarRulesAndWaitStable(
        worker!,
        DEFAULT_CURRENT_GRAMMAR_RULES,
        3,
        browserTimeout(5000, 7000),
      );
      await applyConfigChange(browser, worker!);
      await page.focus(LEXICAL_SELECTOR);
      await triggerReview(worker!);
      panel = await waitForReview(page, "lexical findings", (p) => p.status === "Issues: 1");
      expect(panel.notes).toContain("Review only");
      expect(panel.fixAll.hidden).toBe(true);
      await clickReviewControl(page, `.item[data-id="${panel.items[0].id}"]`);
      panel = await waitForReview(page, "lexical card", (p) => p.card.open);
      expect(panel.card.applyDisabled).toBe(true);
      expect(await page.$eval(LEXICAL_SELECTOR, (el) => el.textContent)).toBe("We saw teh cat.");
      await finishReview();
    },
    browserTimeout(50000, 70000),
  );

  test(
    "Review notice in a modal dialog opens inside the dialog; its close button and Escape dismiss only the notice",
    async () => {
      await prepareReviewPage();
      await page.evaluate(() => {
        const dialog = document.createElement("dialog");
        dialog.id = "notice-dialog";
        const input = document.createElement("input");
        input.type = "password";
        input.id = "notice-password";
        input.value = "teh secret";
        dialog.append(input);
        document.body.append(dialog);
        dialog.showModal();
        input.focus();
      });
      const state = () =>
        page.evaluate(() => ({
          dialogOpen: document.querySelector<HTMLDialogElement>("#notice-dialog")!.open,
          noticeParent: document.querySelector("[data-fluenttyper-review]")?.parentElement?.id,
          focused: document.activeElement?.id ?? "",
        }));
      try {
        // Everything outside a modal dialog is inert: the notice goes inside it.
        await triggerReview(worker!);
        const panel = await waitForReview(page, "notice", (p) => p.open);
        expect(panel.status).toContain("excluded from review");
        expect((await state()).noticeParent).toBe("notice-dialog");
        await clickReviewControl(page, "[data-action=close]");
        await waitForReview(page, "closed by its button", (p) => !p.open);
        expect(await state()).toEqual({
          dialogOpen: true,
          noticeParent: undefined,
          focused: "notice-password",
        });

        // Escape closes the notice, not the page's dialog.
        await triggerReview(worker!);
        await waitForReview(page, "notice again", (p) => p.open);
        await page.keyboard.press("Escape");
        await waitForReview(page, "closed by Escape", (p) => !p.open);
        expect((await state()).dialogOpen).toBe(true);
      } finally {
        await page.evaluate(() => {
          const dialog = document.querySelector<HTMLDialogElement>("#notice-dialog");
          dialog?.close();
          dialog?.remove();
        });
      }
      await finishReview();
    },
    browserTimeout(30000, 45000),
  );

  test(
    "Review mode refuses fixes that a full field's maxlength would cut, and writes nothing",
    async () => {
      await prepareReviewPage();
      // A full field. Fix all writes one merged edit, which the browser would cut
      // at the limit ("I don't know th cat").
      const full = "i dont know teh cat";
      await page.$eval("#test-textarea", (el) => el.setAttribute("maxlength", "19"));
      try {
        await setTextarea(full);
        await triggerReview(worker!);
        let panel = await waitForReview(page, "findings", (p) => p.status === "Issues: 3");
        await clickReviewControl(page, "[data-action=fix-all]");
        panel = await waitForReview(page, "refused", (p) =>
          p.status.includes("The editor refused the change."),
        );
        expect(await textareaValue()).toBe(full);
        expect(panel.items).toHaveLength(3);
      } finally {
        await page.$eval("#test-textarea", (el) => el.removeAttribute("maxlength"));
      }
      await finishReview();
    },
    browserTimeout(30000, 45000),
  );

  devRuntimeTest(
    "CMD_REVIEW_FT_ACTIVE_TAB command reviews the focused editor through the command router",
    async () => {
      await prepareReviewPage();
      await setTextarea("We saw teh cat.");
      await triggerCommandForTesting(worker!, "CMD_REVIEW_FT_ACTIVE_TAB");
      const panel = await waitForReview(page, "command review", (p) => p.status === "Issues: 1");
      expect(panel.items[0].text).toBe("teh \u2192 the");
      expect(await textareaValue()).toBe("We saw teh cat.");
      await finishReview();
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Review text from the popup reviews a Google Docs page whose focus returns into its input frame",
    async () => {
      // The synthetic Docs editor (mocked annotated-text API, no network) served
      // at a Docs URL, so the installed extension runs its real Docs support.
      const docsUrl = "https://docs.google.com/document/d/fluenttyper-e2e/edit";
      const fixture = await fs.promises.readFile(
        path.join(import.meta.dir, "fixtures/google-docs/editor.html"),
        "utf8",
      );
      await prepareReviewPage();
      const docsPage = await browser.newPage();
      const away = await browser.newPage();
      try {
        await docsPage.setRequestInterception(true);
        docsPage.on("request", (request) => {
          if (request.url().startsWith(docsUrl)) {
            void request.respond({ status: 200, contentType: "text/html", body: fixture });
          } else {
            void request.abort();
          }
        });
        await docsPage.goto(docsUrl, { waitUntil: "domcontentloaded" });
        await docsPage.bringToFront();
        await docsPage.evaluate(() => {
          const w = window as unknown as {
            setModel: (text: string) => void;
            focusEditor: () => void;
          };
          w.setModel("We saw teh cat.");
          w.focusEditor();
        });
        await waitUntil(
          "Docs support reads the document",
          () =>
            docsPage.evaluate(
              () =>
                (window as unknown as { _docs_annotate_canvas_by_ext?: unknown })
                  ._docs_annotate_canvas_by_ext != null &&
                document.activeElement?.tagName === "IFRAME",
            ),
          { timeoutMs: browserTimeout(5000, 8000) },
        );
        // The tab the popup was opened on.
        const tabId = await worker!.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          return tab?.id ?? -1;
        });
        // The popup holds focus while the request is sent, then closes, and the
        // browser puts focus back into Docs' input frame, not the top document.
        await away.bringToFront();
        await waitUntil("the Docs page lost focus", async () =>
          docsPage.evaluate(() => !document.hasFocus()),
        );
        await worker!.evaluate(async (id) => {
          await chrome.tabs
            .sendMessage(id, { command: "CMD_REVIEW_FT_ACTIVE_TAB", context: { source: "popup" } })
            .catch(() => undefined);
        }, tabId);
        await docsPage.bringToFront();
        const panel = await waitForReview(
          docsPage,
          "Docs review from the popup",
          (p) => p.status === "Issues: 1",
        );
        expect(panel.items.map((item) => item.text)).toEqual(["teh → the"]);
        // Reviewing changed nothing.
        expect(
          await docsPage.evaluate(() => (window as unknown as { model: { text: string } }).model),
        ).toMatchObject({ text: "We saw teh cat." });

        // The keyboard shortcut (what the command router sends), pressed while typing in Docs.
        await clickReviewControl(docsPage, "[data-action=close]");
        await waitUntil("review closed", async () => !(await readReviewPanel(docsPage)).open);
        await docsPage.evaluate(() =>
          (window as unknown as { focusEditor: () => void }).focusEditor(),
        );
        await triggerReview(worker!);
        await waitForReview(
          docsPage,
          "Docs review from the shortcut",
          (p) => p.status === "Issues: 1",
        );
      } finally {
        await away.close().catch(() => undefined);
        await docsPage.close().catch(() => undefined);
        await page.bringToFront();
        await finishReview();
      }
    },
    browserTimeout(30000, 50000),
  );

  test(
    "Review mode handles wrapping, resize, RTL, hi-DPI hit-testing, dark mode, IME, multiple fields and navigation cleanup",
    async () => {
      await prepareReviewPage();
      const viewport = page.viewport();
      // Hit-testing and mirror measurement at device pixel ratio 2.
      await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 2 });
      if (!isFirefox()) {
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
      }
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
      // A finding that wraps across two lines gets one mark per line box.
      await page.evaluate(() => {
        const field = document.querySelector("#test-textarea") as HTMLTextAreaElement;
        field.style.width = "160px";
        field.value = "Fine words here. Thanks, your welcome";
        field.focus();
        field.setSelectionRange(0, 0);
      });
      await triggerReview(worker!);
      let panel = await waitForReview(page, "wrapped finding", (p) => p.status === "Issues: 1");
      const wrappedMarks = panel.marks.length;
      expect(wrappedMarks).toBeGreaterThanOrEqual(1);
      if (!isFirefox()) {
        const background = await page.evaluate(() => {
          const node = document
            .querySelector("[data-fluenttyper-review]")!
            .shadowRoot!.querySelector(".panel") as HTMLElement;
          return getComputedStyle(node).backgroundColor;
        });
        // The dark palette: a dark panel background.
        const [r, g, b] = background.match(/\d+/g)!.map(Number);
        expect(r + g + b).toBeLessThan(200);
      }
      // Resizing the field re-measures the marks.
      const before = panel.marks.map((mark) => mark.left).join(",");
      await page.evaluate(() => {
        (document.querySelector("#test-textarea") as HTMLTextAreaElement).style.width = "480px";
      });
      panel = await waitForReview(
        page,
        "re-measured marks",
        (p) => p.marks.length >= 1 && p.marks.map((mark) => mark.left).join(",") !== before,
      );
      // A click at the mark's own center hits the same finding (works at any device scale).
      const mark = panel.marks[0];
      await page.mouse.click(mark.left + mark.width / 2, mark.top + mark.height / 2 - 2);
      await waitForReview(page, "card from mark", (p) => p.card.open);

      // IME composition pauses the review; its end rechecks.
      await page.evaluate(() => {
        const field = document.querySelector("#test-textarea") as HTMLTextAreaElement;
        field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      });
      await waitForReview(page, "composition pause", (p) =>
        p.status.includes("Paused while you compose"),
      );
      await page.evaluate(() => {
        const field = document.querySelector("#test-textarea") as HTMLTextAreaElement;
        field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      });
      await waitForReview(page, "composition end", (p) => p.status === "Issues: 1");

      // Reviewing another field closes the first review and scans the new one only.
      await page.evaluate(() => {
        const root = document.querySelector("#test-contenteditable") as HTMLElement;
        root.setAttribute("dir", "rtl");
        root.textContent = "We saw teh cat and teh dog.";
        root.focus();
      });
      await triggerReview(worker!);
      panel = await waitForReview(page, "second field", (p) => p.status === "Issues: 2");
      expect(
        await page.evaluate(() => document.querySelectorAll("[data-fluenttyper-review]").length),
      ).toBe(1);
      // RTL editors get their highlights from the text's own geometry.
      expect(panel.highlights).toEqual(["fluenttyper-review-spelling"]);

      // Navigating away removes every highlight and the panel.
      if (!isFirefox()) await page.emulateMediaFeatures([]);
      await page.setViewport(viewport);
      await gotoTestPage(page, { enableCkEditor: false });
      await waitForInputReady(page, "#test-textarea");
      const after = await readReviewPanel(page);
      expect(after.open).toBe(false);
      expect(after.highlights).toEqual([]);
      await finishReview();
    },
    browserTimeout(50000, 70000),
  );

  test(
    "Review mode works inside a modal dialog, returns focus, stays LTR on RTL pages and fits small viewports",
    async () => {
      await prepareReviewPage();
      const viewport = page.viewport();
      // Inside a modal dialog everything outside it is inert: the panel must still work.
      await page.evaluate(() => {
        const dialog = document.createElement("dialog");
        dialog.id = "review-dialog";
        const field = document.createElement("textarea");
        field.id = "dialog-field";
        field.value = "We saw teh cat.";
        dialog.append(field);
        document.body.append(dialog);
        dialog.showModal();
        field.focus();
        field.setSelectionRange(0, 0);
      });
      await triggerReview(worker!);
      await waitForReview(page, "dialog review", (p) => p.status === "Issues: 1");
      expect(
        await page.evaluate(
          () => !!document.querySelector("#review-dialog [data-fluenttyper-review]"),
        ),
      ).toBe(true);
      await clickReviewControl(page, "[data-action=fix-all]");
      await waitUntil(
        "fixed inside the dialog",
        () =>
          page.evaluate(
            () =>
              (document.querySelector("#dialog-field") as HTMLTextAreaElement).value ===
              "We saw the cat.",
          ),
        { timeoutMs: 5000 },
      );
      // Closed from the panel with Escape: the keyboard returns to the field.
      await page.evaluate(() => {
        const root = document.querySelector("[data-fluenttyper-review]")!.shadowRoot!;
        (root.querySelector("h2") as HTMLElement).focus();
      });
      await page.keyboard.press("Escape");
      await waitForReview(page, "closed", (p) => !p.open);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("dialog-field");
      await page.evaluate(() => {
        const dialog = document.querySelector("#review-dialog") as HTMLDialogElement;
        dialog.close();
        dialog.remove();
      });

      // An RTL page: the English panel and card stay left-to-right.
      await page.evaluate(() => document.documentElement.setAttribute("dir", "rtl"));
      await setTextarea("We saw teh cat.");
      await triggerReview(worker!);
      await waitForReview(page, "rtl review", (p) => p.status === "Issues: 1");
      await clickReviewControl(page, ".item");
      await waitForReview(page, "rtl card", (p) => p.card.open);
      expect(
        await page.evaluate(() => {
          const root = document.querySelector("[data-fluenttyper-review]")!.shadowRoot!;
          return [".panel", ".card"].map(
            (selector) => getComputedStyle(root.querySelector(selector)!).direction,
          );
        }),
      ).toEqual(["ltr", "ltr"]);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await waitForReview(page, "rtl closed", (p) => !p.open);
      await page.evaluate(() => document.documentElement.removeAttribute("dir"));

      // A small viewport (like 200% zoom on a phone): the panel stays on screen
      // and Fix all stays reachable.
      await page.setViewport({ width: 360, height: 320 });
      await setTextarea("i think teh plan is ok , but their is alot to do. We could of won.");
      await triggerReview(worker!);
      await waitForReview(page, "small review", (p) => /^Issues: \d+/.test(p.status));
      const box = await page.evaluate(() => {
        const panel = document
          .querySelector("[data-fluenttyper-review]")!
          .shadowRoot!.querySelector(".panel")!;
        const rect = panel.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: window.innerHeight };
      });
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(box.height);
      await clickReviewControl(page, "[data-action=fix-all]");
      await waitUntil(
        "fixed from a small viewport",
        () =>
          page.evaluate(() =>
            (document.querySelector("#test-textarea") as HTMLTextAreaElement).value.startsWith(
              "I think the plan",
            ),
          ),
        { timeoutMs: 5000 },
      );
      await page.setViewport(viewport);
      await finishReview();
    },
    browserTimeout(40000, 60000),
  );
});
