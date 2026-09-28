/**
 * Real-device Local AI Review benchmark (opt-in; needs a WebGPU GPU with shader-f16).
 *
 *   bun scripts/local-ai-bench/run.ts --real [--models=Qwen3-1.7B-q4f16_1-MLC,...]
 *     [--smoke] [--limit=N] [--ids=case-a,case-b] [--modes=correct,rewrite,cancel] [--json=schema|object|none]
 *     [--prompt=product|classes|soft|twoex|combo] [--tag=name] [--think-budget=N] [--purge | --purge-only]
 *     [--engine=webllm|transformers] [--contract=json|text] [--worker-check] [--headful]
 *
 * Launches Puppeteer's Chrome for Testing with --enable-unsafe-webgpu and a
 * persistent profile under .cache/local-ai-bench/ (weights stay cached across
 * runs), serves a bundled harness page + the pinned model libraries from
 * http://localhost, and drives the REAL WebLLM runtime with the product's
 * prompts/parse/validate code. Fails (non-zero) when no WebGPU adapter with
 * shader-f16 is available; it never falls back to CPU or mocks.
 *
 * Fixtures are synthetic (tests/fixtures/local-ai/). Results (raw outputs
 * included) go to .cache/local-ai-bench/results/ and are never committed.
 */
import { mkdirSync, existsSync, rmSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import {
  LOCAL_AI_MODELS,
  LOCAL_AI_RUNTIME_VERSION,
} from "../../src/core/domain/localAi/modelRegistry";
import type { BenchModel, GenParams } from "./page";
import { runFixtures, type ModelRun } from "./fixtures";
import { PROMPT_VARIANTS } from "./promptVariants";
import { TJS_MODELS, tjsModel, type TjsModel } from "./tjsModels";

const ROOT = resolve(import.meta.dir, "../..");
const CACHE = join(ROOT, ".cache/local-ai-bench");
const PROFILE = join(CACHE, "chrome-profile");
const RESULTS = join(CACHE, "results");
/** First-run download timings survive later (cached) runs. */
const DOWNLOADS = join(RESULTS, "downloads.json");
/** Fixed: the Cache API is per origin, so a stable port keeps weights cached. */
const PORT = 47_811;
/**
 * Model libraries: the packaged ones (public/local-ai/libs, fetched by
 * scripts/fetch-local-ai-assets.ts) plus FT_LOCAL_AI_LIBS for non-registry
 * candidates. Candidate metadata (pinned revision, lib hashes) comes from the
 * registry, or from FT_LOCAL_AI_PROBE (JSON written by the asset probe).
 */
const LIB_DIRS = [process.env.FT_LOCAL_AI_LIBS, join(ROOT, "public/local-ai/libs")].filter(
  (dir): dir is string => Boolean(dir),
);
const libPath = (file: string) =>
  LIB_DIRS.map((dir) => join(dir, file)).find((path) => existsSync(path));

const DEFAULT_MODELS = [
  "Qwen3-1.7B-q4f16_1-MLC",
  "Qwen3.5-2B-q4f16_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Qwen3-4B-q4f16_1-MLC",
];

interface ProbeRecord {
  sha: string;
  weightBytes: number;
  libBytes: number;
  libSha256: string;
  libSri: string;
  conv: string;
}

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
    "local-ai-bench runs real models on a real GPU (downloads ~1-2.3 GB per model).\n" +
      "Opt in explicitly with --real. See docs/local-ai-evaluation.md.",
  );
  process.exit(2);
}

