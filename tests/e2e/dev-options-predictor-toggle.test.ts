import type { Browser, Page } from "puppeteer";
import type { BackgroundContext } from "./e2e-helpers";
import {
  BROWSER_TYPE,
  getBackgroundContext,
  launchBrowser,
  openExtensionPage,
} from "./e2e-helpers";
import {
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
} from "../../src/core/domain/constants";

const RUN_E2E = process.env.RUN_E2E === "1" || process.env.RUN_E2E === "true";
const describeE2E = RUN_E2E ? describe : describe.skip;

const SETTINGS_PREFIX = "store.settings.";

interface PredictorDebugSnapshot {
  config?: {
    debugPresagePredictorEnabled?: boolean;
    debugAIPredictorEnabled?: boolean;
  };
}

async function setSetting(context: BackgroundContext, key: string, value: unknown): Promise<void> {
  await context.evaluate(
    (storageKey, nextValue) =>
      new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [storageKey]: JSON.stringify(nextValue) }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      }),
    `${SETTINGS_PREFIX}${key}`,
    value,
  );
}

async function getSetting<T>(context: BackgroundContext, key: string): Promise<T | undefined> {
  return (await context.evaluate((storageKey) => {
    return new Promise<T | undefined>((resolve, reject) => {
      chrome.storage.local.get(storageKey, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const raw = (result as Record<string, string | undefined>)[storageKey];
        resolve(raw ? (JSON.parse(raw) as T) : undefined);
      });
    });
  }, `${SETTINGS_PREFIX}${key}`)) as T | undefined;
}

async function sendOptionsPageConfigChange(optionsPage: Page): Promise<void> {
  await optionsPage.evaluate((command) => {
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
}

async function getPredictorDebugSnapshot(optionsPage: Page): Promise<PredictorDebugSnapshot> {
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
}

async function waitForSettingValue(
  context: BackgroundContext,
  key: string,
  expectedValue: boolean,
  timeoutMs = 5000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentValue = await getSetting<boolean>(context, key);
    if (currentValue === expectedValue) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${key}=${String(expectedValue)}`);
}

async function waitForSnapshotValue(
  optionsPage: Page,
  key: string,
  expectedValue: boolean,
  timeoutMs = 7000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getPredictorDebugSnapshot(optionsPage);
    const currentValue =
      key === KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED
        ? snapshot.config?.debugPresagePredictorEnabled
        : snapshot.config?.debugAIPredictorEnabled;
    if (currentValue === expectedValue) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for predictor snapshot ${key}=${String(expectedValue)}`);
}

async function togglePredictorDebugButton(optionsPage: Page, key: string): Promise<void> {
  const selector = `[data-action="set-predictor-toggle"][data-key="${key}"]`;
  await optionsPage.waitForSelector(selector, { timeout: 10000 });
  await optionsPage.evaluate((selectorValue) => {
    const element = document.querySelector(selectorValue);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Missing predictor toggle: ${selectorValue}`);
    }
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
  }, selector);
}

describeE2E(`Options Predictor Toggle E2E [${BROWSER_TYPE}]`, () => {
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

  test.each([KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED, KEY_DEBUG_AI_PREDICTOR_ENABLED])(
    "applies %s from predictor debug dashboard",
    async (key) => {
      const optionsPage = await openExtensionPage(browser, worker, "options/options.html");

      try {
        await setSetting(worker, key, true);
        await sendOptionsPageConfigChange(optionsPage);
        await waitForSnapshotValue(optionsPage, key, true);

        await optionsPage.waitForSelector("#predictorDebugRoot", {
          timeout: 10000,
        });
        await togglePredictorDebugButton(optionsPage, key);

        await waitForSettingValue(worker, key, false);
        await waitForSnapshotValue(optionsPage, key, false);
      } finally {
        await setSetting(worker, key, true);
        if (!optionsPage.isClosed()) {
          await sendOptionsPageConfigChange(optionsPage);
        }
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    25000,
  );
});
