import { Browser, Page } from "puppeteer";
import path from "path";
import * as fs from "fs";
import { createServer, Server } from "http";
import {
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_DOMAIN_LIST_MODE,
  KEY_LANGUAGE,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_SITE_PROFILES,
} from "../../src/shared/constants";
import { SUPPORTED_PREDICTION_LANGUAGE_KEYS } from "../../src/shared/lang";
import {
  BROWSER_TYPE,
  itIfChrome,
  launchBrowser,
  getBackgroundContext,
  openExtensionPage,
  openPopupPage,
  triggerCommandForTesting,
  BackgroundContext,
  isFirefox,
} from "./e2e-helpers";

const TEST_PAGE_PATH = path.resolve(__dirname, "test-page.html");
const TEST_HOST = "localhost";
const SETTINGS_PREFIX = "store.settings.";
const CKEDITOR_SELECTOR = ".ck-editor__editable";
const TEST_INPUT_SELECTORS = [
  "#test-textarea",
  "#test-input",
  "#test-contenteditable",
] as const;

let domainTestUrl: string;

function isRetriableWorkerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /chrome\.storage\.local is unavailable|reading 'local'|Execution context was destroyed|Cannot find context with specified id|Target closed|Session closed/i.test(
    message,
  );
}

async function setSetting(
  worker: BackgroundContext,
  key: string,
  value: unknown,
): Promise<void> {
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await worker.evaluate(
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
            storage.set(
              { [storageKeyInner]: JSON.stringify(valueInner) },
              () => {
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
              },
            );
          }),
        storageKey,
        value,
      );
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableWorkerError(error) || attempt === 10) {
        throw error;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw lastError;
}

