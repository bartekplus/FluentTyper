import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { getWebsiteAccessPermissionCopy } from "../src/ui/shared/websiteAccessPermission";

const baseGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  navigator: globalThis.navigator,
  Node: globalThis.Node,
  HTMLElement: globalThis.HTMLElement,
  HTMLButtonElement: globalThis.HTMLButtonElement,
  HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  Event: globalThis.Event,
  chrome: (globalThis as unknown as { chrome: unknown }).chrome,
};

let importNonce = 0;
let activeDom: JSDOM | null = null;

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
  const windowRef = dom.window;

  (globalThis as unknown as { window: Window }).window = windowRef as unknown as Window;
  (globalThis as unknown as { document: Document }).document = windowRef.document;
  (globalThis as unknown as { navigator: Navigator }).navigator = windowRef.navigator;
  (globalThis as unknown as { Node: typeof Node }).Node = windowRef.Node as unknown as typeof Node;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    windowRef.HTMLElement as unknown as typeof HTMLElement;
  (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement =
    windowRef.HTMLButtonElement as unknown as typeof HTMLButtonElement;
  (
    globalThis as unknown as { HTMLTextAreaElement: typeof HTMLTextAreaElement }
  ).HTMLTextAreaElement = windowRef.HTMLTextAreaElement as unknown as typeof HTMLTextAreaElement;
  (globalThis as unknown as { Event: typeof Event }).Event =
    windowRef.Event as unknown as typeof Event;

  return dom;
}

async function flushAsyncWork(rounds = 6): Promise<void> {
  for (let idx = 0; idx < rounds; idx += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  if (activeDom) {
    activeDom.window.close();
    activeDom = null;
  }

  (globalThis as unknown as { window: Window }).window = baseGlobals.window;
  (globalThis as unknown as { document: Document }).document = baseGlobals.document;
  (globalThis as unknown as { navigator: Navigator }).navigator = baseGlobals.navigator;
  (globalThis as unknown as { Node: typeof Node }).Node = baseGlobals.Node;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    baseGlobals.HTMLElement;
  (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement =
    baseGlobals.HTMLButtonElement;
  (
    globalThis as unknown as { HTMLTextAreaElement: typeof HTMLTextAreaElement }
  ).HTMLTextAreaElement = baseGlobals.HTMLTextAreaElement;
  (globalThis as unknown as { Event: typeof Event }).Event = baseGlobals.Event;
  (globalThis as unknown as { chrome: unknown }).chrome = baseGlobals.chrome;
});

describe("onboarding permission status", () => {
  test("uses the shared missing and granted permission copy", async () => {
    const copy = getWebsiteAccessPermissionCopy();
    activeDom = installOnboardingDom();

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
    expect(document.getElementById("permissions-title")?.textContent).toBe(copy.missing.title);
    expect(document.getElementById("permissions-copy")?.textContent).toBe(copy.missing.body);
    expect(button.textContent).toBe(copy.missing.actionLabel);

    button.click();
    await flushAsyncWork();

    expect(container.dataset.permissionState).toBe("granted");
    expect(document.getElementById("permissions-title")?.textContent).toBe(copy.granted.title);
    expect(document.getElementById("permissions-copy")?.textContent).toBe(copy.granted.body);
    expect(button.hidden).toBe(true);
    expect(document.activeElement?.id).toBe("try-me-textarea");
  });

  test("shows recovery copy when browser permissions are unavailable", async () => {
    const copy = getWebsiteAccessPermissionCopy();
    activeDom = installOnboardingDom();

    (window as unknown as { browser: unknown }).browser = {};
    (globalThis as unknown as { chrome: unknown }).chrome = {};

    await import(freshModulePath("../src/ui/onboarding/onboarding"));
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await flushAsyncWork();

    const container = document.getElementById("permissions-container") as HTMLElement;
    const button = document.getElementById("grant-permissions-btn") as HTMLButtonElement;

    expect(container.dataset.permissionState).toBe("unavailable");
    expect(document.getElementById("permissions-title")?.textContent).toBe(copy.unavailable.title);
    expect(document.getElementById("permissions-copy")?.textContent).toBe(copy.unavailable.body);
    expect(button.hidden).toBe(true);
  });
});
