import { describe, expect, jest, test } from "bun:test";
import {
  LocalAiController,
  type LocalAiRequest,
  type LocalAiSettings,
} from "../src/adapters/chrome/background/localAi/LocalAiController";
import {
  CMD_LOCAL_AI_CANCEL_INSTALL,
  CMD_LOCAL_AI_DELETE_MODEL,
  CMD_LOCAL_AI_DISMISS_SETUP_OFFER,
  CMD_LOCAL_AI_ENSURE_HOST,
  CMD_LOCAL_AI_GET_STATUS,
  CMD_LOCAL_AI_INSTALL,
  CMD_LOCAL_AI_OPEN_SETUP,
  CMD_LOCAL_AI_STATUS_CHANGED,
} from "../src/core/domain/constants";
import type { EngineLike } from "../src/adapters/chrome/background/localAi/LocalAiHost";
import { LOCAL_AI_REVIEW_PORT } from "../src/core/domain/contracts/localAi";
import { LOCAL_AI_MODELS } from "../src/core/domain/localAi/modelRegistry";

const STANDARD = LOCAL_AI_MODELS[0];
const QUALITY = LOCAL_AI_MODELS[1];
const EXT = "chrome-extension://ftext/";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Consent = { modelId: string; tier: "standard" | "compact"; at: number } | null;

function makeSettings(
  initial: {
    enabled?: boolean;
    tier?: "standard" | "compact";
    consent?: Consent;
    dismissed?: boolean;
  } = {},
) {
  const state = {
    enabled: initial.enabled ?? true,
    tier: initial.tier ?? ("standard" as "standard" | "compact"),
    consent: initial.consent ?? null,
    dismissed: initial.dismissed ?? false,
  };
  const settings: LocalAiSettings = {
    getLocalAiReviewEnabled: async () => state.enabled,
    getLocalAiReviewTier: async () => state.tier,
    getLocalAiReviewConsent: async () => state.consent,
    setLocalAiReviewConsent: async (consent) => {
      state.consent = consent;
    },
    getLocalAiSetupOfferDismissed: async () => state.dismissed,
    setLocalAiSetupOfferDismissed: async (dismissed) => {
      state.dismissed = dismissed;
    },
  };
  return { settings, state };
}

class FakePort {
  messages: Array<Record<string, unknown>> = [];
  disconnect = jest.fn();
  onMessage = { addListener: () => undefined };
  onDisconnect = { addListener: () => undefined };
  constructor(
    readonly name: string,
    readonly sender: chrome.runtime.MessageSender,
  ) {}
  postMessage(message: unknown): void {
    this.messages.push(message as Record<string, unknown>);
  }
}

/** Nothing is cached, and an install stays in progress. */
function pendingEngine() {
  const calls: string[] = [];
  const results: Record<string, unknown> = { probe: null, cacheState: "none" };
  const engine = new Proxy(
    {},
    {
      get: (_target, name) => () => {
        calls.push(String(name));
        return name === "install"
          ? new Promise(() => undefined)
          : Promise.resolve(results[String(name)]);
      },
    },
  ) as EngineLike;
  return { engine, calls };
}

function makeChrome() {
  const connectListeners: Array<(port: chrome.runtime.Port) => void> = [];
  const storageListeners: Array<(changes: object, area: string) => void> = [];
  const api = {
    runtime: {
      id: "ftext",
      getURL: (path: string) => `${EXT}${path}`,
      getPlatformInfo: jest.fn(async () => ({})),
      sendMessage: jest.fn(async () => undefined),
      onConnect: {
        addListener: (listener: (port: chrome.runtime.Port) => void) =>
          connectListeners.push(listener),
      },
    },
    tabs: { create: jest.fn(async () => ({})) },
    storage: {
      onChanged: {
        addListener: (listener: (changes: object, area: string) => void) =>
          storageListeners.push(listener),
      },
    },
  };
  return {
    api: api as unknown as typeof chrome,
    raw: api,
    connect: (port: FakePort) =>
      connectListeners.forEach((listener) => listener(port as unknown as chrome.runtime.Port)),
    storageChanged: (key: string) =>
      storageListeners.forEach((listener) => listener({ [key]: {} }, "local")),
    listenerCounts: () => ({ connect: connectListeners.length, storage: storageListeners.length }),
  };
}

