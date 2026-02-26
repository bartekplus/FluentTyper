import puppeteer, { Browser } from "puppeteer";
import path from "path";

const EXTENSION_PATH = path.resolve(__dirname, "../../build/");
const IS_CI = process.env.CI === "true" || process.env.CI === "1";

export type BrowserType = "chrome" | "firefox";

export const BROWSER_TYPE: BrowserType =
  (process.env.E2E_BROWSER as BrowserType) || "chrome";

const EXTENSION_NAVIGATION_TIMEOUT_MS = isFirefox() ? 1200 : 5000;
const FIREFOX_DEBUGGING_NAVIGATION_TIMEOUT_MS = 10000;
const FIREFOX_DEBUGGING_SELECTOR_TIMEOUT_MS = 20000;
const FIREFOX_NAVIGATION_RECOVERY_TIMEOUT_MS = 3000;

export function isChrome(): boolean {
  return BROWSER_TYPE === "chrome";
}

export function isFirefox(): boolean {
  return BROWSER_TYPE === "firefox";
}

/**
 * Launch a browser with the extension loaded.
 */
export async function launchBrowser(): Promise<Browser> {
  if (isFirefox()) {
    return launchFirefox();
  }
  return launchChrome();
}

async function launchChrome(): Promise<Browser> {
  const args = [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    "--allow-file-access-from-files",
  ];
  if (IS_CI) {
    args.push(
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    );
  }
  return puppeteer.launch({
    headless: IS_CI,
    args,
    defaultViewport: null,
  });
}

let firefoxExtensionHost = "";

function isNavigationTimeout(error: unknown): boolean {
  return String(error).includes("Navigation timeout");
}

async function resolveFirefoxExtensionHost(
  browser: Browser,
  extensionId: string,
): Promise<string> {
  const page = await browser.newPage();
  try {
    try {
      await page.goto("about:debugging#/runtime/this-firefox", {
        timeout: FIREFOX_DEBUGGING_NAVIGATION_TIMEOUT_MS,
      });
    } catch (error) {
      if (!String(error).includes("Timeout")) {
        throw error;
      }
    }
    await page.waitForSelector(".qa-debug-target-item", {
      timeout: FIREFOX_DEBUGGING_SELECTOR_TIMEOUT_MS,
    });

    const host = await page.evaluate((targetExtensionId) => {
      const extensionItems = Array.from(
        document.querySelectorAll(
          ".qa-debug-target-item[data-qa-target-type='extension']",
        ),
      );
      for (const item of extensionItems) {
        const values = Array.from(
          item.querySelectorAll(".fieldpair__description"),
        ).map((el) => el.textContent?.trim() || "");
        if (!values.includes(targetExtensionId)) {
          continue;
        }
        const manifestLink =
          item.querySelector<HTMLAnchorElement>("a.qa-manifest-url");
        if (!manifestLink?.href) {
          continue;
        }
        try {
          return new URL(manifestLink.href).host;
        } catch {
          return "";
        }
      }
      return "";
    }, extensionId);

    if (!host) {
      throw new Error(
        "Could not resolve Firefox extension host from about:debugging",
      );
    }
    return host;
  } finally {
    if (!page.isClosed()) {
      await page.close();
    }
  }
}

async function launchFirefox(): Promise<Browser> {
  const browser = await puppeteer.launch({
    browser: "firefox",
    headless: IS_CI,
    defaultViewport: null,
  });

  const extensionId = await browser.installExtension(EXTENSION_PATH);
  if (!extensionId) {
    throw new Error("Failed to install Firefox extension");
  }
  firefoxExtensionHost = await resolveFirefoxExtensionHost(
    browser,
    extensionId,
  );
  return browser;
}

export interface BackgroundContext {
  evaluate<T>(
    pageFunction: string | ((...args: unknown[]) => T | Promise<T>),
    ...args: unknown[]
  ): Promise<T>;
  url(): string;
  close?(): Promise<void>;
}

/**
 * Wait for the extension's background context and return it.
 * Chrome uses a service worker, Firefox uses a background page or hidden page.
 */
