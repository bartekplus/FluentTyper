/** Optional real-model scenario. Use only a dedicated synthetic test profile. */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer";
import { distribution } from "./metrics";
import {
  getBackgroundContext,
  openExtensionPage,
  triggerReview,
  readReviewAi,
  waitUntil,
} from "../../tests/e2e/e2e-helpers";
import type { LocalAiStatus } from "../../src/core/domain/contracts/localAi";

const extension = path.resolve(
  process.env.PERF_AI_EXTENSION ?? ".tmp/performance/candidate/extension",
);
const profile = path.resolve(process.env.PERF_AI_PROFILE ?? ".tmp/performance-ai/profile");
const output = path.resolve(".tmp/performance-ai");
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  headless: false,
  userDataDir: profile,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () =>
    new Response(
      '<!doctype html><html lang="en"><textarea id="editor">The results shows a problem with the the report.</textarea><textarea id="typing"></textarea>',
      { headers: { "Content-Type": "text/html" } },
    ),
});
try {
  const context = await getBackgroundContext(browser);
  const options = await openExtensionPage(browser, context, "options/options.html#local-ai");
  if (process.argv.includes("--setup")) {
    console.log(
      "Configure the existing Local AI model in this test profile. Close this browser when setup completes.",
    );
    await new Promise<void>((resolve) => browser.once("disconnected", resolve));
  } else {
    const status = () =>
      options.evaluate(async () => {
        const answer = await chrome.runtime.sendMessage({
          command: "CMD_LOCAL_AI_GET_STATUS",
          context: {},
        });
        if (!answer?.ok) throw new Error("Local AI status is unavailable.");
        return answer.status as LocalAiStatus;
      });
    const initial = await status();
    if (!initial.enabled || !initial.consented || initial.install !== "complete")
      throw new Error("Run perf:ai --setup with a dedicated test profile first.");
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.waitForSelector("textarea[data-ft-suggestion-id]");
    const runs = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.bringToFront();
      await page.focus("#editor");
      await page.evaluate((index) => {
        const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
        editor.value = `The results shows a problem with the the report. This is sample ${index}.`;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }, cycle);
      const before = await status();
      const start = performance.now();
      const phases: Array<{ runtime: string; elapsedMs: number }> = [];
      const recordPhase = async () => {
        const current = await status();
        if (phases.at(-1)?.runtime !== current.runtime && phases.length < 64) {
          phases.push({ runtime: current.runtime, elapsedMs: performance.now() - start });
        }
      };
      if (cycle === 0) await triggerReview(context);
      await waitUntil(
        "Local AI starts",
        async () => {
          await recordPhase();
          return /loading|checking context|queued/i.test((await readReviewAi(page)).line);
        },
        { timeoutMs: 30000 },
      );
      const typingMs: number[] = [];
      await page.focus("#typing");
      // Real typing overlaps the model operation; no model request enters this typing handler.
      for (let i = 0; i < 24; i++) {
        const keyStart = performance.now();
        await page.keyboard.press(i % 2 ? "Backspace" : "a");
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        );
        typingMs.push(performance.now() - keyStart);
        await recordPhase();
      }
      await waitUntil(
        "Local AI completion",
        async () => {
          await recordPhase();
          return /check complete|checked only part|checked part/i.test(
            (await readReviewAi(page)).line,
          );
        },
        { timeoutMs: 600000, intervalMs: 100 },
      );
      runs.push({
        cycle,
        runtimeBefore: before.runtime,
        phases,
        phase: cycle === 0 ? "cold model load and inference" : "warm session inference",
        elapsedMs: performance.now() - start,
        typingRoundTripAndFrameMs: distribution(typingMs),
      });
    }
    await writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        {
          browser: await browser.version(),
          modelId: initial.modelId,
          tier: initial.tier,
          download: "not performed by this measurement command",
          gpuMemory: null,
          runs,
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(output, "summary.md"),
      `# Local AI performance\n\nModel: ${initial.modelId}. Three operations completed in one Review session.\nRuntime phase transitions are sampled. Loading and generation durations are approximate.\nSee results.json for phase transitions and typing distributions. GPU memory was not measured.\n`,
    );
    console.log(`Local AI report: ${path.join(output, "results.json")}`);
  }
} finally {
  server.stop(true);
  await browser.close();
}
