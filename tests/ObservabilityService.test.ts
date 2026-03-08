import "./setup";
import { beforeEach, describe, expect, jest, test } from "bun:test";
import { ObservabilityService } from "../src/adapters/chrome/background/ObservabilityService";

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
      getPredictorSnapshot: () =>
        ({
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
        }) as const,
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
      getPredictorSnapshot: () =>
        ({
          generatedAtMs: 1,
          config: {
            aiPredictorEnabled: false,
            aiModelId: "",
            aiPredictionTimeoutMs: 120,
            debugPresagePredictorEnabled: true,
            debugAIPredictorEnabled: true,
          },
          runtime: {
            presage: { languageEngineCount: 0 },
            webllm: {
              enabled: false,
              modelId: "",
              status: "idle",
              hasWebGPU: false,
              initAttemptCount: 0,
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
        }) as const,
      getAutoLanguageRuntimes: () => [],
    });

    const snapshot = service.getSnapshot();

    expect(snapshot.available).toBe(false);
    expect(snapshot.reason).toBe("dev_build_required");
    expect(snapshot.events).toHaveLength(0);
  });
});
