const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const { join } = require("node:path");

const TEST_DIR = "tests";
const PRELOAD_PATH = "./tests/bun-test-preload.ts";
const TIMEOUT_MS = "60000";

function discoverUnitTestFiles() {
  return readdirSync(TEST_DIR)
    .filter((fileName) => /\.test\.(ts|js)$/.test(fileName))
    .map((fileName) => join(TEST_DIR, fileName).replaceAll("\\", "/"))
    .sort();
}

function runFile(bunBinary, filePath) {
  console.log(`\n=== Running ${filePath} ===`);
  const result = spawnSync(
    bunBinary,
    [
      "test",
      "--preload",
      PRELOAD_PATH,
      "--timeout",
      TIMEOUT_MS,
      "--max-concurrency",
      "1",
      filePath,
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error) {
    console.error(`Failed to start bun test for ${filePath}:`, result.error);
    return false;
  }

  return result.status === 0;
}

const explicitFiles = process.argv.slice(2);
const files = explicitFiles.length > 0 ? explicitFiles : discoverUnitTestFiles();

if (files.length === 0) {
  console.error("No unit test files found.");
  process.exit(1);
}

const bunBinary = process.versions.bun ? process.execPath : "bun";
let hasFailures = false;

for (const filePath of files) {
  const passed = runFile(bunBinary, filePath);
  if (!passed) {
    hasFailures = true;
  }
}

if (hasFailures) {
  process.exit(1);
}

console.log(`\nAll unit test files passed (${files.length} files).`);
