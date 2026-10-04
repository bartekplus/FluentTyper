import path from "path";
import process from "process";
import { cp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { watch as fsWatch } from "fs";
import { parseArgs } from "node:util";
import { LOCAL_AI_DOWNLOAD_ORIGINS } from "./src/core/domain/localAi/modelRegistry";
import {
  APP_BUNDLES,
  LOCAL_AI_ENGINE_MARKERS,
  LOCAL_AI_ORT_DIR,
  LOCAL_AI_ORT_FILES,
} from "./scripts/check-local-ai-artifact";

type BuildMode = "production" | "development";

/**
 * Chrome/Edge extension pages may fetch only themselves and the model-DATA
 * origins. Executable code (JS + ONNX Runtime WASM) is packaged; nothing needs
 * blob: or remote script sources.
 */
const LOCAL_AI_CONNECT_SRC = ["'self'", ...LOCAL_AI_DOWNLOAD_ORIGINS];

const ROOT_DIR = import.meta.dir;
const SRC_DIR = path.join(ROOT_DIR, "src");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const BACKGROUND_ADAPTER_DIR = path.join(SRC_DIR, "adapters", "chrome", "background");
const RUNTIME_HOOKS_NOOP_PATH = path.join(
  BACKGROUND_ADAPTER_DIR,
  "testing",
  "RuntimeTestHooks.noop.ts",
);
const LOCAL_AI_ENGINE_NOOP_PATH = path.join(
  BACKGROUND_ADAPTER_DIR,
  "localAi",
  "engineRuntime.noop.ts",
);

interface BuildContext {
  mode: BuildMode;
  platform: string;
  buildDir: string;
  /** Local AI Review runtime (Transformers.js in background.js): Chrome and Edge. */
  includeLocalAiRuntime: boolean;
}

function platformDir(context: BuildContext): string {
  return path.join(ROOT_DIR, "platform", context.platform);
}

function parseCliOptions(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string", default: "production" },
      platform: { type: "string", default: "chrome" },
      watch: { type: "boolean", default: false },
      outdir: { type: "string", default: "build" },
    },
    strict: true,
  });
  const { mode, outdir } = values;
  if (mode !== "production" && mode !== "development") {
    throw new Error(`Unknown --mode "${mode}"; use production or development`);
  }
  // An empty --outdir would resolve to the repository root, which the build deletes.
  if (!outdir) {
    throw new Error("--outdir must not be empty");
  }
  return { mode, watch: values.watch, outDir: outdir, platform: values.platform };
}

function appendConnectSrcDirective(csp: string, sources: string[]): string {
  const withoutConnectSrc = csp.replace(/\bconnect-src\b[^;]*;?/gi, "").trim();
  const cspPrefix = withoutConnectSrc.endsWith(";") ? withoutConnectSrc : `${withoutConnectSrc};`;
  return `${cspPrefix} connect-src ${sources.join(" ")};`;
}

