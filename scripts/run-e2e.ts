import { mkdir } from "node:fs/promises";
import process from "node:process";

type E2EMode = "production" | "development";
type BrowserPlatform = "chrome" | "firefox";

interface CliOptions {
  mode: E2EMode;
  platform: BrowserPlatform;
  passthroughArgs: string[];
}

function parseCliOptions(argv: string[]): CliOptions {
  let mode: E2EMode = "production";
  let platform: BrowserPlatform = "chrome";
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
    passthroughArgs.push(arg);
  }

  return { mode, platform, passthroughArgs };
}

async function runCommand(
  cmd: string[],
  extraEnv: Record<string, string> = {},
): Promise<void> {
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

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const bunExecutable = Bun.which("bun") ?? "bun";

  await mkdir(".tmp", { recursive: true });
  await runCommand([
    bunExecutable,
    "build.ts",
    `--mode=${options.mode}`,
    `--platform=${options.platform}`,
  ]);

  const sharedE2EEnv = {
    E2E_BROWSER: options.platform,
    RUN_E2E: "1",
  };

  if (options.mode === "development") {
    await runCommand(
      [
        bunExecutable,
        "test",
        "--test-name-pattern=CMD_TOGGLE_FT_ACTIVE_LANG|AI predictor",
        "tests/e2e/puppeteer-extension.test.ts",
        ...options.passthroughArgs,
      ],
      {
        ...sharedE2EEnv,
        FT_E2E_DEV_RUNTIME: "1",
      },
    );
    await runCommand(
      [
        bunExecutable,
        "test",
        "tests/e2e/dev-options-predictor-toggle.test.ts",
        ...options.passthroughArgs,
      ],
      sharedE2EEnv,
    );
    return;
  }

  await runCommand(
    [
      bunExecutable,
      "test",
      "tests/e2e/puppeteer-extension.test.ts",
      "tests/e2e/prodlike-smoke.test.ts",
      ...options.passthroughArgs,
    ],
    sharedE2EEnv,
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
