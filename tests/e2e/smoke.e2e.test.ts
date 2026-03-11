import type { Browser, Page } from "puppeteer";
import path from "path";
import * as fs from "fs";
import type { Server } from "http";
import { createServer } from "http";
import type { BackgroundContext } from "./e2e-helpers";
import {
  BROWSER_TYPE,
  getBackgroundContext,
  getTimeoutProfile,
  isFirefox,
  launchBrowser,
  openExtensionPage,
  openPopupPage,
  waitUntil,
  suiteTimeout,
} from "./e2e-helpers";
import {
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  KEY_DOMAIN_LIST_MODE,
  KEY_EXTENSION_LANGUAGE,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_LANGUAGE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
  KEY_TEXT_EXPANSIONS,
} from "../../src/core/domain/constants";
import { RECOMMENDED_V3_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "../../src/core/domain/themeDefaults";

const RUN_E2E = process.env.RUN_E2E === "1" || process.env.RUN_E2E === "true";
const describeE2E = RUN_E2E ? describe : describe.skip;

const TEST_PAGE_PATH = path.resolve(__dirname, "test-page.html");
const TEST_HOST = "localhost";
const SETTINGS_PREFIX = "store.settings.";
const timeoutProfile = getTimeoutProfile();

type PredictorDebugSnapshot = {
  config?: {
    aiPredictorEnabled?: boolean;
  };
  runtime?: {
    webllm?: {
      enabled?: boolean;
    };
  };
};

type TestNameContext = {
  fullName?: string;
  name?: string;
};

type TrackedTestCallback = (...args: unknown[]) => unknown;
type TestRegistrarLike = {
  (name: string, fn: TrackedTestCallback, timeout?: number): unknown;
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
  const tracked = ((name: string, callback: TrackedTestCallback, timeout?: number) =>
    base(name, wrapTrackedTestCallback(name, callback), timeout)) as TestRegistrarLike;

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

type SettingEntry = readonly [key: string, value: unknown];

let domainTestUrl = "";
let activeBrowserForWorkerRecovery: Browser | null = null;
let settingsDirty = true;

const STATIC_DEFAULT_SETTINGS: readonly SettingEntry[] = [
  [KEY_MIN_WORD_LENGTH_TO_PREDICT, 1],
  [KEY_NUM_SUGGESTIONS, 5],
  [KEY_INLINE_SUGGESTION, false],
  [KEY_SITE_PROFILES, {}],
  ["enable", true],
];

const SUGGESTION_THEME_RESET_SETTINGS: readonly SettingEntry[] = Object.entries(
  DEFAULT_SUGGESTION_THEME_SETTINGS,
).map(([key, value]) => [key, value] as const);

const SUGGESTION_THEME_SETTING_KEYS = SUGGESTION_THEME_RESET_SETTINGS.map(([key]) => key);

const PER_TEST_RESET_SETTINGS: readonly SettingEntry[] = [
  [KEY_ENABLED_LANGUAGES, ["en_US", "de_DE", "textExpander"]],
  [KEY_LANGUAGE, "en_US"],
  [KEY_TEXT_EXPANSIONS, []],
  [KEY_ENABLED_GRAMMAR_RULES, []],
  [KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true],
  [KEY_DOMAIN_LIST_MODE, "blackList"],
  ["domainBlackList", []],
  ...SUGGESTION_THEME_RESET_SETTINGS,
];

function isRetriableWorkerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /chrome\.storage\.local is unavailable|reading 'local'|Execution context was destroyed|Execution context is not available in detached frame or worker|Cannot find context with specified id|Target closed|Session closed|NoSuchFrameError|Browsing Context with id .* not found/i.test(
    message,
  );
}

async function reacquireWorker(browser: Browser): Promise<BackgroundContext> {
  return await waitUntil(
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
    { timeoutMs: suiteTimeout(5000, 10000), intervalMs: 100 },
  );
}

async function ensureWorker(
  browser: Browser,
  currentWorker: BackgroundContext | undefined,
): Promise<BackgroundContext> {
  if (currentWorker) {
    if ("isClosed" in currentWorker && typeof currentWorker.isClosed === "function") {
      if (!currentWorker.isClosed()) {
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
          return currentWorker;
        } catch (error) {
          if (!isRetriableWorkerError(error)) {
            throw error;
          }
        }
      }
    } else {
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
        return currentWorker;
      } catch (error) {
        if (!isRetriableWorkerError(error)) {
          throw error;
        }
      }
    }
  }

  return reacquireWorker(browser);
}

async function setSetting(worker: BackgroundContext, key: string, value: unknown): Promise<void> {
  settingsDirty = true;
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  let workerContext = worker;
  await waitUntil(
    `setting ${key} write`,
    async () => {
      try {
        await workerContext.evaluate(
          (storageKeyInner, nextValue) =>
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
              storage.set({ [storageKeyInner]: JSON.stringify(nextValue) }, () => {
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
        return true;
      } catch (error) {
        if (!isRetriableWorkerError(error)) {
          throw error;
        }
        if (activeBrowserForWorkerRecovery) {
          workerContext = await reacquireWorker(activeBrowserForWorkerRecovery);
        }
        return false;
      }
    },
    { timeoutMs: 4000, intervalMs: 100 },
  );
}

async function getSetting<T>(worker: BackgroundContext, key: string): Promise<T | undefined> {
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  let workerContext = worker;
  const result = await waitUntil<{ value: T | undefined }>(
    `setting ${key} read`,
    async () => {
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
              storage.get(storageKeyInner, (resultInner) => {
                const runtime = (
                  globalThis as typeof globalThis & {
                    chrome?: typeof chrome;
                  }
                ).chrome?.runtime;
                if (runtime?.lastError) {
                  reject(new Error(runtime.lastError.message));
                  return;
                }
                const rawValue = (resultInner as Record<string, string | undefined>)[
                  storageKeyInner
                ];
                resolve(rawValue ? JSON.parse(rawValue) : undefined);
              });
            }),
          storageKey,
        )) as T | undefined;
        return { value };
      } catch (error) {
        if (!isRetriableWorkerError(error)) {
          throw error;
        }
        if (activeBrowserForWorkerRecovery) {
          workerContext = await reacquireWorker(activeBrowserForWorkerRecovery);
        }
        return false;
      }
    },
    { timeoutMs: 4000, intervalMs: 100 },
  );
  return result.value;
}

