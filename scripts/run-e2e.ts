import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

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

function readEnumOption<T extends string>(
  values: Record<string, string | boolean | undefined>,
  name: string,
  allowed: readonly T[],
): T | undefined {
  if (!(name in values)) {
    return undefined;
  }
  const raw = values[name];
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }
  throw new Error(`Unsupported ${name}: ${String(raw)}`);
}

export function parseCliOptions(argv: string[]): CliOptions {
  const { values, tokens } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string" },
      platform: { type: "string" },
      suite: { type: "string" },
      headed: { type: "boolean" },
    },
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  const mode =
    readEnumOption(values, "mode", ["production", "development"] as const) ?? "production";
  const platform = readEnumOption(values, "platform", ["chrome", "firefox"] as const) ?? "chrome";
  const suite = readEnumOption(values, "suite", ["smoke", "full"] as const) ?? "smoke";
  if ("headed" in values && values.headed !== true) {
    throw new Error(`Unsupported headed: ${String(values.headed)}`);
  }
  const headed = values.headed === true;

  // Everything that is not one of our own options goes to `bun test` verbatim.
  const ownIndices = new Set<number>();
  for (const token of tokens) {
    if (token.kind === "option" && ["mode", "platform", "suite", "headed"].includes(token.name)) {
      ownIndices.add(token.index);
      if (token.value !== undefined && !token.inlineValue) {
        ownIndices.add(token.index + 1);
      }
    }
  }
  const passthroughArgs = argv.filter((_, index) => !ownIndices.has(index));

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
        "--test-name-pattern=CMD_TOGGLE_FT_ACTIVE_LANG|CMD_REVIEW_FT_ACTIVE_TAB|AI predictor|predictor debug dashboard",
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

if (import.meta.main) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
