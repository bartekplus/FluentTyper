import { jest, mock } from "bun:test";
import {
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_POPUP_PAGE_DISABLE,
  CMD_POPUP_PAGE_ENABLE,
  CMD_STATUS_COMMAND,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "../src/core/domain/constants";

type TributeLike = {
  queryAndAttachHelper: jest.Mock;
  detachAllHelpers: jest.Mock;
  removeHelpersNotInDocument: jest.Mock;
  updateLangConfig: jest.Mock;
  triggerActiveTribute: jest.Mock;
  fulfillPrediction: jest.Mock;
  autocompleteSeparator?: RegExp;
};

type DomObserverLike = {
  attach: jest.Mock;
  disconnect: jest.Mock;
  setNode: jest.Mock;
  getNode: jest.Mock;
};

type LoadedContentScript = {
  fluentTyper: {
    enabled: boolean;
    config: Record<string, unknown>;
    tributeManager: TributeLike | null;
    domObserver: DomObserverLike;
    handleGetPrediction: (context: Record<string, unknown>) => void;
    messageHandler: (
      message: { command: string; context: Record<string, unknown> } | null,
      sender?: chrome.runtime.MessageSender,
      sendResponse?: (response: unknown) => void,
    ) => void;
    processMutations: (mutations: MutationRecord[]) => void;
    watchDog: () => void;
    checkHostName: () => boolean;
    setConfig: (config: Record<string, unknown>) => void;
    getConfig: () => void;
    enable: () => void;
    disable: () => void;
    restart: () => void;
    destroy: () => void;
  };
  tributeInstances: TributeLike[];
  domObserverInstances: DomObserverLike[];
  checkLastError: jest.Mock;
  sendMessage: jest.Mock;
};

let importNonce = 0;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_content_behavior=${importNonce}`;
}

function defaultConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    autocomplete: true,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    lang: "en_US",
    selectByDigit: true,
    minWordLengthToPredict: 1,
    revertOnBackspace: true,
    displayLangHeader: true,
    inline_suggestion: false,
    themeConfig: undefined,
    ...overrides,
  };
}

const behaviorHarness = {
  fluentTyperInstances: [] as LoadedContentScript["fluentTyper"][],
  tributeInstances: [] as TributeLike[],
  domObserverInstances: [] as DomObserverLike[],
  checkLastError: jest.fn(),
  sendMessage: jest.fn(),
};

jest.unstable_mockModule("../src/core/application/transport-utils", () => ({
  checkLastError: (...args: []) => behaviorHarness.checkLastError(...args),
}));

jest.unstable_mockModule("../src/core/application/dom-utils", () => ({
  isInDocument: (element: Element) => document.contains(element),
}));

jest.unstable_mockModule("../src/adapters/chrome/content-script/TributeManager", () => ({
  TributeManager: jest.fn().mockImplementation(() => {
    const instance: TributeLike = {
      queryAndAttachHelper: jest.fn(),
      detachAllHelpers: jest.fn(),
      removeHelpersNotInDocument: jest.fn(),
      updateLangConfig: jest.fn(),
      triggerActiveTribute: jest.fn(),
      fulfillPrediction: jest.fn(),
    };
    behaviorHarness.tributeInstances.push(instance);
    return instance;
  }),
}));

jest.unstable_mockModule("../src/adapters/chrome/content-script/DomObserver", () => ({
  DomObserver: jest.fn().mockImplementation((initialNode: unknown) => {
    let currentNode = initialNode as Node;
    const instance: DomObserverLike = {
      attach: jest.fn(),
      disconnect: jest.fn(),
      setNode: jest.fn((nextNode: unknown) => {
        currentNode = nextNode as Node;
      }),
      getNode: jest.fn(() => currentNode),
    };
    behaviorHarness.domObserverInstances.push(instance);
    return instance;
  }),
}));

async function loadContentScript(): Promise<LoadedContentScript> {
  jest.clearAllMocks();
  behaviorHarness.tributeInstances.length = 0;
  behaviorHarness.domObserverInstances.length = 0;
  behaviorHarness.checkLastError = jest.fn();
  behaviorHarness.sendMessage = jest.fn();

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      sendMessage: behaviorHarness.sendMessage,
    },
  };
  (window as Window & { FluentTyper?: unknown }).FluentTyper = undefined;

  await import(freshModulePath("../src/adapters/chrome/content-script/content_script"));
  const fluentTyper = (window as Window & { FluentTyper?: LoadedContentScript["fluentTyper"] })
    .FluentTyper!;

  behaviorHarness.fluentTyperInstances.push(fluentTyper);

  return {
    fluentTyper,
    tributeInstances: behaviorHarness.tributeInstances,
    domObserverInstances: behaviorHarness.domObserverInstances,
    checkLastError: behaviorHarness.checkLastError,
    sendMessage: behaviorHarness.sendMessage,
  };
}

describe("content_script behavior", () => {
  afterEach(() => {
    for (const fluentTyper of behaviorHarness.fluentTyperInstances) {
      fluentTyper.destroy();
    }
    behaviorHarness.fluentTyperInstances.length = 0;
    document.body.innerHTML = "";
  });

  afterAll(() => {
    mock.restore();
  });

  test("enables and disables managers through state transitions", async () => {
    const { fluentTyper, tributeInstances, domObserverInstances } = await loadContentScript();
    const domObserver = domObserverInstances[0];

    fluentTyper.enabled = true;
    expect(tributeInstances).toHaveLength(1);
    expect(tributeInstances[0].queryAndAttachHelper).toHaveBeenCalled();
    expect(domObserver.attach).toHaveBeenCalled();

    fluentTyper.enabled = false;
    expect(domObserver.disconnect).toHaveBeenCalled();
    expect(tributeInstances[0].detachAllHelpers).toHaveBeenCalled();
  });

  test("handleGetPrediction sends request and matching response fulfills prediction", async () => {
    const { fluentTyper, tributeInstances, sendMessage } = await loadContentScript();

    fluentTyper.enable();
    const tribute = tributeInstances[0];

    fluentTyper.handleGetPrediction({
      text: "hel",
      nextChar: "",
      tributeId: 3,
      requestId: 10,
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "CMD_CONTENT_SCRIPT_PREDICT_REQ",
        context: expect.objectContaining({
          tributeId: 3,
          requestId: 10,
          lang: "en_US",
          traceId: expect.any(String),
          traceStartedAtMs: expect.any(Number),
        }),
      }),
    );

    fluentTyper.messageHandler({
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: { tributeId: 3, requestId: 10, predictions: ["hello"] },
    });
    expect(tribute.fulfillPrediction).toHaveBeenCalledWith(
      expect.objectContaining({ predictions: ["hello"] }),
    );

    tribute.fulfillPrediction.mockClear();
    fluentTyper.messageHandler({
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: { tributeId: 3, requestId: 11, predictions: ["ignored"] },
    });
    expect(tribute.fulfillPrediction).not.toHaveBeenCalled();
  });

  test("setConfig applies theme and restarts when already enabled", async () => {
    const { fluentTyper } = await loadContentScript();
    const restartSpy = jest.spyOn(fluentTyper, "restart");

    fluentTyper.enabled = true;
    fluentTyper.setConfig(
      defaultConfig({
        enabled: true,
        themeConfig: {
          tributeBgLight: "#ffffff",
          tributeTextLight: "#000000",
          tributeHighlightBgLight: "#dddddd",
          tributeHighlightTextLight: "#111111",
          tributeBorderLight: "#cccccc",
          tributeBgDark: "#121212",
          tributeTextDark: "#f4f4f4",
          tributeHighlightBgDark: "#333333",
          tributeHighlightTextDark: "#fafafa",
          tributeBorderDark: "#555555",
          tributeFontSize: "13px",
          tributePaddingVertical: "6px",
          tributePaddingHorizontal: "9px",
        },
      }),
    );

    const style = document.getElementById("fluent-typer-theme-overrides");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("--tribute-bg-light: #ffffff");
    expect(restartSpy).toHaveBeenCalled();
  });

  test("messageHandler handles config/lang/toggle/trigger commands and status replies", async () => {
    const { fluentTyper } = await loadContentScript();
    fluentTyper.enable();
    const statusResponses: unknown[] = [];

    fluentTyper.messageHandler(
      {
        command: CMD_BACKGROUND_PAGE_SET_CONFIG,
        context: defaultConfig({ enabled: true }),
      },
      undefined,
      (response) => statusResponses.push(response),
    );
    expect(statusResponses[0]).toEqual({
      command: CMD_STATUS_COMMAND,
      context: { enabled: true },
    });
    const tribute = fluentTyper.tributeManager as TributeLike;

    fluentTyper.messageHandler(
      {
        command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
        context: { lang: "fr_FR" },
      },
      undefined,
      (response) => statusResponses.push(response),
    );
    expect(tribute.updateLangConfig).toHaveBeenCalledWith("fr_FR");

    fluentTyper.messageHandler(
      { command: CMD_POPUP_PAGE_DISABLE, context: {} },
      undefined,
      (response) => statusResponses.push(response),
    );
    fluentTyper.messageHandler(
      { command: CMD_POPUP_PAGE_ENABLE, context: {} },
      undefined,
      (response) => statusResponses.push(response),
    );
    fluentTyper.messageHandler(
      { command: CMD_TOGGLE_FT_ACTIVE_TAB, context: {} },
      undefined,
      (response) => statusResponses.push(response),
    );
    fluentTyper.messageHandler(
      { command: CMD_TRIGGER_FT_ACTIVE_TAB, context: {} },
      undefined,
      (response) => statusResponses.push(response),
    );

    expect(tribute.triggerActiveTribute).toHaveBeenCalled();
    expect(
      statusResponses.every(
        (response) => (response as { command?: string }).command === CMD_STATUS_COMMAND,
      ),
    ).toBe(true);
  });

  test("processMutations reattaches helpers for added and attribute-target elements", async () => {
    const { fluentTyper, tributeInstances, domObserverInstances } = await loadContentScript();
    fluentTyper.enable();
    const domObserver = domObserverInstances[0];

    const addedElement = document.createElement("div");
    const attrTarget = document.createElement("span");
    document.body.appendChild(addedElement);
    document.body.appendChild(attrTarget);

    fluentTyper.processMutations([
      {
        type: "childList",
        addedNodes: [addedElement] as unknown as NodeList,
        target: document.body,
      } as unknown as MutationRecord,
      {
        type: "attributes",
        addedNodes: [] as unknown as NodeList,
        target: attrTarget,
      } as unknown as MutationRecord,
    ]);

    expect(domObserver.disconnect).toHaveBeenCalled();
    expect(
      tributeInstances.some(
        (instance) => instance.removeHelpersNotInDocument.mock.calls.length > 0,
      ),
    ).toBe(true);

    const attachedTargets = tributeInstances.flatMap((instance) =>
      instance.queryAndAttachHelper.mock.calls.map((call) => call[0]),
    );
    expect(attachedTargets).toContain(addedElement);
    expect(attachedTargets).toContain(attrTarget);
    expect(domObserver.attach).toHaveBeenCalled();
  });

  test("processMutations scans only top-level mutation roots when nodes are nested", async () => {
    const { fluentTyper, tributeInstances } = await loadContentScript();
    fluentTyper.enable();
    const tribute = tributeInstances[0];
    tribute.queryAndAttachHelper.mockClear();

    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);

    fluentTyper.processMutations([
      {
        type: "childList",
        addedNodes: [parent] as unknown as NodeList,
        target: document.body,
      } as unknown as MutationRecord,
      {
        type: "childList",
        addedNodes: [child] as unknown as NodeList,
        target: parent,
      } as unknown as MutationRecord,
      {
        type: "attributes",
        addedNodes: [] as unknown as NodeList,
        target: child,
      } as unknown as MutationRecord,
    ]);

    expect(tribute.queryAndAttachHelper).toHaveBeenCalledTimes(1);
    expect(tribute.queryAndAttachHelper).toHaveBeenCalledWith(parent);
  });

  test("processMutations falls back to full scan for very large mutation batches", async () => {
    const { fluentTyper, tributeInstances } = await loadContentScript();
    fluentTyper.enable();
    const tribute = tributeInstances[0];
    tribute.queryAndAttachHelper.mockClear();

    const largeBatch = Array.from({ length: 200 }, () => {
      const element = document.createElement("div");
      document.body.appendChild(element);
      return {
        type: "childList",
        addedNodes: [element] as unknown as NodeList,
        target: document.body,
      } as unknown as MutationRecord;
    });

    fluentTyper.processMutations(largeBatch);

    expect(tribute.queryAndAttachHelper).toHaveBeenCalledTimes(1);
    expect(tribute.queryAndAttachHelper).toHaveBeenCalledWith();
  });

  test("watchdog checks host/domain changes and restarts on node replacement", async () => {
    const { fluentTyper, domObserverInstances, sendMessage } = await loadContentScript();
    const domObserver = domObserverInstances[0];
    const restartSpy = jest.spyOn(fluentTyper, "restart");
    const getConfigSpy = jest.spyOn(fluentTyper, "getConfig");

    (fluentTyper as unknown as { hostName: string }).hostName = "example.com";
    expect(fluentTyper.checkHostName()).toBe(true);
    expect(getConfigSpy).toHaveBeenCalled();

    (fluentTyper as unknown as { hostName: string }).hostName = window.location.hostname;
    domObserver.getNode.mockReturnValue(document.createElement("div"));
    fluentTyper.enabled = true;
    fluentTyper.watchDog();

    expect(restartSpy).toHaveBeenCalled();
    expect(domObserver.setNode).toHaveBeenCalledWith(document.body || document.documentElement);
    expect(sendMessage).toHaveBeenCalled();
  });

  test("getConfig requests config and passes callback response to messageHandler", async () => {
    const { fluentTyper, sendMessage, checkLastError } = await loadContentScript();
    const messageHandlerSpy = jest.spyOn(fluentTyper, "messageHandler");

    sendMessage.mockImplementation((_message: unknown, callback?: unknown) => {
      if (typeof callback === "function") {
        callback({
          command: CMD_BACKGROUND_PAGE_SET_CONFIG,
          context: defaultConfig({ enabled: false }),
        });
      }
    });

    fluentTyper.getConfig();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: CMD_CONTENT_SCRIPT_GET_CONFIG }),
      expect.any(Function),
    );
    expect(messageHandlerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ command: CMD_BACKGROUND_PAGE_SET_CONFIG }),
    );
    expect(checkLastError).toHaveBeenCalled();
  });

  test("messageHandler handles empty and unknown messages safely", async () => {
    const { fluentTyper } = await loadContentScript();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    fluentTyper.messageHandler(null);
    fluentTyper.messageHandler({ command: "UNKNOWN_COMMAND", context: {} });

    expect(errorSpy).toHaveBeenCalled();
  });
});
