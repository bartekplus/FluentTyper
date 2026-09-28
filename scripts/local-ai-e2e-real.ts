/**
 * Opt-in, real-GPU end-to-end run of Local AI Review against the production
 * Chrome build: install, Correct, Rewrite, privacy sentinel, offline cold
 * start, partial cache and delete. Downloads the Standard model (~1 GB) from
 * its pinned Hugging Face revision on every run. Fails loudly without a
 * WebGPU adapter that has shader-f16.
 *
 *   bun scripts/local-ai-e2e-real.ts [--headed] [--plumbing-only] [--tier=compact]
 *
 * --plumbing-only builds, launches and checks the options Local AI section,
 * without touching the GPU or the network.
 *
 * Everything lives under .cache/local-ai-e2e/ (git-ignored), wiped at start.
 * Prints a Markdown summary with timings; exits 1 on the first failed step.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import puppeteer, { type Browser, type Page } from "puppeteer";
import {
  KEY_LANGUAGE,
  KEY_LOCAL_AI_REVIEW_CONSENT,
  KEY_LOCAL_AI_REVIEW_ENABLED,
} from "../src/core/domain/constants";
import {
  LOCAL_AI_DOWNLOAD_ORIGINS,
  matchesDownloadOrigin,
  localAiModelForTier,
} from "../src/core/domain/localAi/modelRegistry";
import {
  clickReviewControl,
  getOffscreenDocumentUrls,
  readReviewAi,
  readReviewPanel,
  REVIEW_HOST_SELECTOR,
  watchTargets,
  waitUntil,
  type BackgroundContext,
} from "../tests/e2e/e2e-helpers";

const ROOT = path.resolve(import.meta.dir, "..");
const WORK_DIR = path.join(ROOT, ".cache", "local-ai-e2e");
const EXTENSION_DIR = path.join(WORK_DIR, "extension");
const PROFILE_DIR = path.join(WORK_DIR, "profile");
const HEADED = process.argv.includes("--headed");
const PLUMBING_ONLY = process.argv.includes("--plumbing-only");
const TIER = process.argv.includes("--tier=compact") ? "compact" : "standard";
const MODEL = localAiModelForTier(TIER);
const MODEL_URL = `https://huggingface.co/${MODEL.weightsRepo}/resolve/${MODEL.weightsRevision}/`;
/** A unique synthetic word: it must never be found in any store, log or profile file. */
const SENTINEL = `Zqv${randomBytes(5).toString("hex")}`;
/** The rules flag only "i"; the model is expected to fix "shows" and "the the". */
/** A user-reported, error-dense paragraph (tests/fixtures/local-ai: dense-para-01). */
const DENSE_TEXT =
  "I dont think this feature work correctly when user paste a long texts into editor. Yesterday we was testing the new version and find several issue with suggestions. The application should automatically detect language, but sometime it choose a wrong one. My manager asked me if I can finished the report before friday afternoon. There is too many informations displayed on this screen and its difficult to understand them. She have been working on this project since three years, but she still dont know all the details. We need to improve performance because the current implementation is more slower then before. If the user click this button, all changes is saved immediatly without any confirmation. The new grammar checker looks really good however, it still miss some obvious mistakes. Me and my colleague discussed about this problem, and we decided to not change nothing for now.";
const CORRECT_TEXT = `The results shows a problem with the the report. Tomorrow i will ask ${SENTINEL} about it.`;
const REWRITE_TEXT = `hey, i looked at the numbers and they is mostly fine but ${SENTINEL} want a second look before friday.`;
const MINUTE = 60_000;

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

const results: StepResult[] = [];
const timings: Array<[string, number]> = [];
const consoleText: string[] = [];
const externalRequests: string[] = [];
const blockedRequests: string[] = [];
/** External requests that failed or answered with an HTTP error: URL and reason only. */
const failedRequests: string[] = [];

function progress(message: string): void {
  console.error(`[local-ai-e2e] ${message}`);
}

function isExternal(url: string): boolean {
  return /^(https?|wss?):/.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url);
}

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  const value = await run();
  timings.push([label, Math.round(performance.now() - startedAt)]);
  return value;
}

