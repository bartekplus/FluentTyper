import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { installJsdom } from "./support/jsdomGlobals";

let importNonce = 0;
let activeDom: JSDOM | null = null;
let restoreGlobals: (() => void) | null = null;

function freshModulePath(pathname: string): string {
  importNonce += 1;
  return `${pathname}?bun_test_nonce_onboarding=${importNonce}`;
}

function installOnboardingDom(): JSDOM {
  const onboardingHtmlPath = path.resolve(process.cwd(), "public/new_installation/index.html");
  const html = fs.readFileSync(onboardingHtmlPath, "utf8");
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    url: "https://example.test/new_installation/index.html",
  });
  restoreGlobals = installJsdom(dom);
  return dom;
}

async function flushAsyncWork(rounds = 6): Promise<void> {
  for (let idx = 0; idx < rounds; idx += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  activeDom?.window.close();
  activeDom = null;
  restoreGlobals?.();
  restoreGlobals = null;
});

describe("onboarding permission status", () => {
  test("uses the shared missing and granted permission copy", async () => {
    activeDom = installOnboardingDom();
    const focusSpy = spyOn(window.HTMLTextAreaElement.prototype, "focus");

    const browserMock = {
      permissions: {
        contains: async () => false,
        request: async () => true,
      },
    };
    (window as unknown as { browser: unknown }).browser = browserMock;
    (globalThis as unknown as { chrome: unknown }).chrome = browserMock;

    await import(freshModulePath("../src/ui/onboarding/onboarding"));
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await flushAsyncWork();

    const container = document.getElementById("permissions-container") as HTMLElement;
    const button = document.getElementById("grant-permissions-btn") as HTMLButtonElement;

    expect(container.dataset.permissionState).toBe("missing");
    expect(document.getElementById("permissions-title")?.textContent).toBe(
      "Allow FluentTyper on websites",
    );
    expect(document.getElementById("permissions-copy")?.textContent).toBe(
      "Everything runs on your device; nothing you type leaves your browser. FluentTyper needs access to all websites to help in their text fields.",
    );
    expect(button.textContent).toBe("Allow on all websites");
    expect(document.getElementById("permissions-title")?.textContent).not.toContain(
      "permission_status_",
    );
    expect(document.getElementById("permissions-copy")?.textContent).not.toContain(
      "permission_status_",
    );

    button.click();
    await flushAsyncWork();

    expect(container.dataset.permissionState).toBe("granted");
    expect(document.getElementById("permissions-title")?.textContent).toBe("Access granted");
    expect(document.getElementById("permissions-copy")?.textContent).toBe(
      "FluentTyper can now show suggestions in text fields, and everything still stays local in your browser.",
    );
    expect(button.hidden).toBe(true);
    expect(document.activeElement?.id).toBe("try-me-textarea");
    expect(focusSpy).toHaveBeenCalledWith();
    focusSpy.mockRestore();
  });

  test("shows recovery copy when browser permissions are unavailable", async () => {
    activeDom = installOnboardingDom();

    (window as unknown as { browser: unknown }).browser = {};
    (globalThis as unknown as { chrome: unknown }).chrome = {};

    await import(freshModulePath("../src/ui/onboarding/onboarding"));
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await flushAsyncWork();

    const container = document.getElementById("permissions-container") as HTMLElement;
    const button = document.getElementById("grant-permissions-btn") as HTMLButtonElement;

    expect(container.dataset.permissionState).toBe("unavailable");
    expect(document.getElementById("permissions-title")?.textContent).toBe("Check browser access");
    expect(document.getElementById("permissions-copy")?.textContent).toBe(
      "FluentTyper could not verify website access right now. Reopen FluentTyper or reload this page, then try again. Your typing still stays local in your browser.",
    );
    expect(document.getElementById("permissions-title")?.textContent).not.toContain(
      "permission_status_",
    );
    expect(document.getElementById("permissions-copy")?.textContent).not.toContain(
      "permission_status_",
    );
    expect(button.hidden).toBe(true);
  });

  test("keeps granted state on initial render when permission is checkable but not requestable", async () => {
    activeDom = installOnboardingDom();

    const focusSpy = spyOn(window.HTMLTextAreaElement.prototype, "focus");
    const headerLink = document.querySelector<HTMLAnchorElement>(".brand")!;
    headerLink.focus();
    const browserMock = {
      permissions: {
        contains: async () => true,
      },
    };
    (window as unknown as { browser: unknown }).browser = browserMock;
    (globalThis as unknown as { chrome: unknown }).chrome = browserMock;

    await import(freshModulePath("../src/ui/onboarding/onboarding"));
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await flushAsyncWork();

    const container = document.getElementById("permissions-container") as HTMLElement;
    const button = document.getElementById("grant-permissions-btn") as HTMLButtonElement;

    expect(container.dataset.permissionState).toBe("granted");
    expect(document.getElementById("permissions-title")?.textContent).toBe("Access granted");
    expect(button.hidden).toBe(true);
    expect(document.activeElement).toBe(headerLink);
    expect(focusSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
  });
});

test("localizes the whole welcome page and permissions together in Polish", async () => {
  activeDom = installOnboardingDom();
  const { i18n } = await import("../src/ui/options/fluenttyperI18n");
  const previousLanguage = i18n.lang;
  i18n.lang = "pl";
  (window as unknown as { browser: unknown }).browser = {
    permissions: { contains: async () => true },
  };
  try {
    await import(freshModulePath("../src/ui/onboarding/onboarding"));
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await flushAsyncWork();
    expect(document.documentElement.lang).toBe("pl");
    expect(document.title).toBe("Witaj w FluentTyper");
    expect(document.getElementById("welcome-title")?.textContent).toBe("Pisanie możebyć prostsze.");
    expect(document.getElementById("permissions-title")?.textContent).toBe("Dostęp przyznany");
    expect(document.getElementById("try-me-textarea")?.getAttribute("placeholder")).toBe(
      "Nie mogę się doczekać…",
    );
    expect(document.querySelector(".feature-tour")?.getAttribute("aria-label")).toBe(
      "Poznaj FluentTyper",
    );
    expect(document.querySelector(".review-example .sample-text")?.textContent).toBe(
      "Wczoraj poszłemdo biura.",
    );
    expect(document.body.textContent).not.toContain("Get started");
    expect(document.body.textContent).not.toContain("Local AI Review. Entirely optional.");
  } finally {
    i18n.lang = previousLanguage;
  }
});

test("translates all onboarding content and attributes with a consistent locale fallback", async () => {
  activeDom = installOnboardingDom();
  const { i18n } = await import("../src/ui/options/fluenttyperI18n");
  const { onboardingTranslations } = await import("../src/ui/onboarding/translations");
  const { translateOnboarding } = await import(freshModulePath("../src/ui/onboarding/onboarding"));
  const previousLanguage = i18n.lang;
  const locales = ["en", "pl", "de", "fr", "es", "pr", "sv", "hr", "el"] as const;
  try {
    for (const entry of Object.values(onboardingTranslations)) {
      expect(Object.keys(entry).sort()).toEqual([...locales].sort());
      expect(Object.values(entry).every((text) => text.trim().length > 0)).toBe(true);
    }
    for (const locale of [...locales, "ja"] as const) {
      i18n.lang = locale;
      translateOnboarding();
      expect(document.documentElement.lang).toBe(
        locale === "pr" ? "pt" : locale === "ja" ? "en" : locale,
      );
      expect(document.title).toBe(i18n.get("onboarding_title"));
      for (const element of document.querySelectorAll("[data-i18n]")) {
        const key = element.getAttribute("data-i18n")!;
        expect(i18n.get(key)).not.toBe(key);
        expect(element.textContent).toBe(i18n.get(key));
      }
      const language = locale === "ja" ? "en" : locale;
      let richElementCount = 0;
      for (const [key, translations] of Object.entries(onboardingTranslations)) {
        const expected = document.createElement("div");
        expected.innerHTML = translations[language];
        for (const element of document.querySelectorAll(`[data-i18n-html="${key}"]`)) {
          expect(element.innerHTML).toBe(expected.innerHTML);
          richElementCount++;
        }
      }
      expect(richElementCount).toBe(document.querySelectorAll("[data-i18n-html]").length);
      for (const attribute of ["aria-label", "placeholder", "value"]) {
        for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
          expect(element.getAttribute(attribute)).toBe(
            i18n.get(element.getAttribute(`data-i18n-${attribute}`)!),
          );
        }
      }
      expect(document.querySelector(".inline-word .caret")).not.toBeNull();
      expect(document.querySelector(".review-mark")).not.toBeNull();
    }
    // Only brand names and physical key labels may sit outside translation bindings.
    const walker = document.createTreeWalker(document.body, window.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (
        text &&
        !walker.currentNode.parentElement?.closest("[data-i18n], [data-i18n-html], kbd")
      ) {
        expect(["FluentTyper", "GitHub"]).toContain(text);
      }
    }
  } finally {
    i18n.lang = previousLanguage;
  }
});

test("a Portuguese browser language selects the Portuguese text", async () => {
  activeDom = installOnboardingDom();
  Object.defineProperty(window.navigator, "language", { configurable: true, value: "pt-BR" });
  const { i18n } = await import(freshModulePath("../src/ui/options/fluenttyperI18n"));
  expect(i18n.lang).toBe("pr");
});

test("does not interpret unknown rich translation keys as HTML", async () => {
  activeDom = installOnboardingDom();
  const { translateOnboarding } = await import(freshModulePath("../src/ui/onboarding/onboarding"));
  const heading = document.getElementById("welcome-title")!;
  const original = heading.innerHTML;
  for (const key of ['<img src="x" onerror="alert(1)">', "__proto__", "missing_key"]) {
    heading.setAttribute("data-i18n-html", key);
    translateOnboarding();
    expect(heading.innerHTML).toBe(original);
    expect(heading.querySelector("img")).toBeNull();
  }
});
