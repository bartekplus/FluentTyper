import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

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

  test("prioritizes activation flow over demo and support content on onboarding", () => {
    const onboardingHtmlPath = path.resolve(process.cwd(), "public/new_installation/index.html");
    const html = fs.readFileSync(onboardingHtmlPath, "utf8");
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const { Node } = dom.window;

    const firstMainSection = document.querySelector("main > section");
    const permissionButton = document.getElementById("grant-permissions-btn");
    const practiceTextarea = document.getElementById("try-me-textarea");
    const demoSection = document.getElementById("demo");
    const supportSection = document.getElementById("support");

    expect(firstMainSection?.textContent).toContain("Next action:");
    expect(firstMainSection?.innerHTML).toContain("grant-permissions-btn");
    expect(firstMainSection?.innerHTML).toContain("try-me-textarea");
    expect(firstMainSection?.textContent).toContain(
      "FluentTyper needs website access to appear inside the text fields where you type",
    );

    expect(permissionButton).not.toBeNull();
    expect(practiceTextarea).not.toBeNull();
    expect(demoSection).not.toBeNull();
    expect(supportSection).not.toBeNull();

    expect(permissionButton!.compareDocumentPosition(demoSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(practiceTextarea!.compareDocumentPosition(demoSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(demoSection!.compareDocumentPosition(supportSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
