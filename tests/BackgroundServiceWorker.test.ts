import { jest } from "@jest/globals";

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
            get: jest.fn((key: string, callback: (result: any) => void) => {
                if (typeof key === "string") {
                    callback({});
                } else {
                    callback({});
                }
            }),
            set: jest.fn(),
        },
        sync: {
            get: jest.fn((key: any, callback: (result: any) => void) => {
                callback({});
            }),
            set: jest.fn(),
        },
    },
    i18n: {
        get: jest.fn((key: string) => key),
    }
};
(global as any).chrome = mockChrome;

// Define mocks using unstable_mockModule BEFORE importing the module under test
jest.unstable_mockModule("../src/shared/settingsManager", () => ({
    SettingsManager: jest.fn().mockImplementation(() => ({
        get: jest.fn(),
        set: jest.fn(),
    })),
}));
jest.unstable_mockModule("../src/background/LanguageDetector", () => ({
    LanguageDetector: jest.fn(),
}));
jest.unstable_mockModule("../src/background/PredictionManager", () => ({
    PredictionManager: jest.fn().mockImplementation(() => ({
        initialize: jest.fn(),
        setConfig: jest.fn(),
        runPrediction: jest.fn(),
    })),
}));
jest.unstable_mockModule("../src/background/TabMessenger", () => ({
    TabMessenger: jest.fn().mockImplementation(() => ({
        sendToAllTabs: jest.fn(),
        sendToActiveTab: jest.fn(),
    })),
}));

// Import types for type safety (does not trigger module load)
import type { BackgroundServiceWorker as BackgroundServiceWorkerType } from "../src/background/background";

describe("BackgroundServiceWorker", () => {
    let BackgroundServiceWorkerClass: any;
    let worker: BackgroundServiceWorkerType;

    beforeAll(async () => {
        const module = await import("../src/background/background");
        BackgroundServiceWorkerClass = module.BackgroundServiceWorker;
    });

    beforeEach(() => {
        // Clear instance
        if (BackgroundServiceWorkerClass) {
            (BackgroundServiceWorkerClass as any).instance = undefined;
            worker = new BackgroundServiceWorkerClass();
        }
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // We can't check constructor calls easily with unstable_mockModule unless we imported the mocks too
    // But we can check behavior

    describe("runPrediction", () => {
        it("should not send message if no predictions and no forceReplace", async () => {
            // Setup mock return
            const mockPredictionManager = (worker as any).predictionManager;
            mockPredictionManager.runPrediction.mockResolvedValue({
                predictions: [],
                forceReplace: null
            });

            await worker.runPrediction({
                command: "CMD_BACKGROUND_PAGE_PREDICT_REQ",
                context: {
                    text: "test",
                    nextChar: "",
                    lang: "en_US",
                    tabId: 1,
                    frameId: 0,
                    tributeId: 1,
                    requestId: 1
                }
            });

            expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
        });

        it("should send message if predictions exist", async () => {
            const mockPredictionManager = (worker as any).predictionManager;
            mockPredictionManager.runPrediction.mockResolvedValue({
                predictions: ["tested"],
                forceReplace: null
            });
            const tabId = 123;
            // Mock chrome.tabs.get callback
            (global.chrome.tabs.get as jest.Mock).mockImplementation((id: any, cb: any) => {
                cb({ id: tabId });
            });

            await worker.runPrediction({
                command: "CMD_BACKGROUND_PAGE_PREDICT_REQ",
                context: {
                    text: "test",
                    nextChar: "",
                    lang: "en_US",
                    tabId: tabId,
                    frameId: 0,
                    tributeId: 1,
                    requestId: 1
                }
            });

            expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
                tabId,
                expect.objectContaining({
                    command: "CMD_BACKGROUND_PAGE_PREDICT_RESP",
                    context: expect.objectContaining({
                        predictions: ["tested"]
                    })
                }),
                expect.objectContaining({ frameId: 0 })
            );
        });
    });
});
