import type { Browser, Page } from "puppeteer";
import path from "path";
import * as fs from "fs";
import type { Server } from "http";
import { createServer } from "http";
import {
  CMD_LOCAL_AI_DELETE_MODEL,
  CMD_LOCAL_AI_GET_STATUS,
  CMD_LOCAL_AI_INSTALL,
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  KEY_LOCAL_AI_REVIEW_CONSENT,
  KEY_LOCAL_AI_REVIEW_ENABLED,
  KEY_LOCAL_AI_SETUP_OFFER_DISMISSED,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
} from "../../src/core/domain/constants";
import { localAiModelForTier } from "../../src/core/domain/localAi/modelRegistry";
import type { BackgroundContext, RecordedRequest } from "./e2e-helpers";
import {
  BROWSER_TYPE,
  clickReviewControl,
  evaluateInContentScript,
  getBackgroundContext,
  isChrome,
  isFirefox,
  launchBrowser,
  openExtensionPage,
  readReviewAi,
  recordNetworkRequests,
  suiteTimeout,
  triggerReview,
  waitForReview,
  waitUntil,
} from "./e2e-helpers";

/**
 * Local AI Review in the production build, without a GPU or a model: what
 * must (and must not) happen before the user consents to the download.
 * One fresh profile; the tests run in order and each leaves the settings as
 * it found them. The real-model flow lives in scripts/local-ai-e2e-real.ts.
 */

const RUN_E2E = process.env.RUN_E2E === "1" || process.env.RUN_E2E === "true";
const describeE2E = RUN_E2E ? describe : describe.skip;
const chromeTest = isChrome() ? test : test.skip;
const firefoxTest = isFirefox() ? test : test.skip;

const TEST_PAGE_HTML = fs.readFileSync(path.resolve(__dirname, "test-page.html"), "utf8");
const SETTINGS_PREFIX = "store.settings.";
const REVIEW_TEXT = "i think teh release is ready , but their is one problem.";
const TIMEOUT = suiteTimeout(30000, 60000);

/** Storage keys of the removed dev-only WebLLM autocomplete experiment; stale values are ignored. */
const LEGACY_AI_PREDICTOR_KEYS = {
  aiPredictorEnabled: true,
  debugAiPredictorEnabled: true,
  aiModelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
};

async function setSetting(worker: BackgroundContext, key: string, value: unknown): Promise<void> {
  await worker.evaluate(
    (storageKey, raw) => chrome.storage.local.set({ [storageKey]: raw }),
    `${SETTINGS_PREFIX}${key}`,
    JSON.stringify(value),
  );
}

async function removeSetting(worker: BackgroundContext, key: string): Promise<void> {
  await worker.evaluate(
    (storageKey) => chrome.storage.local.remove(storageKey),
    `${SETTINGS_PREFIX}${key}`,
  );
}

async function getSetting(worker: BackgroundContext, key: string): Promise<unknown> {
  const raw = await worker.evaluate(async (storageKey) => {
    const stored = await chrome.storage.local.get(storageKey);
    return stored[storageKey] as string | undefined;
  }, `${SETTINGS_PREFIX}${key}`);
  return raw === undefined ? undefined : JSON.parse(raw);
}

