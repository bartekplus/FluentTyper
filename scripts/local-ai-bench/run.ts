/**
 * Real-device Local AI Review benchmark (opt-in; needs a WebGPU GPU with shader-f16).
 *
 *   bun run bench:local-ai --real [--models=standard,compact,<tjsModels id>,...]
 *     [--limit=N] [--ids=case-a,case-b] [--modes=correct,rewrite,cancel]
 *     [--prompt=product|classes|soft|twoex|combo] [--contract=json|text] [--tag=name]
 *     [--purge | --purge-only] [--worker-check] [--headful]
 *
 * Launches Puppeteer's Chrome for Testing with --enable-unsafe-webgpu and a
 * persistent profile under .cache/local-ai-bench/ (weights stay cached across
 * runs), serves a bundled harness page + ONNX Runtime Web from
 * http://localhost, and drives the product engine (Transformers.js) with the
 * product's prompts/parse/validate code. By default it runs the registry's
 * models (exactly what ships). Fails (non-zero) when no WebGPU adapter with
 * shader-f16 is available; it never falls back to CPU or mocks.
 *
 * Hard limits: model load ≤ 10 min, each generation ≤ 90 s (interrupted and
 * counted as a timeout), whole model run ≤ 20 min; on a timeout the browser is
 * killed and the next model runs.
 *
 * Fixtures are synthetic (tests/fixtures/local-ai/). Results (raw outputs
 * included) go to .cache/local-ai-bench/results/ and are never committed.
 */
import { mkdirSync, existsSync, rmSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type Browser, type HTTPRequest, type Page } from "puppeteer";
import { LOCAL_AI_RUNTIME_VERSION } from "../../src/core/domain/localAi/modelRegistry";
import type { GenParams } from "./page";
import { runFixtures, type ModelRun } from "./fixtures";
import { PROMPT_VARIANTS } from "./promptVariants";
import { REGISTRY_MODELS, benchModel, type BenchModel } from "./tjsModels";

const ROOT = resolve(import.meta.dir, "../..");
const CACHE = join(ROOT, ".cache/local-ai-bench");
const PROFILE = join(CACHE, "chrome-profile");
const RESULTS = join(CACHE, "results");
/** First-run download timings survive later (cached) runs. */
const DOWNLOADS = join(RESULTS, "downloads.json");
/** Fixed: the Cache API is per origin, so a stable port keeps weights cached. */
const PORT = 47_811;

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=", 2);
    return [key!, value ?? "true"] as const;
  }),
);

function fail(message: string): never {
  console.error(`local-ai-bench: FAIL: ${message}`);
  process.exit(1);
}

if (!args.has("real")) {
  console.error(
    "local-ai-bench runs real models on a real GPU (downloads ~3-5 GB per model).\n" +
      "Opt in explicitly with --real. See docs/local-ai-evaluation.md.",
  );
  process.exit(2);
}

const models = (args.get("models")?.split(",") ?? REGISTRY_MODELS.map((m) => m.id))
  .filter(Boolean)
  .map(
    (id) =>
      benchModel(id) ?? fail(`unknown model ${id} (registry tier/modelId or tjsModels.ts id)`),
  );

// ---- page bundle + server ------------------------------------------------

async function bundle(entry: string): Promise<string> {
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, entry)],
    target: "browser",
    format: "esm",
  });
  if (!build.success) fail(`${entry} bundle failed: ${build.logs.map(String).join("\n")}`);
  return build.outputs[0]!.text();
}
const pageBundle = await bundle("page.ts");
const workerBundle = await bundle("tjsWorker.ts");
const HTML = `<!doctype html><meta charset="utf-8"><title>ft local ai bench</title><script type="module" src="/page.js"></script>`;
const js = { headers: { "content-type": "text/javascript" } };