async function setSettingAndWait(
  worker: BackgroundContext,
  key: string,
  value: unknown,
): Promise<void> {
  await setSetting(worker, key, value);
  const expected = JSON.stringify(value);
  await waitUntil(
    `setting ${key} to stabilize`,
    async () => {
      const current = await getSetting<unknown>(worker, key);
      return JSON.stringify(current) === expected ? true : false;
    },
    { timeoutMs: 5000, intervalMs: 50 },
  );
}

async function setSettingsAndWait(
  worker: BackgroundContext,
  settings: readonly SettingEntry[],
): Promise<void> {
  if (settings.length === 0) {
    return;
  }
  settingsDirty = true;

  const expectedByStorageKey = Object.fromEntries(
    settings.map(([key, value]) => [`${SETTINGS_PREFIX}${key}`, JSON.stringify(value)]),
  );
  const storageKeys = Object.keys(expectedByStorageKey);
  let workerContext = worker;

  await waitUntil(
    "batched settings write",
    async () => {
      try {
        await workerContext.evaluate(
          (serializedValues) =>
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
              storage.set(serializedValues, () => {
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
          expectedByStorageKey,
        );
        return true;
      } catch (error) {
        if (!isRetriableWorkerError(error)) {
          throw error;
        }
        if (activeBrowserForWorkerRecovery) {
          workerContext = await reacquireWorker(activeBrowserForWorkerRecovery);
        }
        return false;
      }
    },
    { timeoutMs: 4000, intervalMs: 100 },
  );

  await waitUntil(
    "batched settings to stabilize",
    async () => {
      try {
        const currentValues = (await workerContext.evaluate(
          (storageKeysInner) =>
            new Promise<Record<string, string | undefined>>((resolve, reject) => {
              const storage = (
                globalThis as typeof globalThis & {
                  chrome?: typeof chrome;
                }
              ).chrome?.storage?.local;
              if (!storage) {
                reject(new Error("chrome.storage.local is unavailable"));
                return;
              }
              storage.get(storageKeysInner, (resultInner) => {
                const runtime = (
                  globalThis as typeof globalThis & {
                    chrome?: typeof chrome;
                  }
                ).chrome?.runtime;
                if (runtime?.lastError) {
                  reject(new Error(runtime.lastError.message));
                  return;
                }
                resolve(resultInner as Record<string, string | undefined>);
              });
            }),
          storageKeys,
        )) as Record<string, string | undefined>;

        return storageKeys.every(
          (storageKey) => currentValues[storageKey] === expectedByStorageKey[storageKey],
        )
          ? true
          : false;
      } catch (error) {
        if (!isRetriableWorkerError(error)) {
          throw error;
        }
        if (activeBrowserForWorkerRecovery) {
          workerContext = await reacquireWorker(activeBrowserForWorkerRecovery);
        }
        return false;
      }
    },
    { timeoutMs: 5000, intervalMs: 50 },
  );
}

async function clearSettingsAndWait(
  worker: BackgroundContext,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  settingsDirty = true;

  const storageKeys = keys.map((key) => `${SETTINGS_PREFIX}${key}`);
  let workerContext = worker;

  await waitUntil(
    "batched settings clear",
    async () => {
      try {
        await workerContext.evaluate(
          (storageKeysInner) =>
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
              storage.remove(storageKeysInner, () => {
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
          storageKeys,
        );
        return true;
      } catch (error) {
        if (!isRetriableWorkerError(error)) {
          throw error;
        }
        if (activeBrowserForWorkerRecovery) {
          workerContext = await reacquireWorker(activeBrowserForWorkerRecovery);
        }
        return false;
      }
    },
    { timeoutMs: 4000, intervalMs: 100 },
  );

  await waitUntil(
    "cleared settings to stabilize",
    async () => {
      try {
        const currentValues = (await workerContext.evaluate(
          (storageKeysInner) =>
            new Promise<Record<string, string | undefined>>((resolve, reject) => {
              const storage = (
                globalThis as typeof globalThis & {
                  chrome?: typeof chrome;
                }
              ).chrome?.storage?.local;
              if (!storage) {
                reject(new Error("chrome.storage.local is unavailable"));
                return;
              }
              storage.get(storageKeysInner, (resultInner) => {
                const runtime = (
                  globalThis as typeof globalThis & {
                    chrome?: typeof chrome;
                  }
                ).chrome?.runtime;
                if (runtime?.lastError) {
                  reject(new Error(runtime.lastError.message));
                  return;
                }
                resolve(resultInner as Record<string, string | undefined>);
              });
            }),
          storageKeys,
        )) as Record<string, string | undefined>;

        return storageKeys.every((storageKey) => currentValues[storageKey] === undefined)
          ? true
          : false;
      } catch (error) {
        if (!isRetriableWorkerError(error)) {
          throw error;
        }
        if (activeBrowserForWorkerRecovery) {
          workerContext = await reacquireWorker(activeBrowserForWorkerRecovery);
        }
        return false;
      }
    },
    { timeoutMs: 5000, intervalMs: 50 },
  );
}

async function sendConfigChange(browser: Browser, worker: BackgroundContext): Promise<void> {
  const send = async (context: BackgroundContext): Promise<void> => {
    await context.evaluate((command) => {
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
  };

  if (isFirefox()) {
    await send(worker);
    return;
  }

  const optionsPage = await openExtensionPage(browser, worker, "options/options.html");
  try {
    await send(optionsPage as BackgroundContext);
  } finally {
    if (!optionsPage.isClosed()) {
      await optionsPage.close();
    }
  }
}

async function openOptionsPage(browser: Browser, worker: BackgroundContext): Promise<Page> {
  const optionsPage = await openExtensionPage(browser, worker, "options/options.html");
  await optionsPage.waitForSelector("#content", { timeout: timeoutProfile.navigationMs });
  return optionsPage;
}

async function waitForInputReady(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: timeoutProfile.inputReadyMs });
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.hasAttribute("data-suggestion") ?? false,
    { timeout: timeoutProfile.inputReadyMs },
    selector,
  );
}

async function gotoTestPage(page: Page): Promise<void> {
  const targetUrl = `${domainTestUrl}?${new URLSearchParams({ testName: currentE2ETestName }).toString()}`;
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutProfile.navigationMs,
  });
}

async function resetTestPageState(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __ftResetTestPage?: () => void;
      }
    ).__ftResetTestPage?.();
  });

  await waitUntil(
    "test page reset",
    async () => {
      const resetComplete = await page.evaluate(() => {
        const valuesCleared = Array.from(
          document.querySelectorAll("textarea, input, [contenteditable='true']"),
        ).every((element) => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return element.value === "";
          }
          return (
            !(element instanceof HTMLElement && element.isContentEditable) ||
            element.textContent === ""
          );
        });

        const disabledInput = document.getElementById("test-disabled");
        const readonlyInput = document.getElementById("test-readonly");

        return (
          valuesCleared &&
          disabledInput instanceof HTMLInputElement &&
          disabledInput.disabled &&
          readonlyInput instanceof HTMLInputElement &&
          readonlyInput.readOnly &&
          !document.querySelector("ft-shadow-test-component") &&
          !document.getElementById("ft-late-shadow-host") &&
          !document.getElementById("ft-nested-shadow-outer-host")
        );
      });
      return resetComplete ? true : false;
    },
    { timeoutMs: suiteTimeout(1500, 3000), intervalMs: 50 },
  );
}

