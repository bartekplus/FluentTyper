import { mkdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
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
  /** Parallel processes for the full suite; undefined chooses from the CPU count. */
  shards?: number;
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
      shards: { type: "string" },
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
  const shards = "shards" in values ? Number(values.shards) : undefined;
  if (shards !== undefined && !(Number.isInteger(shards) && shards > 0)) {
    throw new Error(`Unsupported shards: ${String(values.shards)}`);
  }

  // Everything that is not one of our own options goes to `bun test` verbatim.
  const ownIndices = new Set<number>();
  for (const token of tokens) {
    if (
      token.kind === "option" &&
      ["mode", "platform", "suite", "headed", "shards"].includes(token.name)
    ) {
      ownIndices.add(token.index);
      if (token.value !== undefined && !token.inlineValue) {
        ownIndices.add(token.index + 1);
      }
    }
  }
  const passthroughArgs = argv.filter((_, index) => !ownIndices.has(index));

  return { mode, platform, suite, headed, shards, passthroughArgs };
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

/** Runs the commands at the same time; each prints its output in one block when it ends. */
async function runParallel(
  commands: Array<{ cmd: string[]; env: Record<string, string> }>,
): Promise<void> {
  const failures = await Promise.all(
    commands.map(async ({ cmd, env }) => {
      const child = Bun.spawn({
        cmd,
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      const label = env.E2E_SHARD ? `shard ${env.E2E_SHARD}` : cmd.at(-1);
      process.stdout.write(`\n===== ${label} (exit ${exitCode}) =====\n${out}${err}`);
      return exitCode === 0 ? [] : [`${label} failed (${exitCode})`];
    }),
  );
  if (failures.flat().length > 0) {
    throw new Error(failures.flat().join("\n"));
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
      [bunExecutable, "test", "tests/e2e/full.e2e.test.ts", ...options.passthroughArgs],
      {
        ...sharedE2EEnv,
        E2E_SUITE: "full",
        FT_E2E_DEV_RUNTIME: "1",
      },
    );
    return;
  }

  if (options.suite === "smoke") {
    await runCommand(
      [bunExecutable, "test", "tests/e2e/smoke.e2e.test.ts", ...options.passthroughArgs],
      sharedE2EEnv,
    );
    return;
  }

  // Each shard starts its own browser (about 3 s). A filtered run stays in one process:
  // it is small, and the WordPress runs share one site.
  const shards =
    options.shards ??
    (options.passthroughArgs.length > 0 ? 1 : Math.max(1, Math.floor(availableParallelism() / 2)));
  const testCommand = (file: string) => [bunExecutable, "test", file, ...options.passthroughArgs];
  if (shards === 1) {
    await runCommand(
      [
        bunExecutable,
        "test",
        "tests/e2e/full.e2e.test.ts",
        "tests/e2e/local-ai.e2e.test.ts",
        ...options.passthroughArgs,
      ],
      sharedE2EEnv,
    );
    return;
  }
  await runParallel([
    ...Array.from({ length: shards }, (_, index) => ({
      cmd: testCommand("tests/e2e/full.e2e.test.ts"),
      env: { ...sharedE2EEnv, E2E_SHARD: `${index + 1}/${shards}` },
    })),
    { cmd: testCommand("tests/e2e/local-ai.e2e.test.ts"), env: sharedE2EEnv },
  ]);
}

if (import.meta.main) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
