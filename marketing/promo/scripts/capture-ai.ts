/**
 * Records the promo's Local AI rewrite shot (frame 12) from the production build.
 *
 *   cd ../.. && E2E_EXTENSION_PATH=$PWD/build bun marketing/promo/scripts/capture-ai.ts
 *
 * The first run installs the Recommended model from the options page, as a user would
 * (about 4.9 GB, pinned Hugging Face revision), into a profile kept under
 * .cache/promo-local-ai/ (ignored by Git). Later runs reuse it and download nothing.
 * Needs a WebGPU adapter with shader-f16; set PROMO_AI_HEADED=1 if headless has none.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import {
  clickReviewControl,
  getBackgroundContext,
  openExtensionPage,
  REVIEW_HOST_SELECTOR,
  sleep,
  triggerReview,
  waitForReview,
  waitUntil,
} from "../../../tests/e2e/e2e-helpers";
import { COMPOSER_PAGE } from "./composer";

const ROOT = resolve(import.meta.dir, "../../..");
const EXTENSION = process.env.E2E_EXTENSION_PATH ?? resolve(ROOT, "build");
const PROFILE = resolve(ROOT, ".cache/promo-local-ai/profile");
const OUT = resolve(import.meta.dir, "../assets/ui");
const REWRITE_TEXT = "can u send me the file asap, thx";
const MINUTE = 60_000;

await mkdir(PROFILE, { recursive: true });
await mkdir(OUT, { recursive: true });
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(COMPOSER_PAGE);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as AddressInfo).port;
const browser = await puppeteer.launch({
  headless: process.env.PROMO_AI_HEADED !== "1",
  args: [
    `--disable-extensions-except=${EXTENSION}`,
    `--load-extension=${EXTENSION}`,
    "--enable-unsafe-webgpu",
  ],
  userDataDir: PROFILE,
  defaultViewport: null,
});
try {
  const worker = await getBackgroundContext(browser);
  const workerTarget = browser.targets().find((t) => t.type() === "service_worker");
  const session = await workerTarget?.createCDPSession();
  await session?.send("Runtime.enable");
  session?.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error" || event.type === "warning")
      console.log("worker:", event.args.map((arg) => arg.value ?? arg.description).join(" "));
  });
  session?.on("Runtime.exceptionThrown", (event) =>
    console.log("worker exception:", event.exceptionDetails.exception?.description),
  );
  // Local AI runs only for English reviews.
  await worker.evaluate(() =>
    chrome.storage.local.set({ "store.settings.language": JSON.stringify("en_US") }),
  );
  const options = await openExtensionPage(browser, worker, "options/options.html#local-ai");
  await options.waitForFunction(
    () => !!document.querySelector<HTMLElement>("#local-ai")?.offsetParent,
  );
  const gpu = await options.evaluate(async () => {
    const adapter = await (
      navigator as Navigator & {
        gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> };
      }
    ).gpu?.requestAdapter();
    return adapter ? adapter.features.has("shader-f16") : null;
  });
  if (!gpu)
    throw new Error(`No WebGPU adapter with shader-f16 (${gpu}); retry with PROMO_AI_HEADED=1`);
  const status = () =>
    options.$eval("#local-ai .local-ai-status", (element) => element.textContent ?? "");
  const settled = await waitUntil(
    "Local AI status",
    async () => {
      const now = await status();
      return /Checking/.test(now) ? false : now;
    },
    { timeoutMs: 2 * MINUTE },
  );
  console.log("status:", settled);
  if (!/available offline/.test(settled)) {
    console.log("Installing the Recommended model from the options page…");
    // The styled radio is not clickable by pointer; Standard is the default choice.
    await options.$eval('#local-ai input[name="local-ai-tier"][value="standard"]', (input) => {
      if (!(input as HTMLInputElement).checked) (input as HTMLInputElement).click();
    });
    // The options tab layout can leave no clickable box in headless mode: click in the page.
    const click = async (selector: string) => {
      const button = await options.waitForSelector(`${selector}:not([hidden]):not([disabled])`);
      console.log("click:", await button!.evaluate((el) => el.textContent?.trim()));
      await button!.evaluate((el) => (el as HTMLElement).click());
    };
    await click("#local-ai > * > .text-assets-actions > .is-link");
    await click("#local-ai .local-ai-confirm .is-link");
    let last = "";
    await waitUntil(
      "model available offline",
      async () => {
        const now = `${await status()} | ${await options.$eval("#local-ai", (el) => el.querySelector("progress, .local-ai-progress")?.outerHTML.slice(0, 160) ?? "")}`;
        if (now !== last) console.log("install:", (last = now));
        if (/failed|could not|error|incomplete|no longer/i.test(now)) throw new Error(now);
        return /available offline/.test(now);
      },
      { timeoutMs: 90 * MINUTE, intervalMs: 1000 },
    );
  }
  await options.close();

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 640, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await page.bringToFront();
  await page.evaluate((text) => {
    const doc = document.querySelector<HTMLElement>("#doc")!;
    doc.textContent = text;
    doc.focus();
    getSelection()!.collapse(doc, 1);
  }, REWRITE_TEXT);
  await sleep(500);
  await page.screenshot({ path: resolve(OUT, "v2-ai-before.png") });
  await triggerReview(worker);
  await waitForReview(page, "Review open", (panel) => panel.open && panel.status !== "");
  await clickReviewControl(page, "[data-action=mode-rewrite]");
  await page.evaluate((host) => {
    const select = document
      .querySelector(host)!
      .shadowRoot!.querySelector<HTMLSelectElement>("[data-action=rewrite-style]")!;
    select.value = "professional";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, REVIEW_HOST_SELECTOR);
  await clickReviewControl(page, "[data-action=rewrite-generate]");
  let lastMessage = "";
  const progress = setInterval(() => {
    void page
      .evaluate((host) => {
        const root = document.querySelector(host)?.shadowRoot;
        return `${root?.querySelector(".rewrite-msg")?.textContent ?? ""} | ${root?.querySelector(".status")?.textContent ?? ""} | ${root?.querySelector(".rewrite")?.textContent?.slice(0, 160) ?? ""}`;
      }, REVIEW_HOST_SELECTOR)
      .then((now) => {
        if (now !== lastMessage) console.log("rewrite:", (lastMessage = now));
      })
      .catch(() => undefined);
  }, 2000);
  const ready = await waitUntil(
    "rewrite ready",
    () =>
      page.evaluate((host) => {
        const root = document.querySelector(host)!.shadowRoot!;
        const message = root.querySelector(".rewrite-msg")?.textContent ?? "";
        (window as typeof window & { __promoRewrite?: string }).__promoRewrite = message;
        if (/fail|reject|discarded|could not|too long/i.test(message)) throw new Error(message);
        return /Rewrite ready/.test(message)
          ? {
              style: root.querySelector<HTMLSelectElement>("[data-action=rewrite-style]")!.value,
              diff: root.querySelector(".rewrite-diff")?.textContent ?? "",
            }
          : false;
      }, REVIEW_HOST_SELECTOR),
    { timeoutMs: 10 * MINUTE, intervalMs: 100 },
  );
  clearInterval(progress);
  if (ready.style !== "professional") throw new Error(`Style is ${ready.style}`);
  await sleep(300);
  await page.screenshot({ path: resolve(OUT, "v2-ai-rewrite.png") });
  await writeFile(
    resolve(import.meta.dir, "../evidence/local-ai.json"),
    JSON.stringify({ input: REWRITE_TEXT, style: ready.style, diff: ready.diff }, null, 2),
  );
  console.log("v2-ai-rewrite", JSON.stringify(ready.diff));
} finally {
  await browser.close();
  server.close();
}
