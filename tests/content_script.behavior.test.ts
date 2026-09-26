import { jest, mock } from "bun:test";
import {
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS,
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_POPUP_PAGE_DISABLE,
  CMD_POPUP_PAGE_ENABLE,
  CMD_STATUS_COMMAND,
  CMD_REVIEW_FT_ACTIVE_TAB,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "../src/core/domain/constants";
import { ContentRuntimeController } from "../src/adapters/chrome/content-script/ContentRuntimeController";
import { REVIEW_SUPPORTED_RULE_IDS } from "../src/core/domain/grammar/review/reviewCatalog";
import {
  EARLY_TAB_ACCEPT_MESSAGE_TYPE,
  EARLY_TAB_ACCEPT_REQUEST_EVENT,
} from "../src/adapters/chrome/content-script/suggestions/EarlyTabAcceptBridgeProtocol";

type SuggestionLike = {
  queryAndAttachHelper: jest.Mock;
  detachAllHelpers: jest.Mock;
  removeHelpersNotInDocument: jest.Mock;
  updateLangConfig: jest.Mock;
  triggerActiveSuggestion: jest.Mock;
  fulfillPrediction: jest.Mock;
  handleEarlyTabAcceptRequest: jest.Mock;
  autocompleteSeparator?: RegExp;
  options?: { enabledGrammarRules?: string[] };
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
    suggestionManager: SuggestionLike | null;
    handleGetPrediction: (context: Record<string, unknown>) => void;
    messageHandler: (
      message: { command: string; context?: Record<string, unknown> } | null,
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
  suggestionInstances: SuggestionLike[];
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
    insertSpaceAfterAutocomplete: true,
    lang: "en_US",
    selectByDigit: true,
    minWordLengthToPredict: 1,
    displayLangHeader: true,
    inline_suggestion: false,
    preferNativeAutocomplete: true,
    themeConfig: undefined,
    ...overrides,
  };
}

const behaviorHarness = {
  fluentTyperInstances: [] as LoadedContentScript["fluentTyper"][],
  suggestionInstances: [] as SuggestionLike[],
  domObserverInstances: [] as DomObserverLike[],
  checkLastError: jest.fn(),
  sendMessage: jest.fn(),
};

jest.unstable_mockModule("../src/core/application/transport-utils", () => ({
  checkLastError: (...args: []) => behaviorHarness.checkLastError(...args),
}));

jest.unstable_mockModule("../src/core/application/dom-utils", () => ({
  isInDocument: (element: Element) => {
    let root = element.getRootNode();
    while (root !== document && "host" in root) {
      root = (root as ShadowRoot).host.getRootNode();
    }
    return root === document;
  },
  getDeepActiveElement: (doc: Document) => doc.activeElement,
}));

jest.unstable_mockModule(
  "../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime",
  () => ({
    SuggestionManagerRuntime: jest.fn().mockImplementation((options: SuggestionLike["options"]) => {
      const instance: SuggestionLike = {
        options,
        queryAndAttachHelper: jest.fn(() => false),
        detachAllHelpers: jest.fn(),
        removeHelpersNotInDocument: jest.fn(),
        updateLangConfig: jest.fn(),
        triggerActiveSuggestion: jest.fn(),
        fulfillPrediction: jest.fn(),
        handleEarlyTabAcceptRequest: jest.fn(() => false),
      };
      behaviorHarness.suggestionInstances.push(instance);
      return instance;
    }),
  }),
);

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
  behaviorHarness.suggestionInstances.length = 0;
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
    suggestionInstances: behaviorHarness.suggestionInstances,
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
    const { fluentTyper, suggestionInstances, domObserverInstances } = await loadContentScript();
    const domObserver = domObserverInstances[0];

    fluentTyper.enabled = true;
    expect(suggestionInstances).toHaveLength(1);
    expect(suggestionInstances[0].queryAndAttachHelper).toHaveBeenCalled();
    expect(domObserver.attach).toHaveBeenCalled();

    fluentTyper.enabled = false;
    expect(domObserver.disconnect).toHaveBeenCalled();
    expect(suggestionInstances[0].detachAllHelpers).toHaveBeenCalled();
  });

  test("reports live runtime status when the active content runtime starts", async () => {
    const { fluentTyper, sendMessage } = await loadContentScript();

    fluentTyper.enable();

    expect(sendMessage.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        command: CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS,
        context: expect.objectContaining({
          runtimeGeneration: 1,
          domainURL: window.location.hostname || undefined,
        }),
      }),
    );
  });

  test("consumes early Tab bridge requests when suggestion acceptance succeeds", async () => {
    const { fluentTyper, suggestionInstances } = await loadContentScript();

    fluentTyper.enable();
    const suggestionManager = suggestionInstances[0];
    suggestionManager.handleEarlyTabAcceptRequest.mockReturnValue(true);

    const event = new window.MessageEvent("message", {
      source: window,
      data: {
        source: EARLY_TAB_ACCEPT_REQUEST_EVENT,
        type: EARLY_TAB_ACCEPT_MESSAGE_TYPE,
        entryId: "17",
      },
    });
    window.dispatchEvent(event);

    expect(suggestionManager.handleEarlyTabAcceptRequest).toHaveBeenCalledWith("17");
  });

  test("consumes early Tab bridge requests even when message source is not the page window", async () => {
    const { fluentTyper, suggestionInstances } = await loadContentScript();

    fluentTyper.enable();
    const suggestionManager = suggestionInstances[0];
    suggestionManager.handleEarlyTabAcceptRequest.mockReturnValue(true);

    const channel = new MessageChannel();
    const event = new window.MessageEvent("message", {
      source: channel.port1,
      data: {
        source: EARLY_TAB_ACCEPT_REQUEST_EVENT,
        type: EARLY_TAB_ACCEPT_MESSAGE_TYPE,
        entryId: "23",
      },
    });
    window.dispatchEvent(event);

    expect(suggestionManager.handleEarlyTabAcceptRequest).toHaveBeenCalledWith("23");
  });

  test("handleGetPrediction sends request and matching response fulfills prediction", async () => {
    const { fluentTyper, suggestionInstances, sendMessage } = await loadContentScript();

    fluentTyper.enable();
    document.documentElement.lang = "fr-FR";
    const suggestionManager = suggestionInstances[0];

    fluentTyper.handleGetPrediction({
      text: "hel",
      nextChar: "",
      suggestionId: 3,
      requestId: 10,
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "CMD_CONTENT_SCRIPT_PREDICT_REQ",
        context: expect.objectContaining({
          suggestionId: 3,
          requestId: 10,
          lang: "en_US",
          documentLang: "fr-FR",
          traceId: expect.any(String),
          traceStartedAtMs: expect.any(Number),
        }),
      }),
    );
    const firstRequest = sendMessage.mock.calls.at(-1)?.[0] as
      { context?: { runtimeGeneration?: number } } | undefined;
    const runtimeGeneration = firstRequest?.context?.runtimeGeneration;
    expect(typeof runtimeGeneration).toBe("number");

    fluentTyper.messageHandler({
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: { suggestionId: 3, requestId: 10, runtimeGeneration, predictions: ["hello"] },
    });
    expect(suggestionManager.fulfillPrediction).toHaveBeenCalledWith(
      expect.objectContaining({ predictions: ["hello"] }),
    );

    suggestionManager.fulfillPrediction.mockClear();
    fluentTyper.messageHandler({
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: { suggestionId: 3, requestId: 11, runtimeGeneration, predictions: ["ignored"] },
    });
    expect(suggestionManager.fulfillPrediction).toHaveBeenCalledWith(
      expect.objectContaining({ suggestionId: 3, requestId: 11, predictions: ["ignored"] }),
    );
  });

  test("handleGetPrediction forwards inputAction metadata", async () => {
    const { fluentTyper, sendMessage } = await loadContentScript();
    fluentTyper.enable();
    document.documentElement.lang = "de";

    fluentTyper.handleGetPrediction({
      text: "Hello.",
      nextChar: "",
      afterCursorTokenSuffix: "world",
      inputAction: "delete",
      suggestionId: 3,
      requestId: 10,
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "CMD_CONTENT_SCRIPT_PREDICT_REQ",
        context: expect.objectContaining({
          text: "Hello.",
          afterCursorTokenSuffix: "world",
          inputAction: "delete",
          suggestionId: 3,
          requestId: 10,
          documentLang: "de",
        }),
      }),
    );
  });

  test("matching response preserves reentrant prediction request created during fulfillPrediction", async () => {
    const { fluentTyper, suggestionInstances, sendMessage } = await loadContentScript();

    fluentTyper.enable();
    const suggestionManager = suggestionInstances[0];

    fluentTyper.handleGetPrediction({
      text: "h",
      nextChar: "",
      suggestionId: 3,
      requestId: 1,
    });
    const firstRequest = sendMessage.mock.calls.at(-1)?.[0] as
      { context?: { runtimeGeneration?: number } } | undefined;
    const runtimeGeneration = firstRequest?.context?.runtimeGeneration;
    expect(typeof runtimeGeneration).toBe("number");

    sendMessage.mockClear();
    suggestionManager.fulfillPrediction.mockImplementationOnce(() => {
      fluentTyper.handleGetPrediction({
        text: "H",
        nextChar: "",
        suggestionId: 3,
        requestId: 2,
      });
    });

    fluentTyper.messageHandler({
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: {
        suggestionId: 3,
        requestId: 1,
        runtimeGeneration,
        predictions: [],
      },
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "CMD_CONTENT_SCRIPT_PREDICT_REQ",
        context: expect.objectContaining({
          suggestionId: 3,
          requestId: 2,
        }),
      }),
    );

    fluentTyper.messageHandler({
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: { suggestionId: 3, requestId: 2, runtimeGeneration, predictions: ["hello"] },
    });

    expect(suggestionManager.fulfillPrediction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ suggestionId: 3, requestId: 2, predictions: ["hello"] }),
    );
  });

  test("drops stale prediction responses after runtime restart when generation changes", async () => {
    const { fluentTyper, suggestionInstances, sendMessage } = await loadContentScript();
    fluentTyper.enabled = true;

    const firstManager = suggestionInstances[0];
    fluentTyper.handleGetPrediction({
      text: "old",
      nextChar: "",
      suggestionId: 1,
      requestId: 1,
    });
    const firstGeneration = (
      sendMessage.mock.calls.at(-1)?.[0] as { context?: { runtimeGeneration?: number } } | undefined
    )?.context?.runtimeGeneration;
    expect(typeof firstGeneration).toBe("number");

    fluentTyper.restart();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(suggestionInstances.length).toBeGreaterThanOrEqual(2);
    const restartedManager = suggestionInstances[suggestionInstances.length - 1];
    expect(restartedManager).not.toBe(firstManager);

    sendMessage.mockClear();
    fluentTyper.handleGetPrediction({
      text: "new",
      nextChar: "",
      suggestionId: 1,
      requestId: 1,
    });
    const currentGeneration = (
      sendMessage.mock.calls.at(-1)?.[0] as { context?: { runtimeGeneration?: number } } | undefined
    )?.context?.runtimeGeneration;
    expect(typeof currentGeneration).toBe("number");
    expect(currentGeneration).not.toBe(firstGeneration);

    restartedManager.fulfillPrediction.mockClear();
    fluentTyper.messageHandler({
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: {
        suggestionId: 1,
        requestId: 1,
        runtimeGeneration: firstGeneration,
        predictions: [],
      },
    });
    expect(restartedManager.fulfillPrediction).not.toHaveBeenCalled();

    fluentTyper.messageHandler({
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: {
        suggestionId: 1,
        requestId: 1,
        runtimeGeneration: currentGeneration,
        predictions: ["correct"],
      },
    });
    expect(restartedManager.fulfillPrediction).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId: 1,
        requestId: 1,
        runtimeGeneration: currentGeneration,
        predictions: ["correct"],
      }),
    );
  });

  test("deduplicates rapid restart calls into a single disable-enable cycle", async () => {
    const { fluentTyper, suggestionInstances, domObserverInstances } = await loadContentScript();
    fluentTyper.enabled = true;

    const initialManager = suggestionInstances[0];
    const domObserver = domObserverInstances[0];
    initialManager.detachAllHelpers.mockClear();
    domObserver.disconnect.mockClear();
    domObserver.attach.mockClear();

    fluentTyper.restart();
    fluentTyper.restart();
    fluentTyper.restart();

    expect(initialManager.detachAllHelpers).toHaveBeenCalledTimes(1);
    expect(domObserver.disconnect).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(suggestionInstances).toHaveLength(2);
    const restartedManager = suggestionInstances[1];
    expect(restartedManager.queryAndAttachHelper).toHaveBeenCalledTimes(1);
    expect(restartedManager.triggerActiveSuggestion).toHaveBeenCalledTimes(1);
    expect(domObserver.attach).toHaveBeenCalledTimes(1);
  });

  test("setConfig applies theme and restarts when already enabled", async () => {
    const { fluentTyper, suggestionInstances } = await loadContentScript();

    fluentTyper.enabled = true;
    const initialManager = suggestionInstances[0];
    fluentTyper.setConfig(
      defaultConfig({
        enabled: true,
        themeConfig: {
          suggestionBgLight: "#ffffff",
          suggestionTextLight: "#000000",
          suggestionHighlightBgLight: "#dddddd",
          suggestionHighlightTextLight: "#111111",
          suggestionBorderLight: "#cccccc",
          suggestionBgDark: "#121212",
          suggestionTextDark: "#f4f4f4",
          suggestionHighlightBgDark: "#333333",
          suggestionHighlightTextDark: "#fafafa",
          suggestionBorderDark: "#555555",
          suggestionFontSize: "13px",
          suggestionPaddingVertical: "6px",
          suggestionPaddingHorizontal: "9px",
        },
      }),
    );

    const style = document.getElementById("fluent-typer-theme-overrides");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("--suggestion-bg-light: #ffffff");
    expect(style!.textContent).toContain("--ft-theme-suggestion-text-dark: #f4f4f4");
    expect(initialManager.detachAllHelpers).toHaveBeenCalled();
  });

  test("code mode passes only code-safe grammar rules to the suggestion manager", async () => {
    const { fluentTyper, suggestionInstances } = await loadContentScript();
    const enabledGrammarRules = [
      "capitalizeSentenceStart",
      "commaPeriodSpacing",
      "autoBracketClose",
    ];

    fluentTyper.setConfig(defaultConfig({ enabledGrammarRules }));
    expect(suggestionInstances.at(-1)?.options?.enabledGrammarRules).toEqual(enabledGrammarRules);

    fluentTyper.setConfig(defaultConfig({ enabledGrammarRules, codeMode: true }));
    // The runtime restarts on a timer once it is already enabled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(suggestionInstances.at(-1)?.options?.enabledGrammarRules).toEqual(["autoBracketClose"]);
  });

  test("review runs every review-supported rule whatever is on for typing; code mode leaves none", async () => {
    const { fluentTyper, suggestionInstances } = await loadContentScript();
    // The options the review controller reads when a review starts or rechecks.
    const reviewRules = () =>
      (
        fluentTyper as unknown as {
          runtimeController: {
            createReviewController(): { deps: { getOptions(): { enabledRules: string[] } } };
          };
        }
      ).runtimeController
        .createReviewController()
        .deps.getOptions().enabledRules;

    // Every rule off for typing ("Disable all"): typing gets none, review still runs all it supports.
    fluentTyper.setConfig(defaultConfig({ enabledGrammarRules: [] }));
    expect(suggestionInstances.at(-1)?.options?.enabledGrammarRules).toEqual([]);
    expect(reviewRules()).toEqual([...REVIEW_SUPPORTED_RULE_IDS]);
    expect(reviewRules()).toContain("duplicatePunctuationCollapse");

    fluentTyper.setConfig(
      defaultConfig({ enabledGrammarRules: ["capitalizeSentenceStart"], codeMode: true }),
    );
    expect(reviewRules()).toEqual([]);
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
      (response) => statusResponses.push(response),
    );
    expect(statusResponses[0]).toEqual({
      command: CMD_STATUS_COMMAND,
      context: { enabled: true },
    });
    const suggestionManager = fluentTyper.suggestionManager as SuggestionLike;

    fluentTyper.messageHandler(
      {
        command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
        context: { lang: "fr_FR" },
      },
      (response) => statusResponses.push(response),
    );
    expect(suggestionManager.updateLangConfig).toHaveBeenCalledWith("fr_FR");

    fluentTyper.messageHandler({ command: CMD_POPUP_PAGE_DISABLE, context: {} }, (response) =>
      statusResponses.push(response),
    );
    fluentTyper.messageHandler({ command: CMD_POPUP_PAGE_ENABLE, context: {} }, (response) =>
      statusResponses.push(response),
    );
    fluentTyper.messageHandler({ command: CMD_TOGGLE_FT_ACTIVE_TAB, context: {} }, (response) =>
      statusResponses.push(response),
    );
    fluentTyper.messageHandler({ command: CMD_TRIGGER_FT_ACTIVE_TAB, context: {} }, (response) =>
      statusResponses.push(response),
    );

    expect(suggestionManager.triggerActiveSuggestion).toHaveBeenCalled();
    expect(
      statusResponses.every(
        (response) => (response as { command?: string }).command === CMD_STATUS_COMMAND,
      ),
    ).toBe(true);
  });

  test("messageHandler routes Review text with its source and replies with status", async () => {
    const review = jest
      .spyOn(ContentRuntimeController.prototype, "reviewActiveEditor")
      .mockImplementation(() => undefined);
    try {
      const { fluentTyper } = await loadContentScript();
      fluentTyper.enable();
      const responses: unknown[] = [];
      fluentTyper.messageHandler(
        { command: CMD_REVIEW_FT_ACTIVE_TAB, context: { source: "popup" } },
        (response) => responses.push(response),
      );
      fluentTyper.messageHandler(
        { command: CMD_REVIEW_FT_ACTIVE_TAB, context: { source: "command" } },
        (response) => responses.push(response),
      );
      // Anything but the popup is treated as the keyboard command.
      fluentTyper.messageHandler({ command: CMD_REVIEW_FT_ACTIVE_TAB, context: {} }, (response) =>
        responses.push(response),
      );
      expect(review.mock.calls).toEqual([["popup"], ["command"], ["command"]]);
      expect(
        responses.every(
          (response) => (response as { command?: string }).command === CMD_STATUS_COMMAND,
        ),
      ).toBe(true);
    } finally {
      review.mockRestore();
    }
  });

  test("same-language runtime update does not thrash suggestion manager", async () => {
    const { fluentTyper } = await loadContentScript();
    fluentTyper.enable();
    const suggestionManager = fluentTyper.suggestionManager as SuggestionLike;

    fluentTyper.messageHandler({
      command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
      context: { lang: "en_US" },
    });

    expect(suggestionManager.updateLangConfig).not.toHaveBeenCalled();
  });

  test("processMutations reattaches helpers for added and attribute-target elements", async () => {
    const { fluentTyper, suggestionInstances, domObserverInstances } = await loadContentScript();
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
      suggestionInstances.some(
        (instance) => instance.removeHelpersNotInDocument.mock.calls.length > 0,
      ),
    ).toBe(true);

    const attachedTargets = suggestionInstances.flatMap((instance) =>
      instance.queryAndAttachHelper.mock.calls.map((call) => call[0]),
    );
    expect(attachedTargets).toContain(addedElement);
    expect(attachedTargets).toContain(attrTarget);
    expect(domObserver.attach).toHaveBeenCalled();
  });

  test("processMutations scans only top-level mutation roots when nodes are nested", async () => {
    const { fluentTyper, suggestionInstances } = await loadContentScript();
    fluentTyper.enable();
    const suggestionManager = suggestionInstances[0];
    suggestionManager.queryAndAttachHelper.mockClear();

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

    expect(suggestionManager.queryAndAttachHelper).toHaveBeenCalledTimes(1);
    expect(suggestionManager.queryAndAttachHelper).toHaveBeenCalledWith(parent);
  });

  test("processMutations falls back to full scan for very large mutation batches", async () => {
    const { fluentTyper, suggestionInstances } = await loadContentScript();
    fluentTyper.enable();
    const suggestionManager = suggestionInstances[0];
    suggestionManager.queryAndAttachHelper.mockClear();

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

    expect(suggestionManager.queryAndAttachHelper).toHaveBeenCalledTimes(1);
    expect(suggestionManager.queryAndAttachHelper).toHaveBeenCalledWith();
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

  test("watchdog prefers a host change over a node change and skips the DOM restart", async () => {
    const { fluentTyper, domObserverInstances } = await loadContentScript();
    const domObserver = domObserverInstances[0];
    const getConfigSpy = jest.spyOn(fluentTyper, "getConfig");

    (fluentTyper as unknown as { hostName: string }).hostName = "example.com";
    domObserver.getNode.mockReturnValue(document.createElement("div"));
    fluentTyper.enabled = true;
    domObserver.setNode.mockClear();

    fluentTyper.watchDog();

    expect(getConfigSpy).toHaveBeenCalled();
    expect(domObserver.setNode).not.toHaveBeenCalled();
  });

  test("watchdog does nothing when host and observed node are unchanged", async () => {
    const { fluentTyper, domObserverInstances } = await loadContentScript();
    const domObserver = domObserverInstances[0];
    const getConfigSpy = jest.spyOn(fluentTyper, "getConfig");

    domObserver.getNode.mockReturnValue(document.body || document.documentElement);
    domObserver.setNode.mockClear();

    fluentTyper.watchDog();

    expect(getConfigSpy).not.toHaveBeenCalled();
    expect(domObserver.setNode).not.toHaveBeenCalled();
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
