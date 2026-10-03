const scan = (pattern: string) =>
  new Bun.Glob(pattern).scanSync({ onlyFiles: true }).toArray().sort();

// --parallel runs files in worker processes (one per CPU core) and implies --isolate:
// each file gets a fresh global and module registry, so module mocks cannot leak.
const tests = Bun.spawn(
  [
    "bun",
    "test",
    "--parallel",
    "--max-concurrency=1",
    ...Bun.argv.slice(2),
    ...scan("tests/*.test.ts"),
    ...scan("tests/*.test.js"),
    ...scan("tests/grammar/*.test.ts"),
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
process.exitCode = await tests.exited;
