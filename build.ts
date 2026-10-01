import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { watch as fsWatch, type FSWatcher } from "fs";
import { parseArgs } from "node:util";
import { LOCAL_AI_DOWNLOAD_ORIGINS } from "./src/core/domain/localAi/modelRegistry";
import {
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

interface CliOptions {
  mode: BuildMode;
  watch: boolean;
  platform: string;
  outDir?: string;
}

interface BuildContext {
  mode: BuildMode;
  platform: string;
  /** Development build: __FT_DEV_BUILD__ and runtime test hooks. */
  devBuild: boolean;
  /** Local AI Review runtime (Transformers.js in background.js): Chrome and Edge. */
  includeLocalAiRuntime: boolean;
  configuredLogLevel: string;
  rootDir: string;
  srcDir: string;
  buildDir: string;
  publicDir: string;
  platformDir: string;
  runtimeHooksNoopPath: string;
  localAiEngineNoopPath: string;
}

function parseCliOptions(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string" },
      platform: { type: "string" },
      watch: { type: "boolean" },
      outdir: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  const modeRaw = typeof values.mode === "string" ? values.mode : undefined;
  const mode: BuildMode =
    modeRaw === "development" || modeRaw === "production" ? modeRaw : "production";

  const platformRaw = typeof values.platform === "string" ? values.platform : undefined;

  return {
    mode,
    watch: values.watch === true,
    outDir:
      typeof values.outdir === "string" && values.outdir.length > 0 ? values.outdir : undefined,
    platform: platformRaw && platformRaw.length > 0 ? platformRaw : "chrome",
  };
}

function appendConnectSrcDirective(csp: string, sources: string[]): string {
  const withoutConnectSrc = csp.replace(/\bconnect-src\b[^;]*;?/gi, "").trim();
  const cspPrefix = withoutConnectSrc.endsWith(";") ? withoutConnectSrc : `${withoutConnectSrc};`;
  return `${cspPrefix} connect-src ${sources.join(" ")};`;
}

function transformManifestContent(manifestContent: string, connectSrc: string[] | null): string {
  if (!connectSrc) {
    return manifestContent;
  }
  const manifest = JSON.parse(manifestContent) as {
    content_security_policy?: { extension_pages?: unknown };
  };
  const extensionPagesCsp = manifest.content_security_policy?.extension_pages;

  if (typeof extensionPagesCsp === "string" && extensionPagesCsp.length > 0) {
    manifest.content_security_policy = {
      ...(manifest.content_security_policy || {}),
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
      if (!context.devBuild) {
        build.onResolve(
          {
            filter: /^@adapters\/chrome\/background\/testing\/RuntimeTestHooks$/,
          },
          () => ({ path: context.runtimeHooksNoopPath }),
        );
      }
      if (!context.includeLocalAiRuntime) {
        build.onResolve(
          { filter: /^@adapters\/chrome\/background\/localAi\/engineRuntime$/ },
          () => ({ path: context.localAiEngineNoopPath }),
        );
      }
    },
  };
}

function logBuildError(logs: BuildMessage[], label: string): void {
  console.error(`Build failed for ${label}`);
  for (const log of logs) {
    const location = log.position
      ? `${log.position.file}:${log.position.line}:${log.position.column}`
      : "unknown";
    console.error(`[${log.level}] ${location} ${log.message}`);
  }
}

async function writeBuildOutputs(buildResult: BuildOutput, entryOutfile: string): Promise<void> {
  const entryOutputDirectory = path.dirname(entryOutfile);
  for (const output of buildResult.outputs) {
    const outputRelativePath = output.path.replace(/^[./\\]+/, "");
    const outputPath = path.join(entryOutputDirectory, outputRelativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, output);
  }
}

async function copyStaticAssets(context: BuildContext): Promise<void> {
  const localAiPublicDir = path.join(context.publicDir, "local-ai");
  await cp(context.publicDir, context.buildDir, {
    recursive: true,
    force: true,
    filter(sourcePath) {
      // Firefox ships no Local AI runtime.
      return context.includeLocalAiRuntime || sourcePath !== localAiPublicDir;
    },
  });
  await cp(context.platformDir, context.buildDir, {
    recursive: true,
    force: true,
    filter(sourcePath) {
      return path.basename(sourcePath) !== "manifest.json";
    },
  });
  const manifestSourcePath = path.join(context.platformDir, "manifest.json");
  const manifestDestinationPath = path.join(context.buildDir, "manifest.json");
  const manifestContent = await readFile(manifestSourcePath, "utf8");
  const transformedManifest = transformManifestContent(
    manifestContent,
    context.includeLocalAiRuntime ? LOCAL_AI_CONNECT_SRC : null,
  );
  await writeFile(manifestDestinationPath, transformedManifest, "utf8");

  // libpresage.js loads this wasm by a relative URL at runtime.
  await cp(
    path.join(context.srcDir, "third_party", "libpresage", "libpresage.wasm"),
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
  const transformersDir = path.dirname(
    Bun.resolveSync("@huggingface/transformers", context.rootDir),
  );
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

/**
 * Fails the build if Transformers.js / ONNX Runtime appears outside background.js,
 * or anywhere in a build without the Local AI runtime.
 */
async function assertEngineIsolation(outfiles: string[], engineOutfile: string | null) {
  for (const outfile of outfiles.filter((file) => file !== engineOutfile)) {
    const content = await readFile(outfile, "utf8");
    const marker = LOCAL_AI_ENGINE_MARKERS.find((candidate) => content.includes(candidate));
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
    const content = await readFile(outfile, "utf8");
    const marker = REVIEW_DETECTION_MARKERS.find((candidate) => content.includes(candidate));
    if (marker) {
      throw new Error(`${outfile} contains Review detection ("${marker}"); only background.js may`);
    }
  }
}

interface BundleEntry {
  entrypoint: string;
  outfile: string;
  label: string;
  format: "iife" | "esm";
}

async function bundleExtension(context: BuildContext): Promise<void> {
  await rm(context.buildDir, { recursive: true, force: true });
  await mkdir(context.buildDir, { recursive: true });

  const define = {
    __FT_DEV_BUILD__: JSON.stringify(context.devBuild),
    __FT_LOG_LEVEL__: JSON.stringify(context.configuredLogLevel),
    // Transformers.js' Node-only branch reads __dirname; never embed the build machine's path.
    __dirname: JSON.stringify(""),
  };

  const entrypoints = [
    {
      entrypoint: path.join(context.srcDir, "entries", "popup.ts"),
      outfile: path.join(context.buildDir, "popup", "popup.js"),
      label: "popup",
    },
    {
      entrypoint: path.join(context.srcDir, "entries", "background.ts"),
      outfile: path.join(context.buildDir, "background.js"),
      label: "background",
    },
    {
      entrypoint: path.join(context.srcDir, "entries", "content_script.ts"),
      outfile: path.join(context.buildDir, "content_script.js"),
      label: "content_script",
    },
    {
      entrypoint: path.join(context.srcDir, "entries", "content_script_main_world_start.ts"),
      outfile: path.join(context.buildDir, "content_script_main_world_start.js"),
      label: "content_script_main_world_start",
    },
    {
      entrypoint: path.join(context.srcDir, "entries", "content_script_main_world.ts"),
      outfile: path.join(context.buildDir, "content_script_main_world.js"),
      label: "content_script_main_world",
    },
    {
      entrypoint: path.join(context.srcDir, "entries", "settings.ts"),
      outfile: path.join(context.buildDir, "options", "settings.js"),
      label: "options/settings",
    },
    {
      entrypoint: path.join(context.srcDir, "entries", "onboarding.ts"),
      outfile: path.join(context.buildDir, "new_installation", "onboarding.js"),
      label: "onboarding",
    },
  ].map((item): BundleEntry => ({
    ...item,
    // Transformers.js and ONNX Runtime use import.meta.url: an ES module service worker.
    format: item.label === "background" && context.includeLocalAiRuntime ? "esm" : "iife",
  }));
  const backgroundOutfile = path.join(context.buildDir, "background.js");

  const plugin = createBuildPlugin(context);
  const buildResults = await Promise.all(
    entrypoints.map((item) =>
      Bun.build({
        entrypoints: [item.entrypoint],
        outfile: item.outfile,
        naming: path.basename(item.outfile),
        target: "browser",
        format: item.format,
        minify: context.mode === "production",
        sourcemap: context.mode === "development" ? "external" : "none",
        define,
        plugins: [plugin],
      }).then((result) => ({ result, label: item.label })),
    ),
  );

  let hasBuildError = false;
  for (const buildResult of buildResults) {
    if (!buildResult.result.success) {
      hasBuildError = true;
      logBuildError(buildResult.result.logs, buildResult.label);
    }
  }
  if (hasBuildError) {
    throw new Error("Bundling failed");
  }

  await Promise.all(
    buildResults.map((buildResult, index) =>
      writeBuildOutputs(buildResult.result, entrypoints[index].outfile),
    ),
  );
  await assertEngineIsolation(
    entrypoints.map((item) => item.outfile),
    context.includeLocalAiRuntime ? backgroundOutfile : null,
  );
  await assertReviewDetectionIsolation(
    entrypoints
      .filter((item) => item.label.startsWith("content_script"))
      .map((item) => item.outfile),
    backgroundOutfile,
  );

  await copyStaticAssets(context);
}

async function collectDirectories(rootPath: string): Promise<string[]> {
  const directories: string[] = [];
  try {
    const entries = await readdir(rootPath, { withFileTypes: true });
    directories.push(rootPath);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const nestedPath = path.join(rootPath, entry.name);
      const nestedDirectories = await collectDirectories(nestedPath);
      directories.push(...nestedDirectories);
    }
  } catch {
    // Ignore missing paths.
  }
  return directories;
}

async function waitForAnyFileChange(paths: string[]): Promise<void> {
  const watchedDirectories = (
    await Promise.all(paths.map((watchPath) => collectDirectories(watchPath)))
  ).flat();

  await new Promise<void>((resolve) => {
    const watchers: FSWatcher[] = [];
    let resolved = false;
    const settleDelayMs = 120;

    const complete = (): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      for (const watcher of watchers) {
        watcher.close();
      }
      setTimeout(resolve, settleDelayMs);
    };

    for (const directoryPath of watchedDirectories) {
      try {
        const watcher = fsWatch(directoryPath, () => {
          complete();
        });
        watcher.on("error", () => {
          complete();
        });
        watchers.push(watcher);
      } catch {
        // Ignore watcher registration errors for missing/unsupported paths.
      }
    }

    if (watchers.length === 0) {
      setTimeout(resolve, 1000);
    }
  });
}

async function runWatchMode(context: BuildContext): Promise<void> {
  console.log(`[watch] mode=${context.mode} platform=${context.platform} waiting for changes...`);
  const watchRoots = [context.srcDir, context.publicDir, context.platformDir];
  while (true) {
    await waitForAnyFileChange(watchRoots);
    const startedAt = Date.now();
    console.log("[watch] change detected, rebuilding...");
    try {
      await bundleExtension(context);
      const durationMs = Date.now() - startedAt;
      console.log(`[watch] rebuild complete in ${durationMs}ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[watch] rebuild failed: ${message}`);
    }
  }
}

async function main(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const platform = cliOptions.platform;
  const configuredLogLevel = process.env.FT_LOG_LEVEL || "";

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootDir = __dirname;
  const srcDir = path.join(rootDir, "src");
  const buildDir = path.resolve(rootDir, cliOptions.outDir ?? "build");
  const publicDir = path.join(rootDir, "public");
  const platformDir = path.join(rootDir, "platform", platform);

  const context: BuildContext = {
    mode: cliOptions.mode,
    platform,
    devBuild: cliOptions.mode === "development",
    includeLocalAiRuntime: platform === "chrome" || platform === "edge",
    configuredLogLevel,
    rootDir,
    srcDir,
    buildDir,
    publicDir,
    platformDir,
    runtimeHooksNoopPath: path.join(
      srcDir,
      "adapters",
      "chrome",
      "background",
      "testing",
      "RuntimeTestHooks.noop.ts",
    ),
    localAiEngineNoopPath: path.join(
      srcDir,
      "adapters",
      "chrome",
      "background",
      "localAi",
      "engineRuntime.noop.ts",
    ),
  };

  console.log(
    `Building FluentTyper (${context.mode}, platform=${platform}, outDir=${path.relative(rootDir, buildDir) || "."})...`,
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
