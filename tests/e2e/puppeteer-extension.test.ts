import puppeteer, { Browser, Page } from "puppeteer";
import path from "path";
import { DEFAULT_NUM_SUGGESTIONS } from "../../src/shared/constants";

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
});
