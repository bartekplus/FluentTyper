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
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_LANGUAGE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
  KEY_TEXT_EXPANSIONS,
} from "../../src/core/domain/constants";
import { RECOMMENDED_V3_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";

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

type SettingEntry = readonly [key: string, value: unknown];

let domainTestUrl = "";
let activeBrowserForWorkerRecovery: Browser | null = null;

const STATIC_DEFAULT_SETTINGS: readonly SettingEntry[] = [
  [KEY_MIN_WORD_LENGTH_TO_PREDICT, 1],
  [KEY_NUM_SUGGESTIONS, 5],
  [KEY_INLINE_SUGGESTION, false],
  [KEY_SITE_PROFILES, {}],
  ["enable", true],
];

const PER_TEST_RESET_SETTINGS: readonly SettingEntry[] = [
  [KEY_ENABLED_LANGUAGES, ["en_US", "de_DE", "textExpander"]],
  [KEY_LANGUAGE, "en_US"],
  [KEY_TEXT_EXPANSIONS, []],
  [KEY_ENABLED_GRAMMAR_RULES, []],
  [KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, true],
  [KEY_DOMAIN_LIST_MODE, "blackList"],
  ["domainBlackList", []],
];

function isRetriableWorkerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /chrome\.storage\.local is unavailable|reading 'local'|Execution context was destroyed|Execution context is not available in detached frame or worker|Cannot find context with specified id|Target closed|Session closed/i.test(
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

async function setSetting(worker: BackgroundContext, key: string, value: unknown): Promise<void> {
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

async function applySettings(
  worker: BackgroundContext,
  settings: readonly SettingEntry[],
): Promise<void> {
  for (const [key, value] of settings) {
    await setSettingAndWait(worker, key, value);
  }
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
  }, 60000);

  beforeEach(async () => {
    worker = await reacquireWorker(browser);
    await applySettings(worker, PER_TEST_RESET_SETTINGS);
    await sendConfigChange(browser, worker);
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(timeoutProfile.navigationMs);
    await page.bringToFront();
  });

  afterEach(async () => {
    await closePageSafely(page);
    page = null;
    try {
      worker = await reacquireWorker(browser);
    } catch {
      // Ignore worker recovery errors here; beforeEach re-acquires for the next test.
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

      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, "#test-input");

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

      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, "#test-input");

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
      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, "#test-input");

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
      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, "#test-input");

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
    "reattaches to input when disabled attribute is removed and shows suggestions on typing",
    async () => {
      await gotoTestPage(page);
      await page.bringToFront();
      await waitForInputReady(page, "#test-input");

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
