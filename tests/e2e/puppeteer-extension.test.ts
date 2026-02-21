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

  test("Prediction popup appears in textarea when typing and prediction is inserted on click", async () => {
    await page.goto("file://" + TEST_PAGE_PATH);
    page.bringToFront();
    await page.waitForSelector("#test-textarea");
    const textarea = await page.$("#test-textarea");
    await textarea!.type("h"); // Type a few letters
    // Wait for prediction popup
    await page.waitForSelector(".tribute-container li");
    // Check if there are DEFAULT_NUM_SUGGESTIONS li elements inside the predictionPopup
    const liCount = await page.$$eval(
      ".tribute-container li",
      (lis) => lis.length,
    );
    expect(liCount).toBe(DEFAULT_NUM_SUGGESTIONS);

    // Check if first li is "hello"
    const firstLiText = await page.$eval(
      ".tribute-container li:first-child",
      (li) => li.textContent,
    );
    expect(firstLiText?.toLowerCase()).toBe("have\xa0");

    // Click on the first suggestion
    await page.click(".tribute-container li:first-child");
    const textAreaText = await page.$eval(
      "#test-textarea",
      (textarea) => (textarea as HTMLTextAreaElement).value,
    );
    expect(textAreaText).toBe("have\xa0");
  }, 15000);

  test("Prediction popup appears in textarea when typing and prediction is inserted on TAB", async () => {
    page = await browser.newPage();
    await page.goto("file://" + TEST_PAGE_PATH);
    page.bringToFront();
    await page.waitForSelector("#test-textarea");
    const textarea = await page.$("#test-textarea");
    await textarea!.type("w"); // Type a few letters
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
      () =>
        (document.querySelector("#test-textarea") as HTMLTextAreaElement)
          .value !== "w",
    );
    const textAreaText = await page.$eval(
      "#test-textarea",
      (textarea) => (textarea as HTMLTextAreaElement).value,
    );
    expect(textAreaText).toBe("with\xa0");
  }, 30000);

  test("Inline suggestion prediction is inserted on TAB", async () => {
    page = await browser.newPage();
    await page.goto("file://" + TEST_PAGE_PATH);
    page.bringToFront();

    await setSetting(worker!, KEY_INLINE_SUGGESTION, true);
    await worker!.evaluate(
      "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
    );
    await new Promise((r) => setTimeout(r, 600));

    await page.waitForSelector("#test-textarea");
    const textarea = await page.$("#test-textarea");
    await textarea!.type("w");

    // Wait for the prediction engine to fetch result
    await new Promise((r) => setTimeout(r, 1000));

    await page.keyboard.press("Tab");

    // Wait for the textarea value to change
    await page.waitForFunction(
      () =>
        (document.querySelector("#test-textarea") as HTMLTextAreaElement)
          .value !== "w",
      { timeout: 5000 }
    );
    const textAreaText = await page.$eval(
      "#test-textarea",
      (textarea) => (textarea as HTMLTextAreaElement).value,
    );
    expect(textAreaText).toBe("with\xa0");

    // Cleanup
    await setSetting(worker!, KEY_INLINE_SUGGESTION, false);
    await worker!.evaluate(
      "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
    );
    await new Promise((r) => setTimeout(r, 600));
  }, 30000);

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
    await new Promise((r) => setTimeout(r, 300));
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
    await new Promise((r) => setTimeout(r, 300));
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
    await new Promise((r) => setTimeout(r, 300));
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
    await new Promise((r) => setTimeout(r, 300));
    await popupPage.close();

    const storedLanguage = await getSetting<string>(worker!, KEY_LANGUAGE);
    expect(storedLanguage).toBe("auto_detect");

    await worker!.evaluate(
      "chrome.runtime.sendMessage({command: 'CMD_OPTIONS_PAGE_CONFIG_CHANGE', context: {}});",
    );
    await new Promise((r) => setTimeout(r, 600));

    await textarea!.click();
    await page.evaluate(
      () =>
      ((
        document.querySelector("#test-textarea") as HTMLTextAreaElement
      ).value = ""),
    );
    await textarea!.type("φιλο");
    await new Promise((r) => setTimeout(r, 300));
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
      await new Promise((r) => setTimeout(r, 600));

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
      await new Promise((r) => setTimeout(r, 1000));

      try {
        await page.waitForSelector(".tribute-container li", { timeout: 5000 });
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
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 90000); // Increased timeout for iterating all languages
});
