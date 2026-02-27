import { jest } from "@jest/globals";
import type { PresageModule } from "../src/background/PresageTypes";
import { PresageHandler, PresageConfig } from "../src/background/PresageHandler";
import type { WebLLMPredictor } from "../src/background/WebLLMPredictor";

function createConfig(overrides: Partial<PresageConfig> = {}): PresageConfig {
  return {
    numSuggestions: 6,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: false,
    autoCapitalize: false,
    applySpacingRules: false,
    textExpansions: [],
    variableExpansion: false,
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
    aiPredictorEnabled: false,
    aiModelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    ...overrides,
  };
}

function createFakeModule(predictionsRef: { current: string[] }): PresageModule {
  const callback = {
    pastStream: "",
    get_past_stream() {
      return this.pastStream;
    },
    get_future_stream() {
      return "";
    },
  };

  return {
    PresageCallback: {
      implement: () => callback,
    },
    Presage: class {
      constructor() {}
      config() {}
      predictWithProbability() {
        return {
          size: () => predictionsRef.current.length,
          get: (idx: number) => ({
            prediction: predictionsRef.current[idx],
            probability: 1,
          }),
        };
      }
    },
    FS: { writeFile: jest.fn() },
  } as unknown as PresageModule;
}

describe("PresageHandler parallel merge", () => {
  test("keeps Presage-only behavior when AI predictor is disabled", async () => {
    const predictionsRef = { current: ["alpha", "beta"] };
    const module = createFakeModule(predictionsRef);
    const aiPredictor = {
      setConfig: jest.fn(),
      predict: jest.fn(async () => ["from-ai"]),
    };
    const handler = new PresageHandler(
      module,
      aiPredictor as unknown as WebLLMPredictor,
    );
    handler.setConfig(createConfig({ aiPredictorEnabled: false }));

    const result = await Promise.resolve(
      handler.runPrediction("a", "", "en_US"),
    );

    expect(result.predictions).toEqual(["alpha", "beta"]);
    expect(aiPredictor.predict).not.toHaveBeenCalled();
  });

  test("merges Presage and AI suggestions with deterministic 2:1 interleave", async () => {
    const predictionsRef = {
      current: ["alpha", "beta", "charlie", "delta", "echo"],
    };
    const module = createFakeModule(predictionsRef);
    const aiPredictor = {
      setConfig: jest.fn(),
      predict: jest.fn(async () => ["xray", "yankee", "zulu"]),
    };
    const handler = new PresageHandler(module, aiPredictor as any);
    handler.setConfig(createConfig({ aiPredictorEnabled: true, numSuggestions: 6 }));

    const result = await Promise.resolve(
      handler.runPrediction("a", "", "en_US"),
    );

    expect(result.predictions).toEqual([
      "alpha",
      "beta",
      "xray",
      "charlie",
      "delta",
      "yankee",
    ]);
  });

  test("starts WebLLM before running Presage so both execute in parallel", async () => {
    const predictionsRef = {
      current: ["alpha", "beta", "charlie"],
    };
    const module = createFakeModule(predictionsRef);
    const aiPredictor = {
      setConfig: jest.fn(),
      predict: jest.fn(async () => ["from-ai"]),
    };
    const handler = new PresageHandler(module, aiPredictor as any);
    handler.setConfig(createConfig({ aiPredictorEnabled: true, numSuggestions: 3 }));

    const doPredictionSpy = jest
      .spyOn(handler, "doPredictionHandler")
      .mockImplementation(() => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 10) {
          // Intentional sync work to make invocation order observable.
        }
        return ["alpha", "beta", "charlie"];
      });

    const result = await Promise.resolve(
      handler.runPrediction("a", "", "en_US"),
    );

    expect(result.predictions).toEqual(["alpha", "beta", "from-ai"]);
    expect(aiPredictor.predict).toHaveBeenCalledTimes(1);
    expect(doPredictionSpy).toHaveBeenCalledTimes(1);
    expect(aiPredictor.predict.mock.invocationCallOrder[0]).toBeLessThan(
      doPredictionSpy.mock.invocationCallOrder[0],
    );
  });

  test("deduplicates merged output and fills remaining slots", async () => {
    const predictionsRef = { current: ["alpha", "beta", "epsilon"] };
    const module = createFakeModule(predictionsRef);
    const aiPredictor = {
      setConfig: jest.fn(),
      predict: jest.fn(async () => ["beta", "gamma", "delta"]),
    };
    const handler = new PresageHandler(module, aiPredictor as any);
    handler.setConfig(createConfig({ aiPredictorEnabled: true, numSuggestions: 4 }));

    const result = await Promise.resolve(
      handler.runPrediction("a", "", "en_US"),
    );

    expect(result.predictions).toEqual(["alpha", "beta", "epsilon", "gamma"]);
  });

  test("runs AI predictor when Presage debug route is disabled", async () => {
    const predictionsRef = { current: ["alpha", "beta"] };
    const module = createFakeModule(predictionsRef);
    const aiPredictor = {
      setConfig: jest.fn(),
      predict: jest.fn(async () => ["fromai", "nextai"]),
    };
    const handler = new PresageHandler(module, aiPredictor as any);
    handler.setConfig(
      createConfig({
        aiPredictorEnabled: true,
        debugPresagePredictorEnabled: false,
        debugAIPredictorEnabled: true,
        numSuggestions: 2,
      }),
    );

    const result = await Promise.resolve(
      handler.runPrediction("hello", "", "en_US"),
    );

    expect(aiPredictor.predict).toHaveBeenCalledTimes(1);
    expect(result.predictions).toEqual(["fromai", "nextai"]);
  });

  test("respects configurable AI timeout budget", async () => {
    const predictionsRef = { current: ["alpha", "beta", "charlie"] };
    const module = createFakeModule(predictionsRef);
    const aiPredictor = {
      setConfig: jest.fn(),
      interruptActiveGeneration: jest.fn(),
      predict: jest.fn(
        () =>
          new Promise<string[]>((resolve) => {
            setTimeout(() => resolve(["xray", "yankee"]), 80);
          }),
      ),
    };
    const handler = new PresageHandler(module, aiPredictor as any);
    handler.setConfig(
      createConfig({
        aiPredictorEnabled: true,
        aiPredictionTimeoutMs: 30,
        numSuggestions: 4,
      }),
    );
    let debugEvent: { webllm?: { timedOut?: boolean } } | undefined;

    const result = await Promise.resolve(
      handler.runPrediction("a", "", "en_US", {
        debugListener: (event) => {
          debugEvent = event;
        },
      }),
    );

    expect(result.predictions).toEqual(["alpha", "beta", "charlie"]);
    expect(aiPredictor.predict).toHaveBeenCalledTimes(1);
    expect(aiPredictor.interruptActiveGeneration).toHaveBeenCalledWith(
      "timeout",
      {
        lang: "en_US",
        predictionInput: "a",
      },
    );
    expect(debugEvent?.webllm?.timedOut).toBe(true);
  });
});
