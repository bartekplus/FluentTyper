import fs from "node:fs";
import path from "node:path";

describe("options page scripts", () => {
  test("does not load runtime content script or missing legacy suggestion runtime", () => {
    const optionsHtmlPath = path.resolve(process.cwd(), "public/options/options.html");
    const html = fs.readFileSync(optionsHtmlPath, "utf8");

    expect(html).not.toContain("/content_script.js");
    expect(html).not.toContain("/third_party/tribute/tribute.js");
  });
});
