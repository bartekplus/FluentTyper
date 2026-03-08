import "./setup";
import { beforeEach, describe, expect, jest, test } from "bun:test";
import { ObservabilityService } from "../src/adapters/chrome/background/ObservabilityService";

function createPredictorSnapshot() {
  return {
    generatedAtMs: 1,
    config: {
      aiPredictorEnabled: true,
      aiModelId: "model",
      aiPredictionTimeoutMs: 120,
      debugPresagePredictorEnabled: true,
      debugAIPredictorEnabled: true,
    },
    runtime: {
      presage: { languageEngineCount: 1 },
      webllm: {
        enabled: true,
        modelId: "model",
        status: "ready",
        hasWebGPU: true,
        initAttemptCount: 1,
        isGenerating: false,
        cacheSize: 0,
        lastFailureAt: null,
        lastInitStartedAt: null,
        lastInitDurationMs: null,
        lastInitProgress: null,
        lastInitProgressAt: null,
        lastInitProgressText: null,
        lastInitError: null,
        lastInitProgressLog: [],
        lastPredictAt: null,
        lastPredictDurationMs: null,
        lastPredictSource: "none",
        lastPredictInput: null,
        lastRawOutputPreview: null,
        lastPredictOutputCount: 0,
        lastPredictError: null,
      },
    },
    traces: [],
  } as const;
}

describe("ObservabilityService", () => {
  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  test("captures events and predictor snapshot in dev builds", () => {
    const service = new ObservabilityService({
      isDevBuild: true,
      getPredictorSnapshot: () => createPredictorSnapshot(),
      getAutoLanguageRuntimes: () => [],
    });

    service.recordEvent({
      id: "1",
      timestampMs: 10,
      source: "background",
      moduleId: "PredictionManager",
      level: "info",
      message: "hello",
    });

    const snapshot = service.getSnapshot();

    expect(snapshot.available).toBe(true);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.summary.totalEvents).toBe(1);
    expect(snapshot.predictor).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          aiModelId: "model",
        }),
      }),
    );
  });

  test("returns a stable unavailable snapshot in non-dev builds", () => {
    const service = new ObservabilityService({
      isDevBuild: false,
      getPredictorSnapshot: () => ({
        ...createPredictorSnapshot(),
        config: {
          ...createPredictorSnapshot().config,
          aiPredictorEnabled: false,
          aiModelId: "",
        },
        runtime: {
          ...createPredictorSnapshot().runtime,
          presage: { languageEngineCount: 0 },
          webllm: {
            ...createPredictorSnapshot().runtime.webllm,
            enabled: false,
            modelId: "",
            status: "idle",
            hasWebGPU: false,
            initAttemptCount: 0,
          },
        },
      }),
      getAutoLanguageRuntimes: () => [],
    });

    const snapshot = service.getSnapshot();

    expect(snapshot.available).toBe(false);
    expect(snapshot.reason).toBe("dev_build_required");
    expect(snapshot.events).toHaveLength(0);
  });

  test("marks options modules as registered after forwarding option events", () => {
    const service = new ObservabilityService({
      isDevBuild: true,
      getPredictorSnapshot: () => createPredictorSnapshot(),
      getAutoLanguageRuntimes: () => [],
    });

    service.recordEvent({
      id: "opt-1",
      timestampMs: 10,
      source: "options",
      moduleId: "OptionsObservability",
      level: "info",
      message: "mounted",
    });

    const snapshot = service.getSnapshot();
    const optionsModule = snapshot.modules.find(
      (module) => module.moduleId === "OptionsObservability",
    );

    expect(snapshot.events[0]?.source).toBe("options");
    expect(optionsModule).toEqual(
      expect.objectContaining({
        registered: true,
      }),
    );
  });

  test("replaces runtime status for repeated restarts on one tab/frame", () => {
    let now = 100;
    const service = new ObservabilityService({
      isDevBuild: true,
      getPredictorSnapshot: () => createPredictorSnapshot(),
      getAutoLanguageRuntimes: () => [],
      now: () => now,
    });

    service.recordContentRuntimeStatus({
      tabId: 7,
      frameId: 0,
      runtimeGeneration: 1,
      domainURL: "https://example.com",
    });
    now += 10;
    service.recordContentRuntimeStatus({
      tabId: 7,
      frameId: 0,
      runtimeGeneration: 2,
      domainURL: "https://example.com",
    });
    now += 10;
    service.recordContentRuntimeStatus({
      tabId: 7,
      frameId: 0,
      runtimeGeneration: 3,
      domainURL: "https://example.com",
    });

    const snapshot = service.getSnapshot();

    expect(snapshot.contentRuntimes).toHaveLength(1);
    expect(snapshot.contentRuntimes[0]).toEqual(
      expect.objectContaining({
        tabId: 7,
        frameId: 0,
        runtimeGeneration: 3,
      }),
    );
  });

  test("prunes stale runtime entries after ttl", () => {
    let now = 1_000;
    const service = new ObservabilityService({
      isDevBuild: true,
      getPredictorSnapshot: () => createPredictorSnapshot(),
      getAutoLanguageRuntimes: () => [],
      now: () => now,
    });

    service.recordContentRuntimeStatus({
      tabId: 1,
      frameId: 0,
      runtimeGeneration: 1,
      domainURL: "https://old.example",
    });
    now += 5 * 60 * 1000 + 1;
    service.pruneStaleState();

    expect(service.getSnapshot().contentRuntimes).toHaveLength(0);
  });

  test("keeps content runtime snapshot bounded", () => {
    let now = 10_000;
    const service = new ObservabilityService({
      isDevBuild: true,
      getPredictorSnapshot: () => createPredictorSnapshot(),
      getAutoLanguageRuntimes: () => [],
      now: () => now,
    });

    for (let index = 0; index < 80; index += 1) {
      service.recordContentRuntimeStatus({
        tabId: index,
        frameId: 0,
        runtimeGeneration: index + 1,
        domainURL: `https://example-${index}.com`,
      });
      now += 1;
    }

    const snapshot = service.getSnapshot();

    expect(snapshot.contentRuntimes).toHaveLength(64);
    expect(snapshot.contentRuntimes.some((runtime) => runtime.runtimeGeneration === 80)).toBe(true);
    expect(snapshot.contentRuntimes.some((runtime) => runtime.runtimeGeneration === 1)).toBe(false);
  });
});