/** "webllm" (default) or "transformers" (Transformers.js + ONNX Runtime Web, benchmark-only). */
const ENGINE = args.get("engine") ?? "webllm";
if (ENGINE !== "webllm" && ENGINE !== "transformers") fail(`unknown --engine=${ENGINE}`);
const models = (
  args.get("models")?.split(",") ??
  (ENGINE === "transformers" ? TJS_MODELS.map((m) => m.id) : DEFAULT_MODELS)
).filter(Boolean);
const probeData: Record<string, ProbeRecord> = {
  ...Object.fromEntries(
    LOCAL_AI_MODELS.map((m) => [
      m.modelId,
      {
        sha: m.weightsRevision,
        weightBytes: m.downloadBytes,
        libBytes: m.modelLibBytes,
        libSha256: m.modelLibSha256,
        libSri: m.modelLibSri,
        conv: m.thinking === "qwen3-enable-thinking" ? "qwen3" : "qwen2",
      },
    ]),
  ),
  ...(process.env.FT_LOCAL_AI_PROBE
    ? ((await Bun.file(process.env.FT_LOCAL_AI_PROBE).json()) as Record<string, ProbeRecord>)
    : {}),
};

type ResolvedModel = BenchModel & { probe: ProbeRecord; libFile: string; tjs?: TjsModel };

/** A Transformers.js model in the shape the driver uses (no model library: the runtime is generic). */
function tjsBenchModel(modelId: string): ResolvedModel {
  const m = tjsModel(modelId);
  if (!m) fail(`unknown Transformers.js model ${modelId} (see tjsModels.ts)`);
  return {
    ...m,
    tjs: m,
    modelId,
    libUrl: "",
    libSri: "",
    overrides: {},
    libFile: "",
    probe: {
      sha: m.revision,
      weightBytes: m.bytes,
      libBytes: 0,
      libSha256: "n/a (generic ONNX Runtime Web)",
      libSri: "",
      conv: m.disableThinking ? "qwen3" : "tjs",
    },
  };
}

function benchModel(modelId: string): ResolvedModel {
  if (ENGINE === "transformers") return tjsBenchModel(modelId);
  const probe = probeData[modelId];
  const prebuilt = prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
  if (!probe || !prebuilt)
    fail(`unknown model ${modelId} (not in model-probe.json / WebLLM ${LOCAL_AI_RUNTIME_VERSION})`);
  const libFile = prebuilt.model_lib.split("/").pop()!;
  if (!libPath(libFile)) fail(`missing model library ${libFile} in ${LIB_DIRS.join(", ")}`);
  return {
    modelId,
    repo: `mlc-ai/${modelId}`,
    revision: probe.sha,
    libUrl: `http://localhost:${PORT}/libs/${libFile}`,
    libSri: probe.libSri,
    overrides: { ...prebuilt.overrides },
    probe,
    libFile,
  };
}

// ---- page bundle + server ------------------------------------------------

const build = await Bun.build({
  entrypoints: [join(import.meta.dir, ENGINE === "transformers" ? "tjsPage.ts" : "page.ts")],
  target: "browser",
  format: "esm",
});
if (!build.success) fail(`page bundle failed: ${build.logs.map(String).join("\n")}`);
const bundle = await build.outputs[0]!.text();
const workerBundle =
  ENGINE === "transformers"
    ? await (
        await Bun.build({
          entrypoints: [join(import.meta.dir, "tjsWorker.ts")],
          target: "browser",
          format: "esm",
        })
      ).outputs[0]!.text()
    : "";
const HTML = `<!doctype html><meta charset="utf-8"><title>ft local ai bench</title><script type="module" src="/page.js"></script>`;

const server = Bun.serve({
  port: PORT,
  hostname: "localhost",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response(HTML, { headers: { "content-type": "text/html" } });
    if (path === "/worker.js" && workerBundle)
      return new Response(workerBundle, { headers: { "content-type": "text/javascript" } });
    if (path === "/page.js")
      return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    // ONNX Runtime Web's WASM + loader for the Transformers.js engine, served locally.
    const ort = /^\/ort\/(ort-wasm-simd-threaded\.asyncify\.(?:mjs|wasm))$/.exec(path)?.[1];
    if (ort) {
      return new Response(Bun.file(join(ROOT, "node_modules/onnxruntime-web/dist", ort)), {
        headers: { "content-type": ort.endsWith(".mjs") ? "text/javascript" : "application/wasm" },
      });
    }
    const lib = /^\/libs\/([\w.-]+\.wasm)$/.exec(path)?.[1];
    const file = lib && libPath(lib);
    if (file) return new Response(Bun.file(file));
    return new Response("not found", { status: 404 });
  },
});