export async function getBackgroundContext(
  browser: Browser,
): Promise<BackgroundContext> {
  if (isChrome()) {
    const serviceWorkerTarget = await browser.waitForTarget(
      (target) =>
        target.type() === "service_worker" &&
        target.url().endsWith("background.js"),
      { timeout: 30000 },
    );
    return (await serviceWorkerTarget.worker())!;
  }

  if (!firefoxExtensionHost) {
    throw new Error(
      "Firefox extension host is unavailable. Did you call launchBrowser?",
    );
  }
  const optionsUrl = getExtensionPageUrl(
    firefoxExtensionHost,
    "options/options.html",
  );
  const page = await browser.newPage();
  try {
    await page.goto(optionsUrl, {
      waitUntil: "domcontentloaded",
      timeout: EXTENSION_NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isNavigationTimeout(error)) {
      throw error;
    }
    await page.waitForFunction(
      (expectedPath) => window.location.href.includes(expectedPath),
      { timeout: FIREFOX_NAVIGATION_RECOVERY_TIMEOUT_MS },
      "options/options.html",
    );
  }
  await page
    .waitForFunction(() => document.readyState !== "loading", {
      timeout: FIREFOX_NAVIGATION_RECOVERY_TIMEOUT_MS,
    })
    .catch(() => undefined);
  return page;
}

export async function getRuntimePageUrl(
  context: BackgroundContext,
  pagePath: string,
): Promise<string> {
  return context.evaluate(
    (pagePathInner) => chrome.runtime.getURL(pagePathInner),
    pagePath,
  );
}

/**
 * Build an extension page URL for the current browser.
 * Chrome: chrome-extension://<id>/<path>
 * Firefox: moz-extension://<id>/<path>
 */
export function getExtensionPageUrl(
  extensionId: string,
  pagePath: string,
): string {
  const protocol = isFirefox() ? "moz-extension" : "chrome-extension";
  return `${protocol}://${extensionId}/${pagePath}`;
}

export async function openExtensionPage(
  browser: Browser,
  context: BackgroundContext,
  pagePath: string,
): Promise<import("puppeteer").Page> {
  const url = await getRuntimePageUrl(context, pagePath);
  const page = await browser.newPage();
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: EXTENSION_NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isNavigationTimeout(error)) {
      throw error;
    }
    if (!isFirefox()) {
      throw error;
    }
    await page.waitForFunction(
      (expectedPath) => window.location.href.includes(expectedPath),
      { timeout: FIREFOX_NAVIGATION_RECOVERY_TIMEOUT_MS },
      pagePath,
    );
  }
  if (isFirefox()) {
    await page
      .waitForFunction(() => document.readyState !== "loading", {
        timeout: FIREFOX_NAVIGATION_RECOVERY_TIMEOUT_MS,
      })
      .catch(() => undefined);
  }
  return page;
}

export async function openPopupPage(
  browser: Browser,
  context: BackgroundContext,
): Promise<import("puppeteer").Page> {
  if (isChrome()) {
    try {
      const popupTargetPromise = browser.waitForTarget(
        (target) =>
          target.type() === "page" && target.url().endsWith("popup/popup.html"),
        { timeout: 2000 },
      );
      await context.evaluate("chrome.action.openPopup();");
      const popupTarget = await popupTargetPromise;
      const popupPage = await popupTarget.asPage();
      if (popupPage) {
        return popupPage;
      }
    } catch {
      // Fall back to direct navigation.
    }
  }
  return openExtensionPage(browser, context, "popup/popup.html");
}

export async function triggerCommandForTesting(
  context: BackgroundContext,
  command: string,
): Promise<void> {
  await context.evaluate((commandInner) => {
    return new Promise<void>((resolve, reject) => {
      const hook = (
        globalThis as typeof globalThis & {
          triggerCommandForTesting?: (command: string) => Promise<void> | void;
        }
      ).triggerCommandForTesting;
      if (typeof hook === "function") {
        Promise.resolve(hook(commandInner)).then(resolve, reject);
        return;
      }
      chrome.runtime.sendMessage(
        { type: "TEST_TRIGGER_COMMAND", command: commandInner },
        (response: { ok?: boolean } | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error("Test command ACK returned not ok"));
            return;
          }
          resolve();
        },
      );
    });
  }, command);
}
