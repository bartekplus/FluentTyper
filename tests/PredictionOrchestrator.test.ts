import { jest } from "bun:test";
import type { PresageModule } from "../src/adapters/chrome/background/PresageTypes";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import type { PredictionConfig } from "../src/adapters/chrome/background/PredictionOrchestrator";
import { PredictionOrchestrator } from "../src/adapters/chrome/background/PredictionOrchestrator";
import { Capitalization } from "../src/adapters/chrome/background/CapitalizationHelper";
import type { SecondaryPredictor } from "../src/adapters/chrome/background/PredictionTypes";
import type { PresagePredictionContext } from "../src/adapters/chrome/background/PresageHandler";
import {
  DEFAULT_AI_MODEL_ID,
  DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
} from "../src/core/domain/constants";

interface OrchestratorPrivateProbe {
  resolvePresageSkipReason: (context: PresagePredictionContext) => string;
  resolveAISkipReason: (context: PresagePredictionContext) => string;
  runAIPredictionWithTimeout: (
    lang: string,
    predictionInput: string,
    numSuggestions: number,
  ) => Promise<{
    predictions: string[];
    durationMs: number;
    timedOut: boolean;
  }>;
}

function createConfig(overrides: Partial<PredictionConfig> = {}): PredictionConfig {
  return {
    numSuggestions: 5,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: false,
    autoCapitalize: false,
    textExpansions: [],

    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
    aiPredictorEnabled: false,
    aiModelId: DEFAULT_AI_MODEL_ID,
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

describe("PredictionOrchestrator coverage", () => {
  test("setConfig clamps timeout, applies defaults and preloads when enabled", async () => {
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const aiPredictor = {
      setConfig: jest.fn(),
      preload: jest.fn(),
      predict: jest.fn(async () => []),
    };
    const orchestrator = new PredictionOrchestrator(
      presageHandler,
      aiPredictor as unknown as SecondaryPredictor,
    );

    orchestrator.setConfig(
      createConfig({
        aiPredictorEnabled: true,
        aiModelId: "   ",
        aiPredictionTimeoutMs: 99999,
        debugPresagePredictorEnabled: undefined,
        debugAIPredictorEnabled: undefined,
      }),
    );

    expect(aiPredictor.setConfig).toHaveBeenCalledWith({
      enabled: true,
      modelId: DEFAULT_AI_MODEL_ID,
    });
    expect(aiPredictor.preload).toHaveBeenCalledTimes(1);

    const debugState = orchestrator.getDebugState().predictorConfig;
    expect(debugState.aiPredictionTimeoutMs).toBe(2000);
    expect(debugState.debugPresagePredictorEnabled).toBe(DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED);
    expect(debugState.debugAIPredictorEnabled).toBe(DEFAULT_DEBUG_AI_PREDICTOR_ENABLED);
  });

  test("does not preload when AI is disabled", async () => {
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const aiPredictor = {
      setConfig: jest.fn(),
      preload: jest.fn(),
      predict: jest.fn(async () => []),
    };
    const orchestrator = new PredictionOrchestrator(
      presageHandler,
      aiPredictor as unknown as SecondaryPredictor,
    );

    orchestrator.setConfig(
      createConfig({
        aiPredictorEnabled: false,
        aiPredictionTimeoutMs: 1,
      }),
    );

    expect(aiPredictor.preload).not.toHaveBeenCalled();
    expect(orchestrator.getDebugState().predictorConfig.aiPredictionTimeoutMs).toBe(20);
  });

  test("returns predictor_unavailable skip reason when AI is enabled but missing", async () => {
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(createConfig({ aiPredictorEnabled: true }));

    let debugEvent: { webllm?: { skipReason?: string } } | undefined;
    const result = await orchestrator.runPrediction("a", "", "en_US", {
      debugListener: (event) => {
        debugEvent = event;
      },
    });

    expect(result.predictions).toEqual(["alpha"]);
    expect(debugEvent?.webllm?.skipReason).toBe("predictor_unavailable");
  });

  test("emits warning when debug listener throws", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(createConfig({ aiPredictorEnabled: false }));

    await expect(
      orchestrator.runPrediction("a", "", "en_US", {
        debugListener: () => {
          throw new Error("listener-failed");
        },
      }),
    ).resolves.toEqual({
      predictions: ["alpha"],
      forceReplace: null,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "[PredictionOrchestrator] Prediction debug listener failed",
      { error: "listener-failed" },
    );
    warnSpy.mockRestore();
  });

  test("reports presage skip reason when language engine is missing", async () => {
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(createConfig());

    let debugEvent: { presage?: { skipReason?: string } } | undefined;
    const result = await orchestrator.runPrediction("a", "", "xx_XX", {
      debugListener: (event) => {
        debugEvent = event;
      },
    });

    expect(result.predictions).toEqual([]);
    expect(debugEvent?.presage?.skipReason).toBe("language_engine_missing");
  });

  test("reports spacing and input skip reasons in debug event", async () => {
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const aiPredictor = {
      setConfig: jest.fn(),
      predict: jest.fn(async () => ["ai"]),
    };
    const orchestrator = new PredictionOrchestrator(
      presageHandler,
      aiPredictor as unknown as SecondaryPredictor,
    );

    orchestrator.setConfig(
      createConfig({
        aiPredictorEnabled: true,
        enabledGrammarRules: ["spacingRule", "capitalizeFirstLetter"],
      }),
    );

    let spacingEvent:
      | { presage?: { skipReason?: string }; webllm?: { skipReason?: string } }
      | undefined;
    await orchestrator.runPrediction("a .", "", "en_US", {
      debugListener: (event) => {
        spacingEvent = event;
      },
    });

    expect(spacingEvent?.presage?.skipReason).toBe("blocked_by_grammar_rule");
    expect(spacingEvent?.webllm?.skipReason).toBe("blocked_by_grammar_rule");

    orchestrator.setConfig(
      createConfig({
        aiPredictorEnabled: true,
        minWordLengthToPredict: 4,
      }),
    );

    let inputEvent:
      | { presage?: { skipReason?: string }; webllm?: { skipReason?: string } }
      | undefined;
    await orchestrator.runPrediction("ab", "", "en_US", {
      debugListener: (event) => {
        inputEvent = event;
      },
    });

    expect(inputEvent?.presage?.skipReason).toBe("input_not_predictable");
    expect(inputEvent?.webllm?.skipReason).toBe("input_not_predictable");
  });

  test("reports AI disabled-by-debug-toggle skip reason", async () => {
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const aiPredictor = {
      setConfig: jest.fn(),
      predict: jest.fn(async () => ["ai"]),
    };
    const orchestrator = new PredictionOrchestrator(
      presageHandler,
      aiPredictor as unknown as SecondaryPredictor,
    );
    orchestrator.setConfig(
      createConfig({
        aiPredictorEnabled: true,
        debugAIPredictorEnabled: false,
      }),
    );

    let debugEvent: { webllm?: { skipReason?: string } } | undefined;
    await orchestrator.runPrediction("abc", "", "en_US", {
      debugListener: (event) => {
        debugEvent = event;
      },
    });

    expect(debugEvent?.webllm?.skipReason).toBe("disabled_by_debug_toggle");
  });

  test("handles rejected AI predictions without failing request", async () => {
    const module = createFakeModule({ current: ["alpha", "beta"] });
    const presageHandler = new PresageHandler(module);
    const aiPredictor = {
      setConfig: jest.fn(),
      interruptActiveGeneration: jest.fn(() => true),
      predict: jest.fn(async () => {
        throw new Error("ai_failed");
      }),
    };
    const orchestrator = new PredictionOrchestrator(
      presageHandler,
      aiPredictor as unknown as SecondaryPredictor,
    );
    orchestrator.setConfig(createConfig({ aiPredictorEnabled: true }));

    const result = await orchestrator.runPrediction("a", "", "en_US");

    expect(result.predictions).toEqual(["alpha", "beta"]);
  });

  test("falls back when AI timeout interrupt throws", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const aiPredictor = {
      setConfig: jest.fn(),
      interruptActiveGeneration: jest.fn((reason: string) => {
        if (reason === "timeout") {
          throw new Error("interrupt_failed");
        }
        return true;
      }),
      predict: jest.fn(
        () =>
          new Promise<string[]>((resolve) => {
            setTimeout(() => resolve(["ai"]), 80);
          }),
      ),
    };
    const orchestrator = new PredictionOrchestrator(
      presageHandler,
      aiPredictor as unknown as SecondaryPredictor,
    );
    orchestrator.setConfig(
      createConfig({
        aiPredictorEnabled: true,
        aiPredictionTimeoutMs: 20,
      }),
    );

    const result = await orchestrator.runPrediction("a", "", "en_US");

    expect(result.predictions).toEqual(["alpha"]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[PredictionOrchestrator] Failed to interrupt WebLLM generation",
      expect.objectContaining({
        reason: "timeout",
        error: "interrupt_failed",
      }),
    );
    warnSpy.mockRestore();
  });

  test("handles malformed AI predictor implementation through catch fallback", async () => {
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const aiPredictor = {
      setConfig: jest.fn(),
      interruptActiveGeneration: jest.fn(() => true),
      predict: jest.fn(() => undefined as unknown as Promise<string[]>),
    };
    const orchestrator = new PredictionOrchestrator(
      presageHandler,
      aiPredictor as unknown as SecondaryPredictor,
    );
    orchestrator.setConfig(createConfig({ aiPredictorEnabled: true }));

    const result = await orchestrator.runPrediction("a", "", "en_US");

    expect(result.predictions).toEqual(["alpha"]);
  });

  test("private helpers expose deterministic skip reason fallbacks", async () => {
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const aiPredictor = {
      setConfig: jest.fn(),
      interruptActiveGeneration: jest.fn(() => true),
      predict: jest.fn(async () => ["ai"]),
    };
    const orchestrator = new PredictionOrchestrator(
      presageHandler,
      aiPredictor as unknown as SecondaryPredictor,
    );
    orchestrator.setConfig(createConfig({ aiPredictorEnabled: true }));
    const probe = orchestrator as unknown as OrchestratorPrivateProbe;

    const context: PresagePredictionContext = {
      text: "a",
      nextChar: "",
      lang: "en_US",
      predictionInput: "a",
      doPrediction: true,
      doCapitalize: Capitalization.None,
      forceReplace: null,
      effectiveNumSuggestions: 1,
    };

    expect(probe.resolvePresageSkipReason(context)).toBe("unknown");
    expect(probe.resolveAISkipReason(context)).toBe("unknown");

    const zeroSuggestionContext = {
      ...context,
      effectiveNumSuggestions: 0,
    };
    expect(probe.resolvePresageSkipReason(zeroSuggestionContext)).toBe("num_suggestions_zero");
    expect(probe.resolveAISkipReason(zeroSuggestionContext)).toBe("num_suggestions_zero");

    const noPredictorOrchestrator = new PredictionOrchestrator(presageHandler);
    const noPredictorProbe = noPredictorOrchestrator as unknown as OrchestratorPrivateProbe;
    const aiResult = await noPredictorProbe.runAIPredictionWithTimeout("en_US", "a", 2);
    expect(aiResult).toEqual({
      predictions: [],
      durationMs: 0,
      timedOut: false,
    });
  });
});
