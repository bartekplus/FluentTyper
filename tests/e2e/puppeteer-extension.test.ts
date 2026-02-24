import puppeteer, { Browser, Page, WebWorker } from "puppeteer";
import path from "path";
import { createServer, Server } from "http";
import {
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_DOMAIN_LIST_MODE,
  KEY_LANGUAGE,
  KEY_INLINE_SUGGESTION,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
} from "../../src/shared/constants";
import { SUPPORTED_PREDICTION_LANGUAGE_KEYS } from "../../src/shared/lang";

const EXTENSION_PATH = path.resolve(__dirname, "../../build/");
const TEST_PAGE_PATH = path.resolve(__dirname, "test-page.html");
const SETTINGS_PREFIX = "store.settings.";
const CKEDITOR_SELECTOR = ".ck-editor__editable";
const TEST_INPUT_SELECTORS = [
  "#test-textarea",
  "#test-input",
  "#test-contenteditable",
  CKEDITOR_SELECTOR,
] as const;
const IS_CI = process.env.CI === "true" || process.env.CI === "1";

function isRetriableWorkerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /chrome\.storage\.local is unavailable|reading 'local'|Execution context was destroyed|Cannot find context with specified id|Target closed|Session closed/i.test(
    message,
  );
}

async function setSetting(
  worker: WebWorker,
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
  worker: WebWorker,
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
  worker: WebWorker,
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
  worker: WebWorker,
): Promise<void> {
  const extensionId = worker.url().split("/")[2];
  const extensionPage = await browser.newPage();
  try {
    await extensionPage.goto(
      `chrome-extension://${extensionId}/popup/popup.html`,
    );
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

async function openOptionsPage(browser: Browser, worker: WebWorker) {
  await worker.evaluate("chrome.runtime.openOptionsPage();");
  const optionsTarget = await browser.waitForTarget(
    (target) =>
      target.type() === "page" && target.url().endsWith("options/options.html"),
  );
  const optionsPage = await optionsTarget.asPage();
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
  await page.goto(`file://${TEST_PAGE_PATH}?${params.toString()}`);
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

describe("Chrome Extension E2E Test", () => {
  let browser: Browser;
  let page: Page;
  let worker: WebWorker;
  let domainTestServer: Server;
  let domainTestUrl: string;

  beforeAll(async () => {
    const launchArgs = [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--allow-file-access-from-files",
    ];
    if (IS_CI) {
      launchArgs.push(
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      );
    }

    browser = await puppeteer.launch({
      headless: IS_CI,
      args: launchArgs,
      defaultViewport: null,
    });
    const pages = await browser.pages();
    page = pages[0];
    const serviceWorkerTarget = await browser.waitForTarget(
      (target) =>
        target.type() === "service_worker" &&
        target.url().endsWith("background.js"),
      { timeout: 30000 },
    );
    worker = (await serviceWorkerTarget.worker())!;

    domainTestServer = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><html><body><p>domain test page</p></body></html>",
      );
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
    domainTestUrl = `http://localhost:${address.port}/`;
  }, 20000);

  beforeEach(async () => {
    page = await browser.newPage();
    await page.bringToFront();
  });

  afterEach(async () => {
    if (!page.isClosed()) {
      await page.close();
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
    await browser.close();
  });

  test("Extension installs and open new installation page", async () => {
    // Find the extension ID
    const newInstallationPage = await browser.waitForTarget(
      (target) =>
        target.type() === "page" &&
        target.url().endsWith("new_installation/index.html"),
    );

    expect(newInstallationPage).toBeDefined();
    expect(worker).toBeDefined();
  }, 2000);

  test("Extension installs and popup loads", async () => {
    expect(worker).toBeDefined();
    await worker!.evaluate("chrome.action.openPopup();");

    const popupTarget = await browser.waitForTarget(
      // Assumes that there is only one page with the URL ending with popup.html
      // and that is the popup created by the extension.
      (target) =>
        target.type() === "page" && target.url().endsWith("popup.html"),
    );

    const popupPage = popupTarget.asPage();
    expect(popupPage).toBeDefined();
  }, 5000);

  test("Domain whitelist matches exact host and ignores invalid patterns", async () => {
    await page.goto(domainTestUrl, { waitUntil: "domcontentloaded" });
    await page.bringToFront();

    await setSettingAndWait(worker!, "enable", true);
    await setSettingAndWait(worker!, KEY_DOMAIN_LIST_MODE, "whiteList");
    await setSettingAndWait(worker!, "domainBlackList", ["[", "localhost"]);

    let popupPage: Page | null = null;
    try {
      const existingPopupPages = await Promise.all(
        browser
          .targets()
          .filter(
            (target) =>
              target.type() === "page" && target.url().endsWith("popup.html"),
          )
          .map((target) => target.page()),
      );
      for (const existingPopupPage of existingPopupPages) {
        if (existingPopupPage && !existingPopupPage.isClosed()) {
          await existingPopupPage.close();
        }
      }

      await worker!.evaluate("chrome.action.openPopup();");
      const popupTarget = await browser.waitForTarget(
        (target) =>
          target.type() === "page" && target.url().endsWith("popup.html"),
        { timeout: 5000 },
      );
      popupPage = await popupTarget.asPage();
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

  test("Enabled languages restrict popup language list", async () => {
    const enabledLanguages = ["en_US", "de_DE"];
    await setSetting(worker!, KEY_ENABLED_LANGUAGES, enabledLanguages);
    await setSetting(worker!, KEY_LANGUAGE, "en_US");

    await worker!.evaluate("chrome.action.openPopup();");
    const popupTarget = await browser.waitForTarget((target) =>
      target.url().endsWith("popup.html"),
    );
    const popupPage = await popupTarget.asPage();
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

  test("Auto detect is only allowed when multiple languages are enabled", async () => {
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

  test("Auto detect in popup detects language and predicts", async () => {
    await gotoTestPage(page);
    page.bringToFront();
    await page.waitForSelector("#test-textarea");
    const textarea = await page.$("#test-textarea");

    await setSetting(worker!, KEY_ENABLED_LANGUAGES, ["en_US", "el_GR"]);
    await setSetting(worker!, KEY_LANGUAGE, "en_US");

    await worker!.evaluate("chrome.action.openPopup();");
    const popupTarget = await browser.waitForTarget((target) =>
      target.url().endsWith("popup.html"),
    );
    const popupPage = await popupTarget.asPage();
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

  test("Extension UI language translates options page correctly", async () => {
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
      const popupPage = await browser.newPage();
      await popupPage.goto(
        `chrome-extension://${worker!.url().split("/")[2]}/popup/popup.html`,
      );
      await popupPage.waitForSelector(".settings-box", { timeout: 500 });

      // Wait a moment for translations to apply
      await new Promise((r) => setTimeout(r, 100));

      const { found, actualText } = await popupPage.evaluate((exp: string) => {
        const btn = document.getElementById("runOptions");
        return {
          found: btn?.textContent?.includes(exp) ?? false,
          actualText: btn?.textContent || "NULL",
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
