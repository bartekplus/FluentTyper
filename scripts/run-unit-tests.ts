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
    // The Review worst-case tests scan long inputs, some in a child process with the regex
    // JIT off; with every core busy they can pass the 5 s default. Their budgets are CPU time.
    "--timeout=30000",
    ...Bun.argv.slice(2),
    ...scan("tests/*.test.ts"),
    ...scan("tests/*.test.js"),
    ...scan("tests/grammar/*.test.ts"),
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
process.exitCode = await tests.exited;
