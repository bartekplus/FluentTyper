// A mock.module call stays in effect until its process stops. These files replace shared
// modules, so each file runs in its own process:
// - content_script.behavior replaces SuggestionManagerRuntime, which
//   tests/SuggestionManagerRuntime.test.ts must load as real code.
// - background.routing replaces transport-utils and other shared modules, which the Review
//   suites and tests/PersonalizationService.test.ts must load as real code.
const ISOLATED_TESTS = new Set([
  "tests/background.routing.test.ts",
  "tests/content_script.behavior.test.ts",
]);

function sorted(entries: string[]): string[] {
  return [...entries].sort((left, right) => left.localeCompare(right));
}

async function runSuite(patterns: string[], label: string): Promise<void> {
  if (patterns.length === 0) {
    return;
  }

  const proc = Bun.spawn(["bun", "test", ...patterns], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
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
