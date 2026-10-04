import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SettingsEngine, type SettingsRegistry } from "../src/ui/settings-engine/SettingsEngine.js";
import { Store } from "../src/core/application/storage/Store.js";
import { manifest } from "../src/ui/options/settingsManifest.js";
import { renderGrammarWorkspacePanel } from "../src/ui/options/GrammarWorkspacePanel.js";
import { wireRuntimeSettingsHandlers } from "../src/ui/options/settings.js";
import {
  CMD_LOCAL_AI_CANCEL_INSTALL,
  CMD_LOCAL_AI_DELETE_MODEL,
  CMD_LOCAL_AI_GET_STATUS,
  CMD_LOCAL_AI_INSTALL,
  CMD_LOCAL_AI_STATUS_CHANGED,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  KEY_LOCAL_AI_REVIEW_ENABLED,
} from "../src/core/domain/constants";
import type { LocalAiStatus } from "../src/core/domain/contracts/localAi";

type SentMessage = { command: string; context?: Record<string, unknown> };

const NOT_SET_UP: LocalAiStatus = {
  enabled: true,
  consented: false,
  tier: "standard",
  modelId: "gemma-4-E4B-it-onnx-q4f16@843f250f",
  displayName: "Recommended (Gemma 4 E4B)",
  downloadBytes: 968_001_536,
  install: "none",
  runtime: "download-required",
  offerSetup: true,
};

let sent: SentMessage[];
let listeners: Array<(message: unknown) => void>;
let storage: Record<string, unknown>;
let currentStatus: LocalAiStatus;
/** While set, Local AI command replies (snapshotted at send time) wait for it. */
let replyGate: Promise<void> | null = null;
const originalChrome = (globalThis as { chrome?: unknown }).chrome;

function installFakeChrome(): void {
  sent = [];
  listeners = [];
  storage = {};
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (message: SentMessage, callback?: (response: unknown) => void) => {
        sent.push(message);
        const response = message.command.startsWith("CMD_LOCAL_AI_")
          ? { ok: true, status: currentStatus }
          : undefined;
        const reply = () => {
          callback?.(response);
          return response;
        };
        return replyGate ? replyGate.then(reply) : Promise.resolve(reply());
      },
      onMessage: { addListener: (fn: (message: unknown) => void) => listeners.push(fn) },
    },
    storage: {
      local: {
        get: (key: string | null, done: (items: Record<string, unknown>) => void) =>
          done(key === null ? { ...storage } : { [key]: storage[key] }),
        set: (items: Record<string, unknown>, done?: () => void) => {
          Object.assign(storage, items);
          done?.();
        },
        remove: (key: string, done?: () => void) => {
          delete storage[key];
          done?.();
        },
      },
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function renderOptions(): Promise<{ registry: SettingsRegistry; card: HTMLElement }> {
  const tabs = document.createElement("ul");
  const main = document.createElement("main");
  main.className = "options-main";
  const content = document.createElement("div");
  main.appendChild(content);
  document.body.append(tabs, main);

  const settings = [
    { tab: "core_settings", group: "General", name: "intro", type: "description", text: "x" },
    ...manifest.settings.filter((setting) => setting.tab === "grammar_tab"),
  ] as typeof manifest.settings;
  const defaults: Record<string, unknown> = {};
  for (const setting of settings) {
    if (setting.name !== undefined && "default" in setting) {
      defaults[setting.name] = setting.default;
    }
  }
  const engine = new SettingsEngine({
    container: { tabs, content },
    store: new Store("settings", defaults),
  });
  const registry = engine.buildFromManifest({
    name: "Test",
    tabs: manifest.tabs.filter((tab) => tab.id === "core_settings" || tab.id === "grammar_tab"),
    settings,
  });
  renderGrammarWorkspacePanel(registry.grammarWorkspacePanel.element, registry);
  wireRuntimeSettingsHandlers(registry);
  await flush();
  return { registry, card: document.getElementById("local-ai")! };
}

function visibleButton(card: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...card.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => !button.hidden && button.textContent?.startsWith(label),
  );
}

function statusText(card: HTMLElement): string {
  return card.querySelector('[role="status"]')?.textContent ?? "";
}

function broadcast(status: LocalAiStatus): void {
  currentStatus = status;
  for (const listener of listeners) {
    listener({ command: CMD_LOCAL_AI_STATUS_CHANGED, context: { status } });
  }
}

