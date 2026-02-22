import puppeteer, { Browser, Page, WebWorker } from "puppeteer";
import path from "path";
import {
  DEFAULT_NUM_SUGGESTIONS,
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_LANGUAGE,
  KEY_INLINE_SUGGESTION,
} from "../../src/shared/constants";
import { SUPPORTED_PREDICTION_LANGUAGE_KEYS } from "../../src/shared/lang";

const EXTENSION_PATH = path.resolve(__dirname, "../../build/");
const TEST_PAGE_PATH = path.resolve(__dirname, "test-page.html");
const SETTINGS_PREFIX = "store.settings.";

async function setSetting(
  worker: WebWorker,
  key: string,
  value: unknown,
): Promise<void> {
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  await worker.evaluate(
    (storageKeyInner, valueInner) =>
      chrome.storage.local.set({
        [storageKeyInner]: JSON.stringify(valueInner),
      }),
    storageKey,
    value,
  );
}

async function getSetting<T>(
  worker: WebWorker,
  key: string,
): Promise<T | undefined> {
  const storageKey = `${SETTINGS_PREFIX}${key}`;
  return worker.evaluate(
    (storageKeyInner) =>
      new Promise((resolve) => {
        chrome.storage.local.get(storageKeyInner, (result) => {
          const rawValue = (result as Record<string, string | undefined>)[
            storageKeyInner
          ];
          resolve(rawValue ? JSON.parse(rawValue) : undefined);
        });
      }),
    storageKey,
  ) as Promise<T | undefined>;
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

describe("Chrome Extension E2E Test", () => {
  let browser: Browser;
  let page: Page;
  let worker: WebWorker;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: false, // Extension UI cannot be tested in headless mode
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
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
  }, 20000);

  afterAll(async () => {
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
  }, 20000);

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
  }, 20000);

  test.each([["#test-textarea"], ["#test-input"], ["#test-contenteditable"]])(
    "Prediction popup appears in %s when typing and prediction is inserted on click",
    async (selector) => {
      await page.goto("file://" + TEST_PAGE_PATH);
      page.bringToFront();
      await page.waitForSelector(selector);
      const element = await page.$(selector);
      await element!.type("h"); // Type a few letters
      // Wait for prediction popup
      await page.waitForSelector(".tribute-container li");
      // Check if there are DEFAULT_NUM_SUGGESTIONS li elements inside the predictionPopup
      const liCount = await page.$$eval(
        ".tribute-container li",
        (lis) => lis.length,
      );
      expect(liCount).toBe(DEFAULT_NUM_SUGGESTIONS);

      // Check if first li is "have\xa0"
      const firstLiText = await page.$eval(
        ".tribute-container li:first-child",
        (li) => li.textContent,
      );
      expect(firstLiText?.toLowerCase()).toBe("have\xa0");

      // Click on the first suggestion
      await page.click(".tribute-container li:first-child");
      const elementText = await page.$eval(
        selector,
        (el) => (el as HTMLInputElement).value ?? el.textContent,
      );
      expect(elementText).toBe("have\xa0");
    },
    15000,
  );

  test.each([["#test-textarea"], ["#test-input"], ["#test-contenteditable"]])(
    "Prediction popup appears in %s when typing and prediction is inserted on TAB",
    async (selector) => {
      page = await browser.newPage();
      await page.goto("file://" + TEST_PAGE_PATH);
      page.bringToFront();
      await page.waitForSelector(selector);
      const element = await page.$(selector);
      await element!.type("w"); // Type a few letters
      // Wait for prediction popup
      await page.waitForSelector(".tribute-container li");
      // Check if there are DEFAULT_NUM_SUGGESTIONS li elements inside the predictionPopup
      const liCount = await page.$$eval(
        ".tribute-container li",
        (lis) => lis.length,
      );
      expect(liCount).toBe(DEFAULT_NUM_SUGGESTIONS);

      // Check if first li is "with"
      const firstLiText = await page.$eval(
        ".tribute-container li:first-child",
        (li) => li.textContent,
      );
      expect(firstLiText?.toLowerCase()).toBe("with\xa0");

      await page.keyboard.press("Tab");
      // Wait for the textarea value to become "with\xa0"
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
      expect(elementText).toBe("with\xa0");
    },
    30000,
  );

  test("Cursor movement cancels missing space auto-insertion", async () => {
    page = await browser.newPage();
    await page.goto("file://" + TEST_PAGE_PATH);
    page.bringToFront();
    await page.waitForSelector("#test-textarea");
    const textarea = await page.$("#test-textarea");

    // Type a partial word to trigger autocomplete
    await textarea!.type("h");
    await page.waitForSelector(".tribute-container li");

    // Press Tab to autocomplete to "have\xa0"
    await page.keyboard.press("Tab");
    await page.waitForFunction(
      () =>
        (document.querySelector("#test-textarea") as HTMLTextAreaElement)
          .value === "have\xa0",
    );

    // Now move the cursor left (over the \xa0)
    await page.keyboard.press("ArrowLeft");

    // Type 'x'
    await textarea!.type("x");

    // Evaluate if 'x' was inserted WITHOUT an extra space before it.
    // If the flag wasn't cleared, it would insert \xa0 before x -> "have\xa0x\xa0"
    // Since expected behavior clears the flag, it should be "havex\xa0"
    await new Promise((r) => setTimeout(r, 50));
    const textAreaText = await page.$eval(
      "#test-textarea",
      (textarea) => (textarea as HTMLTextAreaElement).value,
    );
    expect(textAreaText).toBe("havex\xa0");
  }, 15000);

  test.each([["#test-textarea"], ["#test-input"], ["#test-contenteditable"]])(
    "Inline suggestion prediction is inserted on TAB in %s",
    async (selector) => {
      page = await browser.newPage();
      await page.goto("file://" + TEST_PAGE_PATH);
      page.bringToFront();

      await setSetting(worker!, KEY_INLINE_SUGGESTION, true);
      await worker!.evaluate(
        "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
      );
      await new Promise((r) => setTimeout(r, 50));

      await page.waitForSelector(selector);
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
        { timeout: 5000 },
        selector,
      );
      const elementText = await page.$eval(
        selector,
        (el) => (el as HTMLInputElement).value ?? el.textContent,
      );
      expect(elementText).toBe("with\xa0");

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
  }, 20000);

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
  }, 20000);

  test("Auto detect in popup detects language and predicts", async () => {
    page = await browser.newPage();
    await page.goto("file://" + TEST_PAGE_PATH);
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

    await page.waitForSelector(".tribute-container li", { timeout: 5000 });
    const firstLiText = await page.$eval(
      ".tribute-container li:first-child",
      (li) => li.textContent,
    );
    expect(firstLiText?.toLowerCase()).toContain("φιλοσοφία");
  }, 30000);

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
    de_DE: { input: "schmetter", expected: "schmetterling" },
    pl_PL: { input: "chrabą", expected: "chrabąszcz" },
    pt_BR: { input: "caipir", expected: "caipira" },
    textExpander: { input: "asap", expected: "as soon as possible" },
  };

  test("Prediction works for all supported languages", async () => {
    page = await browser.newPage();
    await page.goto("file://" + TEST_PAGE_PATH);
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
        const firstLiText = await page.$eval(
          ".tribute-container li:first-child",
          (li) => li.textContent,
        );
        expect(firstLiText?.toLowerCase()).toContain(
          testData.expected.toLowerCase(),
        );
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
      // Note: Tribute might not remove the container, just hide it.
      // But clearing the input usually clears predictions.
      await new Promise((r) => setTimeout(r, 50));
    }
  }, 90000); // Increased timeout for iterating all languages

  test("Extension UI language translates options page correctly", async () => {
    // i18n short codes mapped to full locale codes and expected divider text
    const TEST_LANGS: { locale: string; expected: string }[] = [
      { locale: "en_US", expected: "Extension UI Language" },
      { locale: "fr_FR", expected: "Langue de l'interface" },
      { locale: "hr_HR", expected: "Jezik su\u010Delja pro\u0161irenja" },
      { locale: "es_ES", expected: "Idioma de la interfaz" },
      { locale: "el_GR", expected: "\u0393\u03BB\u03CE\u03C3\u03C3\u03B1 \u03B4\u03B9\u03B5\u03C0\u03B1\u03C6\u03AE\u03C2 \u03B5\u03C0\u03AD\u03BA\u03C4\u03B1\u03C3\u03B7\u03C2" },
      { locale: "sv_SE", expected: "Till\u00E4ggets gr\u00E4nssnittsspr\u00E5k" },
      { locale: "de_DE", expected: "Sprache der Erweiterungsoberfl\u00E4che" },
      { locale: "pl_PL", expected: "J\u0119zyk interfejsu rozszerzenia" },
      { locale: "pt_BR", expected: "Idioma da interface da extens\u00E3o" },
    ];

    for (const { locale, expected } of TEST_LANGS) {
      // 1. Set the extension language in chrome.storage.local
      await setSetting(worker!, "extensionLanguage", locale);

      // 2. Open options page to sync localStorage in the extension context
      const syncPage = await openOptionsPage(browser, worker!);
      await syncPage.waitForSelector("#content", { timeout: 5000 });
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
      await optionsPage.waitForSelector("#content .divider", { timeout: 5000 });

      const textFound = await optionsPage.evaluate((exp: string) => {
        const dividers = document.querySelectorAll(".divider");
        for (const d of dividers) {
          if (d.textContent?.includes(exp)) return true;
        }
        return false;
      }, expected);

      expect(textFound).toBe(true);
      await optionsPage.close();
    }

    // Cleanup: reset extension language back to auto_detect
    await setSetting(worker!, "extensionLanguage", "auto_detect");
    // Also update localStorage in the extension context
    const cleanupPage = await openOptionsPage(browser, worker!);
    await cleanupPage.waitForSelector("#content", { timeout: 5000 });
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
  }, 120000);


  test.each([["#test-textarea"], ["#test-input"], ["#test-contenteditable"]])(
    "Prediction popup can be closed via Escape key in %s",
    async (selector) => {
      page = await browser.newPage();
      await page.goto("file://" + TEST_PAGE_PATH);
      page.bringToFront();

      await setSetting(worker!, KEY_LANGUAGE, "en_US");
      await worker!.evaluate(
        "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
      );
      await new Promise((r) => setTimeout(r, 100));

      await page.waitForSelector(selector);
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
        { timeout: 5000 },
      );
    },
    15000,
  );

  test.each([["#test-textarea"], ["#test-input"], ["#test-contenteditable"]])(
    "Text expansion works correctly in %s",
    async (selector) => {
      page = await browser.newPage();
      await page.goto("file://" + TEST_PAGE_PATH);
      page.bringToFront();

      await setSetting(worker!, KEY_ENABLED_LANGUAGES, ["textExpander"]);
      await setSetting(worker!, KEY_LANGUAGE, "textExpander");
      await worker!.evaluate(
        "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
      );
      await new Promise((r) => setTimeout(r, 100));

      await page.waitForSelector(selector);
      const element = await page.$(selector);
      await element!.type("asap"); // Trigger text expansion

      await page.waitForSelector(".tribute-container li");
      const firstLiText = await page.$eval(
        ".tribute-container li:first-child",
        (li) => li.textContent,
      );
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
});
