import { jest } from "@jest/globals";
import {
  CMD_BACKGROUND_PAGE_PREDICT_REQ,
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  KEY_LANGUAGE,
} from "../src/shared/constants";

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadBackgroundHarness(
  stateOverrides: Record<string, unknown> = {},
) {
  jest.resetModules();
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
    revertOnBackspace: true,
    displayLangHeader: true,
    inline_suggestion: false,
    tributeBgLight: "#fff",
    tributeTextLight: "#111",
    tributeHighlightBgLight: "#eee",
    tributeHighlightTextLight: "#000",
    tributeBorderLight: "#ccc",
    tributeBgDark: "#111",
    tributeTextDark: "#eee",
    tributeHighlightBgDark: "#333",
    tributeHighlightTextDark: "#fff",
    tributeBorderDark: "#666",
    tributeFontSize: "14px",
    tributePaddingVertical: "8px",
    tributePaddingHorizontal: "12px",
    numSuggestions: 5,
    insertSpaceAfterAutocomplete: true,
    autoCapitalize: true,
    applySpacingRules: true,
    textExpansions: [],
    variableExpansion: false,
    timeFormat: "HH:mm",
    dateFormat: "yyyy-MM-dd",
    userDictionaryList: [],
    ...stateOverrides,
  };

  const settingsGet = jest.fn(async (key: string) => state[key]);
  const settingsSet = jest.fn(async (key: string, value: unknown) => {
    state[key] = value;
  });
  const languageDetect = jest.fn(async () => "fr_FR");
  const predictionRun = jest.fn(async () => ({
    predictions: ["hello"],
    forceReplace: null,
  }));
  const predictionInitialize = jest.fn(async () => undefined);
  const predictionSetConfig = jest.fn();
  const tabSendToAll = jest.fn();
  const tabSendToActive = jest.fn();
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

  jest.unstable_mockModule("../src/shared/settingsManager", () => ({
    SettingsManager: jest.fn().mockImplementation(() => ({
      get: settingsGet,
      set: settingsSet,
    })),
  }));
  jest.unstable_mockModule("../src/background/LanguageDetector", () => ({
    LanguageDetector: jest.fn().mockImplementation(() => ({
      detectLanguage: languageDetect,
    })),
  }));
  jest.unstable_mockModule("../src/background/PredictionManager", () => ({
    PredictionManager: jest.fn().mockImplementation(() => ({
      runPrediction: predictionRun,
      initialize: predictionInitialize,
      setConfig: predictionSetConfig,
    })),
  }));
  jest.unstable_mockModule("../src/background/TabMessenger", () => ({
    TabMessenger: jest.fn().mockImplementation(() => ({
      sendToAllTabs: tabSendToAll,
      sendToActiveTab: tabSendToActive,
    })),
  }));
  jest.unstable_mockModule("../src/shared/utils", () => ({
    checkLastError,
    getDomain,
    isEnabledForDomain,
  }));
  jest.unstable_mockModule("../src/shared/error", () => ({
    logError,
  }));
  jest.unstable_mockModule("../src/background/Migration", () => ({
    migrateToLocalStore,
  }));

  const module = await import("../src/background/background");

  const onInstalled = onInstalledAddListener.mock.calls[0][0] as (
    details: chrome.runtime.InstalledDetails,
  ) => void;
  const onCommand = onCommandAddListener.mock.calls[0][0] as (
    command: string,
  ) => void;
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
    languageDetect,
    predictionInitialize,
    predictionSetConfig,
    tabSendToAll,
    tabSendToActive,
    checkLastError,
    getDomain,
    isEnabledForDomain,
    logError,
    migrateToLocalStore,
    onInstalled,
    onCommand,
    onMessage,
    startupHandler,
    chromeMock: { tabs: chromeMock.tabs },
  };
}

