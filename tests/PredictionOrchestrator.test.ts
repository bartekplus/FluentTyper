import { jest } from "bun:test";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import { PredictionOrchestrator } from "../src/adapters/chrome/background/PredictionOrchestrator";
import { Capitalization } from "../src/adapters/chrome/background/CapitalizationHelper";
import type { PresagePredictionContext } from "../src/adapters/chrome/background/PresageHandler";
import { DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED } from "../src/core/domain/constants";
import { mod } from "./fakeLibPresage.js";
import { predictionConfig } from "./support/predictionConfig";

interface OrchestratorPrivateProbe {
  resolvePresageSkipReason: (context: PresagePredictionContext) => string;
}

describe("PredictionOrchestrator coverage", () => {
  beforeEach(() => {
    mod.PresageCallback.predictions = ["alpha"];
  });

  afterEach(() => {
    mod.PresageCallback.predictions = [];
  });

  test("setConfig applies the Presage debug toggle default", () => {
    const presageHandler = new PresageHandler(mod);
    const orchestrator = new PredictionOrchestrator(presageHandler);

    orchestrator.setConfig(predictionConfig({ debugPresagePredictorEnabled: undefined }));

    expect(orchestrator.getDebugState().predictorConfig).toEqual({
      debugPresagePredictorEnabled: DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
    });
  });

  test("emits warning when debug listener throws", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const presageHandler = new PresageHandler(mod);
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(predictionConfig());

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
    const presageHandler = new PresageHandler(mod);
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(predictionConfig());

    let debugEvent: { presage?: { skipReason?: string } } | undefined;
    const result = await orchestrator.runPrediction("a", "", "xx_XX", {
      debugListener: (event) => {
        debugEvent = event;
      },
    });

    expect(result.predictions).toEqual([]);
    expect(debugEvent?.presage?.skipReason).toBe("language_engine_missing");
  });

  test("reports input skip reasons in debug event", async () => {
    const presageHandler = new PresageHandler(mod);
    const orchestrator = new PredictionOrchestrator(presageHandler);

    orchestrator.setConfig(predictionConfig());

    let separatorEvent: { presage?: { skipReason?: string } } | undefined;
    await orchestrator.runPrediction("a .", "", "en_US", {
      debugListener: (event) => {
        separatorEvent = event;
      },
    });

    expect(separatorEvent?.presage?.skipReason).toBe("input_not_predictable");

    orchestrator.setConfig(predictionConfig({ minWordLengthToPredict: 4 }));

    let inputEvent: { presage?: { skipReason?: string } } | undefined;
    await orchestrator.runPrediction("ab", "", "en_US", {
      debugListener: (event) => {
        inputEvent = event;
      },
    });

    expect(inputEvent?.presage?.skipReason).toBe("input_not_predictable");
  });

  test("reports Presage disabled-by-debug-toggle skip reason", async () => {
    const presageHandler = new PresageHandler(mod);
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(predictionConfig({ debugPresagePredictorEnabled: false }));

    let debugEvent: { presage?: { skipReason?: string } } | undefined;
    const result = await orchestrator.runPrediction("abc", "", "en_US", {
      debugListener: (event) => {
        debugEvent = event;
      },
    });

    expect(result.predictions).toEqual([]);
    expect(debugEvent?.presage?.skipReason).toBe("disabled_by_debug_toggle");
  });

  test("private helpers expose deterministic skip reason fallbacks", () => {
    const presageHandler = new PresageHandler(mod);
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(predictionConfig());
    const probe = orchestrator as unknown as OrchestratorPrivateProbe;

    const context: PresagePredictionContext = {
      text: "a",
      nextChar: "",
      lang: "en_US",
      predictionInput: "a",
      snippetToken: "a",
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
