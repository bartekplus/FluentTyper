import { spawn, type ChildProcess } from "node:child_process";

export function startWordPressCommand(
  args: string[],
  env: Record<string, string> = {},
  output: "inherit" | "pipe" | "ignore" = "inherit",
) {
  const child = spawn(args[0], args.slice(1), {
    stdio: ["ignore", output, output],
    detached: process.platform !== "win32",
    env: { ...process.env, ...env },
  });
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  return { child, exited };
}
const stopped = new WeakSet<ChildProcess>();
export function stopWordPressCommand(child: ChildProcess): void {
  if (!child.pid || stopped.has(child)) return;
  stopped.add(child);
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
export async function completeWordPressCommand(
  command: ReturnType<typeof startWordPressCommand>,
  timeoutMs: number,
): Promise<number> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stopWordPressCommand(command.child);
  }, timeoutMs);
  try {
    const code = await command.exited;
    if (timedOut) throw new Error(`WordPress E2E command exceeded ${timeoutMs / 1000} seconds.`);
    return code;
  } finally {
    clearTimeout(timer);
    stopWordPressCommand(command.child);
  }
}
