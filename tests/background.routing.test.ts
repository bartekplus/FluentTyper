import { jest, mock } from "bun:test";
import {
  CMD_BACKGROUND_PAGE_PREDICT_REQ,
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS,
  CMD_CONTENT_SCRIPT_USAGE_EVENT,
  CMD_GET_AUTO_LANGUAGE_STATUS,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_POPUP_ACK_WEEKLY_RECAP,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  DEFAULT_AI_PREDICTION_TIMEOUT_MS,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_LANGUAGE,
  KEY_SITE_PROFILES,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
} from "../src/core/domain/constants";

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

class MockConfigError extends Error {
  readonly kind = "config";
  readonly code: string;

  constructor(message: string, details: { code: string; cause?: unknown }) {
    super(message);
    this.name = "ConfigError";
    this.code = details.code;
  }
}

class MockTransportError extends Error {
  readonly kind = "transport";
  readonly code: string;

  constructor(message: string, details: { code: string; cause?: unknown }) {
    super(message);
    this.name = "TransportError";
    this.code = details.code;
  }
}

class MockPredictorError extends Error {
  readonly kind = "predictor";
  readonly code: string;

  constructor(message: string, details: { code: string; cause?: unknown }) {
    super(message);
    this.name = "PredictorError";
    this.code = details.code;
  }
}

const backgroundHarnessMocks = {
  settingsGet: jest.fn(async () => undefined),
  settingsSet: jest.fn(async () => undefined),
  resolveAutoLanguage: jest.fn(async () => ({
    language: "en_US",
    changed: true,
    source: "detection",
    isLocked: false,
    switched: false,
    tabId: 1,
    frameId: 0,
  })),
  cycleManualLockForScope: jest.fn(async () => null),
  getRecentSessionStatusForScope: jest.fn(async () => null),
  predictionRun: jest.fn(async () => ({ predictions: [] })),
  predictionInitialize: jest.fn(async () => undefined),
  predictionSetConfig: jest.fn(),
  predictionEnsureTraceId: jest.fn((traceId?: string) => traceId || "generated-trace-id"),
  predictionRecordTraceTimelineEvent: jest.fn(
    (meta?: { traceId?: string }) => meta?.traceId || "generated-trace-id",
  ),
  tabSendToAll: jest.fn(),
  tabSendToActive: jest.fn(),
  tabSendToTab: jest.fn(),
  getActiveTabContext: jest.fn(async () => ({
    tabId: 1,
    hostname: "example.com",
  })),
  getLastActiveWebsiteTabContext: jest.fn(async () => ({
    tabId: 1,
    hostname: "example.com",
  })),
  checkLastError: jest.fn(),
  getDomain: jest.fn(() => "example.com"),
  isEnabledForDomain: jest.fn(async () => true),
  logError: jest.fn(),
  migrateToLocalStore: jest.fn(async () => undefined),
};

function installBackgroundHarnessModuleMocks(): void {
  jest.unstable_mockModule("../src/core/application/settingsManager", () => ({
    SettingsManager: jest.fn().mockImplementation(() => ({
      get: (...args: [string]) => backgroundHarnessMocks.settingsGet(...args),
      set: (...args: [string, unknown]) => backgroundHarnessMocks.settingsSet(...args),
    })),
  }));

  jest.unstable_mockModule("../src/adapters/chrome/background/LanguageDetector", () => ({
    LanguageDetector: jest.fn().mockImplementation(() => ({
      resolveLanguage: (...args: [unknown]) => backgroundHarnessMocks.resolveAutoLanguage(...args),
      reportRuntimeActivity: jest.fn(),
      getLiveRuntimeStatus: jest.fn(async () => null),
      cycleManualLockForScope: (...args: [unknown]) =>
        backgroundHarnessMocks.cycleManualLockForScope(...args),
      getRecentSessionStatusForScope: (...args: [unknown]) =>
        backgroundHarnessMocks.getRecentSessionStatusForScope(...args),
    })),
  }));

  jest.unstable_mockModule("../src/adapters/chrome/background/PredictionManager", () => ({
    PredictionManager: jest.fn().mockImplementation(() => ({
      runPrediction: (...args: [string, string, string, unknown?, unknown?, string?]) =>
        backgroundHarnessMocks.predictionRun(...args),
      initialize: () => backgroundHarnessMocks.predictionInitialize(),
      setConfig: (...args: [unknown]) => backgroundHarnessMocks.predictionSetConfig(...args),
      ensureTraceId: (...args: [string?]) =>
        backgroundHarnessMocks.predictionEnsureTraceId(...args),
      recordTraceTimelineEvent: (...args: [unknown?]) =>
        backgroundHarnessMocks.predictionRecordTraceTimelineEvent(...args),
    })),
  }));

  jest.unstable_mockModule("../src/adapters/chrome/background/TabMessenger", () => ({
    TabMessenger: jest.fn().mockImplementation(() => ({
      sendToAllTabs: (...args: [unknown, unknown?, unknown?]) =>
        backgroundHarnessMocks.tabSendToAll(...args),
      sendToActiveTab: (...args: [unknown]) => backgroundHarnessMocks.tabSendToActive(...args),
      sendToTab: (...args: [number, number, unknown]) =>
        backgroundHarnessMocks.tabSendToTab(...args),
      getActiveTabContext: (...args: []) => backgroundHarnessMocks.getActiveTabContext(...args),
      getLastActiveWebsiteTabContext: (...args: []) =>
        backgroundHarnessMocks.getLastActiveWebsiteTabContext(...args),
    })),
  }));

  jest.unstable_mockModule("../src/core/application/transport-utils", () => ({
    checkLastError: (...args: []) => backgroundHarnessMocks.checkLastError(...args),
  }));

  jest.unstable_mockModule("../src/core/application/domain-utils", () => ({
    getDomain: (...args: [string]) => backgroundHarnessMocks.getDomain(...args),
    isEnabledForDomain: (...args: [unknown, string]) =>
      backgroundHarnessMocks.isEnabledForDomain(...args),
    isLetter: (character: string) => /^\p{L}/u.test(character),
    isWhiteSpace: (character: string, matchNewLine = true) =>
      (matchNewLine ? /\s+/ : /[^\S\r\n]+/).test(character),
    isNumber: (value: string) =>
      (!Number.isNaN(Number(value)) && !Number.isNaN(Number.parseFloat(value))) ||
      value.replace(/[^0-9]/g, "").length > 1,
  }));

  jest.unstable_mockModule("../src/core/domain/error", () => ({
    logError: (...args: [string, unknown]) => backgroundHarnessMocks.logError(...args),
    getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    ConfigError: MockConfigError,
    TransportError: MockTransportError,
    PredictorError: MockPredictorError,
    isFluentTyperError: (error: unknown) => {
      if (!error || typeof error !== "object") {
        return false;
      }
      const candidate = error as { kind?: unknown; code?: unknown };
      return (
        (candidate.kind === "config" ||
          candidate.kind === "transport" ||
          candidate.kind === "predictor") &&
        typeof candidate.code === "string"
      );
    },
  }));

  jest.unstable_mockModule("../src/adapters/chrome/background/Migration", () => ({
    migrateToLocalStore: (...args: [string | undefined]) =>
      backgroundHarnessMocks.migrateToLocalStore(...args),
  }));
}

