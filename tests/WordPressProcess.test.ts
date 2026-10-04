import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  startWordPressCommand,
  stopWordPressCommand,
  completeWordPressCommand,
} from "../scripts/wordpressProcess";

test("WordPress commands finish and cleanup remains idempotent", async () => {
  const command = startWordPressCommand([process.execPath, "-e", "process.exit(0)"], {}, "ignore");
  expect(await completeWordPressCommand(command, 2000)).toBe(0);
  stopWordPressCommand(command.child);
});

test("WordPress command timeouts stop the owned process and its child", async () => {
  if (process.platform === "win32") return;
  const command = startWordPressCommand(
    [
      process.execPath,
      "-e",
      `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},60000)'],{stdio:'ignore'});
    // console.log colors numbers when FORCE_COLOR is set, so write the PID as plain text.
    process.stdout.write(child.pid + "\\n");
    setInterval(()=>{},60000);
  `,
    ],
    {},
    "pipe",
  );
  try {
    const pid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The test child did not start.")), 2000);
      command.child.stdout!.once("data", (chunk: Buffer) => {
        clearTimeout(timer);
        resolve(Number(chunk.toString().trim()));
      });
    });
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    await expect(completeWordPressCommand(command, 100)).rejects.toThrow("exceeded 0.1 seconds");
    expect(command.child.signalCode).toBe("SIGKILL");
    let state = "";
    try {
      state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
    } catch {
      // No process remains at that PID.
    }
    expect(!state || state.startsWith("Z")).toBe(true);
  } finally {
    stopWordPressCommand(command.child);
  }
});