const requestOrigins = new Set<string>();
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
  // Origins only (packaging/CSP evidence); URLs are model files, never editor text.
  page.on("request", (request) => requestOrigins.add(new URL(request.url()).origin));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => "ftBench" in window);
  return { browser, page };
}

// ---- run ---------------------------------------------------------------

mkdirSync(RESULTS, { recursive: true });
const downloads: Record<string, { ms: number; date: string }> = existsSync(DOWNLOADS)
  ? await Bun.file(DOWNLOADS).json()
  : {};
const environment = {
  date: new Date().toISOString(),
  runtime:
    ENGINE === "transformers"
      ? `@huggingface/transformers ${(await Bun.file(join(ROOT, "node_modules/@huggingface/transformers/package.json")).json()).version} / onnxruntime-web ${(await Bun.file(join(ROOT, "node_modules/onnxruntime-web/package.json")).json()).version}`
      : `@mlc-ai/web-llm ${LOCAL_AI_RUNTIME_VERSION}`,
  engine: ENGINE,
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

/** --purge deletes each measured model's weights afterwards, except these. */
const KEEP = ["Qwen3-4B-q4f16_1-MLC", "Qwen3-1.7B-q4f16_1-MLC"];
/** Skip a download that would leave less than this free (2x weights, see below). */
const MIN_FREE_BYTES = 8e9;
const skipped: Record<string, string> = {};
function freeBytes(): number {
  const stats = statfsSync(ROOT);
  return stats.bavail * stats.bsize;
}
/** Deletes a model's cached weights/config/lib, then the profile's HTTP cache copy. */
async function purge(model: ResolvedModel): Promise<void> {
  const { browser, page } = await openPage();
  await page.evaluate((m) => window.ftBench.deleteModel(m), model);
  await browser.close();
  rmSync(join(PROFILE, "Default/Cache"), { recursive: true, force: true });
}

const JSON_MODE = (args.get("json") ?? "schema") as GenParams["json"];
const SUFFIX = args.has("smoke") ? ".smoke" : args.get("tag") ? `.${args.get("tag")}` : "";
const PROMPT = (args.get("prompt") ?? "product") as GenParams["prompt"];
if (!PROMPT_VARIANTS.includes(PROMPT))
  fail(`unknown --prompt=${PROMPT} (${PROMPT_VARIANTS.join("|")})`);
const CORRECT: GenParams = {
  temperature: 0,
  seed: 42,
  enableThinking: false,
  json: JSON_MODE,
  prompt: PROMPT,
};

for (const modelId of models) {
  const model = benchModel(modelId);
  const isQwen3Family =
    ENGINE === "webllm" && (model.probe.conv === "qwen3" || modelId.startsWith("Qwen3.5"));
  const thinkBudget = Number(args.get("think-budget") ?? 0);
  const correctParams: GenParams = {
    ...CORRECT,
    // enable_thinking is a Qwen3/3.5 template switch; WebLLM would inject think markup into others.
    enableThinking: isQwen3Family ? thinkBudget > 0 : undefined,
    ...(isQwen3Family && thinkBudget > 0 ? { thinkBudget, json: "none" as const } : {}),
    ...(args.get("contract") === "text" ? { contract: "text" as const } : {}),
  };
  const run: ModelRun = {
    environment,
    modelId,
    revision: model.revision,
    libSha256: model.probe.libSha256,
    downloadBytes: model.probe.weightBytes,
    params: { correct: correctParams },
    downloadMs: null,
    coldLoadMs: null,
    warmupMs: null,
    thinkingProbe: [],
    smoke: [],
    correct: [],
    rewrite: [],
    cancel: [],
  };
  console.log(`\n== ${modelId} @ ${model.revision}`);

  if (args.has("worker-check") && model.tjs) {
    const { browser, page } = await openPage();
    const result = await page.evaluate(
      (m) =>
        (
          window as unknown as { ftBench: { workerCheck(m: unknown): Promise<unknown> } }
        ).ftBench.workerCheck(m),
      model.tjs,
    );
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
      const freeAfter = freeBytes() - 2 * model.probe.weightBytes;
      if (!cached && freeAfter < MIN_FREE_BYTES) {
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
      page.evaluate((p) => window.ftBench.generateTrivial(p), correctParams),
      GENERATION_TIMEOUT_MS,
      "first generation",
    );
    run.warmupMs = warm.genMs;
    console.log(`first generation: ${warm.genMs.toFixed(0)} ms (${warm.finish})`);

    // 4. Thinking switch (Qwen3/3.5 only): reasoning markup with/without enable_thinking?
    for (const enableThinking of isQwen3Family ? [false, undefined] : []) {
      const r = await bounded(
        page.evaluate((p) => window.ftBench.generateTrivial(p), {
          ...correctParams,
          enableThinking,
          json: "none" as const,
        }),
        GENERATION_TIMEOUT_MS,
        "thinking probe",
      );
      run.thinkingProbe.push({
        enableThinking: enableThinking ?? null,
        hasThinkMarkup: /<\/?think>/.test(r.raw),
        head: r.raw.slice(0, 120),
        completionTokens: r.usage?.completion_tokens ?? null,
      });
    }

    if (args.has("smoke")) {
      for (const json of ["object", "schema", "none"] as const) {
        const r = await page.evaluate((p) => window.ftBench.generateTrivial(p), {
          ...correctParams,
          json,
        });
        run.smoke.push({ ...r, outcome: null, parsedMs: r.genMs });
        console.log(
          `smoke json=${json}: ${r.genMs.toFixed(0)} ms ${r.finish} ${r.error ?? JSON.stringify(r.raw).slice(0, 100)}`,
        );
      }
    } else {
      await runFixtures(page, run, args, correctParams, {
        generationMs: GENERATION_TIMEOUT_MS,
        deadline: modelDeadline,
      });
    }

    await browser.close();
    run.requestOrigins = [...requestOrigins].sort();
    requestOrigins.clear();
    await Bun.write(join(RESULTS, `${modelId}${SUFFIX}.json`), JSON.stringify(run, null, 2));
    console.log(`wrote ${join(RESULTS, `${modelId}${SUFFIX}.json`)}`);
  } catch (error) {
    // Bounded message only (no fixture text): e.g. load failure, timeout or GPU device loss.
    skipped[modelId] = String(error).slice(0, 200);
    console.log(`FAILED ${modelId}: ${skipped[modelId]}`);
    activeBrowser?.process()?.kill("SIGKILL");
    run.failure = skipped[modelId];
    run.requestOrigins = [...requestOrigins].sort();
    requestOrigins.clear();
    // Partial results stay usable (cases that completed before the failure).
    await Bun.write(join(RESULTS, `${modelId}${SUFFIX}.json`), JSON.stringify(run, null, 2));
  }
  if (args.has("purge") && !KEEP.includes(modelId)) {
    await purge(model).catch((error: unknown) =>
      fail(`purge ${modelId}: ${String(error).slice(0, 200)}`),
    );
    console.log(`purged ${modelId}; ${(freeBytes() / 1e9).toFixed(1)} GB free`);
  }
}
if (Object.keys(skipped).length > 0) console.log(`skipped/failed: ${JSON.stringify(skipped)}`);

server.stop(true);
