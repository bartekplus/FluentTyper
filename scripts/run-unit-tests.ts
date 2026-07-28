import { globSync } from "glob";

const POPUP_TEST = "tests/popup.dashboard.retry.test.ts";
const SUGGESTION_MANAGER_TEST = "tests/SuggestionManager.test.ts";

const UTILS_TEST = "tests/utils.test.ts";
const PERSONALIZATION_SERVICE_TEST = "tests/PersonalizationService.test.ts";

const ISOLATED_TESTS = new Set([
  POPUP_TEST,
  SUGGESTION_MANAGER_TEST,
  UTILS_TEST,
  PERSONALIZATION_SERVICE_TEST,
]);

function sortedUnique(entries: string[]): string[] {
  return [...new Set(entries)].sort((left, right) => left.localeCompare(right));
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

const rootTests = sortedUnique(globSync("tests/*.test.ts"));
const jsTests = sortedUnique(globSync("tests/*.test.js"));
const grammarTests = sortedUnique(globSync("tests/grammar/*.test.ts"));

const isolatedTests = rootTests.filter((path) => ISOLATED_TESTS.has(path));
const remainingRootTests = rootTests.filter((path) => !ISOLATED_TESTS.has(path));

for (const testFile of isolatedTests) {
  await runSuite([testFile], `Isolated: ${testFile}`);
}
await runSuite([...remainingRootTests, ...jsTests, ...grammarTests], "Main unit test suite");
