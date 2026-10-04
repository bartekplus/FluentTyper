const scan = (pattern: string) =>
  new Bun.Glob(pattern).scanSync({ onlyFiles: true }).toArray().sort();

const files = [
  ...scan("tests/*.test.ts"),
  ...scan("tests/*.test.js"),
  ...scan("tests/grammar/*.test.ts"),
];
// Timing tests assert CPU-time budgets. Under full parallel load, SMT siblings share a core and
// thread CPU time grows 3-5 times, so these files run in a second, serial pass.
const isTiming = (file: string) => file.endsWith(".timing.test.ts");
// --only=parallel or --only=timing runs one pass, so CI can run the two passes in separate jobs.
const only = Bun.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
if (only !== undefined && only !== "parallel" && only !== "timing") {
  throw new Error(`Unsupported only: ${only}`);
}
const passthroughArgs = Bun.argv.slice(2).filter((arg) => !arg.startsWith("--only="));

const run = (flags: string[], selected: string[]) =>
  Bun.spawn(
    [
      "bun",
      "test",
      ...flags,
      // The Review worst-case tests scan long inputs, some in a child process with the regex
      // JIT off; with every core busy they can pass the 5 s default.
      "--timeout=30000",
      ...passthroughArgs,
      ...selected,
    ],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  ).exited;

// --parallel runs files in worker processes (one per CPU core) and implies --isolate:
// each file gets a fresh global and module registry, so module mocks cannot leak.
const parallel =
  only === "timing"
    ? 0
    : await run(
        ["--parallel", "--max-concurrency=1"],
        files.filter((file) => !isTiming(file)),
      );
const serial =
  only === "parallel" ? 0 : await run(["--isolate", "--max-concurrency=1"], files.filter(isTiming));
process.exitCode = parallel || serial;