async function getSetting<T>(
  worker: BackgroundContext,
  key: string,
): Promise<T | undefined> {
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      return (await worker.evaluate(
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
              const rawValue = (result as Record<string, string | undefined>)[
                storageKeyInner
              ];
              resolve(rawValue ? JSON.parse(rawValue) : undefined);
            });
          }),
        storageKey,
      )) as T | undefined;
    } catch (error) {
      lastError = error;
      if (!isRetriableWorkerError(error) || attempt === 10) {
        throw error;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw lastError;
}

async function setSettingAndWait(
  worker: BackgroundContext,
  key: string,
  value: unknown,
  timeoutMs = 3000,
): Promise<void> {
  await setSetting(worker, key, value);
  const expected = JSON.stringify(value);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const current = await getSetting<unknown>(worker, key);
    if (JSON.stringify(current) === expected) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for setting ${key} to become ${expected}`);
}

async function notifyConfigChange(
  browser: Browser,
  worker: BackgroundContext,
): Promise<void> {
  if (isFirefox()) {
    await worker.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage(
            { command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE", context: {} },
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
    );
    return;
  }

  const extensionPage = await openExtensionPage(
    browser,
    worker,
    "options/options.html",
  );
  try {
    await extensionPage.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage(
            { command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE", context: {} },
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
    );
  } finally {
    if (!extensionPage.isClosed()) {
      await extensionPage.close();
    }
  }
}

async function openOptionsPage(browser: Browser, worker: BackgroundContext) {
  const optionsPage = await openExtensionPage(
    browser,
    worker,
    "options/options.html",
  );
  await optionsPage.waitForSelector("#content");
  return optionsPage;
}

function shouldEnableCkEditor(selector: string) {
  return selector === CKEDITOR_SELECTOR;
}

async function gotoTestPage(
  page: Page,
  options: { enableCkEditor?: boolean } = {},
) {
  const testName = expect.getState().currentTestName || "Unknown Test";
  const params = new URLSearchParams({ testName });
  if (options.enableCkEditor) {
    params.set("enableCkEditor", "1");
  }
  // Use a local HTTP server instead of file:// so host permissions apply consistently.
  const targetUrl = `${domainTestUrl}?${params.toString()}`;
  if (isFirefox()) {
    await page.evaluate((url) => {
      window.location.href = url;
    }, targetUrl);
    await page.waitForFunction(
      () =>
        document.readyState === "interactive" ||
        document.readyState === "complete",
    );
    // Wait for content script injection
    await new Promise((r) => setTimeout(r, 500));
  } else {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
    });
  }
}

async function waitForInputReady(page: Page, selector: string) {
  if (selector === CKEDITOR_SELECTOR) {
    await page.waitForFunction(
      () =>
        Boolean(
          (
            window as typeof window & {
              __testCkEditorReady?: boolean;
              __testCkEditorError?: string | null;
            }
          ).__testCkEditorReady ||
          (
            window as typeof window & {
              __testCkEditorError?: string | null;
            }
          ).__testCkEditorError,
        ),
      { timeout: 10000 },
    );

    const ckEditorError = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __testCkEditorError?: string | null;
          }
        ).__testCkEditorError,
    );
    if (ckEditorError) {
      throw new Error(`CKEditor failed to initialize: ${ckEditorError}`);
    }
  }

  await page.waitForSelector(selector, { timeout: 10000 });
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.hasAttribute("data-tribute") ?? false,
    { timeout: 10000 },
    selector,
  );
}

async function waitForVisibleSuggestions(
  page: Page,
  timeoutMs = 8000,
): Promise<number> {
  const suggestions = await waitForVisibleSuggestionTexts(page, timeoutMs);
  return suggestions.length;
}

async function waitForVisibleSuggestionTexts(
  page: Page,
  timeoutMs = 8000,
): Promise<string[]> {
  const countHandle = await page.waitForFunction(
    () => {
      const activeElement = document.activeElement as
        | (HTMLElement & { tributeMenu?: Element | null })
        | null;
      const activeMenu = activeElement?.tributeMenu;
      const containers = [
        ...(activeMenu instanceof Element ? [activeMenu] : []),
        ...Array.from(document.querySelectorAll(".tribute-container")).filter(
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
        const texts = Array.from(container.querySelectorAll("li"))
          .map((li) => li.textContent ?? "")
          .filter((text) => text.length > 0);
        if (texts.length > 0) {
          return texts;
        }
      }
      return null;
    },
    { timeout: timeoutMs },
  );
  const texts = (await countHandle.jsonValue()) as string[] | null;
  await countHandle.dispose();
  return texts ?? [];
}

async function clickFirstVisibleSuggestion(
  page: Page,
  timeoutMs = 8000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const activeElement = document.activeElement as
        | (HTMLElement & { tributeMenu?: Element | null })
        | null;
      const activeMenu = activeElement?.tributeMenu;
      const containers = [
        ...(activeMenu instanceof Element ? [activeMenu] : []),
        ...Array.from(document.querySelectorAll(".tribute-container")).filter(
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

describe(`Extension E2E Test [${BROWSER_TYPE}]`, () => {
  let browser: Browser;
  let page: Page;
  let worker: BackgroundContext;
  let domainTestServer: Server;
  let domainTestHtml: string;

  beforeAll(async () => {
    browser = await launchBrowser();
    const pages = await browser.pages();
    page = pages[0];
    worker = await getBackgroundContext(browser);
    domainTestHtml = fs.readFileSync(TEST_PAGE_PATH, "utf8");

    domainTestServer = createServer((req, res) => {
      if (req.url && req.url.includes("ckeditor.js")) {
        try {
          const ckeditorPath = path.resolve(__dirname, "../../node_modules/@ckeditor/ckeditor5-build-classic/build/ckeditor.js");
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
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(5000);
    await page.bringToFront();
  });

  afterEach(async () => {
    try {
      if (page && typeof page.isClosed === "function" && !page.isClosed()) {
        await page.close();
      }
    } catch (e) {
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
    } catch (e) { }
    try {
      await browser.close();
    } catch (e) { }
  });

  itIfChrome("Extension installs and open new installation page", async () => {
    // Find the extension ID
    const newInstallationPage = await browser.waitForTarget(
      (target) =>
        target.type() === "page" &&
        target.url().endsWith("new_installation/index.html"),
    );

    expect(newInstallationPage).toBeDefined();
    expect(worker).toBeDefined();
  }, 2000);

  it("Diagnostic: Content script and background communication check", async () => {
    if (isFirefox()) {
      await page.evaluate((url) => { window.location.href = url; }, domainTestUrl);
      await page.waitForFunction(() => document.readyState === "interactive" || document.readyState === "complete");
      await new Promise(r => setTimeout(r, 500));
    } else {
      await page.goto(domainTestUrl, { waitUntil: "domcontentloaded" });
    }
    await page.bringToFront();

    // Check if background worker evaluates correctly
    const bgUrl = await worker.url();
    console.log("Diagnostic: Background worker URL:", bgUrl);

    const bgStorage = await worker.evaluate(() => {
      return typeof chrome !== "undefined" && typeof chrome.storage !== "undefined";
    });
    console.log("Diagnostic: Has chrome.storage in background?", bgStorage);
    expect(bgStorage).toBe(true);

    // Check if content script injected
    const hasTribute = await page.evaluate(() => {
      return !!document.querySelector(".tribute-container");
    });
    console.log("Diagnostic: Has generic tribute container?", hasTribute);
  });

  itIfChrome("Extension installs and popup loads", async () => {
    expect(worker).toBeDefined();
    const popupPage = await openPopupPage(browser, worker!);
    expect(popupPage).toBeDefined();
    await popupPage.close();
  }, 5000);

  itIfChrome("Domain whitelist matches exact host and ignores invalid patterns", async () => {
    await page.goto(domainTestUrl, { waitUntil: "domcontentloaded" });
    await page.bringToFront();

    await setSettingAndWait(worker!, "enable", true);
    await setSettingAndWait(worker!, KEY_DOMAIN_LIST_MODE, "whiteList");
    await setSettingAndWait(worker!, "domainBlackList", ["[", TEST_HOST]);

    let popupPage: Page | null = null;
    try {
      const existingPopupPages = await Promise.all(
        browser
          .targets()
          .filter(
            (target) =>
              target.type() === "page" && target.url().endsWith("popup/popup.html"),
          )
          .map((target) => target.page()),
      );
      for (const existingPopupPage of existingPopupPages) {
        if (existingPopupPage && !existingPopupPage.isClosed()) {
          await existingPopupPage.close();
        }
      }

      popupPage = await openPopupPage(browser, worker!);
      await popupPage!.waitForSelector("#checkboxDomainInput");
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
    }
  }, 10000);

  test("Site profiles setting round-trips through extension storage", async () => {
    const siteProfiles = {
      [TEST_HOST]: {
        language: "fr_FR",
        numSuggestions: 3,
        inline_suggestion: true,
      },
    };
    await setSettingAndWait(worker!, KEY_SITE_PROFILES, siteProfiles);

    const storedSiteProfiles = await getSetting<typeof siteProfiles>(
      worker!,
      KEY_SITE_PROFILES,
    );
    expect(storedSiteProfiles).toEqual(siteProfiles);

    await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
  }, 5000);

  test("CMD_TOGGLE_FT_ACTIVE_LANG changes global language when no site profile exists", async () => {
    try {
      await setSettingAndWait(worker!, "enable", true);
      await setSettingAndWait(
        worker!,
        KEY_ENABLED_LANGUAGES,
        SUPPORTED_PREDICTION_LANGUAGE_KEYS,
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
      await notifyConfigChange(browser, worker!);

      await triggerCommandForTesting(worker!, "CMD_TOGGLE_FT_ACTIVE_LANG");
      await new Promise((r) => setTimeout(r, 500));

      const langAfter = await getSetting<string>(worker!, KEY_LANGUAGE);
      expect(langAfter).not.toBe("en_US");
      expect(SUPPORTED_PREDICTION_LANGUAGE_KEYS).toContain(langAfter);
    } finally {
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
      await notifyConfigChange(browser, worker!);
    }
  }, 15000);

  test("CMD_TOGGLE_FT_ACTIVE_LANG changes per-site language when site profile exists", async () => {
    try {
      await setSettingAndWait(worker!, "enable", true);
      await setSettingAndWait(
        worker!,
        KEY_ENABLED_LANGUAGES,
        SUPPORTED_PREDICTION_LANGUAGE_KEYS,
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");

      // Navigate to the domain test server so the active tab matches TEST_HOST.
      await page.goto(domainTestUrl, { waitUntil: "domcontentloaded" });
      await page.bringToFront();

      // Create a site profile for the active test host.
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {
        [TEST_HOST]: {
          language: "en_US",
        },
      });
      await notifyConfigChange(browser, worker!);

      await triggerCommandForTesting(worker!, "CMD_TOGGLE_FT_ACTIVE_LANG");
      await new Promise((r) => setTimeout(r, 500));

      // Verify global language is unchanged
      const globalLang = await getSetting<string>(worker!, KEY_LANGUAGE);
      expect(globalLang).toBe("en_US");

      // Verify site profile language was changed
      const siteProfiles = await getSetting<
        Record<string, { language: string }>
      >(worker!, KEY_SITE_PROFILES);
      expect(siteProfiles).toBeDefined();
      expect(siteProfiles![TEST_HOST]).toBeDefined();
      expect(siteProfiles![TEST_HOST].language).not.toBe("en_US");
      expect(SUPPORTED_PREDICTION_LANGUAGE_KEYS).toContain(
        siteProfiles![TEST_HOST].language,
      );
    } finally {
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
      await notifyConfigChange(browser, worker!);
    }
  }, 15000);

  itIfChrome("Site profile override increases suggestions count on matching domain", async () => {
    const selector = "#test-textarea";
    try {
      await setSettingAndWait(worker!, "enable", true);
      await setSettingAndWait(worker!, KEY_DOMAIN_LIST_MODE, "blackList");
      await setSettingAndWait(worker!, "domainBlackList", []);
      await setSettingAndWait(
        worker!,
        KEY_ENABLED_LANGUAGES,
        SUPPORTED_PREDICTION_LANGUAGE_KEYS,
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
      await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 0);
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
      await notifyConfigChange(browser, worker!);

      await page.goto(domainTestUrl, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      await waitForInputReady(page, selector);
      const popupPage = await openPopupPage(browser, worker!);
      await popupPage.close();
      await page.bringToFront();
      const inputWithoutOverride = await page.$(selector);
      await page.focus(selector);
      await inputWithoutOverride!.type("impor");
      await new Promise((r) => setTimeout(r, 600));
      const hasSuggestionsWithoutOverride = await page.evaluate(() => {
        const containers = Array.from(
          document.querySelectorAll(".tribute-container"),
        );
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
      expect(hasSuggestionsWithoutOverride).toBe(false);

      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {
        [TEST_HOST]: {
          language: "en_US",
          numSuggestions: 4,
        },
      });
      await notifyConfigChange(browser, worker!);

      await page.goto(domainTestUrl, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      await waitForInputReady(page, selector);
      const popupPageAfterOverride = await openPopupPage(browser, worker!);
      await popupPageAfterOverride.close();
      await page.bringToFront();
      const inputWithOverride = await page.$(selector);
      await page.focus(selector);
      await inputWithOverride!.type("impor");
      const countWithOverride = await waitForVisibleSuggestions(page, 15000);
      expect(countWithOverride).toBeGreaterThan(0);
    } finally {
      await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
      await notifyConfigChange(browser, worker!);
    }
  }, 30000);

  itIfChrome("Site profile override changing to inline suggestion enables tab completion", async () => {
    const selector = "#test-textarea";
    try {
      await setSettingAndWait(worker!, "enable", true);
      await setSettingAndWait(worker!, KEY_DOMAIN_LIST_MODE, "blackList");
      await setSettingAndWait(worker!, "domainBlackList", []);
      await setSettingAndWait(
        worker!,
        KEY_ENABLED_LANGUAGES,
        SUPPORTED_PREDICTION_LANGUAGE_KEYS,
      );
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);

      // Start with popup suggestion mode
      await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
      await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
      await notifyConfigChange(browser, worker!);

      await page.goto(domainTestUrl, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      await waitForInputReady(page, selector);

      // Verify popup suggestion mode is active
      const input = await page.$(selector);
      await page.focus(selector);
      await input!.type("impor");
      const countWithPopup = await waitForVisibleSuggestions(page, 15000);
      expect(countWithPopup).toBeGreaterThan(0);

      // Clear input
      await input!.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");

      // Set a site profile override for the active test host.
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {
        [TEST_HOST]: {
          language: "en_US",
          numSuggestions: 5,
          inline_suggestion: true,
        },
      });
      // trigger config change WITHOUT reloading page
      await notifyConfigChange(browser, worker!);

      // Give the background script some time to dispatch and content script to restart
      await new Promise((r) => setTimeout(r, 600));

      await page.focus(selector);
      await input!.type("impor");

      // Wait for inline engine prediction
      await new Promise((r) => setTimeout(r, 300));

      // Try tab completion
      await page.keyboard.press("Tab");

      // Wait for the textarea value to change
      await page.waitForFunction(
        (sel) =>
          ((document.querySelector(sel) as HTMLInputElement).value ??
            document.querySelector(sel)?.textContent) !== "impor",
        {},
        selector,
      );

      const elementText = await page.$eval(
        selector,
        (el) => (el as HTMLInputElement).value ?? el.textContent,
      );

      // Verify that tab completion successfully completed the word
      // (it shouldn't be "impor" and it shouldn't just be "impor\t" if we prevent default correctly)
      expect(elementText).not.toBe("impor");
      expect(elementText).not.toBe("impor\t");
      expect(elementText!.length).toBeGreaterThan(5);
    } finally {
      await setSettingAndWait(worker!, KEY_NUM_SUGGESTIONS, 5);
      await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
      await setSettingAndWait(worker!, KEY_SITE_PROFILES, {});
      await notifyConfigChange(browser, worker!);
    }
  }, 30000);

  test("CKEditor 5 input initializes on test page", async () => {
    await gotoTestPage(page, { enableCkEditor: true });
    page.bringToFront();
    await waitForInputReady(page, CKEDITOR_SELECTOR);

    const ckEditorElement = await page.$(CKEDITOR_SELECTOR);
    expect(ckEditorElement).toBeTruthy();
  }, 15000);

  test.each(TEST_INPUT_SELECTORS)(
    "Prediction popup appears in %s when typing and prediction is inserted on click",
    async (selector) => {
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(
        worker!,
        KEY_ENABLED_LANGUAGES,
        SUPPORTED_PREDICTION_LANGUAGE_KEYS,
      );
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await notifyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
      });
      page.bringToFront();
      await waitForInputReady(page, selector);
      const element = await page.$(selector);
      await page.focus(selector);
      await element!.type("h"); // Type a few letters
      // Wait for prediction popup
      const liCount = await waitForVisibleSuggestions(page);
      expect(liCount).toBeGreaterThan(0);

      // Check that first suggestion starts with typed prefix and ends with \xa0
      const [firstLiText] = await waitForVisibleSuggestionTexts(page);
      expect(firstLiText?.toLowerCase()).toMatch(/^h\S*\xa0$/);

      // Click on the first suggestion
      await clickFirstVisibleSuggestion(page);
      await page.waitForFunction(
        (sel) =>
          ((document.querySelector(sel) as HTMLInputElement).value ??
            document.querySelector(sel)?.textContent) !== "h",
        {},
        selector,
      );
      const elementText = await page.$eval(
        selector,
        (el) => (el as HTMLInputElement).value ?? el.textContent,
      );
      // Inserted text should match what was shown in the suggestion
      expect(elementText).toBe(firstLiText?.toLowerCase());
    },
    30000,
  );

  test.each(TEST_INPUT_SELECTORS)(
    "Prediction popup appears in %s when typing and prediction is inserted on TAB",
    async (selector) => {
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(
        worker!,
        KEY_ENABLED_LANGUAGES,
        SUPPORTED_PREDICTION_LANGUAGE_KEYS,
      );
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await notifyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
      });
      page.bringToFront();
      await waitForInputReady(page, selector);
      const element = await page.$(selector);
      await page.focus(selector);
      await element!.type("w"); // Type a few letters
      // Wait for prediction popup
      const liCount = await waitForVisibleSuggestions(page);
      expect(liCount).toBeGreaterThan(0);

      // Check that first suggestion starts with typed prefix and ends with \xa0
      const [firstLiText] = await waitForVisibleSuggestionTexts(page);
      expect(firstLiText?.toLowerCase()).toMatch(/^w\S*\xa0$/);

      await page.keyboard.press("Tab");
      // Wait for the value to change from just "w"
      await page.waitForFunction(
        (sel) =>
          ((document.querySelector(sel) as HTMLInputElement).value ??
            document.querySelector(sel)?.textContent) !== "w",
        {},
        selector,
      );
      const elementText = await page.$eval(
        selector,
        (el) => (el as HTMLInputElement).value ?? el.textContent,
      );
      // Inserted text should match the first suggestion
      expect(elementText).toBe(firstLiText?.toLowerCase());
    },
    30000,
  );

  test("Cursor movement cancels missing space auto-insertion", async () => {
    await gotoTestPage(page);
    page.bringToFront();
    await page.waitForSelector("#test-textarea");
    const textarea = await page.$("#test-textarea");

    // Type a partial word to trigger autocomplete
    await textarea!.type("h");
    await page.waitForSelector(".tribute-container li");

    // Press Tab to autocomplete (prediction depends on DB)
    await page.keyboard.press("Tab");
    await page.waitForFunction(
      () =>
        (document.querySelector("#test-textarea") as HTMLTextAreaElement)
          .value !== "h",
    );

    // Capture the autocompleted word
    const autocompletedText = await page.$eval(
      "#test-textarea",
      (el) => (el as HTMLTextAreaElement).value,
    );
    // Should be something like "he\xa0" or "have\xa0" — a word starting with h + \xa0
    expect(autocompletedText).toMatch(/^h\S*\xa0$/);
    const wordPart = autocompletedText.slice(0, -1); // strip trailing \xa0

    // Now move the cursor left (over the \xa0)
    await page.keyboard.press("ArrowLeft");

    // Type 'x'
    await textarea!.type("x");

    // Evaluate if 'x' was inserted WITHOUT an extra space before it.
    // If the flag wasn't cleared, it would insert \xa0 before x -> "word\xa0x\xa0"
    // Since expected behavior clears the flag, it should be "wordx\xa0"
    await new Promise((r) => setTimeout(r, 50));
    const textAreaText = await page.$eval(
      "#test-textarea",
      (el) => (el as HTMLTextAreaElement).value,
    );
    expect(textAreaText).toBe(wordPart + "x\xa0");
  }, 1500);

  test.each(TEST_INPUT_SELECTORS)(
    "Inline suggestion prediction is inserted on TAB in %s",
    async (selector) => {
      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
      });
      page.bringToFront();

      await setSetting(worker!, KEY_INLINE_SUGGESTION, true);
      await worker!.evaluate(
        "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
      );
      await new Promise((r) => setTimeout(r, 50));

      await waitForInputReady(page, selector);
      const element = await page.$(selector);
      await element!.type("w");

      // Wait for the prediction engine to fetch result
      await new Promise((r) => setTimeout(r, 50));

      await page.keyboard.press("Tab");

      // Wait for the textarea value to change
      await page.waitForFunction(
        (sel) =>
          ((document.querySelector(sel) as HTMLInputElement).value ??
            document.querySelector(sel)?.textContent) !== "w",
        { timeout: 500 },
        selector,
      );
      const elementText = await page.$eval(
        selector,
        (el) => (el as HTMLInputElement).value ?? el.textContent,
      );
      // Should be a word starting with "w" followed by \xa0
      expect(elementText).toMatch(/^w\S*\xa0$/);

      // Cleanup
      await setSetting(worker!, KEY_INLINE_SUGGESTION, false);
      await worker!.evaluate(
        "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
      );
      await new Promise((r) => setTimeout(r, 50));
    },
    30000,
  );

  itIfChrome("Enabled languages restrict popup language list", async () => {
    const enabledLanguages = ["en_US", "de_DE"];
    await setSetting(worker!, KEY_ENABLED_LANGUAGES, enabledLanguages);
    await setSetting(worker!, KEY_LANGUAGE, "en_US");

    const popupPage = await openPopupPage(browser, worker!);
    await popupPage.waitForSelector("#languageSelect");

    const options = await popupPage.$$eval("#languageSelect option", (opts) =>
      opts.map((opt) => (opt as HTMLOptionElement).value),
    );
    expect(options).toEqual(["auto_detect", ...enabledLanguages]);

    await popupPage.select("#languageSelect", "de_DE");
    await new Promise((r) => setTimeout(r, 50));
    const storedLanguage = await getSetting<string>(worker!, KEY_LANGUAGE);
    expect(storedLanguage).toBe("de_DE");

    await popupPage.close();

    await setSetting(
      worker!,
      KEY_ENABLED_LANGUAGES,
      SUPPORTED_PREDICTION_LANGUAGE_KEYS,
    );
    await setSetting(worker!, KEY_LANGUAGE, "en_US");
  }, 2000);

  itIfChrome("Auto detect is only allowed when multiple languages are enabled", async () => {
    await setSetting(worker!, KEY_ENABLED_LANGUAGES, ["en_US"]);
    await setSetting(worker!, KEY_LANGUAGE, "auto_detect");
    await setSetting(worker!, KEY_FALLBACK_LANGUAGE, "auto_detect");

    const optionsPageSingle = await openOptionsPage(browser, worker!);
    await new Promise((r) => setTimeout(r, 50));
    await optionsPageSingle.close();

    const storedLanguageSingle = await getSetting<string>(
      worker!,
      KEY_LANGUAGE,
    );
    const storedFallbackSingle = await getSetting<string>(
      worker!,
      KEY_FALLBACK_LANGUAGE,
    );
    expect(storedLanguageSingle).toBe("en_US");
    expect(storedFallbackSingle).toBe("en_US");

    await setSetting(worker!, KEY_ENABLED_LANGUAGES, ["en_US", "de_DE"]);
    await setSetting(worker!, KEY_LANGUAGE, "auto_detect");
    await setSetting(worker!, KEY_FALLBACK_LANGUAGE, "auto_detect");

    const optionsPageMulti = await openOptionsPage(browser, worker!);
    await new Promise((r) => setTimeout(r, 50));
    await optionsPageMulti.close();

    const storedLanguageMulti = await getSetting<string>(worker!, KEY_LANGUAGE);
    const storedFallbackMulti = await getSetting<string>(
      worker!,
      KEY_FALLBACK_LANGUAGE,
    );
    expect(storedLanguageMulti).toBe("auto_detect");
    expect(storedFallbackMulti).toBe("en_US");

    const enabledLanguages = await getSetting<string[]>(
      worker!,
      KEY_ENABLED_LANGUAGES,
    );
    expect(enabledLanguages).toEqual(["en_US", "de_DE"]);
  }, 2000);

  itIfChrome("Auto detect in popup detects language and predicts", async () => {
    await gotoTestPage(page);
    page.bringToFront();
    await page.waitForSelector("#test-textarea");
    const textarea = await page.$("#test-textarea");

    await setSetting(worker!, KEY_ENABLED_LANGUAGES, ["en_US", "el_GR"]);
    await setSetting(worker!, KEY_LANGUAGE, "en_US");

    const popupPage = await openPopupPage(browser, worker!);
    await popupPage.waitForSelector("#languageSelect");
    await popupPage.select("#languageSelect", "auto_detect");
    await new Promise((r) => setTimeout(r, 50));
    await popupPage.close();

    const storedLanguage = await getSetting<string>(worker!, KEY_LANGUAGE);
    expect(storedLanguage).toBe("auto_detect");

    await worker!.evaluate(
      "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
    );
    await new Promise((r) => setTimeout(r, 50));

    await textarea!.click();
    await page.evaluate(
      () =>
      ((
        document.querySelector("#test-textarea") as HTMLTextAreaElement
      ).value = ""),
    );
    await textarea!.type("φιλο");
    await new Promise((r) => setTimeout(r, 50));
    await textarea!.type("σ");

    await page.waitForSelector(".tribute-container li", { timeout: 500 });
    // Check that at least one suggestion contains the expected Greek word
    const allSuggestionTexts = await page.$$eval(
      ".tribute-container li",
      (lis) => lis.map((li) => li.textContent?.toLowerCase() ?? ""),
    );
    expect(allSuggestionTexts.some((text) => text.includes("φιλοσοφία"))).toBe(
      true,
    );
  }, 3000);

  const LANGUAGE_TEST_DATA: Record<
    string,
    { input: string; expected: string }
  > = {
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

  test("Prediction works for all supported languages", async () => {
    await gotoTestPage(page);
    page.bringToFront();
    await page.waitForSelector("#test-textarea");
    const textarea = await page.$("#test-textarea");

    await setSetting(
      worker!,
      KEY_ENABLED_LANGUAGES,
      SUPPORTED_PREDICTION_LANGUAGE_KEYS,
    );

    for (const lang of SUPPORTED_PREDICTION_LANGUAGE_KEYS) {
      await setSetting(worker!, KEY_LANGUAGE, lang);
      await worker!.evaluate(
        "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
      );
      await new Promise((r) => setTimeout(r, 20));

      // 2. Type input and verify prediction
      const testData = LANGUAGE_TEST_DATA[lang];
      if (!testData) {
        console.warn(`No test data for language: ${lang}`);
        continue;
      }

      await textarea!.click();
      // Ensure textarea is focused and clear
      await page.evaluate(
        () =>
        ((
          document.querySelector("#test-textarea") as HTMLTextAreaElement
        ).value = ""),
      );
      await textarea!.type(testData.input);
      // Wait for predictions to update after typing
      await new Promise((r) => setTimeout(r, 50));

      try {
        await page.waitForSelector(".tribute-container li", { timeout: 500 });
        // Check that at least one suggestion contains the expected word
        const allSuggestionTexts = await page.$$eval(
          ".tribute-container li",
          (lis) => lis.map((li) => li.textContent?.toLowerCase() ?? ""),
        );
        const found = allSuggestionTexts.some((text) =>
          text.includes(testData.expected.toLowerCase()),
        );
        if (!found) {
          throw new Error(
            `Expected "${testData.expected}" to appear in suggestions, got: [${allSuggestionTexts.join(", ")}]`,
          );
        }
      } catch (e) {
        throw new Error(
          `Failed verification for language ${lang}. Input: ${testData.input}, Expected: ${testData.expected}. Error: ${e}`,
          { cause: e },
        );
      }

      // Cleanup for next iteration
      await page.evaluate(
        () =>
        ((
          document.querySelector("#test-textarea") as HTMLTextAreaElement
        ).value = ""),
      );
      // Wait for predictions to disappear
      await new Promise((r) => setTimeout(r, 50));
    }

    // Cleanup: reset language to en_US
    await setSetting(worker!, KEY_LANGUAGE, "en_US");
    await worker!.evaluate(
      "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
    );
    await new Promise((r) => setTimeout(r, 50));
  }, 9000); // Increased timeout for iterating all languages

  itIfChrome("Extension UI language translates options page correctly", async () => {
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

      // 2. Open options page to sync localStorage in the extension context
      const syncPage = await openOptionsPage(browser, worker!);
      await syncPage.waitForSelector("#content", { timeout: 500 });
      // Write to localStorage directly within the extension's origin
      await syncPage.evaluate((loc: string) => {
        localStorage.setItem(
          "store.settings.extensionLanguage",
          JSON.stringify(loc),
        );
      }, locale);
      await syncPage.close();

      // 3. Reopen the options page - i18n.js will now read from localStorage
      const optionsPage = await openOptionsPage(browser, worker!);
      await optionsPage.waitForSelector("#content .divider", { timeout: 500 });

      const textFound = await optionsPage.evaluate((exp: string) => {
        const dividers = document.querySelectorAll(".divider");
        for (const d of dividers) {
          if (d.textContent?.includes(exp)) return true;
        }
        return false;
      }, expected);

      expect(textFound).toBe(true);
      await optionsPage.close();

      // 4. Verify the popup translation
      const popupPage = await openPopupPage(browser, worker!);
      await popupPage.waitForSelector(".control-card", { timeout: 500 });

      // Wait a moment for translations to apply
      await new Promise((r) => setTimeout(r, 100));

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
    // Also update localStorage in the extension context
    const cleanupPage = await openOptionsPage(browser, worker!);
    await cleanupPage.waitForSelector("#content", { timeout: 500 });
    await cleanupPage.evaluate(() => {
      localStorage.setItem(
        "store.settings.extensionLanguage",
        JSON.stringify("auto_detect"),
      );
    });
    await cleanupPage.close();
    await worker!.evaluate(
      "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
    );
    await new Promise((r) => setTimeout(r, 50));
  }, 12000);

  test.each(TEST_INPUT_SELECTORS)(
    "Prediction popup can be closed via Escape key in %s",
    async (selector) => {
      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
      });
      page.bringToFront();

      await setSetting(worker!, KEY_LANGUAGE, "en_US");
      await worker!.evaluate(
        "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
      );
      await new Promise((r) => setTimeout(r, 100));

      await waitForInputReady(page, selector);
      const element = await page.$(selector);

      await element!.type("h"); // Trigger popup
      await page.waitForSelector(".tribute-container li", { timeout: 4000 });

      // Add a small delay
      await new Promise((r) => setTimeout(r, 100));
      await page.keyboard.press("Escape");

      // Wait for the popup to disappear
      await page.waitForFunction(
        () =>
          !document.querySelector(".tribute-container") ||
          document
            .querySelector(".tribute-container")
            ?.getAttribute("style")
            ?.includes("display: none"),
        { timeout: 500 },
      );
    },
    30000,
  );

  test.each(TEST_INPUT_SELECTORS)(
    "Text expansion works correctly in %s",
    async (selector) => {
      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
      });
      page.bringToFront();

      await setSetting(worker!, KEY_ENABLED_LANGUAGES, ["textExpander"]);
      await setSetting(worker!, KEY_LANGUAGE, "textExpander");
      await worker!.evaluate(
        "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
      );
      await new Promise((r) => setTimeout(r, 100));

      await waitForInputReady(page, selector);
      const element = await page.$(selector);
      await element!.type("asap"); // Trigger text expansion

      await page.waitForSelector(".tribute-container li");
      const [firstLiText] = await waitForVisibleSuggestionTexts(page);
      expect(firstLiText?.toLowerCase()).toBe("as soon as possible\xa0");

      await page.keyboard.press("Tab");

      // Wait for insertion
      await page.waitForFunction(
        (sel) =>
          ((document.querySelector(sel) as HTMLInputElement).value ??
            document.querySelector(sel)?.textContent) !== "asap",
        {},
        selector,
      );
      const elementText = await page.$eval(
        selector,
        (el) => (el as HTMLInputElement).value ?? el.textContent,
      );
      expect(elementText).toBe("as soon as possible\xa0");

      // Cleanup
      await setSetting(
        worker!,
        KEY_ENABLED_LANGUAGES,
        SUPPORTED_PREDICTION_LANGUAGE_KEYS,
      );
      await setSetting(worker!, KEY_LANGUAGE, "en_US");
      await worker!.evaluate(
        "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
      );
      await new Promise((r) => setTimeout(r, 100));
    },
    30000,
  );

  test.each(TEST_INPUT_SELECTORS)(
    "KEY_MIN_WORD_LENGTH_TO_PREDICT set to 0 predicts immediately after space in %s",
    async (selector) => {
      // Set settings BEFORE creating the page so content script initializes correctly
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 0);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(
        worker!,
        KEY_ENABLED_LANGUAGES,
        SUPPORTED_PREDICTION_LANGUAGE_KEYS,
      );
      await notifyConfigChange(browser, worker!);

      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
      });
      page.bringToFront();

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
          if (!target) return false;
          const value =
            (target as HTMLInputElement).value ?? target.textContent ?? "";
          return value.endsWith(" ") || value.endsWith("\xa0");
        },
        { timeout: 2000 },
        selector,
      );
      const predictionsAfterSpace = await waitForVisibleSuggestions(page);
      expect(predictionsAfterSpace).toBeGreaterThan(0);

      // Cleanup
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await notifyConfigChange(browser, worker!);
    },
    30000,
  );

  test.each(TEST_INPUT_SELECTORS)(
    "KEY_MIN_WORD_LENGTH_TO_PREDICT set to -1 does not predict automatically in %s",
    async (selector) => {
      // Reset and set settings BEFORE creating the page
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, -1);
      await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
      await setSettingAndWait(
        worker!,
        KEY_ENABLED_LANGUAGES,
        SUPPORTED_PREDICTION_LANGUAGE_KEYS,
      );
      await notifyConfigChange(browser, worker!);
      await gotoTestPage(page, {
        enableCkEditor: shouldEnableCkEditor(selector),
      });
      page.bringToFront();

      await waitForInputReady(page, selector);
      const element = await page.$(selector);

      // Type something
      await element!.type("this is impor");

      // It should NOT show predictions
      await new Promise((r) => setTimeout(r, 500));
      const hasVisiblePredictions = await page.evaluate(() => {
        const items = document.querySelectorAll(".tribute-container li");
        return items.length > 0;
      });
      expect(hasVisiblePredictions).toBe(false);

      // Cleanup
      await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      await notifyConfigChange(browser, worker!);
    },
    30000,
  );
});