function localAiCommands(): SentMessage[] {
  return sent.filter((message) => message.command.startsWith("CMD_LOCAL_AI_"));
}

beforeEach(() => {
  currentStatus = NOT_SET_UP;
  installFakeChrome();
});

afterEach(() => {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  (globalThis as { chrome?: unknown }).chrome = originalChrome;
  if (window.location.hash) {
    window.location.hash = "";
  }
});

describe("Local AI settings section", () => {
  test("page load only asks for a probed status and offers an explicit install", async () => {
    const { card } = await renderOptions();

    expect(sent).toEqual([{ command: CMD_LOCAL_AI_GET_STATUS, context: { probe: true } }]);
    expect(statusText(card)).toContain("Not set up yet");
    expect(visibleButton(card, "Download and enable (≈ 4.92 GB)")).toBeDefined();
    expect(card.textContent).toContain("Hugging Face");
    expect(card.textContent).toContain("runs on your GPU while a review is open");
    expect(card.querySelectorAll('input[type="radio"]')).toHaveLength(2);
  });

  test("probes only once the section becomes visible", async () => {
    let notify: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      constructor(callback: typeof notify) {
        notify = callback;
      }
      observe(): void {}
      disconnect(): void {}
    };
    const { card } = await renderOptions();

    expect(localAiCommands()).toEqual([]);
    expect(statusText(card)).toContain("Checking Local AI status");
    notify?.([{ isIntersecting: true }]);
    await flush();
    expect(localAiCommands()).toEqual([
      { command: CMD_LOCAL_AI_GET_STATUS, context: { probe: true } },
    ]);
  });

  test("the toggle and tier write settings and refresh config without downloading", async () => {
    const { registry, card } = await renderOptions();
    sent.length = 0;

    const toggle = registry[KEY_LOCAL_AI_REVIEW_ENABLED].element as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    toggle.click();
    await flush();
    expect(storage["store.settings.localAiReviewEnabled"]).toBe("false");
    expect(sent.map((message) => message.command)).toEqual([CMD_OPTIONS_PAGE_CONFIG_CHANGE]);

    const quality = card.querySelector<HTMLInputElement>('input[value="compact"]')!;
    quality.click();
    await flush();
    expect(storage["store.settings.localAiReviewTier"]).toBe('"compact"');
    expect(sent.map((message) => message.command)).toEqual([
      CMD_OPTIONS_PAGE_CONFIG_CHANGE,
      CMD_OPTIONS_PAGE_CONFIG_CHANGE,
    ]);
    expect(statusText(card)).toContain("Compact (Qwen3 4B Instruct 2507) isn't installed yet");
    expect(visibleButton(card, "Download and enable (≈ 2.9 GB)")).toBeDefined();
  });

  test("install needs the inline confirm and sends the selected tier only after it", async () => {
    const { registry, card } = await renderOptions();
    (registry[KEY_LOCAL_AI_REVIEW_ENABLED].element as HTMLInputElement).click();
    card.querySelector<HTMLInputElement>('input[value="compact"]')!.click();
    await flush();
    sent.length = 0;

    const install = visibleButton(card, "Download and enable")!;
    install.click();
    expect(localAiCommands()).toEqual([]);
    const confirm = card.querySelector<HTMLElement>(".local-ai-confirm")!;
    expect(confirm.hidden).toBe(false);
    expect(confirm.textContent).toContain("2.9 GB");
    expect(confirm.textContent).toContain("huggingface.co");

    visibleButton(card, "Not now")!.click();
    expect(confirm.hidden).toBe(true);
    expect(document.activeElement).toBe(install);
    expect(localAiCommands()).toEqual([]);

    install.click();
    visibleButton(card, "Download")!.click();
    await flush();
    expect(localAiCommands()).toEqual([
      { command: CMD_LOCAL_AI_INSTALL, context: { tier: "compact" } },
    ]);
    // "Download and enable" also switches the preference back on.
    expect(storage["store.settings.localAiReviewEnabled"]).toBe("true");
  });

  test("shows available offline only for a complete install; partial offers reinstall", async () => {
    const { card } = await renderOptions();

    broadcast({ ...NOT_SET_UP, consented: true, install: "partial", runtime: "unconfigured" });
    expect(statusText(card)).toContain("Download incomplete");
    expect(statusText(card)).not.toContain("available offline");
    expect(visibleButton(card, "Install again (≈ 4.92 GB)")).toBeDefined();

    broadcast({ ...NOT_SET_UP, consented: true, install: "complete", runtime: "ready" });
    expect(statusText(card)).toBe("Installed — available offline.");
    expect(visibleButton(card, "Download and enable")).toBeUndefined();
    expect(visibleButton(card, "Delete model")).toBeDefined();

    broadcast({ ...NOT_SET_UP, consented: true, install: "none", runtime: "download-required" });
    expect(statusText(card)).toContain("no longer on this device");

    broadcast({ ...NOT_SET_UP, consented: true, install: "partial", error: "download-failed" });
    expect(statusText(card)).toContain("The download failed.");
  });

  test("a command reply older than a pushed status does not overwrite it", async () => {
    let release!: () => void;
    replyGate = new Promise((resolve) => (release = resolve));
    try {
      const { card } = await renderOptions();
      // The probe's reply (not set up) is still on its way when the install completes.
      broadcast({ ...NOT_SET_UP, consented: true, install: "complete", runtime: "ready" });
      release();
      await flush();
      expect(statusText(card)).toBe("Installed — available offline.");
    } finally {
      replyGate = null;
    }
  });

  test("an unsupported browser or device hides install controls and explains why", async () => {
    currentStatus = { ...NOT_SET_UP, runtime: "unavailable", unavailable: "host-unsupported" };
    const { card } = await renderOptions();

    expect(statusText(card)).toContain("Firefox");
    expect(visibleButton(card, "Download and enable")).toBeUndefined();
    expect(card.querySelector<HTMLElement>(".local-ai-models")!.hidden).toBe(true);

    broadcast({ ...NOT_SET_UP, runtime: "unavailable", unavailable: "missing-feature" });
    expect(statusText(card)).toContain("16-bit float shaders");
    expect(visibleButton(card, "Download and enable")).toBeUndefined();
  });

  test("delete asks inline and then sends the model id", async () => {
    currentStatus = { ...NOT_SET_UP, consented: true, install: "complete", runtime: "ready" };
    const { card } = await renderOptions();
    sent.length = 0;

    visibleButton(card, "Delete model")!.click();
    expect(localAiCommands()).toEqual([]);
    const confirm = card.querySelector<HTMLElement>(".local-ai-confirm")!;
    expect(confirm.textContent).toContain("keeps your preference");
    expect(confirm.textContent).toContain("nothing downloads automatically");

    visibleButton(card, "Delete model")!.click();
    await flush();
    expect(localAiCommands()).toEqual([
      {
        command: CMD_LOCAL_AI_DELETE_MODEL,
        context: { modelId: "gemma-4-E4B-it-onnx-q4f16@843f250f" },
      },
    ]);
  });

  test("download progress updates the bar without re-announcing, and can be cancelled", async () => {
    const { card } = await renderOptions();
    broadcast({ ...NOT_SET_UP, consented: true, runtime: "downloading", progress: 0.1 });
    const live = card.querySelector('[role="status"]')!;
    const firstText = live.firstChild;

    broadcast({ ...NOT_SET_UP, consented: true, runtime: "downloading", progress: 0.42 });
    const bar = card.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(live.firstChild).toBe(firstText);
    expect(visibleButton(card, "Download and enable")).toBeUndefined();

    sent.length = 0;
    visibleButton(card, "Cancel download")!.click();
    await flush();
    expect(localAiCommands()).toEqual([{ command: CMD_LOCAL_AI_CANCEL_INSTALL, context: {} }]);
  });

  test("an install's GPU load keeps Cancel; a Review's load does not offer it", async () => {
    const { card } = await renderOptions();
    broadcast({ ...NOT_SET_UP, consented: true, runtime: "loading", installing: true });
    sent.length = 0;
    visibleButton(card, "Cancel download")!.click();
    await flush();
    expect(localAiCommands()).toEqual([{ command: CMD_LOCAL_AI_CANCEL_INSTALL, context: {} }]);

    broadcast({ ...NOT_SET_UP, consented: true, install: "complete", runtime: "loading" });
    expect(visibleButton(card, "Cancel download")).toBeUndefined();
  });

  test("#local-ai opens the Grammar tab and focuses the section heading", async () => {
    window.location.hash = "#local-ai";
    const { card } = await renderOptions();

    expect(card.closest(".content-tab")?.classList.contains("is-active")).toBe(true);
    expect(document.activeElement).toBe(card.querySelector("h4"));
  });
});
