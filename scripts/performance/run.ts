import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { cpus, totalmem, platform, release } from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import { distribution, assertNoGrowth } from "./metrics";

const tier = process.argv[2] ?? "smoke";
if (!["smoke", "stress", "soak"].includes(tier)) throw new Error("Use smoke, stress, or soak.");
const positive = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
};
const tabs = positive("PERF_TABS", tier === "soak" ? 40 : tier === "stress" ? 5 : 1);
const cycles = positive("PERF_CYCLES", tier === "smoke" ? 3 : tier === "stress" ? 30 : 1000000);
const seconds = positive("PERF_SECONDS", tier === "soak" ? 7200 : tier === "stress" ? 600 : 120);
const repeats = positive("PERF_REPEATS", 2);
const output = path.resolve(process.env.PERF_OUTPUT ?? `.tmp/performance/${Date.now()}`);
const build = path.join(output, "extension");
await mkdir(output, { recursive: true });
await Promise.all(
  ["results.json", "summary.md", "failure.json"].map((name) =>
    rm(path.join(output, name), { force: true }),
  ),
);
if (process.env.PERF_BASE_BUILD) {
  await cp(path.resolve(process.env.PERF_BASE_BUILD), build, { recursive: true });
} else {
  const child = Bun.spawn(
    ["bun", "build.ts", "--mode=production", "--platform=chrome", `--outdir=${build}`],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (await child.exited) throw new Error("Performance build failed.");
}
const bundle = path.join(build, "content_script.js");
const original = await readFile(
  process.env.PERF_BASE_BUILD ? path.join(build, "content_script.original.js") : bundle,
  "utf8",
);
await writeFile(path.join(build, "content_script.original.js"), original);
const buildHash = new Bun.CryptoHasher("sha256").update(original).digest("hex");
const backgroundHash = new Bun.CryptoHasher("sha256")
  .update(await readFile(path.join(build, "background.js")))
  .digest("hex");
await writeFile(
  bundle,
  `${await readFile(new URL("./probe.js", import.meta.url), "utf8")}\n${original}`,
);
process.env.E2E_EXTENSION_PATH = build;
const {
  launchBrowser,
  openExtensionPage,
  getBackgroundContext,
  evaluateInContentScript,
  triggerReview,
  waitForReview,
  clickReviewControl,
  waitUntil,
} = await import("../../tests/e2e/e2e-helpers");
const fixture =
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>Performance fixture</title><body><main><textarea id="editor" rows="8" cols="80">' +
  "The cat is ready. We is ready. ".repeat(80) +
  '</textarea><textarea id="typing" rows="8" cols="80">The dog is ready. </textarea></main></body></html>';
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(fixture, { headers: { "Content-Type": "text/html" } }),
});
type Probe = Record<string, number> & { handlerMs: number[] };
const runs: Array<Record<string, unknown>> = [];
const boundedPush = <T>(values: T[], value: T) => {
  if (values.length === 4096) values.shift();
  values.push(value);
};
try {
  for (let repeat = 0; repeat < repeats; repeat++) {
    // Reverse order on alternate repetitions to expose order effects.
    const modes = ["disabled", "idle", "typing", "review"];
    if (repeat % 2) modes.reverse();
    for (const mode of modes) {
      console.log(`Performance: repeat ${repeat + 1}, ${mode}`);
      const browser =
        mode === "disabled"
          ? await puppeteer.launch({
              headless: true,
              defaultViewport: null,
              args: process.env.CI
                ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
                : [],
            })
          : await launchBrowser();
      try {
        const context = mode === "disabled" ? null : await getBackgroundContext(browser);
        if (context)
          await context.evaluate(async () => {
            await chrome.storage.local.set({
              "store.settings.language": JSON.stringify("en_US"),
              "store.settings.enable": "true",
              "store.settings.domainBlackList": "[]",
            });
          });
        const pages = [];
        const coldMs = [];
        for (let i = 0; i < tabs; i++) {
          const page = await browser.newPage();
          await page.setViewport({ width: 1024, height: 768 });
          await page.evaluateOnNewDocument(() => {
            const samples: number[] = [];
            (globalThis as unknown as { fixtureInputMs: number[] }).fixtureInputMs = samples;
            document.addEventListener(
              "input",
              () => {
                const start = performance.now();
                requestAnimationFrame(() => {
                  if (samples.length === 4096) samples.shift();
                  samples.push(performance.now() - start);
                });
              },
              true,
            );
          });
          const start = performance.now();
          await page.goto(`http://127.0.0.1:${server.port}/fixture`);
          if (context) await page.waitForSelector("textarea[data-ft-suggestion-id]");
          coldMs.push(performance.now() - start);
          pages.push(page);
        }
        const read = (page: (typeof pages)[number]) =>
          evaluateInContentScript<Probe>(page, "globalThis.__ftPerformance()");
        const frame = (page: (typeof pages)[number]) =>
          page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
        // Measured quiescence window; this delay is the workload, not a readiness substitute.
        const idle = () => new Promise((resolve) => setTimeout(resolve, 1000));
        await idle();
        const baseline: Probe[] = [];
        const responsiveness: number[] = [];
        const reviewMs: number[] = [];
        const inputFrameMs: number[] = [];
        const memory: unknown[] = [];
        const resourceCycles: unknown[] = [];
        const started = Date.now();
        let completed = 0;
        for (
          let cycle = 0;
          cycle < cycles && Date.now() - started < (seconds * 1000) / (repeats * modes.length);
          cycle++
        ) {
          for (const page of pages) {
            await page.bringToFront();
            if (cycle > 0 && cycle % 10 === 0) {
              await page.reload({ waitUntil: "domcontentloaded" });
              if (context) await page.waitForSelector("textarea[data-ft-suggestion-id]");
            }
            if (mode !== "idle") {
              await page.focus("#editor");
              const reviewStart = performance.now();
              if (mode === "review") {
                await triggerReview(context!);
              }
              await page.focus("#typing");
              for (const key of ["a", "b", "c", "Backspace", "Backspace", "Backspace"]) {
                const start = performance.now();
                await page.keyboard.press(key);
                await frame(page);
                boundedPush(responsiveness, performance.now() - start);
              }
              if (mode === "review") {
                await waitForReview(
                  page,
                  "native Review completion",
                  (p) => p.open && p.status !== "" && !/checking|reviewing/i.test(p.status),
                );
                boundedPush(reviewMs, performance.now() - reviewStart);
                await clickReviewControl(page, "[data-action=close]");
              }
              for (const value of await page.evaluate(() =>
                (globalThis as unknown as { fixtureInputMs: number[] }).fixtureInputMs.splice(0),
              ))
                boundedPush(inputFrameMs, value);
              // Replace editors without navigation to exercise retained detached state.
              await page.evaluate((route) => {
                document.querySelector("main")!.innerHTML =
                  '<textarea id="editor" rows="8" cols="80">The cat is ready. </textarea><textarea id="typing" rows="8" cols="80">The dog is ready. </textarea>';
                history.pushState({}, "", `/route-${route}`);
              }, cycle % 3);
              if (context)
                await waitUntil(
                  "editor helpers",
                  async () => (await page.$$("textarea[data-ft-suggestion-id]")).length >= 2,
                );
            }
            await idle();
            const metrics = await page.metrics();
            boundedPush(memory, {
              cycle,
              tab: pages.indexOf(page),
              elapsedMs: Date.now() - started,
              pageAndIsolatedHeapBytes: metrics.JSHeapUsedSize,
              domNodes: metrics.Nodes,
              documentCount: metrics.Documents,
              browserListeners: metrics.JSEventListeners,
            });
            if (context) {
              const current = await read(page);
              current.activeEditorStates = await page.$$eval(
                "textarea[data-ft-suggestion-id]",
                (elements) => elements.length,
              );
              if (current.activeEditorStates !== 2)
                throw new Error("Editor state count differs from fixture count.");
              // Ignore first-cycle lazy resources; later cycles must not accumulate registrations.
              boundedPush(resourceCycles, {
                cycle,
                tab: pages.indexOf(page),
                ...current,
                handlerMs: distribution(current.handlerMs),
              });
              if (cycle > 0)
                assertNoGrowth(baseline[pages.indexOf(page)], current, [
                  "listeners",
                  "observers",
                  "timers",
                  "frames",
                  "pendingMessages",
                  "activeEditorStates",
                ]);
              if (cycle === 0) baseline[pages.indexOf(page)] = current;
            }
          }
          completed++;
        }
        if (context) {
          const before = await Promise.all(pages.map(read));
          await idle();
          const after = await Promise.all(pages.map(read));
          for (let i = 0; i < pages.length; i++)
            assertNoGrowth(before[i], after[i], ["scans", "layout", "messages"]);
        }
        if (context) {
          const settingsPage = await openExtensionPage(browser, context, "options/options.html");
          const transitionResources = new Map<boolean, Probe[]>();
          for (const enabled of [false, true, false, true]) {
            await settingsPage.evaluate(async (value) => {
              await chrome.storage.local.set({ "store.settings.enable": JSON.stringify(value) });
              const answer = await chrome.runtime.sendMessage({
                command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE",
                context: {},
              });
              if (!answer?.ok) throw new Error("Config update failed.");
            }, enabled);
            for (const page of pages) {
              await waitUntil(
                "runtime enable state",
                async () =>
                  (await page.$$eval(
                    "textarea[data-ft-suggestion-id]",
                    (elements) => elements.length,
                  )) === (enabled ? 2 : 0),
              );
              if (!enabled) {
                await idle();
                const before = await read(page);
                await idle();
                assertNoGrowth(before, await read(page), ["scans", "layout", "messages"]);
              }
            }
            if (enabled) await idle();
            const current = await Promise.all(pages.map(read));
            const previous = transitionResources.get(enabled);
            if (previous) {
              current.forEach((sample, index) =>
                assertNoGrowth(previous[index], sample, [
                  "listeners",
                  "observers",
                  "timers",
                  "frames",
                  "pendingMessages",
                ]),
              );
            } else transitionResources.set(enabled, current);
          }
          await settingsPage.close();
        }
        const result = {
          repeat,
          mode,
          browser: await browser.version(),
          cycles: completed,
          coldLoadMs: distribution(coldMs),
          keyboardRoundTripAndTwoFramesMs: distribution(responsiveness),
          inputToNextFrameMs: distribution(inputFrameMs),
          nativeReviewCompletionUpperBoundMs: distribution(reviewMs),
          memory,
          resourceCycles,
        };
        runs.push(result);
        await writeFile(
          path.join(output, "results.json"),
          JSON.stringify(
            {
              schema: 1,
              tier,
              tabs,
              cycles,
              workloadSeconds: seconds,
              repeats,
              contentBundleSha256: buildHash,
              backgroundBundleSha256: backgroundHash,
              hardware: {
                cpu: cpus()[0]?.model,
                logicalCpus: cpus().length,
                totalMemory: totalmem(),
                platform: platform(),
                release: release(),
              },
              fixtureBytes: Buffer.byteLength(fixture),
              warmup:
                "one second after helper attachment; first cycle excluded from resource growth assertions",
              instrumentation:
                "test-only production bundle prefix; no forced GC; each sample series keeps its last 4096 entries",
              notMeasured: [
                "separate isolated-world heap",
                "browser process RSS",
                "GPU/model memory",
                "local AI inference",
              ],
              runs,
            },
            null,
            2,
          ),
        );
      } finally {
        await browser.close();
      }
    }
  }
} catch (error) {
  await writeFile(
    path.join(output, "failure.json"),
    JSON.stringify({
      completedRuns: runs.length,
      error: error instanceof Error ? error.name : "unknown",
    }),
  );
  await writeFile(
    path.join(output, "summary.md"),
    "Performance run failed. See failure.json and the command output. Completed modes remain in results.json.\n",
  );
  throw error;
} finally {
  server.stop(true);
}
const rows = runs.map((run) => {
  const latency = run.inputToNextFrameMs as ReturnType<typeof distribution>;
  const heap = run.memory as Array<{ pageAndIsolatedHeapBytes: number }>;
  return `| ${run.repeat} | ${run.mode} | ${latency.n} | ${latency.p50} | ${latency.p95} | ${heap.at(-1)!.pageAndIsolatedHeapBytes - heap[0].pageAndIsolatedHeapBytes} |`;
});
await writeFile(
  path.join(output, "summary.md"),
  `# Extension performance

${runs.length} browser runs completed. Resource and idle assertions passed.

| Repeat | Mode | Input samples | Input to frame p50 ms | p95 ms | Last minus first sampled heap bytes |
|---|---|---:|---:|---:|---:|
${rows.join("\n")}

Timing and memory are reports only. No timing or memory release gate is calibrated.
Heap deltas include page and isolated contexts. They are not leak assertions or retained-size measurements.
Review latency includes concurrent typing and is an upper bound. Frame timing is not display latency.
See results.json for environment, per-cycle heap, and resource counts. Local AI inference was not run.
No collection was forced. Compare matched repetitions with the disabled control.
`,
);
console.log(`Performance report: ${output}`);