async function step(name: string, run: () => Promise<string>): Promise<void> {
  progress(`step: ${name}`);
  try {
    results.push({ step: name, ok: true, detail: await run() });
  } catch (error) {
    results.push({
      step: name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ------------------------------------------------------------------ browser

async function launch(offline: boolean): Promise<{ browser: Browser; worker: BackgroundContext }> {
  const args = [
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    "--enable-unsafe-webgpu",
  ];
  if (offline) args.push("--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost");
  const browser = await puppeteer.launch({
    headless: !HEADED,
    args,
    userDataDir: PROFILE_DIR,
    defaultViewport: null,
  });
  const target = await browser.waitForTarget(
    (candidate) =>
      candidate.type() === "service_worker" && candidate.url().endsWith("/background.js"),
    { timeout: 15000 },
  );
  const worker = (await target.worker())!;
  await watchTargets(browser, async (session, watched) => {
    session.on("Runtime.consoleAPICalled", (event) => {
      consoleText.push(
        event.args.map((arg) => String(arg.value ?? arg.description ?? "")).join(" "),
      );
    });
    session.on("Runtime.exceptionThrown", (event) => {
      consoleText.push(
        event.exceptionDetails.exception?.description ?? event.exceptionDetails.text,
      );
    });
    session.on("Log.entryAdded", (event) => consoleText.push(event.entry.text));
    const externalIds = new Map<string, string>();
    session.on("Network.requestWillBeSent", (event) => {
      if (!isExternal(event.request.url)) return;
      externalRequests.push(event.request.url);
      externalIds.set(event.requestId, event.request.url);
    });
    session.on("Network.responseReceived", (event) => {
      if (externalIds.has(event.requestId) && event.response.status >= 400) {
        failedRequests.push(`${event.response.status} ${event.response.url}`);
      }
    });
    session.on("Network.loadingFailed", (event) => {
      const url = externalIds.get(event.requestId);
      if (url)
        failedRequests.push(`${event.errorText}${event.canceled ? " (canceled)" : ""} ${url}`);
    });
    if (offline) {
      // Every request that is not the extension's own or the local test page fails.
      session.on("Fetch.requestPaused", (event) => {
        const allowed = !isExternal(event.request.url);
        if (!allowed) blockedRequests.push(`${watched.type()} ${event.request.url}`);
        void (
          allowed
            ? session.send("Fetch.continueRequest", { requestId: event.requestId })
            : session.send("Fetch.failRequest", {
                requestId: event.requestId,
                errorReason: "InternetDisconnected",
              })
        ).catch(() => undefined);
      });
      await session
        .send("Fetch.enable", { patterns: [{ urlPattern: "*" }] })
        .catch(() => undefined);
    }
    await Promise.all([
      session.send("Runtime.enable"),
      session.send("Log.enable").catch(() => undefined),
      session.send("Network.enable").catch(() => undefined),
    ]);
  });
  return { browser, worker };
}

async function openOptions(browser: Browser, worker: BackgroundContext): Promise<Page> {
  const url = await worker.evaluate(() => chrome.runtime.getURL("options/options.html#local-ai"));
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !!document.querySelector<HTMLElement>("#local-ai")?.offsetParent,
  );
  return page;
}

const optionsStatus = (page: Page) =>
  page.$eval("#local-ai .local-ai-status", (element) => element.textContent ?? "");

async function clickOptionsButton(page: Page, selector: string): Promise<void> {
  const button = await page.waitForSelector(`${selector}:not([hidden]):not([disabled])`);
  await button!.click();
}

async function getSetting(worker: BackgroundContext, key: string): Promise<unknown> {
  const raw = await worker.evaluate(async (storageKey) => {
    const stored = await chrome.storage.local.get(storageKey);
    return stored[storageKey] as string | undefined;
  }, `store.settings.${key}`);
  return raw === undefined ? undefined : JSON.parse(raw);
}

/** Cached entries under the pinned model URL, per WebLLM scope (read from an extension page). */
async function cachedModelKeys(page: Page): Promise<string[]> {
  return page.evaluate(async (base) => {
    const keys: string[] = [];
    for (const scope of ["webllm/config", "webllm/model"]) {
      if (!(await caches.has(scope))) continue;
      const cache = await caches.open(scope);
      for (const request of await cache.keys()) {
        if (request.url.startsWith(base)) keys.push(request.url);
      }
    }
    return keys;
  }, MODEL_URL);
}

// -------------------------------------------------------------- review page

let pageUrl = "";

async function openEditor(browser: Browser, text: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelector("#editor")?.hasAttribute("data-suggestion") ?? false,
    { timeout: 15000 },
  );
  await page.evaluate((value) => {
    const field = document.querySelector("#editor") as HTMLTextAreaElement;
    field.value = value;
    field.focus();
    field.setSelectionRange(0, 0);
  }, text);
  return page;
}

async function review(worker: BackgroundContext): Promise<void> {
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (typeof tab?.id !== "number") throw new Error("No active tab");
    await chrome.tabs.sendMessage(tab.id, {
      command: "CMD_REVIEW_FT_ACTIVE_TAB",
      context: { source: "command" },
    });
  });
}

