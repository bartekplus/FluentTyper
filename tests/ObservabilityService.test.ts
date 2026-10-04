import { beforeEach, describe, expect, jest, test } from "bun:test";
import { ObservabilityService } from "../src/adapters/chrome/background/ObservabilityService";

function createPredictorSnapshot() {
  return {
    generatedAtMs: 1,
    config: { debugPresagePredictorEnabled: true },
    runtime: { presage: { languageEngineCount: 1 } },
    traces: [],
  };
}

function createService(
  overrides: Partial<ConstructorParameters<typeof ObservabilityService>[0]> = {},
) {
  return new ObservabilityService({
    isDevBuild: true,
    getPredictorSnapshot: () => createPredictorSnapshot(),
    getAutoLanguageRuntimes: () => [],
    ...overrides,
  });
}

describe("ObservabilityService", () => {
  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  test("captures events and predictor snapshot in dev builds", () => {
    const service = createService();

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
          debugPresagePredictorEnabled: true,
        }),
      }),
    );
  });

  test("keeps no events and returns a stable unavailable snapshot in non-dev builds", () => {
    const service = createService({ isDevBuild: false });

    service.recordEvent({
      id: "cs-1",
      timestampMs: 10,
      source: "content_script",
      moduleId: "Review",
      level: "warn",
      message: "sentinel-7f3a",
    });
    const snapshot = service.getSnapshot();

    expect((service as unknown as { events: unknown[] }).events).toHaveLength(0);
    expect(snapshot.available).toBe(false);
    expect(snapshot.reason).toBe("dev_build_required");
    expect(snapshot.events).toHaveLength(0);
  });

  test("marks options modules as registered after forwarding option events", () => {
    const service = createService();

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

  test("marks forwarded content modules as registered without waiting for events", () => {
    const service = createService();

    service.registerRemoteModules("content_script", [
      "ContentRuntimeController",
      "HostChangeWatcher",
    ]);

    const snapshot = service.getSnapshot();
    const contentRuntimeController = snapshot.modules.find(
      (module) => module.moduleId === "ContentRuntimeController",
    );

    expect(contentRuntimeController).toEqual(
      expect.objectContaining({
        registered: true,
        sources: expect.arrayContaining(["content_script"]),
      }),
    );
  });

  test("replaces runtime status for repeated restarts on one tab/frame", () => {
    let now = 100;
    const service = createService({ now: () => now });

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
    const service = createService({ now: () => now });

    service.recordContentRuntimeStatus({
      tabId: 1,
      frameId: 0,
      runtimeGeneration: 1,
      domainURL: "https://old.example",
    });
    now += 5 * 60 * 1000 + 1;

    expect(service.getSnapshot().contentRuntimes).toHaveLength(0);
  });

  test("keeps content runtime snapshot bounded", () => {
    let now = 10_000;
    const service = createService({ now: () => now });

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

  test("projects content and auto-language runtimes to plain status objects", () => {
    const service = createService({
      getAutoLanguageRuntimes: () => [
        {
          tabId: 3,
          frameId: 1,
          runtimeGeneration: 2,
          domain: "example.com",
          updatedAt: 50,
          extra: "dropped",
        } as never,
      ],
      now: () => 100,
    });
    service.recordContentRuntimeStatus({
      tabId: 7,
      frameId: 0,
      runtimeGeneration: 3,
      domainURL: " Example.COM ",
    });

    const snapshot = service.getSnapshot();

    expect(snapshot.contentRuntimes).toEqual([
      { tabId: 7, frameId: 0, runtimeGeneration: 3, domain: "example.com", updatedAt: 100 },
    ]);
    expect(snapshot.autoLanguageRuntimes).toEqual([
      { tabId: 3, frameId: 1, runtimeGeneration: 2, domain: "example.com", updatedAt: 50 },
    ]);
  });
});