let importNonce = 0;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_background_routing=${importNonce}`;
}

async function loadBackgroundHarness(stateOverrides: Record<string, unknown> = {}) {
  mock.restore();
  installBackgroundHarnessModuleMocks();
  jest.clearAllMocks();

  const state: Record<string, unknown> = {
    language: "en_US",
    enabled_languages: ["en_US", "fr_FR"],
    enabled: true,
    autocomplete: true,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    selectByDigit: true,
    minWordLengthToPredict: 1,
    displayLangHeader: true,
    inline_suggestion: false,
    preferNativeAutocomplete: true,
    suggestionBgLight: "#fff",
    suggestionTextLight: "#111",
    suggestionHighlightBgLight: "#eee",
    suggestionHighlightTextLight: "#000",
    suggestionBorderLight: "#ccc",
    suggestionBgDark: "#111",
    suggestionTextDark: "#eee",
    suggestionHighlightBgDark: "#333",
    suggestionHighlightTextDark: "#fff",
    suggestionBorderDark: "#666",
    suggestionFontSize: "14px",
    suggestionPaddingVertical: "8px",
    suggestionPaddingHorizontal: "12px",
    numSuggestions: 5,
    insertSpaceAfterAutocomplete: true,
    autoCapitalize: true,
    textExpansions: [],

    timeFormat: "HH:mm",
    dateFormat: "yyyy-MM-dd",
    userDictionaryList: [],
    ...stateOverrides,
  };

  const settingsGet = jest.fn(async (key: string) => state[key]);
  const settingsSet = jest.fn(async (key: string, value: unknown) => {
    state[key] = value;
  });
  const resolveAutoLanguage = jest.fn(async () => ({
    language: "fr_FR",
    changed: true,
    source: "detection",
    isLocked: false,
    switched: false,
    tabId: 111,
    frameId: 0,
  }));
  const cycleManualLockForScope = jest.fn(async () => null);
  const getRecentSessionStatusForScope = jest.fn(async () => null);
  const predictionRun = jest.fn(async () => ({
    predictions: ["hello"],
  }));
  const predictionInitialize = jest.fn(async () => undefined);
  const predictionSetConfig = jest.fn();
  const predictionEnsureTraceId = jest.fn((traceId?: string) => traceId || "generated-trace-id");
  const predictionRecordTraceTimelineEvent = jest.fn(
    (meta?: { traceId?: string }) => meta?.traceId || "generated-trace-id",
  );
  const tabSendToAll = jest.fn();
  const tabSendToActive = jest.fn();
  const tabSendToTab = jest.fn();
  const getActiveTabContext = jest.fn(async () => ({
    tabId: 1,
    hostname: "example.com",
  }));
  const getLastActiveWebsiteTabContext = jest.fn(async () => ({
    tabId: 9,
    hostname: "docs.example",
  }));
  const checkLastError = jest.fn();
  const getDomain = jest.fn(() => "example.com");
  const isEnabledForDomain = jest.fn(async () => true);
  const logError = jest.fn();
  const migrateToLocalStore = jest.fn(async () => undefined);

  const onInstalledAddListener = jest.fn();
  const onCommandAddListener = jest.fn();
  const onMessageAddListener = jest.fn();
  const storageLocalGet = jest.fn();

  const chromeMock = {
    runtime: {
      onInstalled: { addListener: onInstalledAddListener },
      onMessage: { addListener: onMessageAddListener },
      getManifest: jest.fn(() => ({ version: "2026.2.1" })),
    },
    commands: {
      onCommand: { addListener: onCommandAddListener },
    },
    tabs: {
      create: jest.fn(),
      get: jest.fn((tabId: number, callback: (tab: chrome.tabs.Tab) => void) =>
        callback({ id: tabId } as chrome.tabs.Tab),
      ),
      sendMessage: jest.fn(),
      query: jest.fn((_queryInfo: unknown, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        const tabs = [{ id: 1, url: "https://example.com/path" } as chrome.tabs.Tab];
        if (callback) {
          callback(tabs);
        }
        return Promise.resolve(tabs);
      }),
    },
    storage: {
      local: {
        get: storageLocalGet,
        set: jest.fn(),
      },
      sync: {
        get: jest.fn(),
        set: jest.fn(),
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

  backgroundHarnessMocks.settingsGet = settingsGet;
  backgroundHarnessMocks.settingsSet = settingsSet;
  backgroundHarnessMocks.resolveAutoLanguage = resolveAutoLanguage;
  backgroundHarnessMocks.cycleManualLockForScope = cycleManualLockForScope;
  backgroundHarnessMocks.getRecentSessionStatusForScope = getRecentSessionStatusForScope;
  backgroundHarnessMocks.predictionRun = predictionRun;
  backgroundHarnessMocks.predictionInitialize = predictionInitialize;
  backgroundHarnessMocks.predictionSetConfig = predictionSetConfig;
  backgroundHarnessMocks.predictionEnsureTraceId = predictionEnsureTraceId;
  backgroundHarnessMocks.predictionRecordTraceTimelineEvent = predictionRecordTraceTimelineEvent;
  backgroundHarnessMocks.tabSendToAll = tabSendToAll;
  backgroundHarnessMocks.tabSendToActive = tabSendToActive;
  backgroundHarnessMocks.tabSendToTab = tabSendToTab;
  backgroundHarnessMocks.getActiveTabContext = getActiveTabContext;
  backgroundHarnessMocks.getLastActiveWebsiteTabContext = getLastActiveWebsiteTabContext;
  backgroundHarnessMocks.checkLastError = checkLastError;
  backgroundHarnessMocks.getDomain = getDomain;
  backgroundHarnessMocks.isEnabledForDomain = isEnabledForDomain;
  backgroundHarnessMocks.logError = logError;
  backgroundHarnessMocks.migrateToLocalStore = migrateToLocalStore;

  const { BackgroundServiceWorker } =
    await import("../src/adapters/chrome/background/BackgroundServiceWorker");
  (BackgroundServiceWorker as unknown as { instance?: unknown }).instance = undefined;

  const module = await import(freshModulePath("../src/adapters/chrome/background/background"));

  const onInstalled = onInstalledAddListener.mock.calls[0][0] as (
    details: chrome.runtime.InstalledDetails,
  ) => void;
  const onCommand = onCommandAddListener.mock.calls[0][0] as (command: string) => void;
  const onMessage = onMessageAddListener.mock.calls[0][0] as (
    request: { command: string; context?: Record<string, unknown> },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => boolean;
  const startupHandler = storageLocalGet.mock.calls[0][1] as (
    result: Record<string, unknown>,
  ) => Promise<void>;

  return {
    module,
    state,
    settingsGet,
    settingsSet,
    resolveAutoLanguage,
    cycleManualLockForScope,
    getRecentSessionStatusForScope,
    predictionRun,
    predictionInitialize,
    predictionSetConfig,
    predictionEnsureTraceId,
    predictionRecordTraceTimelineEvent,
    tabSendToAll,
    tabSendToActive,
    tabSendToTab,
    getActiveTabContext,
    getLastActiveWebsiteTabContext,
    checkLastError,
    getDomain,
    isEnabledForDomain,
    logError,
    migrateToLocalStore,
    onInstalled,
    onCommand,
    onMessage,
    onMessageAddListener,
    startupHandler,
    chromeMock: { tabs: chromeMock.tabs },
  };
}

describe("background routing and lifecycle", () => {
  afterEach(() => {
    mock.restore();
  });

  test("registers listeners and runs startup initialization pipeline", async () => {
    const harness = await loadBackgroundHarness();

    await harness.startupHandler({ lastVersion: "2025.12.0" });

    expect(harness.migrateToLocalStore).toHaveBeenCalledWith("2025.12.0");
    expect(harness.predictionInitialize).toHaveBeenCalled();
    expect(harness.predictionSetConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPredictorEnabled: false,
        aiModelId: DEFAULT_AI_MODEL_ID,
        aiPredictionTimeoutMs: DEFAULT_AI_PREDICTION_TIMEOUT_MS,
      }),
    );
    expect(harness.tabSendToAll).toHaveBeenCalled();
  });

  test("startup logs failure when migration rejects", async () => {
    const harness = await loadBackgroundHarness();
    harness.migrateToLocalStore.mockRejectedValueOnce(new Error("boom"));

    await harness.startupHandler({ lastVersion: "2025.12.0" });

    expect(harness.logError).toHaveBeenCalledWith("lastVersion handler", expect.any(Error));
  });

  test("registers no test-only runtime message hook in non-dev builds", async () => {
    const harness = await loadBackgroundHarness();

    expect(harness.onMessageAddListener).toHaveBeenCalledTimes(1);
  });

  test("startup ignores debug predictor routing toggles outside dev builds", async () => {
    const harness = await loadBackgroundHarness({
      [KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED]: false,
      [KEY_DEBUG_AI_PREDICTOR_ENABLED]: false,
    });

    await harness.startupHandler({ lastVersion: "2025.12.0" });

    expect(harness.predictionSetConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPredictorEnabled: false,
        debugPresagePredictorEnabled: DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
        debugAIPredictorEnabled: DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
      }),
    );
  });

  test("onInstalled handles install and update flows", async () => {
    const harness = await loadBackgroundHarness();

    harness.onInstalled({
      reason: "install",
    } as chrome.runtime.InstalledDetails);
    expect(harness.chromeMock.tabs.create).toHaveBeenCalledWith({
      url: "new_installation/index.html",
    });

    harness.onInstalled({
      reason: "update",
      previousVersion: "2025.1.0",
    } as chrome.runtime.InstalledDetails);
    await flushPromises();
    expect(harness.migrateToLocalStore).toHaveBeenCalledWith("2025.1.0");

    harness.migrateToLocalStore.mockRejectedValueOnce(new Error("update fail"));
    harness.onInstalled({
      reason: "update",
      previousVersion: "2025.1.1",
    } as chrome.runtime.InstalledDetails);
    await flushPromises();
    expect(harness.logError).toHaveBeenCalledWith("migrateToLocalStore", expect.any(Error));
  });

  test("onCommand toggles active tab, triggers active tab and rotates language", async () => {
    const harness = await loadBackgroundHarness();

    harness.onCommand(CMD_TOGGLE_FT_ACTIVE_TAB);
    harness.onCommand(CMD_TRIGGER_FT_ACTIVE_TAB);
    harness.onCommand(CMD_TOGGLE_FT_ACTIVE_LANG);
    await flushPromises();

    expect(harness.tabSendToActive).toHaveBeenCalledWith(
      expect.objectContaining({ command: CMD_TOGGLE_FT_ACTIVE_TAB }),
    );
    expect(harness.tabSendToActive).toHaveBeenCalledWith(
      expect.objectContaining({ command: CMD_TRIGGER_FT_ACTIVE_TAB }),
    );
    expect(harness.settingsSet).toHaveBeenCalledWith(KEY_LANGUAGE, "fr_FR");
    expect(harness.tabSendToTab).toHaveBeenCalledWith(1, 0, {
      command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
      context: { lang: "fr_FR" },
    });
  });

  test("onCommand rotates active language for current site profile if it exists", async () => {
    const harness = await loadBackgroundHarness({
      [KEY_SITE_PROFILES]: {
        "example.com": {
          language: "en_US",
        },
      },
    });

    harness.onCommand(CMD_TOGGLE_FT_ACTIVE_LANG);
    await flushPromises();

    expect(harness.settingsSet).toHaveBeenCalledWith(
      KEY_SITE_PROFILES,
      expect.objectContaining({
        "example.com": expect.objectContaining({
          language: "fr_FR",
        }),
      }),
    );
    expect(harness.tabSendToTab).toHaveBeenCalledWith(1, 0, {
      command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
      context: { lang: "fr_FR" },
    });
  });

  test("onCommand toggles global language if current site profile does not exist", async () => {
    const harness = await loadBackgroundHarness({
      [KEY_SITE_PROFILES]: {
        "other.com": {
          language: "en_US",
        },
      },
      language: "en_US",
    });

    harness.onCommand(CMD_TOGGLE_FT_ACTIVE_LANG);
    await flushPromises();

    expect(harness.settingsSet).toHaveBeenCalledWith(KEY_LANGUAGE, "fr_FR");
    expect(harness.tabSendToTab).toHaveBeenCalledWith(1, 0, {
      command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
      context: { lang: "fr_FR" },
    });
  });

  test("onCommand uses a session-only lock for active auto-detect sessions", async () => {
    const harness = await loadBackgroundHarness({
      language: "auto_detect",
    });
    harness.cycleManualLockForScope.mockResolvedValueOnce({
      language: "fr_FR",
      source: "manual_lock",
      locked: true,
      tabId: 1,
      frameId: 0,
      domain: "example.com",
      updatedAt: Date.now(),
    });

    harness.onCommand(CMD_TOGGLE_FT_ACTIVE_LANG);
    await flushPromises();

    expect(harness.cycleManualLockForScope).toHaveBeenCalledWith({
      tabId: 1,
      frameId: undefined,
      runtimeGeneration: undefined,
      domainURL: "example.com",
    });
    expect(harness.settingsSet).not.toHaveBeenCalledWith(KEY_LANGUAGE, expect.anything());
    expect(harness.tabSendToTab).toHaveBeenCalledWith(1, 0, {
      command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
      context: { lang: "fr_FR" },
    });
  });

  test("onCommand logs unsupported command", async () => {
    const harness = await loadBackgroundHarness();

    harness.onCommand("CMD_UNKNOWN");

    expect(harness.logError).toHaveBeenCalledWith("onCommand", "Unknown command: CMD_UNKNOWN");
  });

  test("onMessage handles content-script predict request with same language", async () => {
    const harness = await loadBackgroundHarness();
    const runPredictionSpy = jest
      .spyOn(harness.module.BackgroundServiceWorker.prototype, "runPrediction")
      .mockResolvedValue(undefined);

    const result = harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
        context: {
          text: "hello",
          nextChar: "",
          afterCursor: " world",
          inputAction: "delete",
          lang: "en_US",
          suggestionId: 1,
          requestId: 9,
          runtimeGeneration: 2,
        },
      },
      { tab: { id: 321 } as chrome.tabs.Tab, frameId: 7 },
      jest.fn(),
    );

    await flushPromises();

    expect(result).toBe(false);
    expect(runPredictionSpy).toHaveBeenCalledWith(
      {
        command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
        context: expect.objectContaining({
          text: "hello",
          nextChar: "",
          afterCursor: " world",
          inputAction: "delete",
          lang: "en_US",
          tabId: 321,
          frameId: 7,
        }),
      },
      undefined,
    );
  });

  test("onMessage applies site profile language and suggestion count override", async () => {
    const harness = await loadBackgroundHarness({
      [KEY_SITE_PROFILES]: {
        "example.com": {
          language: "fr_FR",
          numSuggestions: 2,
          inline_suggestion: true,
        },
      },
    });
    const runPredictionSpy = jest.spyOn(
      (
        harness.module.BackgroundServiceWorker as {
          prototype: {
            runPrediction: (
              message: unknown,
              configOverride?: { numSuggestions?: number },
            ) => Promise<void>;
          };
        }
      ).prototype,
      "runPrediction",
    );

    harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
        context: {
          text: "bonjour",
          nextChar: "",
          lang: "fr_FR",
          suggestionId: 4,
          requestId: 5,
          runtimeGeneration: 3,
          traceId: "trace-fr-5",
        },
      },
      {
        tab: { id: 77, url: "https://example.com/path" } as chrome.tabs.Tab,
        frameId: 3,
      },
      jest.fn(),
    );
    await flushPromises();

    expect(runPredictionSpy).toHaveBeenCalledWith(
      {
        command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
        context: expect.objectContaining({
          text: "bonjour",
          nextChar: "",
          lang: "fr_FR",
          tabId: 77,
          frameId: 3,
          suggestionId: 4,
          requestId: 5,
          runtimeGeneration: 3,
          traceId: "trace-fr-5",
        }),
      },
      {
        numSuggestions: 2,
      },
    );
  });

  test("onMessage predict request falls back to global runtime config for unmatched domain", async () => {
    const harness = await loadBackgroundHarness({
      [KEY_SITE_PROFILES]: {
        "example.com": {
          language: "fr_FR",
          numSuggestions: 4,
        },
      },
      language: "en_US",
    });
    harness.getDomain.mockReturnValueOnce("other.example");
    const runPredictionSpy = jest.spyOn(
      (
        harness.module.BackgroundServiceWorker as {
          prototype: {
            runPrediction: (
              message: unknown,
              configOverride?: { numSuggestions?: number },
            ) => Promise<void>;
          };
        }
      ).prototype,
      "runPrediction",
    );

    harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
        context: {
          text: "hello",
          nextChar: "",
          lang: "en_US",
          suggestionId: 11,
          requestId: 12,
          runtimeGeneration: 4,
          traceId: "trace-en-12",
        },
      },
      {
        tab: { id: 90, url: "https://other.example" } as chrome.tabs.Tab,
        frameId: 1,
      },
      jest.fn(),
    );
    await flushPromises();

    expect(runPredictionSpy).toHaveBeenCalledWith(
      {
        command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
        context: expect.objectContaining({
          text: "hello",
          nextChar: "",
          lang: "en_US",
          tabId: 90,
          frameId: 1,
          suggestionId: 11,
          requestId: 12,
          runtimeGeneration: 4,
          traceId: "trace-en-12",
        }),
      },
      undefined,
    );
  });

  test("onMessage requests language update and still predicts when resolved language differs", async () => {
    const harness = await loadBackgroundHarness();
    harness.state[KEY_LANGUAGE] = "en_US";

    const sendToTabSpy = jest.spyOn(
      harness.module.BackgroundServiceWorker.prototype,
      "sendCommandToTabContentScript",
    );
    const runPredictionSpy = jest
      .spyOn(harness.module.BackgroundServiceWorker.prototype, "runPrediction")
      .mockResolvedValue(undefined);

    harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
        context: {
          text: "hello",
          nextChar: "",
          lang: "fr_FR",
          suggestionId: 1,
          requestId: 1,
          runtimeGeneration: 5,
        },
      },
      { tab: { id: 2 } as chrome.tabs.Tab, frameId: 0 },
      jest.fn(),
    );
    await flushPromises();

    expect(sendToTabSpy).toHaveBeenCalledWith(2, 0, {
      command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
      context: { lang: "en_US" },
    });
    expect(runPredictionSpy).toHaveBeenCalledWith(
      {
        command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
        context: expect.objectContaining({
          text: "hello",
          nextChar: "",
          lang: "en_US",
          tabId: 2,
          frameId: 0,
          suggestionId: 1,
          requestId: 1,
          runtimeGeneration: 5,
        }),
      },
      undefined,
    );
  });

  test("onMessage auto-detect branch updates language and predicts on first request", async () => {
    const harness = await loadBackgroundHarness({
      language: "auto_detect",
      enabled_languages: ["en_US", "fr_FR"],
    });
    const sendToTabSpy = jest.spyOn(
      harness.module.BackgroundServiceWorker.prototype,
      "sendCommandToTabContentScript",
    );
    const runPredictionSpy = jest
      .spyOn(harness.module.BackgroundServiceWorker.prototype, "runPrediction")
      .mockResolvedValue(undefined);

    harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
        context: {
          text: "bonjour",
          nextChar: "",
          lang: "auto_detect",
          suggestionId: 1,
          requestId: 3,
          runtimeGeneration: 6,
        },
      },
      { tab: { id: 111 } as chrome.tabs.Tab, frameId: 0 },
      jest.fn(),
    );
    await flushPromises();

    expect(harness.resolveAutoLanguage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "bonjour",
        tabId: 111,
        frameId: 0,
        enabledLanguages: ["en_US", "fr_FR"],
      }),
    );
    expect(sendToTabSpy).toHaveBeenCalledWith(111, 0, {
      command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
      context: { lang: "fr_FR" },
    });
    expect(runPredictionSpy).toHaveBeenCalledWith(
      {
        command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
        context: expect.objectContaining({
          text: "bonjour",
          nextChar: "",
          lang: "fr_FR",
          tabId: 111,
          frameId: 0,
          suggestionId: 1,
          requestId: 3,
          runtimeGeneration: 6,
        }),
      },
      undefined,
    );
  });

  test("onMessage handles options page config change success and failure", async () => {
    const harness = await loadBackgroundHarness();
    const sendResponse = jest.fn();

    const ok = harness.onMessage(
      { command: CMD_OPTIONS_PAGE_CONFIG_CHANGE, context: {} },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushPromises();
    expect(ok).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });

    const updateSpy = jest
      .spyOn(harness.module.BackgroundServiceWorker.prototype, "updatePresageConfig")
      .mockRejectedValueOnce(new Error("failed update"));
    sendResponse.mockClear();

    harness.onMessage(
      { command: CMD_OPTIONS_PAGE_CONFIG_CHANGE, context: {} },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushPromises();

    expect(updateSpy).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    expect(harness.logError).toHaveBeenCalledWith(
      "handleOptionsPageConfigChange.config.message_update_runtime_config_failed",
      expect.any(Error),
    );
  });

  test("onMessage get config applies site profile language and inline overrides", async () => {
    const harness = await loadBackgroundHarness({
      [KEY_SITE_PROFILES]: {
        "example.com": {
          language: "fr_FR",
          inline_suggestion: true,
          preferNativeAutocomplete: false,
        },
      },
      language: "en_US",
      inline_suggestion: false,
      preferNativeAutocomplete: true,
    });
    const sendResponse = jest.fn();

    harness.onMessage(
      { command: CMD_CONTENT_SCRIPT_GET_CONFIG, context: {} },
      { tab: { url: "https://example.com" } as chrome.tabs.Tab },
      sendResponse,
    );
    await flushPromises();

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          lang: "fr_FR",
          inline_suggestion: true,
          preferNativeAutocomplete: false,
          insertSpaceAfterAutocomplete: true,
          enabled: true,
        }),
      }),
    );
  });

  test("onMessage get config falls back to global profile for unmatched domain", async () => {
    const harness = await loadBackgroundHarness({
      [KEY_SITE_PROFILES]: {
        "example.com": {
          language: "fr_FR",
          inline_suggestion: true,
        },
      },
      language: "en_US",
      inline_suggestion: false,
      preferNativeAutocomplete: false,
    });
    const sendResponse = jest.fn();
    harness.getDomain.mockReturnValueOnce("other.example");

    harness.onMessage(
      { command: CMD_CONTENT_SCRIPT_GET_CONFIG, context: {} },
      { tab: { url: "https://other.example" } as chrome.tabs.Tab },
      sendResponse,
    );
    await flushPromises();

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          lang: "en_US",
          inline_suggestion: false,
          preferNativeAutocomplete: false,
          enabled: true,
        }),
      }),
    );
  });

  test("onMessage get config keeps domain enablement false even when profile exists", async () => {
    const harness = await loadBackgroundHarness({
      [KEY_SITE_PROFILES]: {
        "example.com": {
          language: "fr_FR",
          inline_suggestion: true,
        },
      },
    });
    const sendResponse = jest.fn();
    harness.isEnabledForDomain.mockResolvedValueOnce(false);

    harness.onMessage(
      { command: CMD_CONTENT_SCRIPT_GET_CONFIG, context: {} },
      { tab: { url: "https://example.com" } as chrome.tabs.Tab },
      sendResponse,
    );
    await flushPromises();

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          lang: "fr_FR",
          enabled: false,
        }),
      }),
    );
  });

  test("onMessage handles get config request and unsupported commands", async () => {
    const harness = await loadBackgroundHarness();
    const sendResponse = jest.fn();
    const getConfigSpy = jest
      .spyOn(harness.module.BackgroundServiceWorker.prototype, "getBackgroundPageSetConfigMsg")
      .mockResolvedValue({
        command: CMD_BACKGROUND_PAGE_SET_CONFIG,
        context: { enabled: true, lang: "en_US" },
      } as never);
    harness.isEnabledForDomain.mockResolvedValueOnce(false);

    const handled = harness.onMessage(
      { command: CMD_CONTENT_SCRIPT_GET_CONFIG, context: {} },
      { tab: { url: "https://example.com" } as chrome.tabs.Tab },
      sendResponse,
    );
    await flushPromises();

    expect(handled).toBe(true);
    expect(harness.getDomain).toHaveBeenCalledWith("https://example.com");
    expect(getConfigSpy).toHaveBeenCalledWith("example.com");
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ enabled: false }),
      }),
    );

    const unknown = harness.onMessage(
      { command: "UNKNOWN", context: {} },
      {} as chrome.runtime.MessageSender,
      jest.fn(),
    );
    expect(unknown).toBe(false);
    expect(harness.logError).toHaveBeenCalledWith("onMessage", "Unknown command: UNKNOWN");
    expect(harness.checkLastError).toHaveBeenCalled();
  });

  test("onMessage returns active auto language session status", async () => {
    const harness = await loadBackgroundHarness();
    harness.getRecentSessionStatusForScope.mockResolvedValueOnce({
      language: "de_DE",
      source: "manual_lock",
      locked: true,
      tabId: 9,
      frameId: 0,
      domain: "docs.example",
      updatedAt: Date.now(),
    });
    const sendResponse = jest.fn();

    harness.onMessage(
      { command: CMD_GET_AUTO_LANGUAGE_STATUS, context: {} },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushPromises();

    expect(harness.getLastActiveWebsiteTabContext).toHaveBeenCalled();
    expect(harness.getRecentSessionStatusForScope).toHaveBeenCalledWith({
      tabId: 9,
      frameId: undefined,
      runtimeGeneration: undefined,
      domainURL: "docs.example",
    });
    expect(sendResponse).toHaveBeenCalledWith({
      status: expect.objectContaining({
        language: "de_DE",
        locked: true,
      }),
    });
  });

  test("onMessage returns null auto language status when no website tab context exists", async () => {
    const harness = await loadBackgroundHarness();
    harness.getLastActiveWebsiteTabContext.mockResolvedValueOnce(undefined);
    const sendResponse = jest.fn();

    harness.onMessage(
      { command: CMD_GET_AUTO_LANGUAGE_STATUS, context: {} },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushPromises();

    expect(sendResponse).toHaveBeenCalledWith({ status: null });
    expect(harness.getRecentSessionStatusForScope).not.toHaveBeenCalled();
  });

  test("onMessage records live runtime status for the sender frame", async () => {
    const harness = await loadBackgroundHarness();
    const reportSpy = jest.spyOn(
      harness.module.BackgroundServiceWorker.prototype,
      "reportAutoLanguageRuntime",
    );
    const sendResponse = jest.fn();

    harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS,
        context: {
          runtimeGeneration: 4,
          domainURL: "iframe.example",
        },
      },
      { tab: { id: 42 } as chrome.tabs.Tab, frameId: 7 },
      sendResponse,
    );
    await flushPromises();

    expect(reportSpy).toHaveBeenCalledWith({
      tabId: 42,
      frameId: 7,
      runtimeGeneration: 4,
      domainURL: "iframe.example",
    });
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  test("onMessage handles productivity usage + popup stats commands", async () => {
    const harness = await loadBackgroundHarness();
    const statsModule = await import("../src/adapters/chrome/background/ProductivityStatsManager");
    const recordSpy = jest
      .spyOn(statsModule.ProductivityStatsManager.prototype, "recordUsageEvent")
      .mockResolvedValue(undefined);
    const getSpy = jest
      .spyOn(statsModule.ProductivityStatsManager.prototype, "getDashboardStats")
      .mockResolvedValue({
        today: {
          acceptedSuggestions: 1,
          charactersSaved: 4,
          estimatedMinutesSaved: 0.1,
        },
        last7Days: {
          acceptedSuggestions: 1,
          charactersSaved: 4,
          estimatedMinutesSaved: 0.1,
        },
        lifetime: {
          acceptedSuggestions: 1,
          charactersSaved: 4,
          estimatedMinutesSaved: 0.1,
        },
        lifetimeEvents: {
          suggestionsShown: 1,
          snippetsExpanded: 1,
          charsInsertedFromSnippet: 9,
          charsTypedForTrigger: 3,
        },
        last7DaysEvents: {
          suggestionsShown: 1,
          snippetsExpanded: 1,
          charsInsertedFromSnippet: 9,
          charsTypedForTrigger: 3,
        },
        last7DaysTrend: [
          {
            dateKey: "2026-02-09",
            acceptedSuggestions: 0,
            charactersSaved: 0,
            estimatedMinutesSaved: 0,
          },
          {
            dateKey: "2026-02-10",
            acceptedSuggestions: 1,
            charactersSaved: 4,
            estimatedMinutesSaved: 0.1,
          },
        ],
        perLanguageLifetime: [],
        perLanguageLast7Days: [],
        topSnippets: [],
        weekOverWeekDeltaPct: null,
        milestoneProgress: {
          previousMilestoneHours: 0,
          nextMilestoneHours: 1,
          progressPct: 10,
          lifetimeHoursSaved: 0.1,
        },
        weeklyRecap: {
          weekKey: "2026-02-02",
          acceptedSuggestions: 1,
          charactersSaved: 4,
          estimatedMinutesSaved: 0.1,
          topSnippet: null,
          milestonesCrossedHours: [],
          equivalentTasks: 0,
        },
        shouldShowWeeklyRecap: false,
        donationPrompt: null,
      });
    const ackWeekSpy = jest
      .spyOn(statsModule.ProductivityStatsManager.prototype, "acknowledgeWeeklyRecap")
      .mockResolvedValue(undefined);
    const ackMilestoneSpy = jest
      .spyOn(statsModule.ProductivityStatsManager.prototype, "handleDonationPromptAction")
      .mockResolvedValue(undefined);
    const resetSpy = jest
      .spyOn(statsModule.ProductivityStatsManager.prototype, "resetStats")
      .mockResolvedValue(undefined);

    const usageResponse = jest.fn();
    const usageHandled = harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_USAGE_EVENT,
        context: {
          eventType: "suggestion_accepted",
          triggerText: "brb",
          typedTextLength: 3,
          insertedTextLength: 9,
          language: "en_US",
        },
      },
      {} as chrome.runtime.MessageSender,
      usageResponse,
    );
    await flushPromises();
    expect(usageHandled).toBe(true);
    expect(recordSpy).toHaveBeenCalled();
    expect(usageResponse).toHaveBeenCalledWith({ ok: true });

    const popupResponse = jest.fn();
    const popupHandled = harness.onMessage(
      {
        command: CMD_POPUP_GET_PRODUCTIVITY_STATS,
        context: {},
      },
      {} as chrome.runtime.MessageSender,
      popupResponse,
    );
    await flushPromises();
    expect(popupHandled).toBe(true);
    expect(getSpy).toHaveBeenCalled();
    expect(popupResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        lifetime: expect.objectContaining({
          acceptedSuggestions: 1,
        }),
      }),
    );

    const ackWeekResponse = jest.fn();
    harness.onMessage(
      {
        command: CMD_POPUP_ACK_WEEKLY_RECAP,
        context: { weekKey: "2026-02-02" },
      },
      {} as chrome.runtime.MessageSender,
      ackWeekResponse,
    );
    await flushPromises();
    expect(ackWeekSpy).toHaveBeenCalledWith("2026-02-02");
    expect(ackWeekResponse).toHaveBeenCalledWith({ ok: true });

    const ackMilestoneResponse = jest.fn();
    harness.onMessage(
      {
        command: CMD_POPUP_ACK_DONATION_MILESTONE,
        context: {
          promptId: "milestone_1",
          action: "supported",
          milestoneHours: 1,
        },
      },
      {} as chrome.runtime.MessageSender,
      ackMilestoneResponse,
    );
    await flushPromises();
    expect(ackMilestoneSpy).toHaveBeenCalledWith("milestone_1", "supported", 1);
    expect(ackMilestoneResponse).toHaveBeenCalledWith({ ok: true });

    const resetResponse = jest.fn();
    harness.onMessage(
      {
        command: CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
        context: {},
      },
      {} as chrome.runtime.MessageSender,
      resetResponse,
    );
    await flushPromises();
    expect(resetSpy).toHaveBeenCalled();
    expect(resetResponse).toHaveBeenCalledWith({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Performance regression tests
  // ---------------------------------------------------------------------------

  test("prediction response is sent via sendMessage directly without a chrome.tabs.get pre-flight", async () => {
    // Regression guard: before this fix, BackgroundServiceWorker.runPrediction
    // called chrome.tabs.get before every sendMessage, adding ~5–10 ms IPC
    // latency.  The method must now call sendMessage directly.
    const harness = await loadBackgroundHarness();

    const tabsGetSpy = jest.spyOn(harness.chromeMock.tabs, "get");
    jest.spyOn(harness.chromeMock.tabs, "sendMessage").mockResolvedValue(undefined);

    // Mock updatePresageConfig so ensureRuntimeConfigReady resolves immediately
    // without needing the full settings / Presage initialisation path.
    jest
      .spyOn(harness.module.BackgroundServiceWorker.prototype, "updatePresageConfig")
      .mockResolvedValue(undefined);

    // Route through onMessage (same path as a real content-script keystroke).
    // We deliberately do NOT mock runPrediction so the real dispatch code runs.
    harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
        context: {
          text: "hello",
          nextChar: "",
          lang: "en_US",
          suggestionId: 1,
          requestId: 1,
          runtimeGeneration: 1,
        },
      },
      { tab: { id: 42 } as chrome.tabs.Tab, frameId: 0 },
      jest.fn(),
    );
    await flushPromises();

    // Response dispatched directly via sendMessage.
    expect(harness.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ command: CMD_BACKGROUND_PAGE_PREDICT_RESP }),
      { frameId: 0 },
    );
    // No pre-flight tab existence check.
    expect(tabsGetSpy).not.toHaveBeenCalled();
  });

  test("domain settings cache is invalidated after CMD_OPTIONS_PAGE_CONFIG_CHANGE so next prediction sees fresh settings", async () => {
    // Regression guard: MessageRouter must call domainSettingsCache.invalidate()
    // after a settings change so the very next prediction request reads fresh
    // values instead of returning a stale cache hit.
    const harness = await loadBackgroundHarness({ language: "en_US" });

    const runPredictionSpy = jest
      .spyOn(harness.module.BackgroundServiceWorker.prototype, "runPrediction")
      .mockResolvedValue(undefined);

    const sender = {
      tab: { id: 1, url: "https://example.com/path" } as chrome.tabs.Tab,
      frameId: 0,
    };
    const predictCtx = {
      text: "hello",
      nextChar: "",
      lang: "en_US",
      suggestionId: 1,
      requestId: 1,
      runtimeGeneration: 1,
    };

    // First prediction — populates the cache with en_US.
    harness.onMessage(
      { command: CMD_CONTENT_SCRIPT_PREDICT_REQ, context: predictCtx },
      sender,
      jest.fn(),
    );
    await flushPromises();

    // Language changes in settings while the cache still holds en_US.
    harness.state.language = "fr_FR";

    // Trigger config change — this must flush the domain settings cache.
    harness.onMessage(
      { command: CMD_OPTIONS_PAGE_CONFIG_CHANGE, context: {} },
      {} as chrome.runtime.MessageSender,
      jest.fn(),
    );
    await flushPromises();

    // Second prediction after the cache was invalidated.
    harness.onMessage(
      { command: CMD_CONTENT_SCRIPT_PREDICT_REQ, context: { ...predictCtx, requestId: 2 } },
      sender,
      jest.fn(),
    );
    await flushPromises();

    // The language forwarded to runPrediction must reflect the updated state.
    expect(runPredictionSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ lang: "fr_FR" }),
      }),
      undefined,
    );
  });
});
