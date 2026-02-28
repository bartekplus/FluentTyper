import { Browser, Page } from "puppeteer";
import {
  BROWSER_TYPE,
  BackgroundContext,
  getBackgroundContext,
  launchBrowser,
  openExtensionPage,
} from "./e2e-helpers";
import { CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT } from "../../src/core/domain/constants";

interface PredictorDebugSnapshot {
  config?: {
    aiPredictorEnabled?: boolean;
  };
  runtime?: {
    webllm?: {
      enabled?: boolean;
    };
  };
}

async function getPredictorDebugSnapshot(
  browser: Browser,
  context: BackgroundContext,
): Promise<PredictorDebugSnapshot> {
  const optionsPage = await openExtensionPage(
    browser,
    context,
    "options/options.html",
  );
  try {
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
  } finally {
    if (!optionsPage.isClosed()) {
      await optionsPage.close();
    }
  }
}

describe(`Production Build Smoke E2E [${BROWSER_TYPE}]`, () => {
  let browser: Browser;
  let worker: BackgroundContext;

  beforeAll(async () => {
    browser = await launchBrowser();
    worker = await getBackgroundContext(browser);
  }, 60000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  }, 20000);

  test("does not expose runtime command test hooks", async () => {
    const hasRuntimeHook = await worker.evaluate(() => {
      return typeof (globalThis as { triggerCommandForTesting?: unknown })
        .triggerCommandForTesting === "function";
    });
    expect(hasRuntimeHook).toBe(false);
  }, 10000);

  test("keeps predictor debug panel hidden in options page", async () => {
    const optionsPage: Page = await openExtensionPage(
      browser,
      worker,
      "options/options.html",
    );
    try {
      await optionsPage.waitForSelector("#content");
      const hasPredictorDebugRoot = await optionsPage.$("#predictorDebugRoot");
      expect(hasPredictorDebugRoot).toBeNull();

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
  }, 20000);

  test("reports AI predictor runtime disabled", async () => {
    const snapshot = await getPredictorDebugSnapshot(browser, worker);
    expect(snapshot.config?.aiPredictorEnabled).toBe(false);
    expect(snapshot.runtime?.webllm?.enabled).toBe(false);
  }, 15000);
});
