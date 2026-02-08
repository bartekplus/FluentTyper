import puppeteer, { Browser, Page } from "puppeteer";
import path from "path";
import { DEFAULT_NUM_SUGGESTIONS } from "../../src/shared/constants";
import { SUPPORTED_LANGUAGES } from "../../src/shared/lang";

const EXTENSION_PATH = path.resolve(__dirname, "../../build/");
const TEST_PAGE_PATH = path.resolve(__dirname, "test-page.html");

describe("Chrome Extension E2E Test", () => {
  let browser: Browser;
  let page: Page;

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

    const serviceWorker = await browser.waitForTarget(
      // Assumes that there is only one service worker created by the extension and its URL ends with background.js.
      (target) =>
        target.type() === "service_worker" &&
        target.url().endsWith("background.js"),
    );
    expect(newInstallationPage).toBeDefined();
    expect(serviceWorker).toBeDefined();
  }, 20000);

  test("Extension installs and popup loads", async () => {
    // Find the extension ID
    const serviceWorker = await browser.waitForTarget(
      // Assumes that there is only one service worker created by the extension and its URL ends with background.js.
      (target) =>
        target.type() === "service_worker" &&
        target.url().endsWith("background.js"),
    );
    expect(serviceWorker).toBeDefined();

    const worker = await serviceWorker.worker();
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
  }, 15000);

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

    for (const lang of Object.keys(SUPPORTED_LANGUAGES)) {
      if (lang === "auto_detect") continue;

      // 1. Open popup and change language
      const serviceWorker = await browser.waitForTarget(
        (target) =>
          target.type() === "service_worker" &&
          target.url().endsWith("background.js"),
      );
      const worker = await serviceWorker.worker();
      await worker!.evaluate("chrome.action.openPopup();");

      const popupTarget = await browser.waitForTarget((target) =>
        target.url().endsWith("popup.html"),
      );
      const popupPage = await popupTarget.asPage();
      await popupPage!.waitForSelector("#languageSelect");
      await popupPage!.select("#languageSelect", lang);
      // Wait a bit for the config to be saved and propagated
      await new Promise((r) => setTimeout(r, 500));
      await popupPage!.close();

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
          (document.querySelector("#test-textarea") as HTMLTextAreaElement)
            .value = "",
      );
      await textarea!.type(testData.input);
      // Wait for predictions to update after typing
      await new Promise((r) => setTimeout(r, 1000));

      try {
        await page.waitForSelector(".tribute-container li", { timeout: 2000 });
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
          (document.querySelector("#test-textarea") as HTMLTextAreaElement)
            .value = "",
      );
      // Wait for predictions to disappear
      // Note: Tribute might not remove the container, just hide it.
      // But clearing the input usually clears predictions.
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 60000); // Increased timeout for iterating all languages
});