const editorValue = (page: Page) =>
  page.$eval("#editor", (element) => (element as HTMLTextAreaElement).value);

async function waitForRuleFinding(page: Page): Promise<void> {
  await waitUntil(
    "first rule finding",
    async () =>
      (await readReviewPanel(page)).items.length > (await readReviewAi(page)).aiItems.length,
    { timeoutMs: 20000, intervalMs: 20 },
  );
}

async function waitForAiLine(page: Page, pattern: RegExp, timeoutMs: number): Promise<string> {
  let line = "";
  await waitUntil(
    `Local AI line ${pattern}`,
    async () => {
      line = (await readReviewAi(page)).line;
      return pattern.test(line);
    },
    { timeoutMs, intervalMs: 100 },
  ).catch((error: unknown) => {
    throw new Error(`${String(error)}; last line: "${line}"`, { cause: error });
  });
  return line;
}

/** Ids of the findings tagged Local AI. */
const aiItemIds = (page: Page) =>
  page.evaluate(
    (host) =>
      Array.from(
        document.querySelector(host)?.shadowRoot?.querySelectorAll<HTMLElement>(".item") ?? [],
      )
        .filter((item) => !!item.querySelector(".why .tag"))
        .map((item) => item.dataset.id ?? ""),
    REVIEW_HOST_SELECTOR,
  );

async function pressUndo(page: Page): Promise<void> {
  await page.focus("#editor");
  const isMac = process.platform === "darwin";
  await page.keyboard.down(isMac ? "Meta" : "Control");
  await page.keyboard.press("z", isMac ? { commands: ["Undo"] } : undefined);
  await page.keyboard.up(isMac ? "Meta" : "Control");
}

// -------------------------------------------------------------------- privacy

async function dumpExtensionStorage(worker: BackgroundContext): Promise<string> {
  return worker.evaluate(async () =>
    JSON.stringify([
      await chrome.storage.local.get(null),
      await chrome.storage.sync.get(null),
      await chrome.storage.session.get(null),
    ]),
  );
}

/** Profile files that contain the sentinel, in UTF-8 or UTF-16. */
async function profileFilesWithSentinel(dir: string): Promise<{ hits: string[]; scanned: number }> {
  const needles = [Buffer.from(SENTINEL, "utf8"), Buffer.from(SENTINEL, "utf16le")];
  const hits: string[] = [];
  let scanned = 0;
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // CacheStorage holds the model blobs; Sessions is Chrome's own tab restore,
        // which saves every page's form field values (the textarea) with or without the extension.
        if (entry.name !== "CacheStorage" && entry.name !== "Sessions") await walk(full);
      } else if (entry.isFile()) {
        const bytes = await readFile(full).catch(() => null);
        if (!bytes) continue;
        scanned += 1;
        if (needles.some((needle) => bytes.includes(needle))) hits.push(path.relative(dir, full));
      }
    }
  };
  await walk(dir);
  return { hits, scanned };
}

// ----------------------------------------------------------------------- main

