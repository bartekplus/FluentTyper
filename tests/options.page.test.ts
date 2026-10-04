import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM, VirtualConsole } from "jsdom";
import {
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_OBSERVABILITY_MODULE_OVERRIDES,
  KEY_PREFIX_ONLY_MODE,
} from "../src/core/domain/constants";
import { wireRuntimeSettingsHandlers } from "../src/ui/options/settings";
import { installJsdom } from "./support/jsdomGlobals";
import { fakeRegistry } from "./support/settingsFakes";

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

  test("the dev manifest does not repeat the observability card help text", async () => {
    const globals = globalThis as { __FT_DEV_BUILD__?: boolean };
    globals.__FT_DEV_BUILD__ = true;
    try {
      const manifestPath = "../src/ui/options/settingsManifest.ts?dev_manifest";
      const { manifest } = (await import(
        manifestPath
      )) as typeof import("../src/ui/options/settingsManifest.js");
      const { i18n } = await import("../src/ui/options/fluenttyperI18n.js");
      expect(manifest.tabs.map((tab) => tab.id)).toContain("observability_tab");
      // The Controls card shows observability_desc as its help text.
      const repeats = manifest.settings.filter(
        (setting) => "text" in setting && setting.text?.includes(i18n.get("observability_desc")),
      );
      expect(repeats).toEqual([]);
    } finally {
      delete globals.__FT_DEV_BUILD__;
    }
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

type SentMessage = { command: string; context?: unknown };

const CONFIG_CHANGE = "CMD_OPTIONS_PAGE_CONFIG_CHANGE";

function stubConfigChangeSender(): SentMessage[] {
  const sent: SentMessage[] = [];
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: (message: SentMessage) => {
        sent.push(message);
        return Promise.resolve();
      },
    },
  };
  return sent;
}

describe("options page settings handlers", () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  });

  test.each([
    "enable",
    KEY_PREFIX_ONLY_MODE,
    "domainBlackList",
    KEY_OBSERVABILITY_MODULE_OVERRIDES,
  ])("%s tells the background one time, after the storage write", (key) => {
    const sent = stubConfigChangeSender();
    const registry = fakeRegistry({ [key]: undefined });
    const persisted: Array<(value: unknown) => void> = [];
    registry[key].addEvent = (type: string, fn: (value: unknown) => void) => {
      if (type === "persisted") persisted.push(fn);
    };
    wireRuntimeSettingsHandlers(registry);
    expect(sent).toEqual([]);

    persisted.forEach((fn) => fn(undefined));

    expect(sent.filter((message) => message.command === CONFIG_CHANGE)).toHaveLength(1);
  });

  test.each([
    ["already locked", true, "10", []],
    ["different", false, "5", [true, 10]],
  ] as const)(
    "inline mode writes only the locked values that are %s",
    (_label, acceptOnTab, numSuggestions, expected) => {
      stubConfigChangeSender();
      const registry = fakeRegistry({
        [KEY_INLINE_SUGGESTION]: true,
        [KEY_AUTOCOMPLETE_ON_TAB]: acceptOnTab,
        // A select control gives its value as a string.
        [KEY_NUM_SUGGESTIONS]: numSuggestions,
        [KEY_PREFIX_ONLY_MODE]: true,
      });
      wireRuntimeSettingsHandlers(registry);

      registry[KEY_INLINE_SUGGESTION].set(true);

      const writes = [KEY_AUTOCOMPLETE_ON_TAB, KEY_NUM_SUGGESTIONS, KEY_PREFIX_ONLY_MODE].flatMap(
        (key) => registry[key].calls.map((call) => call.value),
      );
      expect(writes).toEqual([...expected]);
    },
  );
});