async function prepareReusableTestPage(browser: Browser, page: Page | null): Promise<Page> {
  let nextPage = page;
  if (!nextPage || nextPage.isClosed()) {
    nextPage = await browser.newPage();
    nextPage.setDefaultNavigationTimeout(timeoutProfile.navigationMs);
  }

  await nextPage.bringToFront();
  if (!nextPage.url().startsWith(domainTestUrl)) {
    await gotoTestPage(nextPage);
  } else {
    await resetTestPageState(nextPage);
  }

  await waitForInputReady(nextPage, "#test-input");
  return nextPage;
}

async function waitForSuggestionTexts(page: Page): Promise<string[]> {
  const handle = await page.waitForFunction(
    () => {
      const getMenuRoot = (container: Element): ParentNode =>
        (container as HTMLElement).shadowRoot ?? container;
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
        const visibleTexts = Array.from(getMenuRoot(container).querySelectorAll("li[data-index]"))
          .map((li) => li.textContent ?? "")
          .filter((text) => text.length > 0);
        if (visibleTexts.length > 0) {
          return visibleTexts;
        }
      }
      return false;
    },
    { timeout: timeoutProfile.suggestionMs },
  );
  return (await handle.jsonValue()) as string[];
}

async function getVisibleSuggestionThemeSnapshot(page: Page): Promise<{
  backgroundColor: string;
  overrideCssText: string | null;
}> {
  const handle = await page.waitForFunction(
    () => {
      const getPanel = (container: Element): Element =>
        ((container as HTMLElement).shadowRoot?.querySelector(
          ".ft-suggestion-panel",
        ) as Element | null) ?? container;
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
        const overrideCssText =
          document.getElementById("fluent-typer-theme-overrides")?.textContent ?? null;
        return {
          backgroundColor: window.getComputedStyle(getPanel(container)).backgroundColor,
          overrideCssText,
        };
      }
      return false;
    },
    { timeout: timeoutProfile.suggestionMs },
  );
  return (await handle.jsonValue()) as {
    backgroundColor: string;
    overrideCssText: string | null;
  };
}

