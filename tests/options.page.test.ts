import fs from "node:fs";
import path from "node:path";

describe("options page scripts", () => {
  test("does not load runtime content script or missing legacy suggestion runtime", () => {
    const optionsHtmlPath = path.resolve(process.cwd(), "public/options/options.html");
    const html = fs.readFileSync(optionsHtmlPath, "utf8");

    expect(html).not.toContain("/content_script.js");
    expect(html).not.toContain("/third_party/tribute/tribute.js");
  });

  test("does not expose the removed Smart Backspace setting", () => {
    const manifestPath = path.resolve(
      process.cwd(),
      "src/third_party/fancier-settings/manifest.js",
    );
    const i18nPath = path.resolve(process.cwd(), "src/third_party/fancier-settings/i18n.js");

    const manifest = fs.readFileSync(manifestPath, "utf8");
    const i18n = fs.readFileSync(i18nPath, "utf8");

    expect(manifest).not.toContain("smart_backspace");
    expect(manifest).not.toContain("revertOnBackspace");
    expect(i18n).not.toContain("Enable Smart Backspace");
  });
});
