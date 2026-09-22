import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";

const LOADER_PATH = "src/third_party/libpresage/libpresage.js";
const PACKAGE_DIR = "public/third_party/libpresage";

const LOADER = readFileSync(LOADER_PATH, "utf-8");
const PACKAGE_FILES = readdirSync(PACKAGE_DIR).filter((entry) => entry.endsWith(".data"));

/**
 * The committed libpresage.js carries one inlined data-loader per language.
 * A loader that fetches its package by bare relative name resolves against the
 * page inside the extension, fails, and leaves the emscripten data download
 * pending — which hangs module initialisation (the service worker never becomes
 * responsive). Node-based tests do not catch that: they take the
 * `require("fs")` branch instead of fetching.
 */
describe("libpresage data loaders", () => {
  test("no loader fetches a package by bare relative name", () => {
    expect(LOADER).not.toContain("fetch(packageName)");
  });

  test("every data package is fetched via chrome.runtime.getURL", () => {
    const viaRuntimeUrl =
      LOADER.match(/chrome\.runtime\.getURL\("third_party\/libpresage\/"/g) ?? [];
    expect(viaRuntimeUrl).toHaveLength(PACKAGE_FILES.length);
  });

  test("an Arabic loader is present", () => {
    expect(LOADER).toContain("ar_SA.data");
    expect(LOADER).toContain("/resources_js/ar_SA/ngrams_db/ngrams.trie");
    expect(LOADER).toContain("/resources_js/ar_SA/hunspell/ar_SA.dic");
  });

  test("the Arabic loader metadata matches ar_SA.data and excludes aspell", () => {
    // Parse ar_SA's own loadPackage({...}) metadata, not the whole bundle.
    const pkgNameAt = LOADER.search(/PACKAGE_NAME\s*=\s*['"]ar_SA\.data['"]/);
    expect(pkgNameAt).toBeGreaterThan(-1);
    const match = LOADER.slice(pkgNameAt).match(
      /loadPackage\((\{"?files"?:[\s\S]*?"?remote_package_size"?:\s*\d+\})\)/,
    );
    expect(match).not.toBeNull();
    // Minified emscripten output leaves object keys unquoted; quote them for JSON.
    const metadata = JSON.parse(match![1].replace(/([{,])(\w+):/g, '$1"$2":')) as {
      files: { filename: string; start: number; end: number }[];
      remote_package_size: number;
    };

    expect(metadata.remote_package_size).toBe(statSync(`${PACKAGE_DIR}/ar_SA.data`).size);
    expect(metadata.files.length).toBeGreaterThan(0);
    // use_aspell=False: the predictor is dropped from presage.xml, so the
    // packaged ar_SA tree must not carry aspell files.
    for (const file of metadata.files) {
      expect(file.filename.startsWith("/resources_js/ar_SA/")).toBe(true);
      expect(file.filename).not.toContain("/aspell/");
    }
    const totalBytes = metadata.files.reduce((sum, file) => sum + (file.end - file.start), 0);
    expect(totalBytes).toBe(metadata.remote_package_size);
  });

  test("every packaged .data file is referenced and its size matches the loader", () => {
    for (const file of PACKAGE_FILES) {
      expect(LOADER).toContain(file);
      const size = statSync(`${PACKAGE_DIR}/${file}`).size;
      const declared = new RegExp(`remote_package_size"?\\s*:\\s*${size}\\b`);
      expect(declared.test(LOADER)).toBe(true);
    }
  });
});
