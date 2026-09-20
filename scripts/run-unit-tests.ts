const POPUP_TEST = "tests/popup.dashboard.retry.test.ts";
const SUGGESTION_MANAGER_TEST = "tests/SuggestionManager.test.ts";

const UTILS_TEST = "tests/utils.test.ts";
const PERSONALIZATION_SERVICE_TEST = "tests/PersonalizationService.test.ts";

// The content_script suites module-mock SuggestionManagerRuntime, which would leak into
// tests/SuggestionManagerRuntime.test.ts when run in the same process.
const ISOLATED_TESTS = new Set([
  "tests/content_script.behavior.test.ts",
  "tests/content_script.watchdog.test.ts",
  POPUP_TEST,
  SUGGESTION_MANAGER_TEST,
  UTILS_TEST,
  PERSONALIZATION_SERVICE_TEST,
]);

function sorted(entries: string[]): string[] {
  return [...entries].sort((left, right) => left.localeCompare(right));
}

async function runSuite(patterns: string[], label: string): Promise<void> {
  if (patterns.length === 0) {
    return;
  }

  const process = Bun.spawn(["bun", "test", "--max-concurrency=1", ...patterns], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}`);
  }
}

async function runCommand(cmd: string[], label: string): Promise<void> {
  const process = Bun.spawn(cmd, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}`);
  }
}

const rootTests = sorted(new Bun.Glob("tests/*.test.ts").scanSync({ onlyFiles: true }).toArray());
const jsTests = sorted(new Bun.Glob("tests/*.test.js").scanSync({ onlyFiles: true }).toArray());
const grammarTests = sorted(
  new Bun.Glob("tests/grammar/*.test.ts").scanSync({ onlyFiles: true }).toArray(),
);

const isolatedTests = rootTests.filter((path) => ISOLATED_TESTS.has(path));
const remainingRootTests = rootTests.filter((path) => !ISOLATED_TESTS.has(path));

for (const testFile of isolatedTests) {
  await runSuite([testFile], `Isolated: ${testFile}`);
}
await runSuite([...remainingRootTests, ...jsTests, ...grammarTests], "Main unit test suite");

// The scripts/ suites are Python — they cover the dictionary/RPM build tooling,
// which no bun test file exercises.  Run them here so they are part of the
// standard test command instead of only being run by hand.
const pythonSuites = sorted(
  new Bun.Glob("scripts/test_*.py").scanSync({ onlyFiles: true }).toArray(),
);
if (pythonSuites.length > 0) {
  const python = Bun.which("python3") ?? Bun.which("python");
  if (!python) {
    throw new Error("python3 is required to run the scripts/ test suites");
  }
  for (const suite of pythonSuites) {
    await runCommand([python, suite], `Python suite: ${suite}`);
  }
}