describeE2E(`Local AI Review E2E [${BROWSER_TYPE}]`, () => {
  let browser: Browser;
  let worker: BackgroundContext;
  let server: Server;
  let pageOrigin = "";
  let network: { requests: RecordedRequest[]; stop(): void } | null = null;
  let page: Page | null = null;

  /** Requests to anything but the extension itself and the local test page. */
  const outsideRequests = () =>
    (network?.requests ?? []).filter(
      ({ url }) => !/^(chrome-extension|data|blob|about):/.test(url) && !url.startsWith(pageOrigin),
    );

  /** The engine never started: ONNX Runtime fetches its WASM only when a model loads. */
  async function expectNoAiHost(): Promise<void> {
    if (isChrome()) {
      expect((network?.requests ?? []).filter(({ url }) => url.includes("local-ai/ort/"))).toEqual(
        [],
      );
    }
  }

  async function openReviewPage(): Promise<Page> {
    const next = await browser.newPage();
    await next.goto(`${pageOrigin}/`, { waitUntil: "domcontentloaded" });
    await next.bringToFront();
    await next.waitForFunction(
      () => document.querySelector("#test-textarea")?.hasAttribute("data-suggestion") ?? false,
      { timeout: suiteTimeout(10000, 15000) },
    );
    return next;
  }

  async function startReview(target: Page) {
    await target.evaluate((value) => {
      const field = document.querySelector("#test-textarea") as HTMLTextAreaElement;
      field.value = value;
      field.focus();
      field.setSelectionRange(0, 0);
    }, REVIEW_TEXT);
    await triggerReview(worker);
    return waitForReview(target, "rule findings", (panel) => panel.items.length > 0);
  }

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(TEST_PAGE_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server has no port");
    pageOrigin = `http://localhost:${address.port}`;

    browser = await launchBrowser();
    if (isChrome()) network = await recordNetworkRequests(browser);
    worker = await getBackgroundContext(browser);
    if (isChrome()) {
      // A fresh install opens an active onboarding tab; finish that before opening the test page.
      const installed = await browser.waitForTarget(
        (target) =>
          target.type() === "page" && target.url().endsWith("/new_installation/index.html"),
        { timeout: 10000 },
      );
      await (await installed.page())?.close();
    }
  }, 60000);

  afterEach(async () => {
    if (page && !page.isClosed()) await page.close().catch(() => undefined);
    page = null;
  });

  afterAll(async () => {
    network?.stop();
    await browser?.close().catch(() => undefined);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  chromeTest(
    "fresh profile: Review shows rule findings and a one-time setup offer, with no AI host and no downloads",
    async () => {
      page = await openReviewPage();
      const panel = await startReview(page);
      expect(panel.items.map((item) => item.text)).toContain("teh → the");

      const ai = await waitUntil("setup offer", async () => {
        const snapshot = await readReviewAi(page!);
        return snapshot.setup ? snapshot : false;
      });
      expect(ai.setupSize).toMatch(/^One-time download: ≈ \d/);
      expect(ai.aiItems).toEqual([]);
      expect(ai.pause).toBe(false);

      // Nothing loads, downloads or runs before consent.
      await expectNoAiHost();
      expect(await getSetting(worker, KEY_LOCAL_AI_REVIEW_CONSENT)).toBeUndefined();
      expect(outsideRequests()).toEqual([]);
    },
    TIMEOUT,
  );

  chromeTest(
    "a content script cannot install or delete a model",
    async () => {
      page = await openReviewPage();
      const answers = await evaluateInContentScript<unknown[]>(
        page,
        `Promise.all([
          chrome.runtime.sendMessage({ command: ${JSON.stringify(CMD_LOCAL_AI_INSTALL)}, context: { tier: "standard" } }),
          chrome.runtime.sendMessage({ command: ${JSON.stringify(CMD_LOCAL_AI_DELETE_MODEL)}, context: { modelId: ${JSON.stringify(localAiModelForTier("standard").modelId)} } }),
        ])`,
      );
      expect(answers).toEqual([
        { ok: false, error: "forbidden" },
        { ok: false, error: "forbidden" },
      ]);
      expect(await getSetting(worker, KEY_LOCAL_AI_REVIEW_CONSENT)).toBeUndefined();
      await expectNoAiHost();
      expect(outsideRequests()).toEqual([]);
    },
    TIMEOUT,
  );

  chromeTest(
    "legacy AI predictor settings do not route typing to a model",
    async () => {
      for (const [key, value] of Object.entries(LEGACY_AI_PREDICTOR_KEYS)) {
        await setSetting(worker, key, value);
      }
      await setSetting(worker, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
      try {
        page = await openReviewPage();
        await page.focus("#test-input");
        await page.type("#test-input", "th");
        // Presage answers the popup.
        await page.waitForFunction(
          () =>
            Array.from(document.querySelectorAll<HTMLElement>('[id^="ft-menu-"]')).some(
              (menu) => (menu.shadowRoot ?? menu).querySelectorAll("li[data-index]").length > 0,
            ),
          { timeout: suiteTimeout(10000, 15000) },
        );

        const optionsPage = await openExtensionPage(browser, worker, "options/options.html");
        try {
          const snapshot = await optionsPage.evaluate(
            (command) => chrome.runtime.sendMessage({ command, context: {} }),
            CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
          );
          expect(JSON.stringify(snapshot)).not.toMatch(/aiPredictor|aiModelId|webllm/i);
        } finally {
          await optionsPage.close();
        }
        await expectNoAiHost();
        expect(await getSetting(worker, KEY_LOCAL_AI_REVIEW_CONSENT)).toBeUndefined();
        expect(outsideRequests()).toEqual([]);
      } finally {
        for (const key of Object.keys(LEGACY_AI_PREDICTOR_KEYS)) {
          await removeSetting(worker, key);
        }
        await removeSetting(worker, KEY_MIN_WORD_LENGTH_TO_PREDICT);
      }
    },
    TIMEOUT,
  );

  chromeTest(
    '"Not now" dismisses the setup offer for good',
    async () => {
      page = await openReviewPage();
      await startReview(page);
      await waitUntil("setup offer", async () => (await readReviewAi(page!)).setup);
      await clickReviewControl(page, "[data-action=ai-setup-later]");
      await waitUntil("offer hidden", async () => !(await readReviewAi(page!)).setup);
      await waitUntil(
        "dismissal stored",
        async () => (await getSetting(worker, KEY_LOCAL_AI_SETUP_OFFER_DISMISSED)) === true,
      );

      await page.close();
      page = await openReviewPage();
      const panel = await startReview(page);
      expect(panel.items.length).toBeGreaterThan(0);
      expect((await readReviewAi(page)).setup).toBe(false);
      await expectNoAiHost();
      expect(outsideRequests()).toEqual([]);
    },
    TIMEOUT,
  );

  chromeTest(
    "with the Local AI preference off, Review shows no AI controls",
    async () => {
      await removeSetting(worker, KEY_LOCAL_AI_SETUP_OFFER_DISMISSED);
      await setSetting(worker, KEY_LOCAL_AI_REVIEW_ENABLED, false);
      try {
        page = await openReviewPage();
        const panel = await startReview(page);
        expect(panel.items.length).toBeGreaterThan(0);
        const ai = await readReviewAi(page);
        expect(ai).toMatchObject({ modes: false, ai: false, setup: false, aiItems: [] });
        await expectNoAiHost();
        expect(outsideRequests()).toEqual([]);
      } finally {
        await removeSetting(worker, KEY_LOCAL_AI_REVIEW_ENABLED);
      }
    },
    TIMEOUT,
  );

  // Last on Chrome: the options page's status probe configures the (model-less) runtime host.
  chromeTest(
    '"Set up local AI…" opens the Local AI settings; installing needs the inline confirm',
    async () => {
      page = await openReviewPage();
      await startReview(page);
      await waitUntil("setup offer", async () => (await readReviewAi(page!)).setup);
      const optionsTarget = browser.waitForTarget((target) =>
        target.url().endsWith("options/options.html#local-ai"),
      );
      await clickReviewControl(page, "[data-action=ai-setup]");
      const optionsPage = (await (await optionsTarget).asPage())!;
      try {
        // Record the Local AI commands the page sends from its very first script.
        await optionsPage.evaluateOnNewDocument(() => {
          const sent: string[] = [];
          (globalThis as { __ftLocalAiSent?: string[] }).__ftLocalAiSent = sent;
          const runtime = chrome.runtime;
          const original = runtime.sendMessage.bind(runtime) as (...args: unknown[]) => unknown;
          (runtime as { sendMessage: unknown }).sendMessage = (...args: unknown[]) => {
            const command = (args[0] as { command?: unknown } | null)?.command;
            if (typeof command === "string" && command.startsWith("CMD_LOCAL_AI_")) {
              sent.push(command);
            }
            return original(...args);
          };
        });
        // Revealing the card selects its parent tab and can rewrite the fragment
        // before instrumentation is installed. Reload the original setup deep link.
        await optionsPage.evaluate(() => history.replaceState(null, "", "#local-ai"));
        await optionsPage.reload({ waitUntil: "domcontentloaded" });
        // The status probe uses IntersectionObserver and waits for a visible tab.
        await optionsPage.bringToFront();
        await optionsPage.waitForFunction(
          () =>
            document.activeElement?.id === "local-ai-title" &&
            !!document.querySelector<HTMLElement>("#local-ai")?.offsetParent,
          { timeout: 10000 },
        );
        const sentCommands = () =>
          optionsPage.evaluate(
            () => (globalThis as { __ftLocalAiSent?: string[] }).__ftLocalAiSent ?? [],
          );
        await waitUntil("status request", async () => (await sentCommands()).length > 0);

        // A machine without a usable WebGPU adapter (CI) is told so, with nothing to install.
        const install = "#local-ai > * > .text-assets-actions > .is-link:not([hidden])";
        const shown = await optionsPage.waitForFunction(
          (selector) =>
            document.querySelector(selector)
              ? "install"
              : document.querySelector(".local-ai-status")?.textContent?.includes("isn't available")
                ? "unsupported"
                : false,
          { timeout: 15000 },
          install,
        );
        if ((await shown.jsonValue()) === "install") {
          // Install asks first; nothing is sent until the confirm button is pressed.
          await (await optionsPage.$(install))!.click();
          await optionsPage.waitForSelector("#local-ai .local-ai-confirm:not([hidden])");
        }
        expect(new Set(await sentCommands())).toEqual(new Set([CMD_LOCAL_AI_GET_STATUS]));
        expect(await getSetting(worker, KEY_LOCAL_AI_REVIEW_CONSENT)).toBeUndefined();
        expect(outsideRequests()).toEqual([]);
      } finally {
        await optionsPage.close();
      }
    },
    TIMEOUT,
  );

  firefoxTest(
    "Firefox has no runtime host: Review works with no AI controls",
    async () => {
      page = await openReviewPage();
      const panel = await startReview(page);
      expect(panel.items.length).toBeGreaterThan(0);
      const ai = await readReviewAi(page);
      expect(ai).toMatchObject({ modes: false, ai: false, setup: false, aiItems: [] });
    },
    TIMEOUT,
  );
});
