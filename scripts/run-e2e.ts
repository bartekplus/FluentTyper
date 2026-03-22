import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

type E2EMode = "production" | "development";
type BrowserPlatform = "chrome" | "firefox";
type E2ESuite = "smoke" | "full";

interface CliOptions {
  mode: E2EMode;
  platform: BrowserPlatform;
  suite: E2ESuite;
  headed: boolean;
  passthroughArgs: string[];
}

function parseCliOptions(argv: string[]): CliOptions {
  let mode: E2EMode = "production";
  let platform: BrowserPlatform = "chrome";
  let suite: E2ESuite = "smoke";
  let headed = false;
  const passthroughArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value === "production" || value === "development") {
        mode = value;
        continue;
      }
      throw new Error(`Unsupported mode: ${value}`);
    }
    if (arg === "--mode") {
      const value = argv[index + 1];
      if (value === "production" || value === "development") {
        mode = value;
        index += 1;
        continue;
      }
      throw new Error(`Unsupported mode: ${String(value)}`);
    }
    if (arg.startsWith("--platform=")) {
      const value = arg.slice("--platform=".length);
      if (value === "chrome" || value === "firefox") {
        platform = value;
        continue;
      }
      throw new Error(`Unsupported platform: ${value}`);
    }
    if (arg === "--platform") {
      const value = argv[index + 1];
      if (value === "chrome" || value === "firefox") {
        platform = value;
        index += 1;
        continue;
      }
      throw new Error(`Unsupported platform: ${String(value)}`);
    }
    if (arg.startsWith("--suite=")) {
      const value = arg.slice("--suite=".length);
      if (value === "smoke" || value === "full") {
        suite = value;
        continue;
      }
      throw new Error(`Unsupported suite: ${value}`);
    }
    if (arg === "--suite") {
      const value = argv[index + 1];
      if (value === "smoke" || value === "full") {
        suite = value;
        index += 1;
        continue;
      }
      throw new Error(`Unsupported suite: ${String(value)}`);
    }
    if (arg === "--headed") {
      headed = true;
      continue;
    }
    passthroughArgs.push(arg);
  }

  return { mode, platform, suite, headed, passthroughArgs };
}

async function runCommand(cmd: string[], extraEnv: Record<string, string> = {}): Promise<void> {
  const child = Bun.spawn({
    cmd,
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${cmd.join(" ")}`);
  }
}

function createIsolatedBuildDir(options: CliOptions): string {
  return path.resolve(
    process.cwd(),
    ".tmp",
    "e2e-builds",
    `${options.mode}-${options.platform}-${options.suite}-${process.pid}-${Date.now()}`,
  );
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const bunExecutable = Bun.which("bun") ?? "bun";
  const extensionBuildDir = createIsolatedBuildDir(options);

  await mkdir(path.dirname(extensionBuildDir), { recursive: true });
  await runCommand([
    bunExecutable,
    "build.ts",
    `--mode=${options.mode}`,
    `--platform=${options.platform}`,
    `--outdir=${extensionBuildDir}`,
  ]);

  const sharedE2EEnv: Record<string, string> = {
    E2E_BROWSER: options.platform,
    E2E_EXTENSION_PATH: extensionBuildDir,
    E2E_SUITE: options.suite,
    RUN_E2E: "1",
  };
  if (options.headed) {
    sharedE2EEnv.E2E_HEADED = "1";
  }

  if (options.mode === "development") {
    await runCommand(
      [
        bunExecutable,
        "test",
        "--test-name-pattern=CMD_TOGGLE_FT_ACTIVE_LANG|AI predictor|predictor debug dashboard",
        "tests/e2e/full.e2e.test.ts",
        ...options.passthroughArgs,
      ],
      {
        ...sharedE2EEnv,
        E2E_SUITE: "full",
        FT_E2E_DEV_RUNTIME: "1",
      },
    );
    return;
  }

  const productionTestFile =
    options.suite === "smoke" ? "tests/e2e/smoke.e2e.test.ts" : "tests/e2e/full.e2e.test.ts";
  await runCommand(
    [bunExecutable, "test", productionTestFile, ...options.passthroughArgs],
    sharedE2EEnv,
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
