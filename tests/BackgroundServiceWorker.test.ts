import { jest, mock } from "bun:test";

// Mock chrome global
const mockChrome = {
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    getManifest: jest.fn(() => ({ version: "1.0.0" })),
  },
  commands: {
    onCommand: { addListener: jest.fn() },
  },
  tabs: {
    create: jest.fn(),
    get: jest.fn(),
    sendMessage: jest.fn(),
  },
  storage: {
    local: {
      get: jest.fn((key: string, callback: (result: unknown) => void) => {
        if (typeof key === "string") {
          callback({});
        } else {
          callback({});
        }
      }),
      set: jest.fn(),
    },
    sync: {
      get: jest.fn((key: unknown, callback: (result: unknown) => void) => {
        callback({});
      }),
      set: jest.fn(),
    },
  },
  i18n: {
    get: jest.fn((key: string) => key),
  },
};
(global as unknown as { chrome: unknown }).chrome = mockChrome;

// Define mocks using unstable_mockModule BEFORE importing the module under test
jest.unstable_mockModule("../src/core/application/settingsManager", () => ({
  SettingsManager: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
  })),
}));
jest.unstable_mockModule("../src/adapters/chrome/background/LanguageDetector", () => ({
  LanguageDetector: jest.fn(),
}));
jest.unstable_mockModule("../src/adapters/chrome/background/PredictionManager", () => ({
  PredictionManager: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    setConfig: jest.fn(),
    runPrediction: jest.fn(),
    ensureTraceId: jest.fn((traceId?: string) => traceId || "generated-trace-id"),
    recordTraceTimelineEvent: jest.fn(
      (meta?: { traceId?: string }) => meta?.traceId || "generated-trace-id",
    ),
  })),
}));
jest.unstable_mockModule("../src/adapters/chrome/background/TabMessenger", () => ({
  TabMessenger: jest.fn().mockImplementation(() => ({
    sendToAllTabs: jest.fn(),
    sendToActiveTab: jest.fn(),
  })),
}));

// Import types for type safety (does not trigger module load)
import type { BackgroundServiceWorker as BackgroundServiceWorkerType } from "../src/adapters/chrome/background/background";

describe("BackgroundServiceWorker", () => {
  let BackgroundServiceWorkerClass: { new (): BackgroundServiceWorkerType };
  let worker: BackgroundServiceWorkerType;

  beforeAll(async () => {
    const module = await import("../src/adapters/chrome/background/background");
    BackgroundServiceWorkerClass = module.BackgroundServiceWorker;
  });

  beforeEach(() => {
    // Clear instance
    if (BackgroundServiceWorkerClass) {
      (BackgroundServiceWorkerClass as unknown as { instance: unknown }).instance = undefined;
      worker = new BackgroundServiceWorkerClass();
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    mock.restore();
  });

  // We can't check constructor calls easily with unstable_mockModule unless we imported the mocks too
  // But we can check behavior

  describe("runPrediction", () => {
    it("should send empty prediction response when no predictions exist", async () => {
      // Setup mock return
      (
        worker.predictionManager.runPrediction as jest.Mock<() => Promise<unknown>>
      ).mockResolvedValue({
        predictions: [],
      });
      (global.chrome.tabs.get as jest.Mock).mockImplementation((id: unknown, cb: unknown) => {
        const callback = cb as (tab: chrome.tabs.Tab) => void;
        callback({ id: id as number } as chrome.tabs.Tab);
      });

      await worker.runPrediction({
        command: "CMD_BACKGROUND_PAGE_PREDICT_REQ",
        context: {
          text: "test",
          nextChar: "",
          lang: "en_US",
          tabId: 1,
          frameId: 0,
          suggestionId: 1,
          requestId: 1,
          runtimeGeneration: 1,
        },
      });

      expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          command: "CMD_BACKGROUND_PAGE_PREDICT_RESP",
          context: expect.objectContaining({
            predictions: [],
            runtimeGeneration: 1,
          }),
        }),
        expect.objectContaining({ frameId: 0 }),
      );
    });

    it("should send message if predictions exist", async () => {
      (
        worker.predictionManager.runPrediction as jest.Mock<() => Promise<unknown>>
      ).mockResolvedValue({
        predictions: ["tested"],
      });
      const tabId = 123;
      // Mock chrome.tabs.get callback
      (global.chrome.tabs.get as jest.Mock).mockImplementation((id: unknown, cb: unknown) => {
        const callback = cb as (tab: chrome.tabs.Tab) => void;
        callback({ id: id as number } as chrome.tabs.Tab);
      });

      await worker.runPrediction({
        command: "CMD_BACKGROUND_PAGE_PREDICT_REQ",
        context: {
          text: "test",
          nextChar: "",
          lang: "en_US",
          tabId,
          frameId: 0,
          suggestionId: 1,
          requestId: 1,
          runtimeGeneration: 7,
        },
      });

      expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
        tabId,
        expect.objectContaining({
          command: "CMD_BACKGROUND_PAGE_PREDICT_RESP",
          context: expect.objectContaining({
            predictions: ["tested"],
            runtimeGeneration: 7,
          }),
        }),
        expect.objectContaining({ frameId: 0 }),
      );
    });
  });
});