async function main(): Promise<void> {
  await rm(WORK_DIR, { recursive: true, force: true });
  const build = Bun.spawnSync({
    cmd: [
      process.execPath,
      "build.ts",
      "--mode=production",
      "--platform=chrome",
      `--outdir=${EXTENSION_DIR}`,
    ],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  check(build.exitCode === 0, "Production build failed");

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      '<!doctype html><title>Local AI e2e</title><textarea id="editor" rows="8" cols="80"></textarea>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  check(address && typeof address !== "string", "Test server has no port");
  pageUrl = `http://localhost:${address.port}/`;
  try {
    await run();
  } finally {
    server.close();
  }
}

async function run(): Promise<void> {
  let { browser, worker } = await launch(false);
  try {
    // Local AI runs only for English reviews; the profile persists for the offline phase.
    await worker.evaluate(
      (key) => chrome.storage.local.set({ [key]: JSON.stringify("en_US") }),
      `store.settings.${KEY_LANGUAGE}`,
    );
    if (PLUMBING_ONLY) {
      await step("plumbing: options Local AI section renders, nothing downloads", async () => {
        const page = await openOptions(browser, worker);
        const status = await waitUntil("status", async () => {
          const text = await optionsStatus(page);
          return /Not set up yet/.test(text) ? text : false;
        });
        await page.close();
        check(externalRequests.length === 0, `External requests: ${externalRequests.join(", ")}`);
        return `status: "${status}"`;
      });
      return;
    }
    await step("WebGPU adapter with shader-f16", async () => {
      const page = await openOptions(browser, worker);
      const gpu = await page.evaluate(async () => {
        const adapter = await (
          navigator as Navigator & {
            gpu?: {
              requestAdapter(): Promise<{
                features: Set<string>;
                info?: { vendor?: string; architecture?: string };
              } | null>;
            };
          }
        ).gpu?.requestAdapter();
        return adapter
          ? {
              f16: adapter.features.has("shader-f16"),
              vendor: `${adapter.info?.vendor ?? "?"} ${adapter.info?.architecture ?? ""}`.trim(),
            }
          : null;
      });
      await page.close();
      check(gpu, "No WebGPU adapter (navigator.gpu missing or requestAdapter() returned null)");
      check(gpu.f16, `WebGPU adapter ${gpu.vendor} lacks shader-f16`);
      return `adapter: ${gpu.vendor}`;
    });

    await step(`(i) install ${MODEL.displayName} from the options page`, async () => {
      const page = await openOptions(browser, worker);
      await page.waitForFunction(() =>
        /Not set up yet/.test(
          document.querySelector("#local-ai .local-ai-status")?.textContent ?? "",
        ),
      );
      await page.click(`#local-ai input[name="local-ai-tier"][value="${TIER}"]`);
      await clickOptionsButton(page, "#local-ai > * > .text-assets-actions > .is-link");
      let lastStatus = "";
      await timed("install (confirm → available offline)", async () => {
        await clickOptionsButton(page, "#local-ai .local-ai-confirm .is-link");
        await waitUntil(
          "available offline",
          async () => {
            const status = await optionsStatus(page);
            if (status !== lastStatus) progress(`install: ${(lastStatus = status)}`);
            if (/failed|could not|error|incomplete|no longer/i.test(status)) {
              throw new Error(
                `Install failed: "${status}" after ${externalRequests.length} requests`,
              );
            }
            return /available offline/.test(status);
          },
          { timeoutMs: 45 * MINUTE, intervalMs: 500 },
        );
      });
      await page.close();
      const origins = [...new Set(externalRequests.map((url) => new URL(url).origin))];
      const foreign = origins.filter(
        (origin) => !matchesDownloadOrigin(`${origin}/`, LOCAL_AI_DOWNLOAD_ORIGINS),
      );
      check(
        foreign.length === 0,
        `Requests outside LOCAL_AI_DOWNLOAD_ORIGINS: ${foreign.join(", ")}`,
      );
      check(
        !externalRequests.some((url) => url.includes("raw.githubusercontent.com")),
        "A request went to raw.githubusercontent.com",
      );
      check(await getSetting(worker, KEY_LOCAL_AI_REVIEW_CONSENT), "Consent was not recorded");
      return `${externalRequests.length} requests; origins: ${origins.join(", ") || "none"}`;
    });

    await step(
      "(ii) Correct: rule finding, then a Local AI finding; accept + native undo",
      async () => {
        const page = await openEditor(browser, CORRECT_TEXT);
        const startedAt = performance.now();
        await review(worker);
        await waitForRuleFinding(page);
        timings.push([
          "Review open → first rule finding",
          Math.round(performance.now() - startedAt),
        ]);
        await waitUntil("first Local AI finding", async () => (await aiItemIds(page)).length > 0, {
          timeoutMs: 10 * MINUTE,
          intervalMs: 100,
        }).catch(async (error: unknown) => {
          throw new Error(`${String(error)}; AI line: "${(await readReviewAi(page)).line}"`, {
            cause: error,
          });
        });
        timings.push([
          "Review open → first Local AI finding",
          Math.round(performance.now() - startedAt),
        ]);
        const aiFindings = (await readReviewAi(page)).aiItems;

        const [id] = await aiItemIds(page);
        await clickReviewControl(page, `.item[data-id="${id}"]`);
        await waitUntil("card", async () => (await readReviewPanel(page)).card.open);
        await clickReviewControl(page, ".card [data-action=apply]");
        const applied = await waitUntil("AI correction applied", async () => {
          const value = await editorValue(page);
          return value !== CORRECT_TEXT ? value : false;
        });
        await page.keyboard.press("Escape");
        await pressUndo(page);
        await waitUntil(
          "native undo restores the text",
          async () => (await editorValue(page)) === CORRECT_TEXT,
        );
        await page.close();
        return `AI findings: ${aiFindings.length}; applied one, undo restored (changed ${applied.length - CORRECT_TEXT.length} chars net)`;
      },
    );

    await step("(ii-b) dense paragraph: Local AI findings arrive progressively", async () => {
      const page = await openEditor(browser, DENSE_TEXT);
      const startedAt = performance.now();
      await review(worker);
      await waitForRuleFinding(page);
      await waitUntil("first Local AI finding", async () => (await aiItemIds(page)).length > 0, {
        timeoutMs: 5 * MINUTE,
        intervalMs: 100,
      });
      timings.push([
        "Dense paragraph: Review open → first Local AI finding",
        Math.round(performance.now() - startedAt),
      ]);
      const line = await waitForAiLine(page, /complete|checked|did not finish/i, 5 * MINUTE);
      timings.push([
        "Dense paragraph: Review open → Local AI check finished",
        Math.round(performance.now() - startedAt),
      ]);
      const panel = await readReviewPanel(page);
      const ai = (await readReviewAi(page)).aiItems;
      await page.close();
      console.log(`[local-ai-e2e] dense paragraph Local AI findings:\n  ${ai.join("\n  ")}`);
      check(ai.length >= 5, `only ${ai.length} Local AI findings on the dense paragraph`);
      return `${ai.length} Local AI findings of ${panel.items.length} in total; "${line}"`;
    });

    await step("(iii) Rewrite (Keep my voice): diff, Apply only when ready, apply", async () => {
      const page = await openEditor(browser, REWRITE_TEXT);
      await review(worker);
      await waitForRuleFinding(page);
      await clickReviewControl(page, "[data-action=mode-rewrite]");
      const rewriteState = () =>
        page.evaluate((host) => {
          const root = document.querySelector(host)!.shadowRoot!;
          const apply = root.querySelector<HTMLButtonElement>("[data-action=rewrite-apply]")!;
          return {
            style: root.querySelector<HTMLSelectElement>("[data-action=rewrite-style]")!.value,
            message: root.querySelector(".rewrite-msg")?.textContent ?? "",
            diff: !root.querySelector<HTMLElement>(".rewrite-diff")!.hidden,
            applyUsable: !apply.hidden && !apply.disabled,
          };
        }, REVIEW_HOST_SELECTOR);
      const initial = await rewriteState();
      check(initial.style === "keep-voice", `Default style is ${initial.style}`);
      check(!initial.applyUsable, "Apply is usable before anything was generated");
      await clickReviewControl(page, "[data-action=rewrite-generate]");
      const startedAt = performance.now();
      let sawBusy = false;
      const ready = await waitUntil(
        "rewrite ready",
        async () => {
          const state = await rewriteState();
          if (/Rewriting locally/.test(state.message)) {
            sawBusy = true;
            check(!state.applyUsable, "Apply is usable while generating");
          }
          if (/Rewrite ready/.test(state.message)) return state;
          check(
            !/fail|reject|could not|changes a|too long/i.test(state.message),
            `Rewrite ended: ${state.message}`,
          );
          return false;
        },
        { timeoutMs: 10 * MINUTE, intervalMs: 50 },
      );
      timings.push(["Rewrite Generate → ready", Math.round(performance.now() - startedAt)]);
      check(ready.diff && ready.applyUsable, "Ready rewrite shows no diff or no usable Apply");
      await clickReviewControl(page, "[data-action=rewrite-apply]");
      const after = await waitUntil("rewrite applied", async () => {
        const value = await editorValue(page);
        return value !== REWRITE_TEXT ? value : false;
      });
      await page.close();
      return `generating state seen: ${sawBusy}; text replaced (${REWRITE_TEXT.length} → ${after.length} chars)`;
    });

    await step("(iv-a) sentinel absent from extension storage and console", async () => {
      const storage = await dumpExtensionStorage(worker);
      check(!storage.includes(SENTINEL), "Sentinel found in chrome.storage");
      check(
        !consoleText.some((line) => line.includes(SENTINEL)),
        "Sentinel found in console output",
      );
      return `storage ${storage.length} bytes, ${consoleText.length} console lines`;
    });
  } finally {
    await browser.close().catch(() => undefined);
  }

  await step(
    "(iv-b) sentinel absent from profile files (CacheStorage, Sessions excluded)",
    async () => {
      const { hits, scanned } = await profileFilesWithSentinel(PROFILE_DIR);
      check(hits.length === 0, `Sentinel found in: ${hits.join(", ")}`);
      return `${scanned} files scanned`;
    },
  );

  // ------------------------------------------------------ offline, same profile
  externalRequests.length = 0;
  ({ browser, worker } = await launch(true));
  try {
    await step("(v) offline cold start: Local AI finding from the cache", async () => {
      const page = await openEditor(browser, CORRECT_TEXT);
      const startedAt = performance.now();
      await review(worker);
      await waitForRuleFinding(page);
      await waitUntil("Local AI finding offline", async () => (await aiItemIds(page)).length > 0, {
        timeoutMs: 10 * MINUTE,
        intervalMs: 100,
      }).catch(async (error: unknown) => {
        throw new Error(`${String(error)}; AI line: "${(await readReviewAi(page)).line}"`, {
          cause: error,
        });
      });
      timings.push([
        "Offline cold Review → first Local AI finding",
        Math.round(performance.now() - startedAt),
      ]);
      await page.close();
      check(
        blockedRequests.length === 0,
        `External requests attempted: ${blockedRequests.join(", ")}`,
      );
      check(
        externalRequests.length === 0,
        `External requests seen: ${externalRequests.join(", ")}`,
      );
      return "no external request attempted";
    });

    await step("(vi) partial cache fails honestly, without network", async () => {
      const options = await openOptions(browser, worker);
      const removed = await options.evaluate(async (base) => {
        const cache = await caches.open("webllm/model");
        const shard = (await cache.keys()).find(
          (request) => request.url.startsWith(base) && /params_shard_\d+\.bin$/.test(request.url),
        );
        return shard && (await cache.delete(shard)) ? shard.url : null;
      }, MODEL_URL);
      check(removed, "No weight shard found in CacheStorage");
      await options.close();
      // Cold host: the warm engine must not hide the missing shard.
      await worker.evaluate(() => chrome.offscreen.closeDocument().catch(() => undefined));
      await waitUntil(
        "host closed",
        async () => (await getOffscreenDocumentUrls(worker)).length === 0,
      );

      const page = await openEditor(browser, CORRECT_TEXT);
      await review(worker);
      await waitForRuleFinding(page);
      const line = await waitForAiLine(page, /needs to be installed again/, 2 * MINUTE);
      check((await aiItemIds(page)).length === 0, "Local AI findings from a partial cache");
      check((await readReviewPanel(page)).items.length > 0, "Rule findings lost");
      await page.close();
      const settings = await openOptions(browser, worker);
      const status = await waitUntil(
        "options shows partial",
        async () => {
          const text = await optionsStatus(settings);
          return /incomplete/.test(text) ? text : false;
        },
        { timeoutMs: 30000 },
      );
      await settings.close();
      check(
        blockedRequests.length === 0,
        `External requests attempted: ${blockedRequests.join(", ")}`,
      );
      return `removed ${removed.slice(MODEL_URL.length)}; Review: "${line}"; options: "${status}"`;
    });

    await step("(vii) delete from options: cache empty, consent kept, no download", async () => {
      const options = await openOptions(browser, worker);
      await clickOptionsButton(options, "#local-ai .is-danger");
      await clickOptionsButton(options, "#local-ai .local-ai-confirm .is-link");
      const status = await waitUntil(
        "model deleted",
        async () => {
          const text = await optionsStatus(options);
          return /no longer on this device/.test(text) ? text : false;
        },
        { timeoutMs: 60000 },
      );
      const left = await cachedModelKeys(options);
      await options.close();
      check(left.length === 0, `Cache entries left: ${left.length}`);
      check(await getSetting(worker, KEY_LOCAL_AI_REVIEW_CONSENT), "Consent was removed");
      check(
        (await getSetting(worker, KEY_LOCAL_AI_REVIEW_ENABLED)) !== false,
        "Preference was turned off",
      );

      const page = await openEditor(browser, CORRECT_TEXT);
      await review(worker);
      await waitForRuleFinding(page);
      const line = await waitForAiLine(page, /needs to be installed again/, MINUTE);
      await page.close();
      check(
        blockedRequests.length === 0,
        `External requests attempted: ${blockedRequests.join(", ")}`,
      );
      check(
        externalRequests.length === 0,
        `External requests seen: ${externalRequests.join(", ")}`,
      );
      return `options: "${status}"; Review: "${line}"`;
    });

    await step("(iv-c) sentinel absent from storage and console (offline phase)", async () => {
      const storage = await dumpExtensionStorage(worker);
      check(!storage.includes(SENTINEL), "Sentinel found in chrome.storage");
      check(
        !consoleText.some((line) => line.includes(SENTINEL)),
        "Sentinel found in console output",
      );
      return `${consoleText.length} console lines total`;
    });
  } finally {
    await browser.close().catch(() => undefined);
  }

  await step("(iv-d) sentinel absent from profile files after the whole run", async () => {
    const { hits, scanned } = await profileFilesWithSentinel(PROFILE_DIR);
    check(hits.length === 0, `Sentinel found in: ${hits.join(", ")}`);
    return `${scanned} files scanned`;
  });

  await step("(vii-b) no model copy left in Chrome's HTTP cache after Delete", async () => {
    const bytes = await directoryBytes(path.join(PROFILE_DIR, "Default", "Cache"));
    check(bytes < 50e6, `HTTP cache holds ${Math.round(bytes / 1e6)} MB`);
    return `HTTP cache ${Math.round(bytes / 1e6)} MB`;
  });
}

async function directoryBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await directoryBytes(full) : (await stat(full)).size;
  }
  return total;
}

function printSummary(): void {
  const lines = [
    "## Local AI Review: real-GPU e2e",
    "",
    `Model: ${MODEL.modelId} @ ${MODEL.weightsRevision.slice(0, 12)}; headless: ${!HEADED}`,
    "",
    "| Step | Result | Detail |",
    "| --- | --- | --- |",
    ...results.map(
      ({ step: name, ok, detail }) =>
        `| ${name} | ${ok ? "pass" : "**FAIL**"} | ${detail.replaceAll("|", "\\|")} |`,
    ),
    "",
    "| Timing | ms |",
    "| --- | ---: |",
    ...timings.map(([label, ms]) => `| ${label} | ${ms} |`),
  ];
  if (results.some((result) => !result.ok)) {
    lines.push(
      "",
      "Failed external requests (last 20):",
      ...failedRequests.slice(-20).map((line) => `- ${line}`),
      "",
      "Console (last 30 lines):",
      ...consoleText.slice(-30).map((line) => `- ${line.slice(0, 300)}`),
    );
  }
  console.log(lines.join("\n"));
}

if (import.meta.main) {
  main()
    .then(() => {
      printSummary();
    })
    .catch((error: unknown) => {
      printSummary();
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
