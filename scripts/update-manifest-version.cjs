#!/usr/bin/env node
// scripts/update-manifest-version.js
// Updates the version in all manifest.json files under the platform directory to match package.json

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version;
const platformDir = path.join(__dirname, '../platform');

function findManifestFiles(dir) {
  return fs.readdirSync(dir).flatMap(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      return findManifestFiles(fullPath);
    } else if (file === 'manifest.json') {
      return [fullPath];
    } else {
      return [];
    }
  });
}

const manifests = findManifestFiles(platformDir);

manifests.forEach(manifestPath => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  execSync(`git add "${manifestPath}"`);
});

if (manifests.length > 0) {
  execSync(`git commit -m "chore: update manifest version to ${version}"`);
  console.log(`Updated manifest versions and committed: ${manifests.join(', ')}`);
} else {
  console.log('No manifest.json files found in platform directory.');
}
