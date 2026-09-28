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
import {
  LOCAL_AI_HOST_PORT,
  LOCAL_AI_OFFSCREEN_PATH,
  LOCAL_AI_REVIEW_PORT,
} from "../src/core/domain/contracts/localAi";
import { LOCAL_AI_MODELS } from "../src/core/domain/localAi/modelRegistry";

const STANDARD = LOCAL_AI_MODELS[0];
const QUALITY = LOCAL_AI_MODELS[1];
const EXT = "chrome-extension://ftext/";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Consent = { modelId: string; tier: "standard" | "quality"; at: number } | null;

function makeSettings(
  initial: {
    enabled?: boolean;
    tier?: "standard" | "quality";
    consent?: Consent;
    dismissed?: boolean;
  } = {},
) {
  const state = {
    enabled: initial.enabled ?? true,
    tier: initial.tier ?? ("standard" as "standard" | "quality"),
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
  private readonly listeners: Array<(message: unknown) => void> = [];
  onMessage = {
    addListener: (listener: (message: unknown) => void) => this.listeners.push(listener),
  };
  onDisconnect = { addListener: () => undefined };
  constructor(
    readonly name: string,
    readonly sender: chrome.runtime.MessageSender,
  ) {}
  postMessage(message: unknown): void {
    this.messages.push(message as Record<string, unknown>);
  }
  emit(message: unknown): void {
    this.listeners.forEach((listener) => listener(message));
  }
}

function makeChrome(options: { offscreen?: boolean } = {}) {
  let documentOpen = false;
  const connectListeners: Array<(port: chrome.runtime.Port) => void> = [];
  const storageListeners: Array<(changes: object, area: string) => void> = [];
  const createDocument = jest.fn(async () => {
    await flush();
    documentOpen = true;
  });
  const closeDocument = jest.fn(async () => {
    documentOpen = false;
  });
  const api = {
    runtime: {
      id: "ftext",
      getURL: (path: string) => `${EXT}${path}`,
      getContexts: jest.fn(async () => (documentOpen ? [{}] : [])),
      sendMessage: jest.fn(async () => undefined),
      onConnect: {
        addListener: (listener: (port: chrome.runtime.Port) => void) =>
          connectListeners.push(listener),
      },
    },
    offscreen: options.offscreen === false ? undefined : { createDocument, closeDocument },
    tabs: { create: jest.fn(async () => ({})) },
    storage: {
      onChanged: {
        addListener: (listener: (changes: object, area: string) => void) =>
          storageListeners.push(listener),
      },
    },
  };
  const connect = (port: FakePort) =>
    connectListeners.forEach((listener) => listener(port as unknown as chrome.runtime.Port));
  const hostPort = () =>
    new FakePort(LOCAL_AI_HOST_PORT, { id: "ftext", url: `${EXT}${LOCAL_AI_OFFSCREEN_PATH}` });
  return {
    api: api as unknown as typeof chrome,
    raw: api,
    createDocument,
    closeDocument,
    connect,
    hostPort,
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

function setup(settingsInit: Parameters<typeof makeSettings>[0] = {}, chromeInit = {}) {
  const { settings, state } = makeSettings(settingsInit);
  const chromeFake = makeChrome(chromeInit);
  const controller = new LocalAiController(settings, chromeFake.api);
  controller.register();
  const send = (request: LocalAiRequest, sender = contentScript) =>
    controller.handleMessage(request, sender);
  return { controller, state, chromeFake, send };
}

const consented: Consent = { modelId: STANDARD.modelId, tier: "standard", at: 1 };

describe("LocalAiController authorization", () => {
  test("content scripts cannot install, cancel, delete or probe", async () => {
    const { send, chromeFake, state } = setup();
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
    expect(chromeFake.createDocument).not.toHaveBeenCalled();
  });

  test("the options page installs: consent is recorded first, then the host is told", async () => {
    const { send, chromeFake, state } = setup();
    const response = await send(
      { command: CMD_LOCAL_AI_INSTALL, context: { tier: "standard" } },
      optionsPage,
    );
    expect(state.consent).toMatchObject({ modelId: STANDARD.modelId, tier: "standard" });
    expect(response).toMatchObject({ ok: true, status: { consented: true } });
    expect(chromeFake.createDocument).toHaveBeenCalledTimes(1);
    expect(chromeFake.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: LOCAL_AI_OFFSCREEN_PATH, reasons: ["WORKERS"] }),
    );
    const host = chromeFake.hostPort();
    chromeFake.connect(host);
    await flush();
    expect(host.messages).toEqual([
      { type: "configure", model: { modelId: STANDARD.modelId, tier: "standard" }, enabled: true },
      { type: "install", tier: "standard" },
    ]);
  });

  test("delete keeps consent and preference", async () => {
    const { send, chromeFake, state } = setup({ consent: consented });
    const host = chromeFake.hostPort();
    chromeFake.connect(host);
    await send(
      { command: CMD_LOCAL_AI_DELETE_MODEL, context: { modelId: STANDARD.modelId } },
      optionsPage,
    );
    expect(host.messages.at(-1)).toEqual({ type: "delete-model", modelId: STANDARD.modelId });
    expect(state.consent).toEqual(consented);
    expect(state.enabled).toBe(true);
    expect(
      await send({ command: CMD_LOCAL_AI_DELETE_MODEL, context: { modelId: "evil" } }, optionsPage),
    ).toEqual({ ok: false, error: "invalid" });
  });

  test("the host port is accepted only from the offscreen document; review ports are ignored", async () => {
    const { chromeFake } = setup({ consent: consented });
    const fromPage = new FakePort(LOCAL_AI_HOST_PORT, {
      id: "ftext",
      tab: { id: 1 } as chrome.tabs.Tab,
      url: `${EXT}${LOCAL_AI_OFFSCREEN_PATH}`,
    });
    chromeFake.connect(fromPage);
    const wrongUrl = new FakePort(LOCAL_AI_HOST_PORT, {
      id: "ftext",
      url: `${EXT}options/options.html`,
    });
    chromeFake.connect(wrongUrl);
    const reviewPort = new FakePort(LOCAL_AI_REVIEW_PORT, {
      id: "ftext",
      tab: { id: 1 } as chrome.tabs.Tab,
      url: "https://example.com",
    });
    chromeFake.connect(reviewPort);
    await flush();
    expect(fromPage.disconnect).toHaveBeenCalled();
    expect(wrongUrl.disconnect).toHaveBeenCalled();
    expect(fromPage.messages).toEqual([]);
    expect(reviewPort.disconnect).not.toHaveBeenCalled();
    expect(reviewPort.messages).toEqual([]);
  });
});

describe("LocalAiController host lifecycle", () => {
  test("never creates the host at startup or before consent", async () => {
    const { send, chromeFake } = setup();
    await flush();
    expect(await send({ command: CMD_LOCAL_AI_ENSURE_HOST })).toMatchObject({ ok: true });
    await send({ command: CMD_LOCAL_AI_GET_STATUS });
    expect(chromeFake.createDocument).not.toHaveBeenCalled();
  });

  test("ENSURE_HOST with consent creates the document once (single-flight)", async () => {
    const { send, chromeFake } = setup({ consent: consented });
    const [a, b] = await Promise.all([
      send({ command: CMD_LOCAL_AI_ENSURE_HOST }),
      send({ command: CMD_LOCAL_AI_ENSURE_HOST }),
    ]);
    expect(a).toMatchObject({ ok: true, status: { consented: true } });
    expect(b.ok).toBe(true);
    expect(chromeFake.createDocument).toHaveBeenCalledTimes(1);
    await send({ command: CMD_LOCAL_AI_ENSURE_HOST });
    expect(chromeFake.createDocument).toHaveBeenCalledTimes(1);
  });

  test("ENSURE_HOST reports unavailable when the document cannot be created", async () => {
    const { send, chromeFake } = setup({ consent: consented });
    chromeFake.createDocument.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    expect(await send({ command: CMD_LOCAL_AI_ENSURE_HOST })).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  test("ENSURE_HOST with the preference off does nothing", async () => {
    const { send, chromeFake } = setup({ consent: consented, enabled: false });
    await send({ command: CMD_LOCAL_AI_ENSURE_HOST });
    expect(chromeFake.createDocument).not.toHaveBeenCalled();
  });

  test("host state drives status; idle closes the document", async () => {
    const { send, chromeFake } = setup({ consent: consented });
    await send({ command: CMD_LOCAL_AI_ENSURE_HOST });
    const host = chromeFake.hostPort();
    chromeFake.connect(host);
    host.emit({ type: "state", runtime: "ready", install: "complete", modelId: STANDARD.modelId });
    await flush();
    expect(chromeFake.raw.runtime.sendMessage).toHaveBeenCalledWith({
      command: CMD_LOCAL_AI_STATUS_CHANGED,
      context: { status: expect.objectContaining({ runtime: "ready", install: "complete" }) },
    });
    host.emit({ type: "idle" });
    await flush();
    expect(chromeFake.closeDocument).toHaveBeenCalledTimes(1);
    const status = await send({ command: CMD_LOCAL_AI_GET_STATUS });
    expect(status).toMatchObject({ ok: true, status: { runtime: "ready", install: "complete" } });
  });

  test("a preference change re-configures the host and broadcasts status", async () => {
    const { chromeFake, state } = setup({ consent: consented });
    const host = chromeFake.hostPort();
    chromeFake.connect(host);
    await flush();
    state.enabled = false;
    chromeFake.storageChanged("store.settings.localAiReviewEnabled");
    await flush();
    expect(host.messages.at(-1)).toEqual({ type: "configure", model: null, enabled: false });
    expect(chromeFake.raw.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: CMD_LOCAL_AI_STATUS_CHANGED }),
    );
  });
});

describe("LocalAiController status", () => {
  test("offer setup only when enabled, not consented, not dismissed and host supported", async () => {
    const fresh = setup();
    expect((await fresh.controller.getStatus()).offerSetup).toBe(true);
    await fresh.send({ command: CMD_LOCAL_AI_DISMISS_SETUP_OFFER });
    expect((await fresh.controller.getStatus()).offerSetup).toBe(false);
    expect((await setup({ enabled: false }).controller.getStatus()).offerSetup).toBe(false);
    expect((await setup({ consent: consented }).controller.getStatus()).offerSetup).toBe(false);
  });

  test("consent is per tier and model", async () => {
    const switched = setup({ consent: consented, tier: "quality" });
    expect(await switched.controller.getStatus()).toMatchObject({
      consented: false,
      tier: "quality",
      modelId: QUALITY.modelId,
      install: "unknown",
    });
  });

  test("without chrome.offscreen (Firefox) everything is host-unsupported", async () => {
    const firefox = setup({}, { offscreen: false });
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
    expect(await firefox.send({ command: CMD_LOCAL_AI_ENSURE_HOST })).toMatchObject({ ok: true });
  });

  test("open setup opens the options page at the Local AI section", async () => {
    const { send, chromeFake } = setup();
    await send({ command: CMD_LOCAL_AI_OPEN_SETUP });
    expect(chromeFake.raw.tabs.create).toHaveBeenCalledWith({
      url: `${EXT}options/options.html#local-ai`,
    });
  });
});