const server = Bun.serve({
  port: PORT,
  hostname: "localhost",
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response(HTML, { headers: { "content-type": "text/html" } });
    if (path === "/page.js") return new Response(pageBundle, js);
    if (path === "/worker.js") return new Response(workerBundle, js);
    // ONNX Runtime Web's WASM + loader, served locally (as the extension would package them).
    const ort = /^\/ort\/(ort-wasm-simd-threaded\.asyncify\.(?:mjs|wasm))$/.exec(path)?.[1];
    if (ort) {
      return new Response(Bun.file(join(ROOT, "node_modules/onnxruntime-web/dist", ort)), {
        headers: { "content-type": ort.endsWith(".mjs") ? "text/javascript" : "application/wasm" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

const requestOrigins = new Set<string>();
/** Pinned-revision file paths the page fetched for the current model (checked against the registry). */
const fetchedFiles = new Set<string>();
let fetchPrefix = "";
/** Hard limits (no step may wait unbounded); on a timeout the browser is killed and the next model runs. */
const LOAD_TIMEOUT_MS = 10 * 60_000;
const GENERATION_TIMEOUT_MS = 90_000;
const MODEL_TIMEOUT_MS = 20 * 60_000;
let activeBrowser: Browser | null = null;

function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout: ${label} > ${Math.round(ms / 1000)} s`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function openPage(): Promise<{ browser: Browser; page: Page }> {
  mkdirSync(PROFILE, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !args.has("headful"),
    userDataDir: PROFILE,
    // FT_BENCH_CHROME_ARGS replaces the flags (e.g. to verify the no-WebGPU failure path).
    args: process.env.FT_BENCH_CHROME_ARGS?.split(" ") ?? ["--enable-unsafe-webgpu"],
    protocolTimeout: 60 * 60 * 1000,
  });
  activeBrowser = browser;
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("page error:", String(error).slice(0, 300)));
  // Origins and model file paths only (packaging/CSP evidence); never editor text.
  page.on("request", (request: HTTPRequest) => {
    const url = request.url();
    requestOrigins.add(new URL(url).origin);
    if (fetchPrefix && url.startsWith(fetchPrefix)) fetchedFiles.add(url.slice(fetchPrefix.length));
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => "ftBench" in window);
  return { browser, page };
}

// ---- run ---------------------------------------------------------------

mkdirSync(RESULTS, { recursive: true });
const downloads: Record<string, { ms: number; date: string }> = existsSync(DOWNLOADS)
  ? await Bun.file(DOWNLOADS).json()
  : {};
const ortVersion = (
  (await Bun.file(join(ROOT, "node_modules/onnxruntime-web/package.json")).json()) as {
    version: string;
  }
).version;
const environment = {
  date: new Date().toISOString(),
  runtime: `@huggingface/transformers ${LOCAL_AI_RUNTIME_VERSION} / onnxruntime-web ${ortVersion}`,
  engine: "transformers.js",
  os: `${process.platform} ${process.arch}`,
  browser: "",
  gpu: "",
  promptVersion: "",
  contextWindow: 4096,
};

{
  const { browser, page } = await openPage();
  const probe = await page.evaluate(() => window.ftBench.probe());
  environment.browser = await browser.version();
  environment.gpu = probe.detail;
  environment.promptVersion = await page.evaluate(() => window.ftBench.promptVersion);
  await browser.close();
  if (!probe.ok) fail(`no usable WebGPU adapter: ${probe.detail}`);
  console.log(`WebGPU ok: ${probe.detail}; ${environment.browser}`);
}

/** --purge deletes each measured model's weights afterwards, except the shipped ones. */
const KEEP = REGISTRY_MODELS.map((m) => m.id);
/** Skip a download that would leave less than this free (2x weights, see below). */
const MIN_FREE_BYTES = 8e9;
const skipped: Record<string, string> = {};
function freeBytes(): number {
  const stats = statfsSync(ROOT);
  return stats.bavail * stats.bsize;
}
/** Deletes a model's cached files, then the profile's HTTP cache copy. */
async function purge(model: BenchModel): Promise<void> {
  const { browser, page } = await openPage();
  await bounded(
    page.evaluate((m) => window.ftBench.deleteModel(m), model),
    GENERATION_TIMEOUT_MS,
    "purge",
  );
  await browser.close();
  rmSync(join(PROFILE, "Default/Cache"), { recursive: true, force: true });
}

const SUFFIX = args.get("tag") ? `.${args.get("tag")}` : "";
const PROMPT = (args.get("prompt") ?? "product") as GenParams["prompt"];
if (!PROMPT_VARIANTS.includes(PROMPT))
  fail(`unknown --prompt=${PROMPT} (${PROMPT_VARIANTS.join("|")})`);
const correctParams: GenParams = {
  temperature: 0,
  prompt: PROMPT,
  ...(args.get("contract") === "text" ? { contract: "text" as const } : {}),
};

for (const model of models) {
  const modelId = model.id;
  const run: ModelRun = {
    environment,
    modelId,
    repo: model.repo,
    revision: model.revision,
    dtype: model.dtype,
    downloadBytes: model.bytes,
    params: { correct: correctParams },
    downloadMs: null,
    coldLoadMs: null,
    warmupMs: null,
    correct: [],
    rewrite: [],
    cancel: [],
  };
  console.log(`\n== ${modelId} (${model.repo} @ ${model.revision})`);

  if (args.has("worker-check")) {
    const { browser, page } = await openPage();
    const result = await bounded(
      page.evaluate((m) => window.ftBench.workerCheck(m), model),
      LOAD_TIMEOUT_MS,
      "worker check",
    ).catch((error: unknown) => ({ ok: false, error: String(error).slice(0, 200) }));
    await browser.close();
    console.log(`worker check ${modelId}: ${JSON.stringify(result)}`);
    await Bun.write(join(RESULTS, `${modelId}.worker.json`), JSON.stringify(result, null, 2));
    continue;
  }

  if (args.has("purge-only")) {
    await purge(model);
    console.log(`purged ${modelId}`);
    continue;
  }

  const modelDeadline = Date.now() + MODEL_TIMEOUT_MS;
  fetchPrefix = `https://huggingface.co/${model.repo}/resolve/${model.revision}/`;
  try {
    // 1. Download + cache population, only when not cached yet.
    {
      const { browser, page } = await openPage();
      const cached = await bounded(
        page.evaluate((m) => window.ftBench.isCached(m), model),
        GENERATION_TIMEOUT_MS,
        "cache check",
      );
      // The download transiently holds a second copy (HTTP cache), so budget 2x the weights.
      if (!cached && freeBytes() - 2 * model.bytes < MIN_FREE_BYTES) {
        await browser.close();
        console.log(`not run: disk (${(freeBytes() / 1e9).toFixed(1)} GB free)`);
        skipped[modelId] = "disk";
        continue;
      }
      if (!cached) {
        console.log("downloading (first run)…");
        const { ms } = await bounded(
          page.evaluate((m) => window.ftBench.load(m), model),
          LOAD_TIMEOUT_MS,
          "download + load",
        );
        run.downloadMs = ms;
        downloads[modelId] = { ms, date: environment.date };
        await Bun.write(DOWNLOADS, JSON.stringify(downloads, null, 2));
        console.log(`download + cache + load: ${(ms / 1000).toFixed(1)} s`);
        await page.evaluate(() => window.ftBench.unload());
      }
      await browser.close();
    }
    run.downloadMs ??= downloads[modelId]?.ms ?? null;

    // 2. Cold load from cache in a fresh browser process.
    const { browser, page } = await openPage();
    const load = await bounded(
      page.evaluate((m) => window.ftBench.load(m), model),
      LOAD_TIMEOUT_MS,
      "cold load",
    );
    run.coldLoadMs = load.ms;
    console.log(`cold load from cache: ${(load.ms / 1000).toFixed(2)} s`);

    // 3. First generation (shader compilation / warm-up).
    const warm = await bounded(
      page.evaluate(() => window.ftBench.generateTrivial()),
      GENERATION_TIMEOUT_MS,
      "first generation",
    );
    run.warmupMs = warm.genMs;
    console.log(`first generation: ${warm.genMs.toFixed(0)} ms (${warm.finish})`);

    await runFixtures(page, run, args, correctParams, {
      generationMs: GENERATION_TIMEOUT_MS,
      deadline: modelDeadline,
    });

    await browser.close();
  } catch (error) {
    // Bounded message only (no fixture text): e.g. load failure, timeout or GPU device loss.
    skipped[modelId] = String(error).slice(0, 200);
    run.failure = skipped[modelId];
    console.log(`FAILED ${modelId}: ${skipped[modelId]}`);
    (activeBrowser as Browser | null)?.process()?.kill("SIGKILL");
  }
  run.requestOrigins = [...requestOrigins].sort();
  run.fetchedFiles = [...fetchedFiles].sort();
  requestOrigins.clear();
  fetchedFiles.clear();
  if (model.files) {
    // A registry model must fetch only the files the product pins (and allow-lists).
    const extra = run.fetchedFiles.filter((file) => !model.files!.includes(file));
    if (extra.length > 0)
      console.log(`WARNING ${modelId}: fetched unlisted files ${extra.join(", ")}`);
    run.unlistedFiles = extra;
  }
  // Partial results stay usable (cases that completed before a failure).
  await Bun.write(join(RESULTS, `${modelId}${SUFFIX}.json`), JSON.stringify(run, null, 2));
  console.log(`wrote ${join(RESULTS, `${modelId}${SUFFIX}.json`)}`);
  if (args.has("purge") && !KEEP.includes(modelId)) {
    await purge(model).catch((error: unknown) =>
      fail(`purge ${modelId}: ${String(error).slice(0, 200)}`),
    );
    console.log(`purged ${modelId}; ${(freeBytes() / 1e9).toFixed(1)} GB free`);
  }
}
if (Object.keys(skipped).length > 0) console.log(`skipped/failed: ${JSON.stringify(skipped)}`);

server.stop(true);
