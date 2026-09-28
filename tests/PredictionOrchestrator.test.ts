import { jest } from "bun:test";
import type { PresageModule } from "../src/adapters/chrome/background/PresageTypes";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import type { PredictionConfig } from "../src/adapters/chrome/background/PredictionOrchestrator";
import { PredictionOrchestrator } from "../src/adapters/chrome/background/PredictionOrchestrator";
import { Capitalization } from "../src/adapters/chrome/background/CapitalizationHelper";
import type { PresagePredictionContext } from "../src/adapters/chrome/background/PresageHandler";
import { DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED } from "../src/core/domain/constants";

interface OrchestratorPrivateProbe {
  resolvePresageSkipReason: (context: PresagePredictionContext) => string;
}

function createConfig(overrides: Partial<PredictionConfig> = {}): PredictionConfig {
  return {
    numSuggestions: 5,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: false,
    autoCapitalize: false,
    textExpansions: [],
    prefixOnlyMode: false,

    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
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
  test("setConfig applies the Presage debug toggle default", () => {
    const presageHandler = new PresageHandler(createFakeModule({ current: ["alpha"] }));
    const orchestrator = new PredictionOrchestrator(presageHandler);

    orchestrator.setConfig(createConfig({ debugPresagePredictorEnabled: undefined }));

    expect(orchestrator.getDebugState().predictorConfig).toEqual({
      debugPresagePredictorEnabled: DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
    });
  });

  test("emits warning when debug listener throws", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const module = createFakeModule({ current: ["alpha"] });
    const presageHandler = new PresageHandler(module);
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(createConfig());

    await expect(
      orchestrator.runPrediction("a", "", "en_US", {
        debugListener: () => {
          throw new Error("listener-failed");
        },
      }),
    ).resolves.toEqual({
      predictions: ["alpha"],
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
    const orchestrator = new PredictionOrchestrator(presageHandler);

    orchestrator.setConfig(
      createConfig({
        enabledGrammarRules: ["spacingRule", "capitalizeFirstLetter"],
      }),
    );

    let spacingEvent: { presage?: { skipReason?: string } } | undefined;
    await orchestrator.runPrediction("a .", "", "en_US", {
      debugListener: (event) => {
        spacingEvent = event;
      },
    });

    expect(spacingEvent?.presage?.skipReason).toBe("input_not_predictable");

    orchestrator.setConfig(createConfig({ minWordLengthToPredict: 4 }));

    let inputEvent: { presage?: { skipReason?: string } } | undefined;
    await orchestrator.runPrediction("ab", "", "en_US", {
      debugListener: (event) => {
        inputEvent = event;
      },
    });

    expect(inputEvent?.presage?.skipReason).toBe("input_not_predictable");
  });

  test("reports Presage disabled-by-debug-toggle skip reason", async () => {
    const presageHandler = new PresageHandler(createFakeModule({ current: ["alpha"] }));
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(createConfig({ debugPresagePredictorEnabled: false }));

    let debugEvent: { presage?: { skipReason?: string } } | undefined;
    const result = await orchestrator.runPrediction("abc", "", "en_US", {
      debugListener: (event) => {
        debugEvent = event;
      },
    });

    expect(result.predictions).toEqual([]);
    expect(debugEvent?.presage?.skipReason).toBe("disabled_by_debug_toggle");
  });

  test("keeps predictors running when grammar settings are enabled", async () => {
    const module = createFakeModule({ current: ["world", "word"] });
    const presageHandler = new PresageHandler(module);
    const orchestrator = new PredictionOrchestrator(presageHandler);

    orchestrator.setConfig(
      createConfig({
        minWordLengthToPredict: 1,
        autoCapitalize: true,
        enabledGrammarRules: ["capitalizeFirstLetter"],
      }),
    );

    const result = await orchestrator.runPrediction("w", "", "en_US");

    expect(result.predictions.length).toBeGreaterThan(0);
  });

  test("private helpers expose deterministic skip reason fallbacks", () => {
    const presageHandler = new PresageHandler(createFakeModule({ current: ["alpha"] }));
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(createConfig());
    const probe = orchestrator as unknown as OrchestratorPrivateProbe;

    const context: PresagePredictionContext = {
      text: "a",
      nextChar: "",
      lang: "en_US",
      predictionInput: "a",
      doPrediction: true,
      doCapitalize: Capitalization.None,
      effectiveNumSuggestions: 1,
    };

    expect(probe.resolvePresageSkipReason(context)).toBe("unknown");
    expect(probe.resolvePresageSkipReason({ ...context, effectiveNumSuggestions: 0 })).toBe(
      "num_suggestions_zero",
    );
  });
});
