import { existsSync } from "fs";
import { appendFile, mkdtemp, readFile, readdir, rm } from "fs/promises";
import os from "os";
import path from "path";
import { checkLocalAiArtifact } from "../scripts/check-local-ai-artifact";

const ROOT = path.resolve(import.meta.dir, "..");
let tempRoot = "";

/** Builds into a temp dir; a failed build fails the test (no silent skip). */
async function build(platform: string, mode: "production" | "development"): Promise<string> {
  const outDir = path.join(tempRoot, `${mode}-${platform}`);
  const proc = Bun.spawn(
    ["bun", "build.ts", `--mode=${mode}`, `--platform=${platform}`, `--outdir=${outDir}`],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (exitCode !== 0) {
    throw new Error(`build ${mode}/${platform} failed (${exitCode}):\n${stderr}`);
  }
  return outDir;
}

describe("build.ts options", () => {
  test.each(["--bogus", "positional", "--mode=dev", "--outdir="])(
    "rejects %s before it builds",
    async (arg) => {
      const outDir = path.join(os.tmpdir(), `ft-rejected-build-${process.pid}`);
      const proc = Bun.spawn(["bun", "build.ts", `--outdir=${outDir}`, arg], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await proc.exited).not.toBe(0);
      expect(existsSync(outDir)).toBe(false);
    },
    15_000,
  );
});

describe("Local AI production artifact", () => {
  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ft-local-ai-build-"));
  });
  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("chrome production build passes the release gate; a changed ORT file fails it", async () => {
    const outDir = await build("chrome", "production");
    expect((await checkLocalAiArtifact(outDir, "chrome")).failures).toEqual([]);

    await appendFile(path.join(outDir, "local-ai/ort/ort-wasm-simd-threaded.asyncify.wasm"), "x");
    expect((await checkLocalAiArtifact(outDir, "chrome")).failures.join("\n")).toContain(
      "does not match its pinned SHA-256",
    );
  }, 60_000);

  test("firefox production build passes the release gate (no Local AI runtime)", async () => {
    const report = await checkLocalAiArtifact(await build("firefox", "production"), "firefox");
    expect(report.failures).toEqual([]);
  }, 60_000);

  test("the gate rejects a development build (markers are not vacuous)", async () => {
    const outDir = await build("chrome", "development");
    const report = await checkLocalAiArtifact(outDir, "chrome");
    const failures = report.failures.join("\n");
    expect(failures).toContain("runtime test hooks");
    expect(failures).toContain("__FT_DEV_BUILD__ = true");

    // Source map paths are relative to the map file.
    const maps = (await readdir(outDir, { recursive: true })).filter((f) => f.endsWith(".js.map"));
    expect(maps.length).toBeGreaterThan(0);
    for (const map of maps) {
      const { sources } = JSON.parse(await readFile(path.join(outDir, map), "utf8")) as {
        sources: string[];
      };
      const local = sources.filter((source) => /(^|\/)src\//.test(source));
      expect(local.length).toBeGreaterThan(0);
      for (const source of local) {
        expect(existsSync(path.resolve(outDir, path.dirname(map), source))).toBe(true);
      }
    }
  }, 60_000);
});
