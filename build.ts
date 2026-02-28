import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { watch as fsWatch, type FSWatcher } from "fs";

type BuildMode = "production" | "development";

const WEBLLM_CONNECT_SRC_HOSTS = [
  "https://huggingface.co",
  "https://cdn-lfs.huggingface.co",
  "https://cdn-lfs-us-1.huggingface.co",
  "https://cdn-lfs-us-1.hf.co",
  "https://cas-bridge.xethub.hf.co",
  "https://raw.githubusercontent.com",
];
const WEBLLM_CONNECT_SRC_BASE_SOURCES = ["'self'", "data:"];

interface CliOptions {
  mode: BuildMode;
  watch: boolean;
  platform: string;
}

interface BuildContext {
  mode: BuildMode;
  platform: string;
  includeWebLLMRuntime: boolean;
  configuredLogLevel: string;
  rootDir: string;
  srcDir: string;
  buildDir: string;
  publicDir: string;
  platformDir: string;
  webllmDisabledRuntimePath: string;
  runtimeHooksNoopPath: string;
}

function parseCliOptions(argv: string[]): CliOptions {
  const platformEqualsArg = argv.find((arg) => arg.startsWith("--platform="));
  const platformIndex = argv.indexOf("--platform");
  const platformValueFromNext = platformIndex >= 0 ? argv[platformIndex + 1] : undefined;
  const platformRaw = platformEqualsArg
    ? platformEqualsArg.slice("--platform=".length)
    : platformValueFromNext;

  const modeEqualsArg = argv.find((arg) => arg.startsWith("--mode="));
  const modeIndex = argv.indexOf("--mode");
  const modeValueFromNext = modeIndex >= 0 ? argv[modeIndex + 1] : undefined;
  const modeRaw = modeEqualsArg ? modeEqualsArg.slice("--mode=".length) : modeValueFromNext;
  const mode: BuildMode =
    modeRaw === "development" || modeRaw === "production" ? modeRaw : "production";

  return {
    mode,
    watch: argv.includes("--watch"),
    platform: platformRaw && platformRaw.length > 0 ? platformRaw : "chrome",
  };
}

function appendConnectSrcDirective(csp: string): string {
  const sources = [...WEBLLM_CONNECT_SRC_BASE_SOURCES, ...WEBLLM_CONNECT_SRC_HOSTS];
  const withoutConnectSrc = csp.replace(/\bconnect-src\b[^;]*;?/gi, "").trim();
  const cspPrefix = withoutConnectSrc.endsWith(";") ? withoutConnectSrc : `${withoutConnectSrc};`;
  return `${cspPrefix} connect-src ${sources.join(" ")};`;
}

function transformManifestContent(manifestContent: string, includeWebLLMRuntime: boolean): string {
  if (!includeWebLLMRuntime) {
    return manifestContent;
  }
  const manifest = JSON.parse(manifestContent) as {
    content_security_policy?: { extension_pages?: unknown };
  };
  const extensionPagesCsp = manifest.content_security_policy?.extension_pages;

  if (typeof extensionPagesCsp === "string" && extensionPagesCsp.length > 0) {
    manifest.content_security_policy = {
      ...(manifest.content_security_policy || {}),
      extension_pages: appendConnectSrcDirective(extensionPagesCsp),
    };
  }

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function createBuildPlugin(context: BuildContext) {
  return {
    name: "fluenttyper-build-aliases",
    setup(build: Bun.PluginBuilder) {
      if (!context.includeWebLLMRuntime) {
        build.onResolve({ filter: /^@mlc-ai\/web-llm$/ }, () => ({
          path: context.webllmDisabledRuntimePath,
        }));
        build.onResolve(
          {
            filter: /^@adapters\/chrome\/background\/testing\/RuntimeTestHooks$/,
          },
          () => ({ path: context.runtimeHooksNoopPath }),
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
  await cp(context.publicDir, context.buildDir, {
    recursive: true,
    force: true,
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
    context.includeWebLLMRuntime,
  );
  await writeFile(manifestDestinationPath, transformedManifest, "utf8");

  // libpresage.js loads this wasm by a relative URL at runtime.
  await cp(
    path.join(context.srcDir, "third_party", "libpresage", "libpresage.wasm"),
    path.join(context.buildDir, "libpresage.wasm"),
    { force: true },
  );
}

async function bundleExtension(context: BuildContext): Promise<void> {
  await rm(context.buildDir, { recursive: true, force: true });
  await mkdir(context.buildDir, { recursive: true });

  const plugin = createBuildPlugin(context);
  const define = {
    __FT_DEV_BUILD__: JSON.stringify(context.includeWebLLMRuntime),
    __FT_LOG_LEVEL__: JSON.stringify(context.configuredLogLevel),
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
      entrypoint: path.join(context.srcDir, "entries", "settings.ts"),
      outfile: path.join(context.buildDir, "third_party", "fancier-settings", "settings.js"),
      label: "options/settings",
    },
  ];

  const buildResults = await Promise.all(
    entrypoints.map((item) =>
      Bun.build({
        entrypoints: [item.entrypoint],
        outfile: item.outfile,
        target: "browser",
        format: "iife",
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
  const buildDir = path.join(rootDir, "build");
  const publicDir = path.join(rootDir, "public");
  const platformDir = path.join(rootDir, "platform", platform);

  const context: BuildContext = {
    mode: cliOptions.mode,
    platform,
    includeWebLLMRuntime: cliOptions.mode === "development",
    configuredLogLevel,
    rootDir,
    srcDir,
    buildDir,
    publicDir,
    platformDir,
    webllmDisabledRuntimePath: path.join(
      srcDir,
      "adapters",
      "chrome",
      "background",
      "webllm-disabled-runtime.ts",
    ),
    runtimeHooksNoopPath: path.join(
      srcDir,
      "adapters",
      "chrome",
      "background",
      "testing",
      "RuntimeTestHooks.noop.ts",
    ),
  };

  console.log(`Building FluentTyper (${context.mode}, platform=${platform})...`);
  const startedAt = Date.now();
  await bundleExtension(context);
  const durationMs = Date.now() - startedAt;
  console.log(`Build complete in ${durationMs}ms`);

  if (cliOptions.watch) {
    await runWatchMode(context);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Build failed: ${message}`);
  process.exit(1);
});