const contentScript: chrome.runtime.MessageSender = {
  id: "ftext",
  tab: { id: 7 } as chrome.tabs.Tab,
  url: "https://example.com/page",
};
// The options page opens in a tab, so `tab` is set; its URL is the extension's.
const optionsPage: chrome.runtime.MessageSender = {
  id: "ftext",
  tab: { id: 9 } as chrome.tabs.Tab,
  url: `${EXT}options/options.html#local-ai`,
};

function setup(settingsInit: Parameters<typeof makeSettings>[0] = {}, withEngine = true) {
  const { settings, state } = makeSettings(settingsInit);
  const chromeFake = makeChrome();
  const { engine, calls } = pendingEngine();
  const controller = new LocalAiController(settings, withEngine ? engine : null, chromeFake.api);
  controller.register();
  const send = (request: LocalAiRequest, sender = contentScript) =>
    controller.handleMessage(request, sender);
  return { controller, state, chromeFake, send, engineCalls: calls };
}

const consented: Consent = { modelId: STANDARD.modelId, tier: "standard", at: 1 };

describe("LocalAiController authorization", () => {
  test("content scripts cannot install, cancel, delete or probe", async () => {
    const { send, state, engineCalls } = setup();
    expect(await send({ command: CMD_LOCAL_AI_INSTALL, context: { tier: "standard" } })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await send({ command: CMD_LOCAL_AI_CANCEL_INSTALL })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await send({ command: CMD_LOCAL_AI_DELETE_MODEL, context: { modelId: STANDARD.modelId } }),
    ).toEqual({ ok: false, error: "forbidden" });
    const status = await send({ command: CMD_LOCAL_AI_GET_STATUS, context: { probe: true } });
    expect(status.ok).toBe(true);
    expect(state.consent).toBeNull();
    expect(engineCalls).toEqual([]);
  });

  test("the options page installs: consent is recorded, status is downloading at once", async () => {
    const { send, state, engineCalls } = setup();
    const response = await send(
      { command: CMD_LOCAL_AI_INSTALL, context: { tier: "standard" } },
      optionsPage,
    );
    expect(state.consent).toMatchObject({ modelId: STANDARD.modelId, tier: "standard" });
    expect(response).toMatchObject({
      ok: true,
      status: { consented: true, runtime: "downloading" },
    });
    await flush();
    expect(engineCalls).toContain("probe");
  });

  test("an install while another runs changes neither consent nor the running install", async () => {
    const { send, state } = setup();
    await send({ command: CMD_LOCAL_AI_INSTALL, context: { tier: "standard" } }, optionsPage);
    const response = await send(
      { command: CMD_LOCAL_AI_INSTALL, context: { tier: "compact" } },
      optionsPage,
    );
    expect(state.consent).toMatchObject({ modelId: STANDARD.modelId, tier: "standard" });
    expect(response).toMatchObject({
      ok: true,
      status: { modelId: STANDARD.modelId, runtime: "downloading" },
    });
  });

  test("delete keeps consent and preference", async () => {
    const { send, state, engineCalls } = setup({ consent: consented });
    await send(
      { command: CMD_LOCAL_AI_DELETE_MODEL, context: { modelId: STANDARD.modelId } },
      optionsPage,
    );
    await flush();
    expect(engineCalls).toContain("delete");
    expect(state.consent).toEqual(consented);
    expect(state.enabled).toBe(true);
    expect(
      await send({ command: CMD_LOCAL_AI_DELETE_MODEL, context: { modelId: "evil" } }, optionsPage),
    ).toEqual({ ok: false, error: "invalid" });
  });

  test("review ports are accepted only from this extension's content scripts", async () => {
    const { chromeFake } = setup({ consent: consented });
    const tab = { id: 1 } as chrome.tabs.Tab;
    const content = new FakePort(LOCAL_AI_REVIEW_PORT, { id: "ftext", tab, url: "https://a.b/" });
    const otherExtension = new FakePort(LOCAL_AI_REVIEW_PORT, {
      id: "evil",
      tab,
      url: "https://a.b/",
    });
    const noTab = new FakePort(LOCAL_AI_REVIEW_PORT, { id: "ftext", url: `${EXT}x.html` });
    const extensionPage = new FakePort(LOCAL_AI_REVIEW_PORT, {
      id: "ftext",
      tab,
      url: `${EXT}options/options.html`,
    });
    const otherName = new FakePort("something-else", { id: "evil" });
    for (const port of [content, otherExtension, noTab, extensionPage, otherName]) {
      chromeFake.connect(port);
    }
    await flush();
    expect(content.disconnect).not.toHaveBeenCalled();
    expect(content.messages[0]).toMatchObject({ type: "status" });
    for (const refused of [otherExtension, noTab, extensionPage]) {
      expect(refused.disconnect).toHaveBeenCalled();
      expect(refused.messages).toEqual([]);
    }
    expect(otherName.disconnect).not.toHaveBeenCalled();
    expect(otherName.messages).toEqual([]);
  });
});

