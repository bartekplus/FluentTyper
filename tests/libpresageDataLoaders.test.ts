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

  test("the Arabic package excludes the disabled aspell data", () => {
    // use_aspell=False: the predictor is dropped from presage.xml, so the
    // packaged ar_SA tree must not carry aspell files.
    const arPackage = LOADER.slice(LOADER.indexOf("ar_SA.data"));
    const files = arPackage
      .slice(0, arPackage.indexOf("})})();"))
      .match(/\/resources_js\/ar_SA\/[^"]+/g);
    expect(files).not.toBeNull();
    expect(files!.some((file) => file.includes("/aspell/"))).toBe(false);
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