function transformManifestContent(manifestContent: string, connectSrc: string[]): string {
  const manifest = JSON.parse(manifestContent) as {
    content_security_policy?: { extension_pages?: unknown };
  };
  const extensionPagesCsp = manifest.content_security_policy?.extension_pages;

  if (typeof extensionPagesCsp === "string" && extensionPagesCsp.length > 0) {
    manifest.content_security_policy = {
      ...manifest.content_security_policy,
      extension_pages: appendConnectSrcDirective(extensionPagesCsp, connectSrc),
    };
  }

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Production swaps the runtime test hooks for their no-op module; builds without
 * the Local AI runtime swap the engine (Transformers.js + ONNX Runtime) for none.
 */
function createBuildPlugin(context: BuildContext) {
  return {
    name: "fluenttyper-build-aliases",
    setup(build: Bun.PluginBuilder) {
      // Development build: __FT_DEV_BUILD__ and runtime test hooks.
      if (context.mode !== "development") {
        build.onResolve(
          {
            filter: /^@adapters\/chrome\/background\/testing\/RuntimeTestHooks$/,
          },
          () => ({ path: RUNTIME_HOOKS_NOOP_PATH }),
        );
      }
      if (!context.includeLocalAiRuntime) {
        build.onResolve(
          { filter: /^@adapters\/chrome\/background\/localAi\/engineRuntime$/ },
          () => ({ path: LOCAL_AI_ENGINE_NOOP_PATH }),
        );
      }
    },
  };
}

async function copyStaticAssets(context: BuildContext): Promise<void> {
  const localAiPublicDir = path.join(PUBLIC_DIR, "local-ai");
  await cp(PUBLIC_DIR, context.buildDir, {
    recursive: true,
    force: true,
    filter(sourcePath) {
      // Firefox ships no Local AI runtime.
      return context.includeLocalAiRuntime || sourcePath !== localAiPublicDir;
    },
  });
  await cp(platformDir(context), context.buildDir, {
    recursive: true,
    force: true,
    filter(sourcePath) {
      return path.basename(sourcePath) !== "manifest.json";
    },
  });
  const manifestSourcePath = path.join(platformDir(context), "manifest.json");
  const manifestDestinationPath = path.join(context.buildDir, "manifest.json");
  const manifestContent = await readFile(manifestSourcePath, "utf8");
  await writeFile(
    manifestDestinationPath,
    context.includeLocalAiRuntime
      ? transformManifestContent(manifestContent, LOCAL_AI_CONNECT_SRC)
      : manifestContent,
    "utf8",
  );

  // libpresage.js loads this wasm by a relative URL at runtime.
  await cp(
    path.join(SRC_DIR, "third_party", "libpresage", "libpresage.wasm"),
    path.join(context.buildDir, "libpresage.wasm"),
    { force: true },
  );

  if (context.includeLocalAiRuntime) {
    await copyOrtRuntime(context);
  }
}

/**
 * Copies the ONNX Runtime WebGPU WASM (onnxruntime-web/webgpu = the asyncify build;
 * its JavaScript glue is bundled into background.js) to local-ai/ort/ and fails on
 * any hash drift.
 */
async function copyOrtRuntime(context: BuildContext): Promise<void> {
  // The onnxruntime-web that Transformers.js itself resolves.
  const transformersDir = path.dirname(Bun.resolveSync("@huggingface/transformers", ROOT_DIR));
  const sourceDir = path.dirname(Bun.resolveSync("onnxruntime-web/webgpu", transformersDir));
  const destinationDir = path.join(context.buildDir, LOCAL_AI_ORT_DIR);
  await mkdir(destinationDir, { recursive: true });
  for (const [name, expected] of Object.entries(LOCAL_AI_ORT_FILES)) {
    const bytes = new Uint8Array(await readFile(path.join(sourceDir, name)));
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (sha256 !== expected.sha256 || bytes.byteLength !== expected.bytes) {
      throw new Error(
        `onnxruntime-web ${name} does not match the pinned hash (got ${sha256}, ${bytes.byteLength} bytes); update LOCAL_AI_ORT_FILES only after reviewing the new runtime`,
      );
    }
    await writeFile(path.join(destinationDir, name), bytes);
  }
}

async function findMarker(file: string, markers: readonly string[]) {
  const content = await readFile(file, "utf8");
  return markers.find((marker) => content.includes(marker));
}

/**
 * Fails the build if Transformers.js / ONNX Runtime appears outside background.js,
 * or anywhere in a build without the Local AI runtime.
 */
async function assertEngineIsolation(outfiles: string[], engineOutfile: string | null) {
  for (const outfile of outfiles.filter((file) => file !== engineOutfile)) {
    const marker = await findMarker(outfile, LOCAL_AI_ENGINE_MARKERS);
    if (marker) {
      throw new Error(`${outfile} contains "${marker}"; only a Local AI background.js may`);
    }
  }
}

/**
 * Strings only Review's detectors and their data contain (generated lexicon,
 * English and other-language phrase tables, detector code), and the findings'
 * explanations (reviewExplanations.ts), which the background sends resolved.
 * Review detection runs in background.js; content scripts, loaded by every
 * frame, must not carry it.
 */
const REVIEW_DETECTION_MARKERS = [
  "V e ive e;V  ive [^e]",
  "without further adieu",
  "Vorraussetzung",
  "each|every|the|a|index|variable|counter|iterator|loop",
  "Use the conventional form of this fixed English phrase.",
];

/**
 * Fails the build if Review detection lands in a content script, or if a marker
 * is missing from background.js (it would no longer prove anything).
 */
async function assertReviewDetectionIsolation(
  contentOutfiles: string[],
  backgroundOutfile: string,
) {
  const background = await readFile(backgroundOutfile, "utf8");
  const missing = REVIEW_DETECTION_MARKERS.find((marker) => !background.includes(marker));
  if (missing) {
    throw new Error(`${backgroundOutfile} lacks the Review detection marker "${missing}"`);
  }
  for (const outfile of contentOutfiles) {
    const marker = await findMarker(outfile, REVIEW_DETECTION_MARKERS);
    if (marker) {
      throw new Error(`${outfile} contains Review detection ("${marker}"); only background.js may`);
    }
  }
}

async function bundleExtension(context: BuildContext): Promise<void> {
  await rm(context.buildDir, { recursive: true, force: true });
  await mkdir(context.buildDir, { recursive: true });

  const define = {
    __FT_DEV_BUILD__: JSON.stringify(context.mode === "development"),
    __FT_LOG_LEVEL__: JSON.stringify(process.env.FT_LOG_LEVEL || ""),
    // Transformers.js' Node-only branch reads __dirname; never embed the build machine's path.
    __dirname: JSON.stringify(""),
  };

  const entrypoints = APP_BUNDLES.map((bundle) => ({
    bundle,
    entrypoint: path.join(SRC_DIR, "entries", `${path.basename(bundle, ".js")}.ts`),
    outfile: path.join(context.buildDir, bundle),
  }));
  const backgroundOutfile = path.join(context.buildDir, "background.js");

  const plugin = createBuildPlugin(context);
  await Promise.all(
    entrypoints.map((item) =>
      Bun.build({
        entrypoints: [item.entrypoint],
        outdir: path.dirname(item.outfile),
        naming: path.basename(item.outfile),
        target: "browser",
        // Transformers.js and ONNX Runtime use import.meta.url: an ES module service worker.
        format: item.bundle === "background.js" && context.includeLocalAiRuntime ? "esm" : "iife",
        minify: context.mode === "production",
        sourcemap: context.mode === "development" ? "external" : "none",
        define,
        plugins: [plugin],
      }),
    ),
  );

  await assertEngineIsolation(
    entrypoints.map((item) => item.outfile),
    context.includeLocalAiRuntime ? backgroundOutfile : null,
  );
  await assertReviewDetectionIsolation(
    entrypoints
      .filter((item) => item.bundle.startsWith("content_script"))
      .map((item) => item.outfile),
    backgroundOutfile,
  );

  await copyStaticAssets(context);
}

function waitForAnyFileChange(paths: string[]): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      for (const watcher of watchers) watcher.close();
      setTimeout(resolve, 120);
    };
    const watchers = paths.map((watchPath) =>
      fsWatch(watchPath, { recursive: true }, done).on("error", done),
    );
  });
}

