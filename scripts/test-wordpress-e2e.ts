import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    platform: { type: "string", default: "chrome" },
    runtime: { type: "string", default: "fixture" },
  },
  strict: true,
});
if (
  !["chrome", "firefox"].includes(values.platform!) ||
  !["fixture", "docker", "playground"].includes(values.runtime!)
)
  throw new Error("Select a supported browser and WordPress runtime.");
const runtimeEnv = { WP_ENV_HOME: path.resolve(".tmp", "wordpress-e2e", values.runtime!) };
function start(
  args: string[],
  env: Record<string, string> = {},
  output: "inherit" | "pipe" | "ignore" = "inherit",
) {
  const child = spawn(args[0], args.slice(1), {
    stdio: ["ignore", output, output],
    detached: process.platform !== "win32",
    env: { ...process.env, ...runtimeEnv, ...env },
  });
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  return { child, exited };
}
const stopped = new WeakSet<ChildProcess>();
function stop(child: ChildProcess): void {
  if (!child.pid || stopped.has(child)) return;
  stopped.add(child);
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
async function complete(command: ReturnType<typeof start>, timeoutMs: number): Promise<number> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stop(command.child);
  }, timeoutMs);
  try {
    const code = await command.exited;
    if (timedOut) throw new Error(`WordPress E2E command exceeded ${timeoutMs / 1000} seconds.`);
    return code;
  } finally {
    clearTimeout(timer);
    stop(command.child);
  }
}
async function run(args: string[], env: Record<string, string> = {}): Promise<void> {
  if ((await complete(start(args, env), 240_000)) !== 0)
    throw new Error(`WordPress E2E command failed: ${args.join(" ")}`);
}
const bun = Bun.which("bun")!;
const tests = [bun, "scripts/run-e2e.ts", "--suite=full", `--platform=${values.platform}`];
// The default suite uses real Gutenberg packages. It starts no WordPress server.
if (values.runtime === "fixture") {
  await run([...tests, "--test-name-pattern=Gutenberg"], { E2E_WORDPRESS_URL: "" });
} else {
  let executable = bun;
  if (values.runtime === "docker") {
    const probe = start(["docker", "info"], {}, "ignore");
    if ((await complete(probe, 10_000)) !== 0)
      throw new Error("Start Docker before the Docker WordPress E2E tests.");
  } else {
    executable = process.env.WORDPRESS_NODE_BIN ?? Bun.which("node") ?? "node";
    const probe = start([executable, "-p", "process.versions.node"], {}, "pipe");
    let version = "";
    probe.child.stdout!.on("data", (chunk: Buffer) => {
      version += chunk.toString();
    });
    if ((await complete(probe, 10_000)) !== 0 || !/^(22|24)\./.test(version))
      throw new Error(
        "Playground requires Node.js 22 or 24. Set WORDPRESS_NODE_BIN to its executable path.",
      );
  }
  const url = "http://localhost:8890";
  if (values.runtime === "docker") {
    const wpEnv = "node_modules/@wordpress/env/bin/wp-env";
    await run([executable, wpEnv, "start", "--runtime=docker"]);
    try {
      await run(
        [
          ...tests,
          `--test-name-pattern=${process.env.E2E_WORDPRESS_TEST_PATTERN ?? "WordPress Gutenberg"}`,
        ],
        { E2E_WORDPRESS_URL: url },
      );
    } finally {
      await run([executable, wpEnv, "stop"]);
    }
  } else {
    if (
      await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
        () => true,
        () => false,
      )
    )
      throw new Error("Port 8890 is in use. Stop its server before the Playground tests.");
    const config = (await Bun.file(".wp-env.json").json()) as { core: string };
    const blueprint = path.join(runtimeEnv.WP_ENV_HOME, "blueprint.json");
    await Bun.write(
      blueprint,
      JSON.stringify({
        steps: [
          {
            step: "writeFile",
            path: "/wordpress/wp-content/mu-plugins/fluenttyper-e2e.php",
            data: await Bun.file("tests/e2e/fixtures/wordpress-e2e.php").text(),
          },
        ],
      }),
    );
    // One worker keeps the in-memory SQLite database consistent across requests.
    const server = start([
      executable,
      "node_modules/@wp-playground/cli/wp-playground.js",
      "server",
      `--wp=${config.core}`,
      "--php=8.2",
      "--workers=1",
      "--port=8890",
      `--site-url=${url}`,
      `--blueprint=${blueprint}`,
      "--define-bool",
      "WP_DEBUG",
      "true",
      "--define-bool",
      "SCRIPT_DEBUG",
      "true",
      "--define-bool",
      "DISABLE_WP_CRON",
      "true",
    ]);
    try {
      const deadline = Date.now() + 90_000;
      let ready = false;
      while (Date.now() < deadline && server.child.exitCode === null) {
        ready = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
          (response) => response.ok,
          () => false,
        );
        if (ready) break;
        await Bun.sleep(100);
      }
      if (!ready) throw new Error("Playground did not start. The WordPress tests cannot run.");
      await run(
        [
          ...tests,
          `--test-name-pattern=${process.env.E2E_WORDPRESS_TEST_PATTERN ?? "WordPress Gutenberg"}`,
        ],
        { E2E_WORDPRESS_URL: url },
      );
    } finally {
      stop(server.child);
      await complete(server, 5000);
    }
  }
}
