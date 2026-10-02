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
    const manifestPath = path.resolve(process.cwd(), "src/ui/options/settingsManifest.ts");
    const i18nPath = path.resolve(process.cwd(), "src/ui/options/fluenttyperI18n.ts");

    const manifest = fs.readFileSync(manifestPath, "utf8");
    const i18n = fs.readFileSync(i18nPath, "utf8");

    expect(manifest).not.toContain("smart_backspace");
    expect(manifest).not.toContain("revertOnBackspace");
    expect(i18n).not.toContain("Enable Smart Backspace");
  });

  test("does not build doubled punctuation into composed field labels", async () => {
    const { manifest } = await import("../src/ui/options/settingsManifest.js");
    const extensionLanguageSetting = manifest.settings.find(
      (setting) => setting.name === "extensionLanguage",
    );

    expect(extensionLanguageSetting).toBeDefined();
    expect("label" in extensionLanguageSetting! && extensionLanguageSetting.label).not.toContain(
      "::",
    );
  });

  test("exposes opt-in personalization and a separate clear action", async () => {
    const { manifest } = await import("../src/ui/options/settingsManifest.js");
    const personalization = manifest.settings.find(
      (setting) => setting.name === "personalizationEnabled",
    );
    const clearAction = manifest.settings.find(
      (setting) => setting.name === "clearPersonalizationButton",
    );

    expect(personalization).toEqual(
      expect.objectContaining({
        type: "checkbox",
        default: false,
      }),
    );
    expect("label" in personalization! && personalization.label).toContain(
      "Learn from accepted suggestions",
    );
    expect(clearAction).toEqual(
      expect.objectContaining({
        type: "button",
        text: "Clear learned words",
      }),
    );
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
    const nativeAttachInput = document.getElementById("try-native-list-input");
    const demoLink = document.querySelector('a[href*="youtube.com"]');
    const supportLink = document.querySelector('a[href*="buymeacoffee.com"]');
    const setupSection = document.getElementById("setup");

    expect(firstMainSection?.querySelector('a[href="#setup"]')?.textContent).toContain(
      "Get started",
    );
    expect(setupSection?.contains(permissionButton)).toBe(true);
    expect(setupSection?.contains(practiceTextarea)).toBe(true);
    expect(setupSection?.contains(nativeAttachInput)).toBe(true);
    expect(document.getElementById("permissions-copy")?.textContent).toContain(
      "nothing you type leaves your browser",
    );
    expect(document.getElementById("native-help")?.textContent).toContain("faded icon");
    expect(demoLink).not.toBeNull();
    expect(supportLink).not.toBeNull();
    expect(permissionButton!.compareDocumentPosition(demoLink!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(practiceTextarea!.compareDocumentPosition(demoLink!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(demoLink!.compareDocumentPosition(supportLink!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    dom.window.close();
  });
});
