#!/usr/bin/env bun
// scripts/update-manifest-version.cjs
// Updates the version in all manifest.json files under the platform directory to match package.json

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = packageJson.version;
const platformDir = path.join(__dirname, "../platform");

const manifests = fs
  .readdirSync(platformDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(platformDir, entry.name, "manifest.json"))
  .filter((manifestPath) => fs.existsSync(manifestPath));

manifests.forEach((manifestPath) => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  execSync(`bun run prettier --write "${manifestPath}"`, { stdio: "inherit" });
  execSync(`git add "${manifestPath}"`);
});

if (manifests.length > 0) {
  console.log(`Updated manifest versions and staged: ${manifests.join(", ")}`);
} else {
  console.log("No manifest.json files found in platform directory.");
}
