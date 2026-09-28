import { mkdtemp, rm } from "fs/promises";
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

describe("Local AI production artifact", () => {
  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ft-local-ai-build-"));
  });
  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test.each(["chrome", "firefox"])(
    "%s production build passes the release gate",
    async (platform) => {
      const report = await checkLocalAiArtifact(await build(platform, "production"), platform);
      expect(report.failures).toEqual([]);
    },
    60_000,
  );

  test("the gate rejects a development build (markers are not vacuous)", async () => {
    const report = await checkLocalAiArtifact(await build("chrome", "development"), "chrome");
    const failures = report.failures.join("\n");
    expect(failures).toContain("runtime test hooks");
    expect(failures).toContain("__FT_DEV_BUILD__ = true");
    expect(failures).toContain("contains the WebLLM engine");
    expect(failures).toContain("connect-src");
  }, 60_000);
});