async function typeInInput(page: Page, selector: string, text: string): Promise<void> {
  await page.focus(selector);
  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Input element not found for selector: ${selector}`);
  }
  await element.type(text);
}

async function clearInputContent(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
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

async function waitForInputContentMatch(
  page: Page,
  selector: string,
  pattern: RegExp,
): Promise<string> {
  const handle = await page.waitForFunction(
    (sel, patternSource, patternFlags) => {
      const element = document.querySelector(sel) as HTMLInputElement | HTMLElement | null;
      const currentValue =
        (element as HTMLInputElement | null)?.value ?? element?.textContent ?? "";
      return new RegExp(patternSource, patternFlags).test(currentValue) ? currentValue : false;
    },
    { timeout: timeoutProfile.suggestionMs },
    selector,
    pattern.source,
    pattern.flags,
  );
  return (await handle.jsonValue()) as string;
}

async function applySettings(
  worker: BackgroundContext,
  settings: readonly SettingEntry[],
): Promise<void> {
  await setSettingsAndWait(worker, settings);
}

async function closePageSafely(pageToClose: Page | null | undefined): Promise<void> {
  if (!pageToClose || pageToClose.isClosed()) {
    return;
  }
  try {
    await pageToClose.close();
  } catch {
    // Ignore teardown races (target/session already closing).
  }
}

describeE2E(`E2E Smoke [${BROWSER_TYPE}]`, () => {
  let browser: Browser;
  let worker: BackgroundContext;
  let page: Page | null = null;
  let domainTestServer: Server;
  let domainTestHtml: string;

  beforeAll(async () => {
    browser = await launchBrowser();
    activeBrowserForWorkerRecovery = browser;
    worker = await reacquireWorker(browser);
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
        } catch {
          // Fall through to default HTML response.
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
        } catch {
          // Fall through to default HTML response.
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
      throw new Error("Failed to start domain test server");
    }
    domainTestUrl = `http://${TEST_HOST}:${address.port}/`;

    await applySettings(worker, STATIC_DEFAULT_SETTINGS);
    await sendConfigChange(browser, worker);
    settingsDirty = false;
  }, 60000);

  beforeEach(async () => {
    worker = await ensureWorker(browser, worker);
    if (settingsDirty) {
      await applySettings(worker, PER_TEST_RESET_SETTINGS);
      await sendConfigChange(browser, worker);
      settingsDirty = false;
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
    await closePageSafely(page);
    if ("isClosed" in worker && typeof worker.isClosed === "function") {
      await closePageSafely(worker);
    }
    try {
      await browser.close();
    } catch {
      // Ignore teardown races during browser shutdown.
    }
    activeBrowserForWorkerRecovery = null;
  }, 30000);

  test(
    "extension installation page is reachable",
    async () => {
      const installationPage = await openExtensionPage(
        browser,
        worker,
        "new_installation/index.html",
      );
      try {
        await installationPage.waitForSelector("body", {
          timeout: suiteTimeout(3000, 7000),
        });
      } finally {
        if (!installationPage.isClosed()) {
          await installationPage.close();
        }
      }
    },
    suiteTimeout(7000, 12000),
  );

  test(
    "onboarding playground manual attach icon enables the native autocomplete field",
    async () => {
      const installationPage = await openExtensionPage(
        browser,
        worker,
        "new_installation/index.html",
      );
      try {
        await installationPage.waitForSelector("#try-me-textarea", {
          timeout: suiteTimeout(3000, 7000),
        });
        await installationPage.waitForSelector("#try-native-list-input", {
          timeout: suiteTimeout(3000, 7000),
        });

        await installationPage.waitForFunction(
          () =>
            document
              .querySelector("#try-native-list-input")
              ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof
            HTMLButtonElement,
          { timeout: suiteTimeout(3000, 7000) },
        );

        const initialState = await installationPage.evaluate(() => ({
          standardAttached:
            document.querySelector("#try-me-textarea")?.hasAttribute("data-suggestion") ?? false,
          nativeAttached:
            document.querySelector("#try-native-list-input")?.hasAttribute("data-suggestion") ??
            false,
        }));
        expect(initialState.standardAttached).toBe(true);
        expect(initialState.nativeAttached).toBe(false);

        await installationPage.evaluate(() => {
          const button = document
            .querySelector("#try-native-list-input")
            ?.parentElement?.querySelector(".ft-manual-attach-button") as HTMLButtonElement | null;
          button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });

        await installationPage.waitForFunction(
          () => {
            const field = document.querySelector("#try-native-list-input");
            return field?.hasAttribute("data-suggestion") && document.activeElement === field;
          },
          { timeout: suiteTimeout(3000, 7000) },
        );
      } finally {
        if (!installationPage.isClosed()) {
          await installationPage.close();
        }
      }
    },
    suiteTimeout(8000, 14000),
  );

  test(
    "popup page loads",
    async () => {
      const popupPage = await openPopupPage(browser, worker);
      try {
        await popupPage.waitForSelector("body", {
          timeout: suiteTimeout(3000, 7000),
        });
      } finally {
        if (!popupPage.isClosed()) {
          await popupPage.close();
        }
      }
    },
    suiteTimeout(6000, 10000),
  );

  test(
    "fresh install suggestion popup keeps the default opaque theme",
    async () => {
      await clearSettingsAndWait(worker, SUGGESTION_THEME_SETTING_KEYS);
      await sendConfigChange(browser, worker);

      page = await prepareReusableTestPage(browser, page);

      await typeInInput(page, "#test-input", "h");
      await waitForSuggestionTexts(page);

      const themeSnapshot = await getVisibleSuggestionThemeSnapshot(page);

      expect(themeSnapshot.overrideCssText).toContain(
        `--suggestion-bg-light: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgLight}`,
      );
      expect(themeSnapshot.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(themeSnapshot.backgroundColor).not.toBe("transparent");
    },
    suiteTimeout(8000, 12000),
  );

  test("does not expose runtime command test hooks", async () => {
    const hasRuntimeHook = await worker.evaluate(() => {
      return (
        typeof (globalThis as { triggerCommandForTesting?: unknown }).triggerCommandForTesting ===
        "function"
      );
    });
    expect(hasRuntimeHook).toBe(false);
  }, 7000);

  test(
    "options workspace localizes shell copy and honors deep links",
    async () => {
      await setSettingAndWait(worker, KEY_EXTENSION_LANGUAGE, "fr_FR");

      if (isFirefox()) {
        await worker.evaluate(() => {
          localStorage.setItem("store.settings.extensionLanguage", JSON.stringify("fr_FR"));
        });
      }

      const optionsPage = await openExtensionPage(
        browser,
        worker,
        "options/options.html#advanced_tab",
      );
      try {
        if (!isFirefox()) {
          await optionsPage.evaluate(() => {
            localStorage.setItem("store.settings.extensionLanguage", JSON.stringify("fr_FR"));
          });
          await optionsPage.reload({ waitUntil: "domcontentloaded" });
        }

        await optionsPage.waitForSelector("#advanced_tab:not(.is-hidden)", {
          timeout: suiteTimeout(3000, 7000),
        });

        const snapshot = await optionsPage.evaluate(() => ({
          workspaceTitle: document.querySelector(".options-brand-title")?.textContent?.trim(),
          searchPlaceholder: (
            document.getElementById("options-search-input") as HTMLInputElement | null
          )?.placeholder,
          activeTabId:
            document.querySelector(".content-tab.is-active")?.getAttribute("data-tab-id") ?? "",
        }));

        expect(snapshot.workspaceTitle).toBe("Espace des paramètres");
        expect(snapshot.searchPlaceholder).toBe("Rechercher dans les paramètres");
        expect(snapshot.activeTabId).toBe("advanced_tab");
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.evaluate(() => {
            localStorage.setItem("store.settings.extensionLanguage", JSON.stringify("auto_detect"));
          });
          await optionsPage.close();
        }
        await setSettingAndWait(worker, KEY_EXTENSION_LANGUAGE, "auto_detect");
      }
    },
    suiteTimeout(8000, 14000),
  );

  test(
    "mobile section switcher changes the active options section and hash",
    async () => {
      const optionsPage = await openOptionsPage(browser, worker);
      try {
        await optionsPage.setViewport({ width: 390, height: 844, isMobile: true });

        await optionsPage.select("#mobile-section-select", "site_mgmt_tab");
        await optionsPage.waitForFunction(() => window.location.hash === "#site_mgmt_tab", {
          timeout: suiteTimeout(2000, 6000),
        });

        const state = await optionsPage.evaluate(() => ({
          activeTabId:
            document.querySelector(".content-tab.is-active")?.getAttribute("data-tab-id") ?? "",
        }));

        expect(state.activeTabId).toBe("site_mgmt_tab");
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    suiteTimeout(7000, 12000),
  );

  test(
    "popup advanced stats opens the options page at the advanced tab anchor",
    async () => {
      const popupPage = await openPopupPage(browser, worker);
      let advancedPage: Page | null = null;
      try {
        await popupPage.waitForSelector("#openStatsOptionsBtn", {
          timeout: suiteTimeout(3000, 7000),
        });
        const targetPromise = browser.waitForTarget(
          (target) =>
            target.type() === "page" && target.url().includes("options/options.html#advanced_tab"),
          { timeout: suiteTimeout(3000, 7000) },
        );

        await popupPage.click("#openStatsOptionsBtn");
        const target = await targetPromise;
        advancedPage = await target.asPage();
        expect(target.url()).toContain("options/options.html#advanced_tab");
      } finally {
        if (advancedPage && !advancedPage.isClosed()) {
          await advancedPage.close();
        }
        if (!popupPage.isClosed()) {
          await popupPage.close();
        }
      }
    },
    suiteTimeout(7000, 12000),
  );

  test(
    "keeps predictor debug panel hidden in options page",
    async () => {
      const optionsPage = await openOptionsPage(browser, worker);
      try {
        const debugRoot = await optionsPage.$("#predictorDebugRoot");
        expect(debugRoot).toBeNull();
        const toggleButtonCount = await optionsPage.$$eval(
          '[data-action="set-predictor-toggle"]',
          (buttons) => buttons.length,
        );
        expect(toggleButtonCount).toBe(0);
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    suiteTimeout(7000, 12000),
  );

  test(
    "reports AI predictor runtime disabled",
    async () => {
      const optionsPage = await openOptionsPage(browser, worker);
      try {
        const snapshot = await optionsPage.evaluate((command) => {
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

        expect(snapshot.config?.aiPredictorEnabled).toBe(false);
        expect(snapshot.runtime?.webllm?.enabled).toBe(false);
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    suiteTimeout(7000, 12000),
  );

  test(
    "grammar tab supports grouped rules, search/filter, and setting persistence",
    async () => {
      await setSettingAndWait(worker, KEY_ENABLED_GRAMMAR_RULES, []);
      await sendConfigChange(browser, worker);

      const optionsPage = await openOptionsPage(browser, worker);
      let selectedRuleId = "";
      try {
        const probe = await optionsPage.evaluate(() => {
          const tabAnchors = Array.from(document.querySelectorAll("#tab-container li a"));
          let grammarRoot: Element | null = null;

          for (const tabAnchor of tabAnchors) {
            if (!(tabAnchor instanceof HTMLElement)) {
              continue;
            }
            tabAnchor.click();
            const visibleTab = Array.from(document.querySelectorAll(".content-tab")).find(
              (tab) => !tab.classList.contains("is-hidden"),
            );
            const candidate = visibleTab?.querySelector(".grammar-rule-selector");
            if (candidate) {
              grammarRoot = candidate;
              break;
            }
          }

          if (!grammarRoot) {
            return { ok: false, error: "Grammar tab was not found" };
          }

          const countVisibleCards = () =>
            Array.from(grammarRoot.querySelectorAll(".grammar-rule-card")).filter(
              (card) => !card.classList.contains("is-hidden"),
            ).length;

          const sectionTitles = grammarRoot.querySelectorAll(".grammar-rule-section-title").length;
          const searchInput = grammarRoot.querySelector(
            ".grammar-rule-search-input",
          ) as HTMLInputElement | null;
          const filterSafeButton = grammarRoot.querySelector(
            '.grammar-rule-filter-button[data-filter="safe"]',
          ) as HTMLButtonElement | null;
          const filterRecommendedButton = grammarRoot.querySelector(
            '.grammar-rule-filter-button[data-filter="recommended"]',
          ) as HTMLButtonElement | null;
          const recommendedActionButton = grammarRoot.querySelector(
            '.grammar-rule-selector-actions .button[data-action="recommended"]',
          ) as HTMLButtonElement | null;

          if (!searchInput) {
            return { ok: false, error: "Search input is missing" };
          }
          if (!filterSafeButton) {
            return { ok: false, error: "Safe filter button is missing" };
          }
          if (filterRecommendedButton) {
            return { ok: false, error: "Recommended filter button should not be present" };
          }
          if (!recommendedActionButton) {
            return { ok: false, error: "Recommended action button is missing" };
          }

          const initialVisibleCount = countVisibleCards();
          recommendedActionButton.click();
          const recommendedSelection = Array.from(
            grammarRoot.querySelectorAll(".grammar-rule-card-toggle"),
          )
            .filter((toggle): toggle is HTMLInputElement => toggle instanceof HTMLInputElement)
            .filter((toggle) => toggle.checked)
            .map((toggle) => toggle.value);
          if (recommendedSelection.length === 0) {
            return { ok: false, error: "Recommended action did not enable any rules" };
          }
          const selectedId = recommendedSelection[0];

          searchInput.value = "ellipsis";
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          const searchVisibleCards = Array.from(grammarRoot.querySelectorAll(".grammar-rule-card"))
            .filter((card) => !card.classList.contains("is-hidden"))
            .map(
              (card) => card.querySelector(".grammar-rule-card-toggle") as HTMLInputElement | null,
            )
            .filter((toggle): toggle is HTMLInputElement => Boolean(toggle));

          if (searchVisibleCards.length === 0) {
            return { ok: false, error: "Search did not return any rule cards" };
          }

          searchInput.value = "";
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          filterSafeButton.click();
          const safeVisibleCount = countVisibleCards();
          searchInput.value = "definitely-no-such-rule";
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          const noMatchVisibleCount = countVisibleCards();
          const noResultsVisible = !grammarRoot
            .querySelector(".grammar-rule-selector-no-results")
            ?.classList.contains("is-hidden");
          searchInput.value = "";
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));

          return {
            ok: true,
            sectionTitles,
            initialVisibleCount,
            searchVisibleCount: searchVisibleCards.length,
            safeVisibleCount,
            recommendedSelectionCount: recommendedSelection.length,
            noMatchVisibleCount,
            noResultsVisible,
            selectedId,
          };
        });

        expect(probe.ok).toBe(true);
        if (!probe.ok) {
          throw new Error(probe.error);
        }
        expect(probe.sectionTitles).toBeGreaterThanOrEqual(2);
        expect(probe.initialVisibleCount).toBeGreaterThan(0);
        expect(probe.searchVisibleCount).toBeGreaterThan(0);
        expect(probe.searchVisibleCount).toBeLessThan(probe.initialVisibleCount);
        expect(probe.safeVisibleCount).toBeGreaterThan(0);
        expect(probe.safeVisibleCount).toBeLessThan(probe.initialVisibleCount);
        expect(probe.recommendedSelectionCount).toBeGreaterThan(0);
        expect(probe.noMatchVisibleCount).toBe(0);
        expect(probe.noResultsVisible).toBe(true);
        expect(probe.selectedId.length).toBeGreaterThan(0);
        settingsDirty = true;
        selectedRuleId = probe.selectedId;
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }

      const storedRules = await waitUntil<string[]>(
        "grammar tab recommended action persistence",
        async () => {
          const current = await getSetting<string[]>(worker, KEY_ENABLED_GRAMMAR_RULES);
          const expectedRules = [...RECOMMENDED_V3_GRAMMAR_RULES].sort();
          if (
            Array.isArray(current) &&
            current.includes(selectedRuleId) &&
            [...current].sort().join(",") === expectedRules.join(",")
          ) {
            return current;
          }
          return false;
        },
        { timeoutMs: suiteTimeout(5000, 10000), intervalMs: 50 },
      );

      expect(storedRules).toContain(selectedRuleId);
      expect([...storedRules].sort()).toEqual([...RECOMMENDED_V3_GRAMMAR_RULES].sort());
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "domain whitelist enables predictions for exact host",
    async () => {
      await setSettingAndWait(worker, KEY_DOMAIN_LIST_MODE, "whiteList");
      await setSettingAndWait(worker, "domainBlackList", ["[", TEST_HOST]);
      await sendConfigChange(browser, worker);

      page = await prepareReusableTestPage(browser, page);

      const attached = await page.$eval("#test-input", (el) => el.hasAttribute("data-suggestion"));
      expect(attached).toBe(true);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "prediction popup accepts suggestion with TAB in #test-input",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      await page.focus("#test-input");
      const element = await page.$("#test-input");
      await element!.type("h");

      const [firstSuggestion] = await waitForSuggestionTexts(page);
      expect(firstSuggestion?.toLowerCase()).toMatch(/^h\S*[ \xa0]$/);

      await page.keyboard.press("Tab");
      const value = await waitForInputContentMatch(page, "#test-input", /^h\S*[ \xa0]$/i);
      expect(value.toLowerCase()).toBe(firstSuggestion?.toLowerCase());
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "prediction popup does not inject a delayed space after accept when insertSpaceAfterAutocomplete is disabled",
    async () => {
      await setSettingAndWait(worker, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, false);
      await sendConfigChange(browser, worker);

      page = await prepareReusableTestPage(browser, page);

      await page.focus("#test-input");
      const element = await page.$("#test-input");
      await element!.type("h");

      const [firstSuggestion] = await waitForSuggestionTexts(page);
      expect(firstSuggestion?.toLowerCase()).toMatch(/^h\S*$/);

      await page.keyboard.press("Tab");
      const acceptedValue = await waitForInputContentMatch(page, "#test-input", /^h\S*$/i);
      expect(acceptedValue.toLowerCase()).toBe(firstSuggestion?.toLowerCase());

      await page.keyboard.type("s");
      const suffixedValue = await waitUntil(
        "accepted suggestion to append typed suffix without injected space",
        async () => {
          const current = await page.$eval("#test-input", (el) => (el as HTMLInputElement).value);
          return current === `${acceptedValue}s` ? current : false;
        },
        { timeoutMs: suiteTimeout(5000, 8000), intervalMs: 50 },
      );
      expect(suffixedValue).toBe(`${acceptedValue}s`);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "text expansion accepts first suggestion in #test-input",
    async () => {
      await setSettingAndWait(worker, KEY_ENABLED_LANGUAGES, ["textExpander"]);
      await setSettingAndWait(worker, KEY_LANGUAGE, "textExpander");
      await setSettingAndWait(worker, KEY_TEXT_EXPANSIONS, [["asap", "as soon as possible"]]);
      await sendConfigChange(browser, worker);

      page = await prepareReusableTestPage(browser, page);

      const element = await page.$("#test-input");
      await element!.type("asap");

      const [firstSuggestion] = await waitForSuggestionTexts(page);
      expect(firstSuggestion?.toLowerCase()).toMatch(/^as soon as possible[ \xa0]$/);

      await page.keyboard.press("Tab");
      const value = await waitForInputContentMatch(
        page,
        "#test-input",
        /^as soon as possible[ \xa0]$/i,
      );
      expect(value.toLowerCase()).toMatch(/^as soon as possible[ \xa0]$/);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "options config change command updates grammar rules in runtime storage",
    async () => {
      await setSettingAndWait(worker, KEY_ENABLED_GRAMMAR_RULES, []);
      await sendConfigChange(browser, worker);

      const optionsPage = await openOptionsPage(browser, worker);
      try {
        settingsDirty = true;
        await optionsPage.evaluate(
          (key, command) => {
            const rules = ["capitalizeSentenceStart", "commaPeriodSpacing"];
            const storageKey = `store.settings.${key}`;
            localStorage.setItem(storageKey, JSON.stringify(rules));
            chrome.storage.local.set({ [storageKey]: JSON.stringify(rules) });
            chrome.runtime.sendMessage({ command, context: {} });
          },
          KEY_ENABLED_GRAMMAR_RULES,
          CMD_OPTIONS_PAGE_CONFIG_CHANGE,
        );
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }

      const storedRules = await waitUntil<string[]>(
        "grammar rules to update",
        async () => {
          const current = await getSetting<string[]>(worker, KEY_ENABLED_GRAMMAR_RULES);
          if (
            Array.isArray(current) &&
            current.includes("capitalizeSentenceStart") &&
            current.includes("commaPeriodSpacing")
          ) {
            return current;
          }
          return false;
        },
        { timeoutMs: suiteTimeout(5000, 10000), intervalMs: 50 },
      );

      expect(storedRules).toEqual(
        expect.arrayContaining(["capitalizeSentenceStart", "commaPeriodSpacing"]),
      );
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "attaches to email and url inputs",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      const results = await page.evaluate(() => ({
        email: document.querySelector("#test-email")?.hasAttribute("data-suggestion") ?? false,
        url: document.querySelector("#test-url")?.hasAttribute("data-suggestion") ?? false,
      }));

      expect(results.email).toBe(true);
      expect(results.url).toBe(true);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "does not attach to tel, disabled, or readonly inputs",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      const results = await page.evaluate(() => ({
        tel: document.querySelector("#test-tel")?.hasAttribute("data-suggestion") ?? false,
        disabled:
          document.querySelector("#test-disabled")?.hasAttribute("data-suggestion") ?? false,
        readonly:
          document.querySelector("#test-readonly")?.hasAttribute("data-suggestion") ?? false,
      }));

      expect(results.tel).toBe(false);
      expect(results.disabled).toBe(false);
      expect(results.readonly).toBe(false);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "prefers native/page autocomplete for conflicting fields",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      const results = await page.evaluate(() => ({
        nativeList:
          document.querySelector("#test-native-list")?.hasAttribute("data-suggestion") ?? false,
        nativeListButton:
          document
            .querySelector("#test-native-list")
            ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof HTMLButtonElement,
        semanticEmail:
          document.querySelector("#test-semantic-email")?.hasAttribute("data-suggestion") ?? false,
        semanticEmailButton:
          document
            .querySelector("#test-semantic-email")
            ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof HTMLButtonElement,
        combobox:
          document.querySelector("#test-combobox")?.hasAttribute("data-suggestion") ?? false,
        comboboxButton:
          document
            .querySelector("#test-combobox")
            ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof HTMLButtonElement,
        normalText: document.querySelector("#test-input")?.hasAttribute("data-suggestion") ?? false,
      }));

      expect(results.nativeList).toBe(false);
      expect(results.nativeListButton).toBe(true);
      expect(results.semanticEmail).toBe(false);
      expect(results.semanticEmailButton).toBe(true);
      expect(results.combobox).toBe(false);
      expect(results.comboboxButton).toBe(true);
      expect(results.normalText).toBe(true);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "manual attach icon force-enables FluentTyper for a conflicting field",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      await page.waitForFunction(
        () =>
          document
            .querySelector("#test-native-list")
            ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof HTMLButtonElement,
        { timeout: timeoutProfile.inputReadyMs },
      );

      await page.evaluate(() => {
        const button = document
          .querySelector("#test-native-list")
          ?.parentElement?.querySelector(".ft-manual-attach-button") as HTMLButtonElement | null;
        button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      await waitUntil(
        "native list input to gain data-suggestion after manual attach",
        async () => {
          return await page.$eval(
            "#test-native-list",
            (el) => el.hasAttribute("data-suggestion") && document.activeElement === el,
          );
        },
        { timeoutMs: suiteTimeout(3000, 6000), intervalMs: 50 },
      );

      await typeInInput(page, "#test-native-list", "th");
      const suggestions = await waitForSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "manual attach icon force-enables semantic autocomplete and aria combobox conflicts",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      for (const selector of ["#test-semantic-email", "#test-combobox"]) {
        await page.waitForFunction(
          (fieldSelector) =>
            document
              .querySelector(fieldSelector)
              ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof
            HTMLButtonElement,
          { timeout: timeoutProfile.inputReadyMs },
          selector,
        );

        await page.evaluate((fieldSelector) => {
          const button = document
            .querySelector(fieldSelector)
            ?.parentElement?.querySelector(".ft-manual-attach-button") as HTMLButtonElement | null;
          button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }, selector);

        await waitUntil(
          `${selector} to gain data-suggestion after manual attach`,
          async () => {
            return await page.$eval(
              selector,
              (el) => el.hasAttribute("data-suggestion") && document.activeElement === el,
            );
          },
          { timeoutMs: suiteTimeout(3000, 6000), intervalMs: 50 },
        );

        await typeInInput(page, selector, "th");
        const suggestions = await waitForSuggestionTexts(page);
        expect(suggestions.length).toBeGreaterThan(0);
        await clearInputContent(page, selector);
      }
    },
    suiteTimeout(12000, 18000),
  );

  test(
    "attaches to input inside open shadow root and shows suggestions on typing",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      // Inject a custom element with an open shadow root containing a text input.
      await page.evaluate(() => {
        class FtShadowTestComponent extends HTMLElement {
          constructor() {
            super();
            const shadow = this.attachShadow({ mode: "open" });
            const input = document.createElement("input");
            input.type = "text";
            shadow.appendChild(input);
          }
        }
        customElements.define("ft-shadow-test-component", FtShadowTestComponent);
        document.body.appendChild(document.createElement("ft-shadow-test-component"));
      });

      // Focus the shadow-hosted input so the runtime's late-discovery
      // listeners can detect it and attach a suggestion helper.
      await page.evaluate(() => {
        const host = document.querySelector("ft-shadow-test-component");
        (host?.shadowRoot?.querySelector("input") as HTMLInputElement | null)?.focus();
      });

      // Wait for the extension to attach to the shadow-hosted input.
      await waitUntil(
        "shadow root input to gain data-suggestion",
        async () => {
          const attached = await page.evaluate(() => {
            const host = document.querySelector("ft-shadow-test-component");
            return (
              host?.shadowRoot?.querySelector("input")?.hasAttribute("data-suggestion") ?? false
            );
          });
          return attached ? true : false;
        },
        { timeoutMs: timeoutProfile.inputReadyMs, intervalMs: 50 },
      );

      // Type and verify the suggestion popup appears.
      await page.keyboard.type("h");

      const suggestions = await waitForSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]?.toLowerCase()).toMatch(/^h\S*/);
    },
    suiteTimeout(15000, 22000),
  );

  test(
    "discovers input in shadow root created on a host already in the DOM",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      // Step 1: Insert a bare host element with no shadow root.
      // The extension processes this mutation but finds nothing to attach to.
      await page.evaluate(() => {
        const host = document.createElement("div");
        host.id = "ft-late-shadow-host";
        document.body.appendChild(host);
      });

      // Wait long enough for the extension's mutation coalesce cycle to finish.
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Step 2: Call attachShadow() on the now-stationary host and append an
      // input.  No DOM mutation fires on the parent, so the extension must use
      // the attachShadow() interceptor to detect this shadow root.
      await page.evaluate(() => {
        const host = document.getElementById("ft-late-shadow-host")!;
        const shadow = host.attachShadow({ mode: "open" });
        const input = document.createElement("input");
        input.type = "text";
        shadow.appendChild(input);
      });

      // Focus the late shadow-hosted input so the runtime's interaction fallback
      // can attach helpers even if attachShadow interception is unavailable.
      await page.evaluate(() => {
        const host = document.getElementById("ft-late-shadow-host");
        (host?.shadowRoot?.querySelector("input") as HTMLInputElement | null)?.focus();
      });

      // Wait for the extension to attach to the shadow-hosted input.
      await waitUntil(
        "late shadow root input to gain data-suggestion",
        async () => {
          const attached = await page.evaluate(() => {
            const host = document.getElementById("ft-late-shadow-host");
            return (
              host?.shadowRoot?.querySelector("input")?.hasAttribute("data-suggestion") ?? false
            );
          });
          return attached ? true : false;
        },
        { timeoutMs: timeoutProfile.inputReadyMs, intervalMs: 50 },
      );

      // Verify suggestions appear when the user types.
      await page.keyboard.type("h");

      const suggestions = await waitForSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]?.toLowerCase()).toMatch(/^h\S*/);
    },
    suiteTimeout(15000, 22000),
  );

  test(
    "discovers input in nested shadow root created on a host inside another shadow tree",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      // Step 1: Create an outer shadow tree with an inner host but no inner
      // shadow root yet. This exercises browser event retargeting when the late
      // attachShadow() notification bubbles back to the document listener.
      await page.evaluate(() => {
        const outerHost = document.createElement("div");
        outerHost.id = "ft-nested-shadow-outer-host";
        document.body.appendChild(outerHost);

        const outerShadow = outerHost.attachShadow({ mode: "open" });
        const innerHost = document.createElement("div");
        innerHost.id = "ft-nested-shadow-inner-host";
        outerShadow.appendChild(innerHost);
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Step 2: Attach an inner shadow root after the host is already stable in
      // the outer shadow tree, then add an input. The extension must recover the
      // original dispatcher via composedPath()[0], not the retargeted event.target.
      await page.evaluate(() => {
        const outerHost = document.getElementById("ft-nested-shadow-outer-host");
        const innerHost = outerHost?.shadowRoot?.querySelector("#ft-nested-shadow-inner-host");
        const innerShadow = (innerHost as HTMLElement | null)?.attachShadow({ mode: "open" });
        const input = document.createElement("input");
        input.type = "text";
        innerShadow?.appendChild(input);
      });

      await page.evaluate(() => {
        const outerHost = document.getElementById("ft-nested-shadow-outer-host");
        const innerHost = outerHost?.shadowRoot?.querySelector("#ft-nested-shadow-inner-host");
        (
          (innerHost as HTMLElement | null)?.shadowRoot?.querySelector(
            "input",
          ) as HTMLInputElement | null
        )?.focus();
      });

      await waitUntil(
        "nested late shadow root input to gain data-suggestion",
        async () => {
          const attached = await page.evaluate(() => {
            const outerHost = document.getElementById("ft-nested-shadow-outer-host");
            const innerHost = outerHost?.shadowRoot?.querySelector("#ft-nested-shadow-inner-host");
            return (
              (innerHost as HTMLElement | null)?.shadowRoot
                ?.querySelector("input")
                ?.hasAttribute("data-suggestion") ?? false
            );
          });
          return attached ? true : false;
        },
        { timeoutMs: timeoutProfile.inputReadyMs, intervalMs: 50 },
      );

      await page.keyboard.type("h");

      const suggestions = await waitForSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]?.toLowerCase()).toMatch(/^h\S*/);
    },
    suiteTimeout(15000, 22000),
  );

  test(
    "reattaches to input when disabled attribute is removed and shows suggestions on typing",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      const beforeEnable = await page.evaluate(
        () => document.querySelector("#test-disabled")?.hasAttribute("data-suggestion") ?? false,
      );
      expect(beforeEnable).toBe(false);

      await page.evaluate(() => {
        document.querySelector("#test-disabled")?.removeAttribute("disabled");
      });

      // Wait for the extension to detect the attribute change and attach the helper.
      await waitUntil(
        "disabled input to gain data-suggestion after re-enable",
        async () => {
          const attached = await page.evaluate(
            () =>
              document.querySelector("#test-disabled")?.hasAttribute("data-suggestion") ?? false,
          );
          return attached ? true : false;
        },
        { timeoutMs: suiteTimeout(5000, 8000), intervalMs: 50 },
      );

      // Verify the full user experience: focus the now-enabled input, type a
      // character, and assert the suggestion popup actually appears on screen.
      await page.focus("#test-disabled");
      const element = await page.$("#test-disabled");
      await element!.type("h");

      const suggestions = await waitForSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]?.toLowerCase()).toMatch(/^h\S*/);
    },
    suiteTimeout(15000, 22000),
  );
});