describe("background routing and lifecycle", () => {
  test("registers listeners and runs startup initialization pipeline", async () => {
    const harness = await loadBackgroundHarness();

    await harness.startupHandler({ lastVersion: "2025.12.0" });

    expect(harness.migrateToLocalStore).toHaveBeenCalledWith("2025.12.0");
    expect(harness.predictionInitialize).toHaveBeenCalled();
    expect(harness.predictionSetConfig).toHaveBeenCalled();
    expect(harness.tabSendToAll).toHaveBeenCalled();
  });

  test("startup logs failure when migration rejects", async () => {
    const harness = await loadBackgroundHarness();
    harness.migrateToLocalStore.mockRejectedValueOnce(new Error("boom"));

    await harness.startupHandler({ lastVersion: "2025.12.0" });

    expect(harness.logError).toHaveBeenCalledWith(
      "lastVersion handler",
      expect.any(Error),
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
    expect(harness.logError).toHaveBeenCalledWith(
      "migrateToLocalStore",
      expect.any(Error),
    );
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
    expect(harness.tabSendToActive).toHaveBeenCalledWith({
      command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
      context: { lang: "fr_FR" },
    });
  });

  test("onCommand logs unsupported command", async () => {
    const harness = await loadBackgroundHarness();

    harness.onCommand("CMD_UNKNOWN");

    expect(harness.logError).toHaveBeenCalledWith(
      "onCommand",
      "Unknown command: CMD_UNKNOWN",
    );
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
          lang: "en_US",
          tributeId: 1,
          requestId: 9,
        },
      },
      { tab: { id: 321 } as chrome.tabs.Tab, frameId: 7 },
      jest.fn(),
    );

    await flushPromises();

    expect(result).toBe(false);
    expect(runPredictionSpy).toHaveBeenCalledWith({
      command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
      context: expect.objectContaining({
        text: "hello",
        nextChar: "",
        lang: "en_US",
        tabId: 321,
        frameId: 7,
      }),
    });
  });

  test("onMessage requests language update when resolved language differs", async () => {
    const harness = await loadBackgroundHarness();
    harness.state[KEY_LANGUAGE] = "en_US";

    const sendToActiveSpy = jest.spyOn(
      harness.module.BackgroundServiceWorker.prototype,
      "sendCommandToActiveTabContentScript",
    );

    harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
        context: {
          text: "hello",
          nextChar: "",
          lang: "fr_FR",
          tributeId: 1,
          requestId: 1,
        },
      },
      { tab: { id: 2 } as chrome.tabs.Tab, frameId: 0 },
      jest.fn(),
    );
    await flushPromises();

    expect(sendToActiveSpy).toHaveBeenCalledWith({
      command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
      context: { lang: "en_US" },
    });
  });

  test("onMessage auto-detect branch calls language detector with enabled languages", async () => {
    const harness = await loadBackgroundHarness({
      language: "auto_detect",
      enabled_languages: ["en_US", "fr_FR"],
    });

    harness.onMessage(
      {
        command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
        context: {
          text: "bonjour",
          nextChar: "",
          lang: "auto_detect",
          tributeId: 1,
          requestId: 3,
        },
      },
      { tab: { id: 111 } as chrome.tabs.Tab, frameId: 0 },
      jest.fn(),
    );
    await flushPromises();

    expect(harness.languageDetect).toHaveBeenCalledWith("bonjour", 111, [
      "en_US",
      "fr_FR",
    ]);
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
      .spyOn(
        harness.module.BackgroundServiceWorker.prototype,
        "updatePresageConfig",
      )
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
      "handleOptionsPageConfigChange",
      expect.any(Error),
    );
  });

  test("onMessage handles get config request and unsupported commands", async () => {
    const harness = await loadBackgroundHarness();
    const sendResponse = jest.fn();
    const getConfigSpy = jest
      .spyOn(
        harness.module.BackgroundServiceWorker.prototype,
        "getBackgroundPageSetConfigMsg",
      )
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
    expect(getConfigSpy).toHaveBeenCalled();
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
    expect(harness.logError).toHaveBeenCalledWith(
      "onMessage",
      "Unknown command: UNKNOWN",
    );
    expect(harness.checkLastError).toHaveBeenCalled();
  });
});