async function runWatchMode(context: BuildContext): Promise<void> {
  console.log(`[watch] mode=${context.mode} platform=${context.platform} waiting for changes...`);
  const watchRoots = [SRC_DIR, PUBLIC_DIR, platformDir(context)];
  while (true) {
    await waitForAnyFileChange(watchRoots);
    const startedAt = Date.now();
    console.log("[watch] change detected, rebuilding...");
    try {
      await bundleExtension(context);
      const durationMs = Date.now() - startedAt;
      console.log(`[watch] rebuild complete in ${durationMs}ms`);
    } catch (error) {
      // Bun.build throws an AggregateError: print it whole to show the file and line.
      console.error("[watch] rebuild failed:", error);
    }
  }
}

async function main(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const platform = cliOptions.platform;
  const buildDir = path.resolve(ROOT_DIR, cliOptions.outDir);
  const context: BuildContext = {
    mode: cliOptions.mode,
    platform,
    buildDir,
    includeLocalAiRuntime: platform === "chrome" || platform === "edge",
  };

  console.log(
    `Building FluentTyper (${context.mode}, platform=${platform}, outDir=${path.relative(ROOT_DIR, buildDir) || "."})...`,
  );
  const startedAt = Date.now();
  await bundleExtension(context);
  const durationMs = Date.now() - startedAt;
  console.log(`Build complete in ${durationMs}ms`);

  if (cliOptions.watch) {
    await runWatchMode(context);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
