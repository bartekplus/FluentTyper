/**
 * Real-device Local AI Review benchmark (opt-in; needs a WebGPU GPU with shader-f16).
 *
 *   bun scripts/local-ai-bench/run.ts --real [--models=Qwen3-1.7B-q4f16_1-MLC,...]
 *     [--smoke] [--limit=N] [--ids=case-a,case-b] [--modes=correct,rewrite,cancel] [--json=schema|object|none]
 *     [--prompt=product] [--tag=name] [--headful]
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
import { mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import {
  LOCAL_AI_MODELS,
  LOCAL_AI_RUNTIME_VERSION,
} from "../../src/core/domain/localAi/modelRegistry";
import type { BenchModel, GenParams } from "./page";
import { runFixtures, type ModelRun } from "./fixtures";

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

const models = (args.get("models")?.split(",") ?? DEFAULT_MODELS).filter(Boolean);
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

function benchModel(modelId: string): BenchModel & { probe: ProbeRecord; libFile: string } {
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
  entrypoints: [join(import.meta.dir, "page.ts")],
  target: "browser",
  format: "esm",
});
if (!build.success) fail(`page bundle failed: ${build.logs.map(String).join("\n")}`);
const bundle = await build.outputs[0]!.text();
const HTML = `<!doctype html><meta charset="utf-8"><title>ft local ai bench</title><script type="module" src="/page.js"></script>`;

const server = Bun.serve({
  port: PORT,
  hostname: "localhost",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response(HTML, { headers: { "content-type": "text/html" } });
    if (path === "/page.js")
      return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    const lib = /^\/libs\/([\w.-]+\.wasm)$/.exec(path)?.[1];
    const file = lib && libPath(lib);
    if (file) return new Response(Bun.file(file));
    return new Response("not found", { status: 404 });
  },
});

async function openPage(): Promise<{ browser: Browser; page: Page }> {
  mkdirSync(PROFILE, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !args.has("headful"),
    userDataDir: PROFILE,
    // FT_BENCH_CHROME_ARGS replaces the flags (e.g. to verify the no-WebGPU failure path).
    args: process.env.FT_BENCH_CHROME_ARGS?.split(" ") ?? ["--enable-unsafe-webgpu"],
    protocolTimeout: 60 * 60 * 1000,
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("page error:", String(error).slice(0, 300)));
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
  runtime: LOCAL_AI_RUNTIME_VERSION,
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

const JSON_MODE = (args.get("json") ?? "schema") as GenParams["json"];
const SUFFIX = args.has("smoke") ? ".smoke" : args.get("tag") ? `.${args.get("tag")}` : "";
const PROMPT = (args.get("prompt") ?? "product") as GenParams["prompt"];
const CORRECT: GenParams = {
  temperature: 0,
  seed: 42,
  enableThinking: false,
  json: JSON_MODE,
  prompt: PROMPT,
};

for (const modelId of models) {
  const model = benchModel(modelId);
  const isQwen3Family = model.probe.conv === "qwen3" || modelId.startsWith("Qwen3.5");
  const correctParams: GenParams = {
    ...CORRECT,
    enableThinking: isQwen3Family ? false : undefined,
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

  // 1. Download + cache population, only when not cached yet.
  {
    const { browser, page } = await openPage();
    const cached = await page.evaluate((m) => window.ftBench.isCached(m), model);
    if (!cached) {
      console.log("downloading (first run)…");
      const { ms } = await page.evaluate((m) => window.ftBench.load(m), model);
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
  const load = await page.evaluate((m) => window.ftBench.load(m), model);
  run.coldLoadMs = load.ms;
  console.log(`cold load from cache: ${(load.ms / 1000).toFixed(2)} s`);

  // 3. First generation (shader compilation / warm-up).
  const warm = await page.evaluate((p) => window.ftBench.generateTrivial(p), correctParams);
  run.warmupMs = warm.genMs;
  console.log(`first generation: ${warm.genMs.toFixed(0)} ms (${warm.finish})`);

  // 4. Thinking switch: does the output contain reasoning markup with/without enable_thinking?
  for (const enableThinking of [false, undefined]) {
    const r = await page.evaluate((p) => window.ftBench.generateTrivial(p), {
      ...correctParams,
      enableThinking,
      json: "none" as const,
    });
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
    await runFixtures(page, run, args, correctParams);
  }

  await browser.close();
  await Bun.write(join(RESULTS, `${modelId}${SUFFIX}.json`), JSON.stringify(run, null, 2));
  console.log(`wrote ${join(RESULTS, `${modelId}${SUFFIX}.json`)}`);
}

server.stop(true);
