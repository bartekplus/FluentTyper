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
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_LANGUAGE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
  KEY_TEXT_EXPANSIONS,
} from "../../src/core/domain/constants";

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

let domainTestUrl = "";

function isRetriableWorkerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /chrome\.storage\.local is unavailable|reading 'local'|Execution context was destroyed|Execution context is not available in detached frame or worker|Cannot find context with specified id|Target closed|Session closed/i.test(
    message,
  );
}

async function setSetting(worker: BackgroundContext, key: string, value: unknown): Promise<void> {
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  await waitUntil(
    `setting ${key} write`,
    async () => {
      try {
        await worker.evaluate(
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
        return false;
      }
    },
    { timeoutMs: 4000, intervalMs: 100 },
  );
}

async function getSetting<T>(worker: BackgroundContext, key: string): Promise<T | undefined> {
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  const result = await waitUntil<{ value: T | undefined }>(
    `setting ${key} read`,
    async () => {
      try {
        const value = (await worker.evaluate(
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
  await waitUntil(
    `input helper attach for ${selector}`,
    async () => {
      const isAttached = await page.evaluate(
        (sel) => document.querySelector(sel)?.hasAttribute("data-suggestion") ?? false,
        selector,
      );
      return isAttached ? true : false;
    },
    { timeoutMs: timeoutProfile.inputReadyMs, intervalMs: 50 },
  );
}

async function gotoTestPage(page: Page): Promise<void> {
  await page.goto(domainTestUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutProfile.navigationMs,
  });
}

async function waitForSuggestionTexts(page: Page): Promise<string[]> {
  return await waitUntil(
    "visible suggestion list",
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
    { timeoutMs: timeoutProfile.suggestionMs, intervalMs: 50 },
  );
}

async function waitForInputContentMatch(
  page: Page,
  selector: string,
  pattern: RegExp,
): Promise<string> {
  return await waitUntil(
    `input ${selector} to match ${String(pattern)}`,
    async () => {
      const currentValue = await page.$eval(
        selector,
        (el) => ((el as HTMLInputElement).value ?? el.textContent ?? "") as string,
      );
      return pattern.test(currentValue) ? currentValue : false;
    },
    { timeoutMs: timeoutProfile.suggestionMs, intervalMs: 50 },
  );
}

describeE2E(`E2E Smoke [${BROWSER_TYPE}]`, () => {
  let browser: Browser;
  let worker: BackgroundContext;
  let page: Page;
  let domainTestServer: Server;
  let domainTestHtml: string;

  beforeAll(async () => {
    browser = await launchBrowser();
    worker = await getBackgroundContext(browser);
    page = await browser.newPage();
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
  }, 60000);

  beforeEach(async () => {
    await setSettingAndWait(worker, KEY_ENABLED_LANGUAGES, ["en_US", "de_DE", "textExpander"]);
    await setSettingAndWait(worker, KEY_LANGUAGE, "en_US");
    await setSettingAndWait(worker, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
    await setSettingAndWait(worker, KEY_NUM_SUGGESTIONS, 5);
    await setSettingAndWait(worker, KEY_INLINE_SUGGESTION, false);
    await setSettingAndWait(worker, KEY_TEXT_EXPANSIONS, []);
    await setSettingAndWait(worker, KEY_SITE_PROFILES, {});
    await setSettingAndWait(worker, KEY_ENABLED_GRAMMAR_RULES, []);
    await setSettingAndWait(worker, KEY_DOMAIN_LIST_MODE, "blackList");
    await setSettingAndWait(worker, "domainBlackList", []);
    await setSettingAndWait(worker, "enable", true);
    await sendConfigChange(browser, worker);

    if (page.isClosed()) {
      page = await browser.newPage();
    }
  });

  afterEach(async () => {
    if (page && !page.isClosed()) {
      await page.close();
    }
    page = await browser.newPage();
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
    await browser.close();
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
    "domain whitelist enables predictions for exact host",
    async () => {
      await setSettingAndWait(worker, KEY_DOMAIN_LIST_MODE, "whiteList");
      await setSettingAndWait(worker, "domainBlackList", ["[", TEST_HOST]);
      await sendConfigChange(browser, worker);

      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, "#test-input");

      const attached = await page.$eval("#test-input", (el) => el.hasAttribute("data-suggestion"));
      expect(attached).toBe(true);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "prediction popup accepts suggestion with TAB in #test-input",
    async () => {
      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, "#test-input");

      await page.focus("#test-input");
      const element = await page.$("#test-input");
      await element!.type("h");

      const [firstSuggestion] = await waitForSuggestionTexts(page);
      expect(firstSuggestion?.toLowerCase()).toMatch(/^h\S*\xa0$/);

      await page.keyboard.press("Tab");
      const value = await waitForInputContentMatch(page, "#test-input", /^h\S*\xa0$/i);
      expect(value.toLowerCase()).toBe(firstSuggestion?.toLowerCase());
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

      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, "#test-input");

      const element = await page.$("#test-input");
      await element!.type("asap");

      const [firstSuggestion] = await waitForSuggestionTexts(page);
      expect(firstSuggestion?.toLowerCase()).toBe("as soon as possible\xa0");

      await page.keyboard.press("Tab");
      const value = await waitForInputContentMatch(
        page,
        "#test-input",
        /^as soon as possible\xa0$/i,
      );
      expect(value.toLowerCase()).toBe("as soon as possible\xa0");
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
        await optionsPage.evaluate(
          (key, command) => {
            const rules = ["capitalizeFirstLetter", "spacingRule"];
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
            current.includes("capitalizeFirstLetter") &&
            current.includes("spacingRule")
          ) {
            return current;
          }
          return false;
        },
        { timeoutMs: suiteTimeout(5000, 10000), intervalMs: 50 },
      );

      expect(storedRules).toEqual(expect.arrayContaining(["capitalizeFirstLetter", "spacingRule"]));
    },
    suiteTimeout(10000, 15000),
  );
});