async function flushPage(rounds = 30): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("options page runtime", () => {
  let dom: JSDOM;
  let restoreGlobals = () => {};
  let sent: SentMessage[];
  let snapshotAvailable: boolean;
  let storageWrite: Promise<void>;
  let pageNonce = 0;

  function snapshot() {
    return {
      generatedAtMs: Date.now(),
      available: snapshotAvailable,
      events: [],
      modules: [
        { moduleId: "Alpha", sources: ["options"], registered: true, enabled: true },
        { moduleId: "Beta", sources: ["options"], registered: true, enabled: true },
      ],
      contentRuntimes: [{ tabId: 1, frameId: 0, domain: "a.test" }],
      autoLanguageRuntimes: [],
      predictor: null,
      config: { enabled: true, defaultLevel: "info", moduleOverrides: {} },
      summary: {
        totalEvents: 0,
        eventsByLevel: { debug: 0, info: 0, warn: 0, error: 0 },
        eventsBySource: { background: 0, content_script: 0, options: 0 },
      },
    };
  }

  /** Loads the options page script in its own window, so that its listeners and timers stop with it. */
  async function mountOptionsPage(): Promise<HTMLElement> {
    sent = [];
    snapshotAvailable = true;
    storageWrite = Promise.resolve();
    const storage: Record<string, unknown> = {};
    dom = new JSDOM(
      '<!doctype html><body><ul id="tab-container"></ul><div id="content"></div><div id="observabilityRoot"></div></body>',
      {
        pretendToBeVisual: true,
        url: "https://options.test/options.html",
        // Drop jsdom "not implemented" reports, for example for canvas.
        virtualConsole: new VirtualConsole(),
      },
    );
    const win = dom.window;
    restoreGlobals = installJsdom(dom, {
      location: win.location,
      history: win.history,
      localStorage: win.localStorage,
      HTMLInputElement: win.HTMLInputElement,
      HTMLSelectElement: win.HTMLSelectElement,
      __FT_DEV_BUILD__: true,
      __FT_OBSERVABILITY_CONFIG__: undefined,
      __FT_OBSERVABILITY_SINK__: undefined,
      __FT_OBSERVABILITY_SOURCE__: undefined,
      chrome: {
        runtime: {
          lastError: undefined,
          getManifest: () => ({ version: "1.0.0" }),
          onMessage: { addListener: () => {} },
          sendMessage: (message: SentMessage, callback?: (response: unknown) => void) => {
            sent.push(message);
            const response =
              message.command === "CMD_OPTIONS_GET_OBSERVABILITY_SNAPSHOT" ? snapshot() : undefined;
            callback?.(response);
            return Promise.resolve(response);
          },
        },
        storage: {
          local: {
            get: (key: string | null, done: (items: Record<string, unknown>) => void) =>
              done(key === null ? { ...storage } : { [key]: storage[key] }),
            set: (items: Record<string, unknown>, done?: () => void) =>
              storageWrite.then(() => {
                Object.assign(storage, items);
                done?.();
              }),
            remove: (key: string, done?: () => void) => {
              delete storage[key];
              done?.();
            },
          },
        },
      },
    });
    win.HTMLElement.prototype.scrollIntoView = () => {};
    win.scrollTo = () => {};
    pageNonce += 1;
    await import(`../src/ui/options/settings.ts?options_page=${pageNonce}`);
    win.dispatchEvent(new win.Event("DOMContentLoaded"));
    await flushPage();
    return document.getElementById("observabilityRoot")!;
  }

  afterEach(() => {
    dom.window.close();
    restoreGlobals();
  });

  test("settings import tells the background only after the storage write", async () => {
    await mountOptionsPage();
    let finishWrite = () => {};
    storageWrite = new Promise((resolve) => (finishWrite = resolve));
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept=".json"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(['{"store.settings.language":"\\"de_DE\\""}'], "settings.json")],
    });
    sent.length = 0;

    input.dispatchEvent(new window.Event("input"));
    await flushPage();
    expect(sent.filter((message) => message.command === CONFIG_CHANGE)).toHaveLength(0);

    finishWrite();
    await flushPage();
    expect(sent.filter((message) => message.command === CONFIG_CHANGE)).toHaveLength(1);
  });

  test("the module search box keeps focus and caret after a keystroke", async () => {
    const root = await mountOptionsPage();
    const selector = '[data-action="filter-observability-modules"]';
    const search = root.querySelector<HTMLInputElement>(selector)!;
    search.focus();
    search.value = "alp";
    search.setSelectionRange(3, 3);

    search.dispatchEvent(new window.Event("input", { bubbles: true }));

    const active = document.activeElement as HTMLInputElement;
    expect(active.matches(selector)).toBe(true);
    expect([active.value, active.selectionStart]).toEqual(["alp", 3]);
    expect(root.textContent).toContain("1 of 2 modules shown");
  });

  test("a good poll replaces the panel of an unavailable poll", async () => {
    const root = await mountOptionsPage();
    snapshotAvailable = false;
    window.dispatchEvent(new window.Event("focus"));
    await flushPage();
    expect(root.querySelector(".observability-status.is-error")).not.toBeNull();

    snapshotAvailable = true;
    window.dispatchEvent(new window.Event("focus"));
    await flushPage();

    expect(root.querySelector(".observability-status")).toBeNull();
    expect(root.querySelector(".observability-dashboard")).not.toBeNull();
  });

  test("the live status keeps the scope after a poll with the same snapshot", async () => {
    const root = await mountOptionsPage();
    const scope = root.querySelector<HTMLSelectElement>(
      '[data-action="set-observability-scope-domain"]',
    )!;
    scope.value = "a.test";
    scope.dispatchEvent(new window.Event("change", { bubbles: true }));
    (document.activeElement as HTMLElement | null)?.blur();

    window.dispatchEvent(new window.Event("focus"));
    await flushPage();

    expect(root.querySelector("[data-observability-live-status]")?.textContent).toContain(
      "scope a.test",
    );
  });
});