describe("LocalAiController status", () => {
  test("nothing is probed or loaded at startup, before consent, or on a settings change alone", async () => {
    const { send, engineCalls, state, chromeFake } = setup();
    await send({ command: CMD_LOCAL_AI_GET_STATUS });
    await send({ command: CMD_LOCAL_AI_ENSURE_HOST });
    state.consent = consented;
    chromeFake.storageChanged("store.settings.localAiReviewConsent");
    await flush();
    expect(engineCalls).toEqual([]);
  });

  test("offer setup only when enabled, not consented, not dismissed and supported", async () => {
    const fresh = setup();
    expect((await fresh.controller.getStatus()).offerSetup).toBe(true);
    await fresh.send({ command: CMD_LOCAL_AI_DISMISS_SETUP_OFFER });
    expect((await fresh.controller.getStatus()).offerSetup).toBe(false);
    expect((await setup({ enabled: false }).controller.getStatus()).offerSetup).toBe(false);
    expect((await setup({ consent: consented }).controller.getStatus()).offerSetup).toBe(false);
  });

  test("consent is per tier and model", async () => {
    const switched = setup({ consent: consented, tier: "compact" });
    expect(await switched.controller.getStatus()).toMatchObject({
      consented: false,
      tier: "compact",
      modelId: QUALITY.modelId,
      install: "unknown",
    });
  });

  test("without an engine (Firefox) everything is host-unsupported", async () => {
    const firefox = setup({}, false);
    expect(firefox.chromeFake.listenerCounts()).toEqual({ connect: 0, storage: 0 });
    expect(await firefox.controller.getStatus()).toMatchObject({
      runtime: "unavailable",
      unavailable: "host-unsupported",
      offerSetup: false,
    });
    expect(
      await firefox.send(
        { command: CMD_LOCAL_AI_INSTALL, context: { tier: "standard" } },
        optionsPage,
      ),
    ).toEqual({ ok: false, error: "unavailable" });
  });

  test("open setup opens the options page at the Local AI section", async () => {
    const { send, chromeFake } = setup();
    await send({ command: CMD_LOCAL_AI_OPEN_SETUP });
    expect(chromeFake.raw.tabs.create).toHaveBeenCalledWith({
      url: `${EXT}options/options.html#local-ai`,
    });
  });

  test("a status change is broadcast to extension pages", async () => {
    const { send, chromeFake } = setup();
    await send({ command: CMD_LOCAL_AI_INSTALL, context: { tier: "standard" } }, optionsPage);
    await flush();
    expect(chromeFake.raw.runtime.sendMessage).toHaveBeenCalledWith({
      command: CMD_LOCAL_AI_STATUS_CHANGED,
      context: { status: expect.objectContaining({ runtime: "downloading" }) },
    });
  });
});
